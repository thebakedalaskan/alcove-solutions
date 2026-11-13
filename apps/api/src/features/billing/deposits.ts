/*
 * Top-ups: payments into the treasury through a deposit provider, added to the balance plans are bought with (docs:
 * Plans and usage), a token as a dollar, and what one was opened to buy, bought with it once it's added. What a deposit
 * is (route, address, memo, the provider's quote, what it buys) is sealed under Kservice's accounting key, like the plan;
 * its row says only whose it is, its state and when to look at it again.
 */
import { MAX_TOP_UP_MICRO_USD, TopUpStateSchema, type Purchase, type TopUp, type TopUpRoutes, type TopUpState } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { bytea, exec, maybeOne, rows, STATEMENT_TIMEOUT_MS, timestamp, tx, type Db } from '../../db';
import { conflict, DatabaseError, invalid, notFound, NotFoundError, UnavailableError } from '../../errors';
import { log } from '../../log';
import {
  depositProviders, formatUnits, fromMicroUsd, PROVIDER_TIMEOUT_MS, toMicroUsd, type DepositAddress, type DepositCheck, type DepositProviderName,
  type DepositProvider, type DepositRoute, type DoubtReason, type OpenDepositState
} from './provider';
import { LIMITS, limitsNow } from '../../limits';
import { buyerOf, credit, purchase, refusalOf, refusedError } from './plans';
import { adminsTeam, licensesBought, type TeamRow } from './teams';

const dlog = log.child({ component: 'deposits' });
/** IDs are 22 characters of base64url; anything else names nothing. */
const ID128 = /^[A-Za-z0-9_-]{22}$/;
/** How long after its address expires a deposit is still watched, for a payment that was on its way. */
const GIVE_UP_AFTER_MS = 24 * 3_600_000;
/** How many top-ups one owner may have waiting for a payment at once, and open in any 24 hours (cancelled ones too). */
const MAX_WAITING = 15;
const MAX_A_DAY = 30;
/**
 * The least of what was sent that must have reached the treasury (swapped out, or refunded to it) for a settled deposit
 * to credit, in basis points: 1Click's fee and up to 1% slippage on a swap between stablecoins, with room to spare.
 */
const REACHED_BPS = 9_850n;
/** Amounts the app offers first, in periods of Pro at its price now. */
const PRESET_PERIODS = [1, 3, 6];
const OPEN: readonly TopUpState[] = ['waiting', 'arriving', 'short'];
const isOpen = (s: TopUpState): s is OpenDepositState => s === 'waiting' || s === 'arriving' || s === 'short';
/**
 * Not given up on: open, or cancelled, since 1Click can't cancel a quote and a payment sent to a cancelled top-up's
 * address must still be credited. Past `give_up_at` these stay as they are while the provider can't answer.
 */
type PendingState = OpenDepositState | 'cancelled';
const isPending = (s: TopUpState): s is PendingState => isOpen(s) || s === 'cancelled';
const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string, depositId: string) => ({ v: 1 as const, kind: 'deposit', ownerId, depositId, keyVersion: '1' });
const units = z.string().regex(/^\d+$/);
/**
 * What a top-up is to buy, as its buyer asked for it: months of Pro at the price they were shown, or packs of more notes at
 * the price and size they were shown. Kept as a record's own shape, not the contract's, so a bound the contract changes
 * never stops a record from opening. One kept without a pack's size reads as a pack of the default size.
 */
const Buys = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pro'), months: z.number().int(), microUsdPerMonth: z.number().int() }),
  z.object({ kind: z.literal('hours'), packs: z.number().int(), microUsdPerPack: z.number().int(), minutesPerPack: z.number().int().default(LIMITS['plan.hours.pack_minutes'].default) }),
  z.object({ kind: z.literal('licenses'), count: z.number().int(), microUsdPerLicense: z.number().int() })
]);

/**
 * What a deposit is, sealed. Token amounts are in the token's smallest unit, as integer strings. USDT is no longer
 * offered, but deposits opened with it before still open.
 */
