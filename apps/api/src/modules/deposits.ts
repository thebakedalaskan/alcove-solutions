/*
 * Credit top-ups: payments into the treasury through a deposit provider (docs: payments-and-usage). What a deposit is
 * (route, address, memo, the provider's quote) is sealed under Kservice's accounting key, like billing state; its row
 * says only whose it is, its state, and when to look at it again.
 */
import { TopUpStateSchema, type TopUp, type TopUpRoutes, type TopUpState } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { invalid, notFound, UnavailableError } from '../errors';
import { log } from '../log';
import {
  depositProviders, formatUnits, type DepositCheck, type DepositProvider, type DepositRoute, type OpenDepositState, type OpenedDeposit
} from '../payments/provider';
import { TIERS, credit, creditsFor } from './billing';

const dlog = log.child({ component: 'deposits' });
/** IDs are 22 characters of base64url; anything else names nothing. */
const ID128 = /^[A-Za-z0-9_-]{22}$/;
/** How long after its address expires a deposit is still watched, for a payment that was on its way. */
const GIVE_UP_AFTER_MS = 24 * 3_600_000;
/** Opening a top-up asks the provider about it at most this often. */
const CHECK_EVERY_MS = 5_000;
/** A refund below this, in micro-USD, isn't credited: the deposit is held instead. */
const REFUND_FLOOR = 1_000_000n;
const OPEN: readonly TopUpState[] = ['waiting', 'arriving', 'short'];
const isOpen = (s: TopUpState): s is OpenDepositState => s === 'waiting' || s === 'arriving' || s === 'short';
const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string, depositId: string) => ({ v: 1 as const, kind: 'deposit', ownerId, depositId, keyVersion: '1' });
const units = z.string().regex(/^\d+$/);

/** What a deposit is, sealed. Amounts are in the token's smallest unit, as integer strings. */
export const DepositRecord = z.object({
  route: z.object({
    id: z.string(), provider: z.literal('oneclick'), chain: z.string(), chainName: z.string(), token: z.enum(['USDC', 'USDT']),
    decimals: z.number().int().min(0), minimum: units
  }),
  address: z.string(),
  memo: z.string().nullable(),
  expiresAt: z.string(),
  minimum: units,
  /** The provider's whole quote response, signature included, kept for disputes. */
  quote: z.unknown(),
  /**
   * Once settled: what was sent, what reached the treasury as USDC and what was refunded to it instead (micro-USD,
   * integer strings), the credits it added (0 when held), and the provider's name for the settlement.
   */
  settled: z.object({ sentMicroUsd: units, outMicroUsd: units, refundedMicroUsd: units, credits: z.number().int(), providerRef: z.string() })
    .nullable().default(null)
});
export type DepositRecord = z.infer<typeof DepositRecord>;

/** The providers this server is set up with. Every top-up endpoint is unavailable when top-ups are off here. */
function providers(d: Deps): DepositProvider[] {
  const p = depositProviders(d.cfg);
  if (!p) throw new UnavailableError('Adding credits isn’t available on this server.');
  return Object.values(p);
}
const toRoute = (r: DepositRecord['route'] | DepositRoute) => ({
  id: r.id, chain: r.chain, chainName: r.chainName, token: r.token, minimum: formatUnits(BigInt(r.minimum), r.decimals)
});
/** A deposit as the person sees it. Its address is shown only while money can still be sent to it. */
function toTopUp(depositId: string, r: DepositRecord, state: TopUpState): TopUp {
  const sendable = state === 'waiting' || state === 'short';
  return {
    id: depositId, route: toRoute(r.route), address: sendable ? r.address : null, memo: sendable ? r.memo : null,
    expiresAt: r.expiresAt, state,
    received: r.settled
      ? { amount: formatUnits(BigInt(r.settled.outMicroUsd) + BigInt(r.settled.refundedMicroUsd), 6), credits: r.settled.credits }
      : null
  };
}

export async function routes(d: Deps): Promise<TopUpRoutes> {
  const all = (await Promise.all(providers(d).map((p) => p.routes()))).flat();
  return {
    routes: all.map(toRoute),
    tiers: TIERS.map((t) => ({ from: formatUnits(t.fromMicroUsd, 6), creditsPerUsd: Number(t.creditsPerUsd.num) / Number(t.creditsPerUsd.den) }))
  };
}

/** Opens a top-up on a route: the provider quotes an address paying the treasury, and the deposit is kept sealed. */
export async function start(d: Deps, ownerId: string, routeId: string): Promise<TopUp> {
  const found = (await Promise.all(providers(d).map(async (p) => ({ p, route: (await p.routes()).find((r) => r.id === routeId) })))).find((x) => x.route);
  if (!found?.route) throw invalid('That way to pay isn’t offered.');
  const opened = await found.p.open(found.route);
  const depositId = id128();
  const record: DepositRecord = {
    route: { ...opened.route, minimum: opened.route.minimum.toString() },
    address: opened.address, memo: opened.memo, expiresAt: opened.expiresAt, minimum: opened.minimum.toString(), quote: opened.quote,
    settled: null
  };
  const giveUpAt = new Date(Date.parse(opened.expiresAt) + GIVE_UP_AFTER_MS);
  await exec(d.pool, 'INSERT INTO deposits (owner_id, deposit_id, provider, state, give_up_at, record_ciphertext) VALUES ($1,$2,$3,$4,$5,$6)',
    [ownerId, depositId, found.p.name, 'waiting', giveUpAt, sealJson(key(d), header(ownerId, depositId), toJson(record))]);
  dlog.info('top-up opened', { depositId, provider: found.p.name, state: 'waiting' });
  return toTopUp(depositId, record, 'waiting');
}

