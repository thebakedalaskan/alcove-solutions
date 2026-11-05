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
  depositProviders, formatUnits, type DepositCheck, type DepositProviderName, type DepositProvider, type DepositRoute, type OpenDepositState, type OpenedDeposit
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

/** How many due deposits one watcher pass takes on, and how many of them it works on at once. */
const WATCH_BATCH = 20;
const WATCH_AT_ONCE = 4;
const Due = z.object({
  owner_id: z.string(), deposit_id: z.string(), provider: z.literal('oneclick'), state: TopUpStateSchema, record_ciphertext: bytea,
  created_at: timestamp, given_up: z.boolean()
});

/** Runs `fn` over `items` with at most `n` in flight, so a pass neither takes the whole pool nor floods a provider. */
async function atMost<T, R>(n: number, items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const lane = async () => {
    for (let item = items[next++]; item !== undefined; item = items[next++]) out.push(await fn(item));
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
  return out;
}

/**
 * Gives up on a deposit past `give_up_at`: still waiting, nothing came and it has expired; still arriving or short,
 * or its record no longer opens, something is wrong, so it fails with an error log and reaches support instead of
 * being checked for ever.
 */
function giveUp(d: Deps, ownerId: string, depositId: string, provider: DepositProviderName, unreadable: boolean): Promise<TopUpState | undefined> {
  return tx(d.pool, async (c) => {
    const r = await maybeOne(c, z.object({ state: TopUpStateSchema }), 'SELECT state FROM deposits WHERE owner_id = $1 AND deposit_id = $2 FOR UPDATE', [ownerId, depositId]);
    if (!r || !isOpen(r.state)) return r?.state;
    const state: TopUpState = r.state === 'waiting' && !unreadable ? 'expired' : 'failed';
    await exec(c, 'UPDATE deposits SET state = $3, checked_at = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId, state]);
    if (unreadable) dlog.error('top-up failed, its record doesn’t open', { depositId });
    else if (state === 'failed') dlog.error('top-up failed', { depositId, provider, was: r.state });
    else dlog.info('top-up expired', { depositId, provider });
    return state;
  });
}

/**
 * One pass of the watcher (server.ts runs it every 5 seconds). It claims up to 20 due deposits in one statement,
 * pushing each one's next check 60 seconds ahead as a lease, so another API instance's pass skips them, and works on
 * 4 at a time. Each is checked with its provider and the answer applied, and its next check set by its age: every 10
 * seconds for 15 minutes, every minute until 2 hours, then every 5 minutes until `give_up_at`. When the provider can't
 * answer, the state stays (logged at warn) and it's asked again in a minute. Past `give_up_at` it's asked once more:
 * a finished swap is applied as usual, and anything else gives up on it.
 */
export async function watch(d: Deps): Promise<{ checked: number; credited: number }> {
  const all = depositProviders(d.cfg);
  if (!all) return { checked: 0, credited: 0 };
  const due = await rows(d.pool, Due, `
    UPDATE deposits SET check_after = now() + interval '60 seconds'
    WHERE (owner_id, deposit_id) IN (
      SELECT owner_id, deposit_id FROM deposits WHERE state IN ('waiting','arriving','short') AND check_after <= now()
      ORDER BY check_after LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING owner_id, deposit_id, provider, state, record_ciphertext, created_at, give_up_at <= now() AS given_up`, [WATCH_BATCH]);
  const done = await atMost(WATCH_AT_ONCE, due, async (r): Promise<TopUpState | undefined> => {
    const { deposit_id: depositId, owner_id: ownerId, provider } = r;
    try {
      if (!isOpen(r.state)) return r.state;
      let rec: DepositRecord;
      try {
        rec = record(d, ownerId, r);
      } catch (e) {
        if (r.given_up) return await giveUp(d, ownerId, depositId, provider, true);
        throw e;
      }
      let check: DepositCheck;
      try {
        check = await all[provider].check(opened(rec), r.state);
      } catch (e) {
        dlog.warn('top-up check failed', { depositId, provider, err: e });
        if (r.given_up) return await giveUp(d, ownerId, depositId, provider, false);
        await exec(d.pool, "UPDATE deposits SET check_after = now() + interval '60 seconds' WHERE owner_id = $1 AND deposit_id = $2", [ownerId, depositId]);
        return r.state;
      }
      if (r.given_up && check.state !== 'settled' && check.state !== 'failed') return await giveUp(d, ownerId, depositId, provider, false);
      const state = await apply(d, ownerId, depositId, check);
      await exec(d.pool, `
        UPDATE deposits SET check_after = LEAST(give_up_at, now() + CASE
          WHEN now() - created_at < interval '15 minutes' THEN interval '10 seconds'
          WHEN now() - created_at < interval '2 hours' THEN interval '60 seconds'
          ELSE interval '5 minutes' END)
        WHERE owner_id = $1 AND deposit_id = $2`, [ownerId, depositId]);
      return state;
    } catch (e) {
      dlog.error('top-up not watched', { depositId, err: e });
      return undefined;
    }
  });
  return { checked: due.length, credited: done.filter((s) => s === 'credited').length };
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