export const DepositRecord = z.object({
  route: z.object({
    id: z.string(), provider: z.literal('oneclick'), chain: z.string(), chainName: z.string(), token: z.enum(['USDC', 'USDT']),
    decimals: z.number().int().min(0), minimum: units
  }),
  address: z.string(),
  memo: z.string().nullable(),
  expiresAt: z.string(),
  /**
   * What the person was asked to send, and the least the provider still swaps (its quote's `minAmountIn`). A deposit
   * opened before plans also has the credits it promised, which no longer count: it's added as dollars like any other.
   */
  asked: units,
  minAmountIn: units,
  /** The provider's whole quote response, signature included, kept for disputes. */
  quote: z.unknown(),
  /** What the provider last said arrived, while the deposit was still open (micro-USD), or null before it said. */
  seenMicroUsd: units.nullable(),
  /**
   * Once settled: what was sent, what reached the treasury as USDC and what was refunded to it instead (micro-USD,
   * integer strings), what it added to the balance (micro-USD; 0 when held), and the provider's name for the
   * settlement. One settled before plans added credits instead, and has no `addedMicroUsd`.
   */
  settled: z.object({ sentMicroUsd: units, outMicroUsd: units, refundedMicroUsd: units, addedMicroUsd: units.nullable().default(null), providerRef: z.string() })
    .nullable().default(null),
  /** Whether it was logged that the provider couldn't answer past `give_up_at`, so it's logged once. */
  unanswered: z.boolean().default(false),
  /** Why the provider's last finished answer wasn't credited, so each reason is logged at error once. */
  doubt: z.string().nullable().default(null),
  /**
   * What it was opened to buy once its money is added, and how that went: `waiting` until it's added, then `bought`, or
   * `refused` with why, in words for people (the money stays in the balance). Null for a top-up that only adds money, and
   * for one opened before top-ups bought anything.
   */
  purchase: z.object({ buys: Buys, outcome: z.enum(['waiting', 'bought', 'refused']), why: z.string().nullable() }).nullable().default(null)
});
export type DepositRecord = z.infer<typeof DepositRecord>;
type DepositPurchase = NonNullable<DepositRecord['purchase']>;

/** The providers this server is set up with. Every top-up endpoint is unavailable when top-ups are off here. */
function providers(d: Deps): DepositProvider[] {
  const p = depositProviders(d.cfg);
  if (!p) throw new UnavailableError('Adding money isn’t available on this server.');
  return Object.values(p);
}
/** The least a route takes, in micro-USD: its minimum, a token as a dollar. */
const minimumOf = (r: { minimum: bigint | string; decimals: number }) => toMicroUsd(BigInt(r.minimum), r.decimals);
const toRoute = (r: DepositRecord['route'] | DepositRoute) => ({
  id: r.id, chain: r.chain, chainName: r.chainName, token: r.token, minimum: formatUnits(BigInt(r.minimum), r.decimals)
});
/** A deposit as the person sees it. Its address is shown only while a payment is awaited: one payment per address. */
function toTopUp(depositId: string, r: DepositRecord, state: TopUpState): TopUp {
  // Short: 1Click adds whatever else arrives before its deadline, so the rest can still be sent to the same address.
  const sendable = state === 'waiting' || state === 'short';
  const sent = r.settled?.sentMicroUsd ?? r.seenMicroUsd;
  return {
    id: depositId, route: toRoute(r.route), address: sendable ? r.address : null, memo: sendable ? r.memo : null,
    expiresAt: r.expiresAt, state,
    asked: { amount: formatUnits(BigInt(r.asked), r.route.decimals) },
    received: sent === null ? null : { amount: formatUnits(BigInt(sent), 6), microUsd: r.settled ? Number(r.settled.addedMicroUsd ?? 0) : null },
    purchase: r.purchase
  };
}

export async function routes(d: Deps): Promise<TopUpRoutes> {
  const all = (await Promise.all(providers(d).map((p) => p.routes()))).flat();
  const pro = (await limitsNow(d)).get('plan.pro.price_micro_usd');
  return { routes: all.map(toRoute), presets: pro > 0 ? PRESET_PERIODS.map((n) => n * pro) : [] };
}

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
/**
 * Refuses another top-up while the owner has 15 waiting for a payment to an address that hasn't expired, or opened 30
 * in the last 24 hours (cancelled ones count: each was a quote, and is watched until its address expires). Counted in
 * Postgres, so it holds across API instances.
 */
async function withinLimits(db: Db, ownerId: string): Promise<void> {
  const n = await maybeOne(db, z.object({ waiting: z.number().int(), today: z.number().int() }), `
    SELECT count(*) FILTER (WHERE state = 'waiting' AND give_up_at > now() + interval '24 hours')::int AS waiting,
           count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS today
    FROM deposits WHERE owner_id = $1`, [ownerId]);
  const waiting = n?.waiting ?? 0;
  const today = n?.today ?? 0;
  if (waiting >= MAX_WAITING) {
    throw conflict(`You already have ${MAX_WAITING} top-ups waiting for a payment. Use or cancel one of those, or wait for them to expire.`, { reason: 'too-many-waiting', waiting });
  }
  if (today >= MAX_A_DAY) {
    throw conflict(`You’ve opened ${MAX_A_DAY} top-ups in the last 24 hours, the most there can be. Try again later.`, { reason: 'too-many-today', today });
  }
}

/**
 * Opens a top-up for `microUsd` on a route: the provider quotes an address paying the treasury exactly that, a token as
 * a dollar, and the deposit is kept sealed with what was asked for, and what it's to buy (`buys`) once it's added. That's
 * checked first, as buying it now would be but for the balance, so a price that has changed is said before anything is
 * paid. The limits are checked before asking for a quote, and again under a lock on the owner in the transaction that
 * inserts it, so concurrent requests can't pass them.
 */