const Row = z.object({ deposit_id: z.string(), state: TopUpStateSchema, record_ciphertext: bytea, created_at: timestamp });
const record = (d: Deps, ownerId: string, r: z.infer<typeof Row>) => openJson(key(d), header(ownerId, r.deposit_id), r.record_ciphertext, DepositRecord);
const open = (d: Deps, ownerId: string, r: z.infer<typeof Row>) => toTopUp(r.deposit_id, record(d, ownerId, r), r.state);
/** The deposit as its provider handed it out. */
const opened = (r: DepositRecord): OpenedDeposit => ({
  route: { ...r.route, minimum: BigInt(r.route.minimum) }, address: r.address, memo: r.memo, expiresAt: r.expiresAt,
  minimum: BigInt(r.minimum), quote: toJson(r.quote)
});

const Checked = Row.extend({ checked_at: timestamp.nullable() });
const find = (db: Db, ownerId: string, depositId: string) => ID128.test(depositId)
  ? maybeOne(db, Checked, 'SELECT deposit_id, state, record_ciphertext, created_at, checked_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId])
  : Promise.resolve(undefined);

/** A top-up, asking its provider first while it's open and hasn't been asked in the last 5 seconds. */
export async function get(d: Deps, ownerId: string, depositId: string): Promise<TopUp> {
  const all = providers(d); // off here: unavailable, even for a top-up opened before
  const r = await find(d.pool, ownerId, depositId);
  if (!r) throw notFound('That top-up');
  if (!isOpen(r.state) || (r.checked_at && Date.now() - r.checked_at.getTime() < CHECK_EVERY_MS)) return open(d, ownerId, r);
  const rec = record(d, ownerId, r);
  const p = all.find((x) => x.name === rec.route.provider);
  if (!p) return toTopUp(depositId, rec, r.state);
  let check: DepositCheck;
  try {
    check = await p.check(opened(rec), r.state);
  } catch (e) {
    dlog.warn('top-up check failed', { depositId, provider: p.name, err: e });
    return toTopUp(depositId, rec, r.state);
  }
  await apply(d, ownerId, depositId, check);
  const now = await find(d.pool, ownerId, depositId);
  if (!now) throw notFound('That top-up');
  return open(d, ownerId, now);
}

/**
 * Records what the provider says, in one transaction with the deposit row locked, so a deposit credits at most once
 * however many watchers and requests race on it: a final state is never changed again. A settled deposit credits the
 * tier's rate on what reached the treasury (the USDC out, plus a refund of at least 1 USD), or is held when that
 * comes to no credits.
 */
export async function apply(d: Deps, ownerId: string, depositId: string, check: DepositCheck): Promise<TopUpState> {
  return tx(d.pool, async (c) => {
    const r = await maybeOne(c, Row, 'SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2 FOR UPDATE', [ownerId, depositId]);
    if (!r) throw notFound('That top-up');
    if (!isOpen(r.state)) return r.state;
    const rec = record(d, ownerId, r);
    const provider = rec.route.provider;
    if (check.state === 'settled') {
      const refundCounted = check.refundedMicroUsd >= REFUND_FLOOR ? check.refundedMicroUsd : 0n;
      const credits = creditsFor(check.sentMicroUsd, check.outMicroUsd + refundCounted);
      const state: TopUpState = credits > 0 ? 'credited' : 'held';
      if (credits > 0) await credit(d, c, ownerId, { amount: credits, label: `Credits added, ${formatUnits(check.sentMicroUsd, 6)} ${rec.route.token}` });
      const next: DepositRecord = {
        ...rec,
        settled: {
          sentMicroUsd: check.sentMicroUsd.toString(), outMicroUsd: check.outMicroUsd.toString(), refundedMicroUsd: check.refundedMicroUsd.toString(),
          credits, providerRef: check.providerRef
        }
      };
      await exec(c, 'UPDATE deposits SET state = $3, checked_at = now(), record_ciphertext = $4 WHERE owner_id = $1 AND deposit_id = $2',
        [ownerId, depositId, state, sealJson(key(d), header(ownerId, depositId), toJson(next))]);
      dlog.info('top-up settled', { depositId, provider, state });
      return state;
    }
    if (check.state === 'failed') {
      await exec(c, 'UPDATE deposits SET state = $3, checked_at = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId, 'failed']);
      dlog.error('top-up failed', { depositId, provider });
      return 'failed';
    }
    await exec(c, 'UPDATE deposits SET state = $3, checked_at = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId, check.state]);
    if (check.state !== r.state) dlog.info('top-up moved', { depositId, provider, state: check.state });
    return check.state;
  });
}

/** Checks the deposits that are due and records what their providers say. Claims nothing yet. */
export function watch(_d: Deps): Promise<{ checked: number; credited: number }> {
  return Promise.resolve({ checked: 0, credited: 0 });
}

/** Top-ups still open, and the last 10 finished, newest first. */
export async function list(d: Deps, ownerId: string): Promise<TopUp[]> {
  providers(d); // off here: unavailable, even with top-ups opened before
  const found = await rows(d.pool, Row, `
    (SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND state = ANY($2))
    UNION ALL
    (SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND NOT state = ANY($2) ORDER BY created_at DESC LIMIT 10)
    ORDER BY created_at DESC`, [ownerId, OPEN]);
  return found.map((r) => open(d, ownerId, r));
}
