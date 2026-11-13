/* Billing state is sealed under Kservice's accounting key, never under owner keys (docs: payments-and-usage). */
import type { CreditBalance } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { NotFoundError } from '../../errors';
import { bytea, exec, maybeOne, type Db } from '../../db';

export const PER_MINUTE = 25;
export const WELCOME_CREDITS = 10_000;
/** A rate in credits per USD, kept as a fraction so 10,000/9 is exact. */
export interface Rate { num: bigint; den: bigint }
/**
 * Credits per USD by how many credits one top-up buys: the more credits, the better the rate. 10,000 credits cost
 * 10 USD, 50,000 cost 45 USD and 100,000 cost 80 USD; an amount in between takes the rate of the tier it's in.
 */
export const TIERS: readonly { fromCredits: number; creditsPerUsd: Rate }[] = [
  { fromCredits: 0, creditsPerUsd: { num: 1000n, den: 1n } },
  { fromCredits: 50_000, creditsPerUsd: { num: 10_000n, den: 9n } },
  { fromCredits: 100_000, creditsPerUsd: { num: 1250n, den: 1n } }
];
/** The rate for buying `credits`: the tier it falls in. */
export const rateFor = (credits: number): Rate => TIERS.reduce((best, t) => (credits >= t.fromCredits ? t : best)).creditsPerUsd;
/** What `credits` cost, in micro-USD, rounded up: 10,000 → 10 USD, 50,000 → 45 USD, 46,000 → 46 USD. */
export function priceFor(credits: number): bigint {
  const r = rateFor(credits);
  const top = BigInt(credits) * 1_000_000n * r.den;
  return (top + r.num - 1n) / r.num;
}
/** Credits `microUsd` buys at `rate`, rounded down to whole credits. */
export const creditsAt = (microUsd: bigint, rate: Rate): number => Number((microUsd * rate.num) / (rate.den * 1_000_000n));
/**
 * Credits for money that came without a price agreed for it (a payment too small to swap, or refunded): the most
 * credits it buys at a tier it reaches. 45 USD → 50,000; 46 USD → 51,111; 30 USD → 30,000.
 */
export function creditsForUsd(microUsd: bigint): number {
  for (const t of [...TIERS].reverse()) {
    const c = creditsAt(microUsd, t.creditsPerUsd);
    if (c >= t.fromCredits) return c;
  }
  return 0;
}
/** Every change to the balance, kept with it so charges can be explained. */
const Entry = z.object({ id: z.string(), at: z.string(), label: z.string(), amount: z.number() });
const State = z.object({ balance: z.number(), history: z.array(Entry) });
/** Billing needs only the service key from the configuration: never an owner's keys. */
type Service = Pick<Deps, 'cfg' | 'pool'>;
const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'billing', ownerId, keyVersion: '1' });

/**
 * Whether `kservice` opens an account's billing state as it's stored: how the KSERVICE a TEE carries over is checked before
 * it's sealed in the server keys (serverKeys.ts), since another one would leave every balance unreadable.
 */
export function opensBilling(kservice: Uint8Array, ownerId: string, stateCiphertext: Uint8Array): boolean {
  const accounting = serviceKey(kservice, 'accounting');
  try {
    openJson(accounting, header(ownerId), stateCiphertext, State);
    return true;
  } catch {
    return false;
  } finally {
    accounting.fill(0);
  }
}

export async function openAccount(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string): Promise<void> {
  const state = { balance: WELCOME_CREDITS, history: [{ id: id128(), at: new Date().toISOString(), label: 'Welcome credits', amount: WELCOME_CREDITS }] };
  await exec(db, 'INSERT INTO billing_accounts (owner_id, state_ciphertext, version) VALUES ($1,$2,0)', [ownerId, sealJson(key(d), header(ownerId), toJson(state))]);
}
async function read(d: Service, ownerId: string) {
  const r = await maybeOne(d.pool, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM billing_accounts WHERE owner_id = $1', [ownerId]);
  if (!r) throw new NotFoundError('No billing account.');
  return openJson(key(d), header(ownerId), r.state_ciphertext, State);
}
/** Changes the balance by `delta` with a history entry, in the caller's transaction, with the account row locked. */
async function adjust(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string, delta: number, label: string): Promise<void> {
  const r = await maybeOne(db, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM billing_accounts WHERE owner_id = $1 FOR UPDATE', [ownerId]);
  if (!r) throw new NotFoundError('No billing account.', { context: { ownerId } });
  const s = openJson(key(d), header(ownerId), r.state_ciphertext, State);
  const next = { balance: s.balance + delta, history: [...s.history, { id: id128(), at: new Date().toISOString(), label, amount: delta }] };
  await exec(db, 'UPDATE billing_accounts SET state_ciphertext = $2, version = version + 1 WHERE owner_id = $1', [ownerId, sealJson(key(d), header(ownerId), toJson(next))]);
}
/** Takes credits for written notes, in the caller's transaction, with the account row locked. */
export async function charge(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string, c: { amount: number; label: string }): Promise<void> {
  await adjust(d, db, ownerId, -c.amount, c.label);
}
/** Adds credits for a payment, in the caller's transaction, with the account row locked. */
export async function credit(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string, c: { amount: number; label: string }): Promise<void> {
  await adjust(d, db, ownerId, c.amount, c.label);
}
/** When `now`'s month began: 00:00 UTC on the 1st. */
const monthOf = (now: Date) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
export async function balance(d: Service, ownerId: string): Promise<CreditBalance> {
  const s = await read(d, ownerId);
  const since = monthOf(new Date());
  return {
    balance: s.balance,
    granted: s.history.reduce((sum, e) => sum + Math.max(0, e.amount), 0),
    // Charges are the history's negative entries, each dated when it was made.
    usedThisMonth: s.history.reduce((sum, e) => sum + (e.amount < 0 && Date.parse(e.at) >= since ? -e.amount : 0), 0),
    perMinute: PER_MINUTE
  };
}