export async function start(d: Deps, ownerId: string, routeId: string, microUsd: number, buys: Purchase | null): Promise<TopUp> {
  const all = providers(d);
  if (buys) {
    const refused = refusalOf(await limitsNow(d), buys, await buyerOf(d.pool, ownerId));
    if (refused) throw refusedError(refused, { kind: buys.kind });
  }
  await withinLimits(d.pool, ownerId);
  const found = (await Promise.all(all.map(async (p) => ({ p, route: (await p.routes()).find((r) => r.id === routeId) })))).find((x) => x.route);
  if (!found?.route) throw invalid('That way to pay isn’t offered.');
  const least = minimumOf(found.route);
  if (BigInt(microUsd) < least) {
    throw invalid(`The least you can add with ${found.route.token} on ${found.route.chainName} is ${dollars.format(Number(least) / 1_000_000)}.`, { reason: 'below-minimum', least: Number(least) });
  }
  const opened = await found.p.open(found.route, fromMicroUsd(BigInt(microUsd), found.route.decimals));
  const depositId = id128();
  const record: DepositRecord = {
    route: { ...opened.route, minimum: opened.route.minimum.toString() },
    address: opened.address, memo: opened.memo, expiresAt: opened.expiresAt,
    asked: opened.amountIn.toString(), minAmountIn: opened.minAmountIn.toString(),
    quote: opened.quote, seenMicroUsd: null, settled: null, unanswered: false, doubt: null,
    purchase: buys ? { buys, outcome: 'waiting', why: null } : null
  };
  const giveUpAt = new Date(Date.parse(opened.expiresAt) + GIVE_UP_AFTER_MS);
  try {
    await tx(d.pool, async (c) => {
      await exec(c, "SELECT pg_advisory_xact_lock(hashtext('alcove/deposits'), hashtext($1))", [ownerId]);
      await withinLimits(c, ownerId);
      await exec(c, 'INSERT INTO deposits (owner_id, deposit_id, provider, state, give_up_at, record_ciphertext) VALUES ($1,$2,$3,$4,$5,$6)', [
        ownerId, depositId, found.p.name, 'waiting', giveUpAt, sealJson(key(d), header(ownerId, depositId), toJson(record))
      ]);
    });
  } catch (e) {
    // The account was deleted while the quote was being made.
    if (e instanceof DatabaseError && e.context['pgCode'] === '23503') throw notFound('That account', { reason: 'account-gone' });
    throw e;
  }
  dlog.info('top-up opened', { depositId, provider: found.p.name, state: 'waiting', buys: buys?.kind ?? null });
  return toTopUp(depositId, record, 'waiting');
}

const Row = z.object({ deposit_id: z.string(), state: TopUpStateSchema, record_ciphertext: bytea, created_at: timestamp });
const record = (d: Deps, ownerId: string, r: z.infer<typeof Row>) => openJson(key(d), header(ownerId, r.deposit_id), r.record_ciphertext, DepositRecord);
const open = (d: Deps, ownerId: string, r: z.infer<typeof Row>) => toTopUp(r.deposit_id, record(d, ownerId, r), r.state);
/** Where the deposit is paid, to ask its provider about it. */
const addressOf = (r: DepositRecord): DepositAddress => ({ route: { ...r.route, minimum: BigInt(r.route.minimum) }, address: r.address, memo: r.memo });

