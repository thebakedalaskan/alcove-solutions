/*
 * Credit top-ups: payments into the treasury through a deposit provider (docs: payments-and-usage). What a deposit is
 * (route, address, memo, the provider's quote) is sealed under Kservice's accounting key, like billing state; its row
 * says only whose it is, its state, and when to look at it again.
 */
import { TopUpStateSchema, type TopUp, type TopUpRoutes, type TopUpState } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp } from '../db';
import { invalid, notFound, UnavailableError } from '../errors';
import { log } from '../log';
import { depositProviders, formatUnits, type DepositProvider, type DepositRoute } from '../payments/provider';
import { TIERS } from './billing';

const dlog = log.child({ component: 'deposits' });
/** IDs are 22 characters of base64url; anything else names nothing. */
const ID128 = /^[A-Za-z0-9_-]{22}$/;
/** How long after its address expires a deposit is still watched, for a payment that was on its way. */
const GIVE_UP_AFTER_MS = 24 * 3_600_000;
const OPEN: readonly TopUpState[] = ['waiting', 'arriving', 'short'];
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
  quote: z.unknown()
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
    expiresAt: r.expiresAt, state, received: null
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
    address: opened.address, memo: opened.memo, expiresAt: opened.expiresAt, minimum: opened.minimum.toString(), quote: opened.quote
  };
  const giveUpAt = new Date(Date.parse(opened.expiresAt) + GIVE_UP_AFTER_MS);
  await exec(d.pool, 'INSERT INTO deposits (owner_id, deposit_id, provider, state, give_up_at, record_ciphertext) VALUES ($1,$2,$3,$4,$5,$6)',
    [ownerId, depositId, found.p.name, 'waiting', giveUpAt, sealJson(key(d), header(ownerId, depositId), toJson(record))]);
  dlog.info('top-up opened', { depositId, provider: found.p.name, state: 'waiting' });
  return toTopUp(depositId, record, 'waiting');
}

const Row = z.object({ deposit_id: z.string(), state: TopUpStateSchema, record_ciphertext: bytea, created_at: timestamp });
const open = (d: Deps, ownerId: string, r: z.infer<typeof Row>) =>
  toTopUp(r.deposit_id, openJson(key(d), header(ownerId, r.deposit_id), r.record_ciphertext, DepositRecord), r.state);

export async function get(d: Deps, ownerId: string, depositId: string): Promise<TopUp> {
  providers(d); // off here: unavailable, even for a top-up opened before
  const r = ID128.test(depositId)
    ? await maybeOne(d.pool, Row, 'SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId])
    : undefined;
  if (!r) throw notFound('That top-up');
  return open(d, ownerId, r);
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