const find = (db: Db, ownerId: string, depositId: string) =>
  maybeOne(db, Row, 'SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId]);
/** States a deposit never leaves: whatever its provider says later, nothing changes. */
const FINAL: readonly TopUpState[] = ['credited', 'held'];

/**
 * A top-up, asking its provider first while it's still watched and hasn't been asked in the last 5 seconds. The
 * 5-second slot is claimed in one statement before asking, so requests at once ask the provider once between them.
 */
export async function get(d: Deps, ownerId: string, depositId: string): Promise<TopUp> {
  const all = providers(d); // off here: unavailable, even for a top-up opened before
  if (!ID128.test(depositId)) throw notFound('That top-up');
  const r = await maybeOne(d.pool, Row, `
    UPDATE deposits SET checked_at = now()
    WHERE owner_id = $1 AND deposit_id = $2 AND NOT state = ANY($3) AND check_after < 'infinity'
      AND (checked_at IS NULL OR checked_at < now() - interval '5 seconds')
    RETURNING deposit_id, state, record_ciphertext, created_at`, [ownerId, depositId, FINAL]);
  if (!r) {
    const now = await find(d.pool, ownerId, depositId);
    if (!now) throw notFound('That top-up');
    return open(d, ownerId, now);
  }
  const rec = record(d, ownerId, r);
  const p = all.find((x) => x.name === rec.route.provider);
  if (!p) return toTopUp(depositId, rec, r.state);
  let check: DepositCheck;
  try {
    check = await p.check(addressOf(rec));
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
 * What a settled deposit adds to the balance, in micro-USD, at face value of what was sent. When anything was swapped
 * (even with part refunded, which reaches the treasury too): at least what was asked, all of it; within the provider's
 * band (from `minAmountIn`), exactly what was asked, as promised; below it, what was sent. When nothing was swapped,
 * what was refunded to the treasury, however small (held only when that's nothing).
 */
function addedFor(rec: Pick<DepositRecord, 'asked' | 'minAmountIn' | 'route'>, s: { sentMicroUsd: bigint; outMicroUsd: bigint; refundedMicroUsd: bigint }): bigint {
  if (s.outMicroUsd === 0n && s.refundedMicroUsd > 0n) return s.refundedMicroUsd;
  const asked = toMicroUsd(BigInt(rec.asked), rec.route.decimals);
  if (s.sentMicroUsd >= asked) return s.sentMicroUsd;
  if (s.sentMicroUsd >= toMicroUsd(BigInt(rec.minAmountIn), rec.route.decimals)) return asked;
  return s.sentMicroUsd;
}
/**
 * Why a settled answer can't be credited, or null when it can. What's added goes by what was sent, so what reached the
 * treasury (swapped out, plus refunded to it) must be nearly all of it, and no more can be sent than one top-up takes.
 */
function doubtAbout(s: Extract<DepositCheck, { state: 'settled' }>): DoubtReason | null {
  if (s.sentMicroUsd <= 0n) return 'nothing-sent';
  if (s.sentMicroUsd > BigInt(MAX_TOP_UP_MICRO_USD)) return 'more-than-a-top-up-buys';
  if ((s.outMicroUsd + s.refundedMicroUsd) * 10_000n < s.sentMicroUsd * REACHED_BPS) return 'less-reached-treasury-than-sent';
  return null;
}

/**
 * Makes the purchase a top-up was opened for, in the transaction that adds its money, once the money is in: as buying it
 * from the balance would (plans.ts `purchase`; licenses, teams.ts `licensesBought` for `team`, the team its owner is the
 * admin of, locked before the money was added), so what isn't offered at that price any more, or a balance short of it, is
 * refused with why, and the money stays in the balance. Logged with the deposit's ID and codes, never amounts.
 */
async function buyWith(d: Deps, c: Db, ownerId: string, depositId: string, provider: DepositProviderName, p: DepositPurchase, team: TeamRow | null, lessThanAsked: boolean): Promise<DepositPurchase> {
  const r = p.buys.kind === 'licenses' ? await licensesBought(d, c, team, ownerId, p.buys) : await purchase(d, c, ownerId, p.buys);
  if (r.bought) {
    dlog.info('top-up bought what it was for', { depositId, provider, buys: p.buys.kind });
    return { ...p, outcome: 'bought', why: null };
  }
  dlog.info('top-up didn’t buy what it was for; its money is in the balance', { depositId, provider, buys: p.buys.kind, why: r.refusal.why });
  return { ...p, outcome: 'refused', why: r.refusal.arrived(lessThanAsked) };
}

/**
 * Records what the provider says, in one transaction with the deposit row locked, so a deposit credits at most once
 * however many watchers and requests race on it. A settled answer that can be trusted adds `addedFor` to the balance
 * (or is held when that comes to nothing) from any state but `credited` or `held`, and then buys what the top-up was
 * opened to buy, under the same locks (the deposit's, then for licenses the team's, then the plan's), so that's tried
 * once too: a payment 1Click settles after the deposit failed,
 * expired or was cancelled is still credited, and still buys. A doubtful answer credits nothing: the deposit is
 * `arriving` (a failed or expired one `failed`), logged at error once per reason, and reaches support at its deadline. Otherwise `arriving` never goes
 * back to `waiting`, a cancelled one moves on only when a payment reaches it (and is then due for the watcher at once),
 * and a failed or expired one stays as it is. A status the provider doesn't explain leaves the deposit as it is.
 */
export async function apply(d: Deps, ownerId: string, depositId: string, check: DepositCheck): Promise<TopUpState> {
  return tx(d.pool, async (c) => {
    const r = await maybeOne(c, Row, 'SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2 FOR UPDATE', [ownerId, depositId]);
    if (!r) throw notFound('That top-up');
    if (FINAL.includes(r.state)) return r.state;
    const rec = record(d, ownerId, r);
    const provider = rec.route.provider;
    const late = r.state === 'failed' || r.state === 'expired';
    const save = (state: TopUpState, next: DepositRecord) => exec(c, 'UPDATE deposits SET state = $3, checked_at = now(), record_ciphertext = $4 WHERE owner_id = $1 AND deposit_id = $2',
      [ownerId, depositId, state, sealJson(key(d), header(ownerId, depositId), toJson(next))]);
    const touch = () => exec(c, 'UPDATE deposits SET checked_at = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId]);
    const doubted = async (reason: DoubtReason): Promise<TopUpState> => {
      const state: TopUpState = late ? 'failed' : 'arriving';
      await save(state, { ...rec, doubt: reason });
      if (r.state === 'cancelled') await exec(c, 'UPDATE deposits SET check_after = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId]);
      // Money came and isn't credited: support needs to hear of it, once, not on every check until the deadline.
      if (rec.doubt !== reason || state !== r.state) dlog.error('top-up not credited, its provider’s answer can’t be trusted', { depositId, provider, reason, was: r.state, state });
      else dlog.debug('top-up still not credited', { depositId, provider, reason, state });
      return state;
    };
    if (check.state === 'settled') {
      const reason = doubtAbout(check);
      if (reason) return doubted(reason);
      const added = addedFor(rec, check);
      const state: TopUpState = added > 0n ? 'credited' : 'held';
      const p = rec.purchase;
      const buying = p && p.outcome === 'waiting' ? p : null;
      // Licenses go to the team its owner is the admin of. Every change to a team locks its row before any plan's
      // (teams.ts), so it's locked here, after the deposit's and before the money is added: never after a plan's.
      const team = buying?.buys.kind === 'licenses' ? await adminsTeam(c, ownerId) : null;
      if (added > 0n) await credit(d, c, ownerId, Number(added), `Added, ${formatUnits(check.sentMicroUsd, 6)} ${rec.route.token}`);
      const lessThanAsked = added < toMicroUsd(BigInt(rec.asked), rec.route.decimals);
      await save(state, {
        ...rec,
        settled: {
          sentMicroUsd: check.sentMicroUsd.toString(), outMicroUsd: check.outMicroUsd.toString(), refundedMicroUsd: check.refundedMicroUsd.toString(),
          addedMicroUsd: added.toString(), providerRef: check.providerRef
        },
        purchase: buying ? await buyWith(d, c, ownerId, depositId, provider, buying, team, lessThanAsked) : p
      });
      if (late) dlog.warn('top-up settled after it was given up', { depositId, provider, was: r.state, state });
      else dlog.info('top-up settled', { depositId, provider, state });
      return state;
    }
    if (check.state === 'doubtful') return doubted(check.reason);
    if (late) {
      await touch();
      return r.state;
    }
    if (check.state === 'failed') {
      await exec(c, 'UPDATE deposits SET state = $3, checked_at = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId, 'failed']);
      dlog.error('top-up failed', { depositId, provider });
      return 'failed';
    }
    if (check.state === 'unknown') {
      await touch();
      return r.state;
    }
    // A payment once seen stays seen, and a cancelled top-up stays cancelled: a stale answer never shows the address again.
    const state: TopUpState = r.state !== 'waiting' && check.state === 'waiting' ? r.state : check.state;
    // Concurrent provider checks can finish out of order; money already seen cannot become unsent.
    const previous = rec.seenMicroUsd === null ? 0n : BigInt(rec.seenMicroUsd);
    const seen = check.sentMicroUsd === undefined || check.sentMicroUsd < previous ? rec.seenMicroUsd : check.sentMicroUsd.toString();
    if (seen !== rec.seenMicroUsd) await save(state, { ...rec, seenMicroUsd: seen });
    else await exec(c, 'UPDATE deposits SET state = $3, checked_at = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId, state]);
    if (r.state === 'cancelled' && state !== 'cancelled') await exec(c, 'UPDATE deposits SET check_after = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId]);
    if (state !== r.state) dlog.info('top-up moved', { depositId, provider, state });
    return state;
  });
}

/** How many due deposits one watcher pass takes on, and how many of them it works on at once. */
const WATCH_BATCH = 20;
const WATCH_AT_ONCE = 4;
/**
 * How far ahead a pass pushes the next check of each deposit it claims, so another instance's pass skips it: longer
 * than the pass can take. A pass works through its batch in ceil(20 / 4) = 5 rounds; in each, one deposit takes at
 * most one provider call (15 s) and up to 8 statements (15 s each, lock waits included). Half as much again on top.
 */
const LEASE_S = Math.ceil((Math.ceil(WATCH_BATCH / WATCH_AT_ONCE) * (PROVIDER_TIMEOUT_MS + 8 * STATEMENT_TIMEOUT_MS) * 1.5) / 1000);
/** Every state the watcher asks about; `credited` and `held` are never asked about again. */
const WATCHED: readonly TopUpState[] = ['waiting', 'arriving', 'short', 'cancelled', 'failed', 'expired'];
/**
 * When a deposit nobody is paying any more is next asked about: hourly for the first day after `give_up_at`, every 6
 * hours for a week, then daily. Most of what the watcher asks about is this long tail, so it thins out over time.
 */
const TAIL = `now() + CASE WHEN now() - give_up_at < interval '1 day' THEN interval '1 hour'
  WHEN now() - give_up_at < interval '7 days' THEN interval '6 hours' ELSE interval '1 day' END`;
const Due = z.object({
  owner_id: z.string(), deposit_id: z.string(), provider: z.literal('oneclick'), state: TopUpStateSchema, record_ciphertext: bytea,
  created_at: timestamp, given_up: z.boolean(), watched_enough: z.boolean()
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
 * Gives up on a deposit past `give_up_at`, by what the provider said at this check ('unreadable' when the record no
 * longer opens). Only a definite "nothing arrived" (the provider says it's still waiting for a payment) lets it end
 * quietly: a waiting deposit is `expired`, and a cancelled or expired one stays as it is. Anything else (arriving,
 * short, failed, a status nobody knows, an answer that can't be trusted) means money may have come and something is
 * wrong, so it is `failed`, logged at error, and reaches support. A record that doesn't open can't be asked about
 * again, so that one isn't watched any more; every other given-up deposit still is, on the thinning `TAIL` (see `watch`).
 */
function giveUp(d: Deps, ownerId: string, depositId: string, provider: DepositProviderName, seen: Exclude<DepositCheck['state'], 'settled'> | 'unreadable'): Promise<TopUpState | undefined> {
  return tx(d.pool, async (c) => {
    const r = await maybeOne(c, z.object({ state: TopUpStateSchema, first: z.boolean() }),
      'SELECT state, (checked_at IS NULL OR checked_at < give_up_at) AS first FROM deposits WHERE owner_id = $1 AND deposit_id = $2 FOR UPDATE', [ownerId, depositId]);
    if (!r || FINAL.includes(r.state)) return r?.state;
    if (seen === 'unreadable') {
      await exec(c, "UPDATE deposits SET state = 'failed', checked_at = now(), check_after = 'infinity' WHERE owner_id = $1 AND deposit_id = $2", [ownerId, depositId]);
      dlog.error('top-up failed, its record doesn’t open', { depositId, was: r.state });
      return 'failed';
    }
    if (r.state === 'failed') return r.state;
    if (seen === 'waiting' && r.state !== 'arriving' && r.state !== 'short') {
      const state: TopUpState = r.state === 'waiting' ? 'expired' : r.state;
      await exec(c, 'UPDATE deposits SET state = $3, checked_at = now() WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId, state]);
      if (r.state === 'waiting') dlog.info('top-up expired', { depositId, provider });
      else if (r.state === 'cancelled' && r.first) dlog.info('top-up cancelled, nothing arrived', { depositId, provider });
      return state;
    }
    await exec(c, "UPDATE deposits SET state = 'failed', checked_at = now() WHERE owner_id = $1 AND deposit_id = $2", [ownerId, depositId]);
    dlog.error('top-up failed', { depositId, provider, was: r.state, seen });
    return 'failed';
  });
}

/**
 * The provider couldn't answer past `give_up_at`. Without its answer nobody knows whether money came, so the deposit
 * stays as it is (never `expired`) and is asked about on the thinning `TAIL` until the provider answers; logged at
 * error once.
 */
function unanswered(d: Deps, ownerId: string, depositId: string, provider: DepositProviderName): Promise<void> {
  return tx(d.pool, async (c) => {
    const r = await maybeOne(c, Row, 'SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2 FOR UPDATE', [ownerId, depositId]);
    if (!r || !isPending(r.state)) return;
    const rec = record(d, ownerId, r);
    if (!rec.unanswered) {
      await exec(c, 'UPDATE deposits SET record_ciphertext = $3 WHERE owner_id = $1 AND deposit_id = $2', [ownerId, depositId, sealJson(key(d), header(ownerId, depositId), toJson({ ...rec, unanswered: true }))]);
      dlog.error('top-up still open, its provider hasn’t answered since its deadline', { depositId, provider, state: r.state });
    }
    await exec(c, `UPDATE deposits SET check_after = ${TAIL} WHERE owner_id = $1 AND deposit_id = $2`, [ownerId, depositId]);
  });
}

/**
 * One pass of the watcher (server.ts runs it every 5 seconds). It claims up to 20 due deposits in one statement,
 * pushing each one's next check `LEASE_S` ahead so another API instance's pass skips them, and works on 4 at a time.
 * Each is checked with its provider and the answer applied, and its next check set: an open deposit every 10 seconds
 * for 15 minutes, every minute until 2 hours, every 5 minutes for the rest of its first day, then hourly until
 * `give_up_at`; a cancelled one every 5 minutes for a day, then hourly; past `give_up_at`, or failed or expired, the
 * thinning `TAIL` (hourly, then 6-hourly, then daily). Open deposits are claimed ahead of the rest. When the provider can't answer, the state stays (logged at
 * warn) and it's asked again in a minute (on the `TAIL` once given up). Past `give_up_at` a settled answer is applied as
 * usual and anything else goes to `giveUp`; a provider that can't answer then leaves the deposit as it is, asked about
 * on the `TAIL` until it answers (see `unanswered`). A failed, expired or cancelled deposit is watched until 30 days
 * after its address expired, so a payment settled late still credits; then it isn't asked about again.
 */
export async function watch(d: Deps): Promise<{ checked: number; credited: number }> {
  const all = depositProviders(d.cfg);
  if (!all) return { checked: 0, credited: 0 };
  const due = await rows(d.pool, Due, `
    UPDATE deposits SET check_after = now() + make_interval(secs => $2)
    WHERE (owner_id, deposit_id) IN (
      SELECT owner_id, deposit_id FROM deposits WHERE state = ANY($3) AND check_after <= now()
      -- Open deposits someone may have just paid go first, ahead of the long tail.
      ORDER BY (state IN ('waiting', 'arriving', 'short') AND give_up_at > now()) DESC, check_after
      LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING owner_id, deposit_id, provider, state, record_ciphertext, created_at, give_up_at <= now() AS given_up,
      give_up_at <= now() - interval '29 days' AS watched_enough`, [WATCH_BATCH, LEASE_S, WATCHED]);
  const done = await atMost(WATCH_AT_ONCE, due, async (r): Promise<TopUpState | undefined> => {
    const { deposit_id: depositId, owner_id: ownerId, provider } = r;
    const settledLate = r.state === 'failed' || r.state === 'expired';
    try {
      // `give_up_at` is a day after the address expired, so this is at least 30 days after.
      if ((settledLate || r.state === 'cancelled') && r.watched_enough) {
        await exec(d.pool, "UPDATE deposits SET check_after = 'infinity' WHERE owner_id = $1 AND deposit_id = $2", [ownerId, depositId]);
        dlog.info('top-up no longer watched', { depositId, provider, state: r.state });
        return r.state;
      }
      let rec: DepositRecord;
      try {
        rec = record(d, ownerId, r);
      } catch (e) {
        if (r.given_up || settledLate) return await giveUp(d, ownerId, depositId, provider, 'unreadable');
        throw e;
      }
      let check: DepositCheck;
      try {
        check = await all[provider].check(addressOf(rec));
      } catch (e) {
        dlog.warn('top-up check failed', { depositId, provider, err: e });
        if (r.given_up && isPending(r.state)) {
          await unanswered(d, ownerId, depositId, provider);
          return r.state;
        }
        await exec(d.pool, `UPDATE deposits SET check_after = CASE WHEN state IN ('failed', 'expired') OR give_up_at <= now() THEN ${TAIL} ELSE now() + interval '60 seconds' END
          WHERE owner_id = $1 AND deposit_id = $2`, [ownerId, depositId]);
        return r.state;
      }
      // A finished swap is applied first, even past `give_up_at`: it credits, or (when it can't be trusted) is recorded
      // and logged with its reason before the deposit is given up on.
      const applied = check.state === 'settled' || check.state === 'doubtful' || !r.given_up ? await apply(d, ownerId, depositId, check) : r.state;
      const state = r.given_up && !FINAL.includes(applied)
        ? await giveUp(d, ownerId, depositId, provider, check.state === 'settled' ? 'doubtful' : check.state)
        : applied;
      await exec(d.pool, `
        UPDATE deposits SET check_after = CASE
          WHEN state IN ('failed', 'expired') OR give_up_at <= now() THEN ${TAIL}
          WHEN state = 'cancelled' THEN LEAST(give_up_at, now() + CASE WHEN now() - created_at < interval '1 day' THEN interval '5 minutes' ELSE interval '1 hour' END)
          ELSE LEAST(give_up_at, now() + CASE
            WHEN now() - created_at < interval '15 minutes' THEN interval '10 seconds'
            WHEN now() - created_at < interval '2 hours' THEN interval '60 seconds'
            WHEN now() - created_at < interval '1 day' THEN interval '5 minutes'
            ELSE interval '1 hour' END) END
        WHERE owner_id = $1 AND deposit_id = $2 AND NOT state = ANY($3) AND check_after < 'infinity'`, [ownerId, depositId, FINAL]);
      return state;
    } catch (e) {
      // Its account was deleted during the pass, taking the deposit with it.
      if (e instanceof NotFoundError) dlog.info('top-up gone while watched', { depositId });
      else dlog.error('top-up not watched', { depositId, err: e });
      return undefined;
    }
  });
  return { checked: due.length, credited: done.filter((s) => s === 'credited').length };
}

/**
 * Checks open top-ups with their provider every 5 seconds while top-ups are on: one pass at a time here, and other
 * instances' passes skip the deposits this one has claimed. Returns what stops it.
 */
export function startWatching(d: Deps): () => void {
  if (!depositProviders(d.cfg)) return () => undefined;
  let watching = false;
  const pass = async () => {
    if (watching) return;
    watching = true;
    const t0 = performance.now();
    try {
      const r = await watch(d);
      if (r.checked) dlog.info('deposits watched', { ...r, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      dlog.error('watching deposits failed', { err: e });
    } finally {
      watching = false;
    }
  };
  const timer = setInterval(() => void pass(), 5_000);
  timer.unref();
  return () => clearInterval(timer);
}

/**
 * Cancels a top-up nothing has reached: its address stops being shown and it no longer counts as waiting. 1Click
 * can't cancel a quote, so the address still takes a payment until it expires; the watcher keeps asking about it,
 * every 5 minutes, and one that arrives is credited as for any top-up. In one transaction with the row locked, like `apply`, so it can't
 * race a credit.
 */
export async function cancel(d: Deps, ownerId: string, depositId: string): Promise<TopUp> {
  providers(d); // off here: unavailable, even for a top-up opened before
  return tx(d.pool, async (c) => {
    const r = ID128.test(depositId)
      ? await maybeOne(c, Row, 'SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2 FOR UPDATE', [ownerId, depositId])
      : undefined;
    if (!r) throw notFound('That top-up');
    if (r.state !== 'waiting') {
      const why = r.state === 'cancelled' ? 'This top-up is already cancelled.'
        : r.state === 'expired' ? 'This top-up can’t be cancelled any more: its address has expired.'
        : 'This top-up can’t be cancelled any more: a payment has already reached it.';
      throw conflict(why, { reason: 'not-waiting', state: r.state });
    }
    await exec(c, "UPDATE deposits SET state = 'cancelled', check_after = LEAST(give_up_at, now() + interval '5 minutes') WHERE owner_id = $1 AND deposit_id = $2", [ownerId, depositId]);
    dlog.info('top-up cancelled', { depositId });
    return open(d, ownerId, { ...r, state: 'cancelled' });
  });
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

/**
 * A deposit's record with everything in it kept, what this release doesn't read included (the credits a release before
 * plans promised and added): saved again, it still opens in the previous release, serving while this one deploys.
 */
const Kept = z.looseObject({ settled: z.looseObject({}).nullable().optional() });
type Kept = z.infer<typeof Kept>;
/** A deposit's record as stored (`Kept`) and as this release reads it, or why it can't be opened. */
function openKept(d: Deps, ownerId: string, depositId: string, ciphertext: Uint8Array): { ok: true; kept: Kept; rec: DepositRecord } | { ok: false; error: unknown } {
  try {
    const kept = openJson(key(d), header(ownerId, depositId), ciphertext, Kept);
    return { ok: true, kept, rec: DepositRecord.parse(kept) };
  } catch (error) {
    return { ok: false, error };
  }
}

/** Whether every deposit a release before plans settled has been looked at, as far as this process knows. */
let carriedAll = false;
/**
 * Adds to the balance what every deposit a release before plans settled came to: those releases added credits, which no
 * longer count, so money paid before this release, or while it deployed, is added again as dollars (billing_cutover says
 * when this release's migration ran, and the previous release runs only for a while after it). Each settled deposit is
 * looked at once, then never again (`check_after` infinity), under its row's lock, by the same rules as any other; one
 * whose record can't be opened is logged at error, once, for support to add by hand, and holds up none after it. Once a
 * pass a day after the cutover finds nothing, nothing can come again: this process stops looking. Says how many it added.
 */
export async function creditCarried(d: Deps): Promise<number> {
  if (carriedAll) return 0;
  const due = await rows(d.pool, z.object({ owner_id: z.string(), deposit_id: z.string() }), `
    SELECT owner_id, deposit_id FROM deposits d, billing_cutover b
    WHERE d.state = 'credited' AND d.checked_at < b.at + interval '1 day' AND d.check_after < 'infinity'
    ORDER BY d.checked_at LIMIT 100`);
  if (!due.length) {
    const over = await maybeOne(d.pool, z.object({ over: z.boolean() }), "SELECT now() >= at + interval '1 day' AS over FROM billing_cutover");
    carriedAll = over?.over === true;
    return 0;
  }
  let carried = 0;
  for (const x of due) {
    const where = [x.owner_id, x.deposit_id];
    const outcome = await tx(d.pool, async (c): Promise<{ kind: 'carried' | 'nothing' } | { kind: 'unopened'; error: unknown }> => {
      const r = await maybeOne(c, Row, 'SELECT deposit_id, state, record_ciphertext, created_at FROM deposits WHERE owner_id = $1 AND deposit_id = $2 FOR UPDATE', where);
      if (!r) return { kind: 'nothing' };
      const lookedAt = () => exec(c, "UPDATE deposits SET check_after = 'infinity' WHERE owner_id = $1 AND deposit_id = $2", where);
      const opened = openKept(d, x.owner_id, x.deposit_id, r.record_ciphertext);
      if (!opened.ok) { await lookedAt(); return { kind: 'unopened', error: opened.error }; }
      const { kept, rec } = opened;
      const s = rec.settled;
      if (!s || s.addedMicroUsd !== null) { await lookedAt(); return { kind: 'nothing' }; }
      const added = addedFor(rec, { sentMicroUsd: BigInt(s.sentMicroUsd), outMicroUsd: BigInt(s.outMicroUsd), refundedMicroUsd: BigInt(s.refundedMicroUsd) });
      if (added > 0n) await credit(d, c, x.owner_id, Number(added), `Added, ${formatUnits(BigInt(s.sentMicroUsd), 6)} ${rec.route.token}`);
      const next = toJson({ ...kept, settled: { ...(kept.settled ?? {}), addedMicroUsd: added.toString() } });
      await exec(c, "UPDATE deposits SET record_ciphertext = $3, check_after = 'infinity' WHERE owner_id = $1 AND deposit_id = $2",
        [...where, sealJson(key(d), header(x.owner_id, x.deposit_id), next)]);
      return { kind: 'carried' };
    }).catch((e: unknown) => {
      dlog.warn('top-up from before plans not looked at; it is next time', { depositId: x.deposit_id, err: e });
      return { kind: 'nothing' as const };
    });
    // Said once it's committed, so each is said once.
    if (outcome.kind === 'unopened') dlog.error('top-up from before plans can’t be opened, so it wasn’t added as dollars', { depositId: x.deposit_id, err: outcome.error });
    if (outcome.kind === 'carried') {
      carried++;
      dlog.info('top-up a release before plans settled added as dollars', { depositId: x.deposit_id });
    }
  }
  return carried;
}
