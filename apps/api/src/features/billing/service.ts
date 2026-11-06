/* Billing state is sealed under Kservice's accounting key, never under owner keys (docs: payments-and-usage). */
import type { CreditBalance } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { NotFoundError } from '../../errors';
import { bytea, exec, maybeOne, type Db } from '../../db';

export const PER_MINUTE = 25;
export const WELCOME_CREDITS = 10_000;
/** Every change to the balance, kept with it so charges can be explained. */
const Entry = z.object({ id: z.string(), at: z.string(), label: z.string(), amount: z.number() });
const State = z.object({ balance: z.number(), history: z.array(Entry) });
/** Billing needs only the service key from the configuration: never an owner's keys. */
type Service = Pick<Deps, 'cfg' | 'pool'>;
const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'billing', ownerId, keyVersion: '1' });

export async function openAccount(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string): Promise<void> {
  const state = { balance: WELCOME_CREDITS, history: [{ id: id128(), at: new Date().toISOString(), label: 'Welcome credits', amount: WELCOME_CREDITS }] };
  await exec(db, 'INSERT INTO billing_accounts (owner_id, state_ciphertext, version) VALUES ($1,$2,0)', [ownerId, sealJson(key(d), header(ownerId), toJson(state))]);
}
async function read(d: Service, ownerId: string) {
  const r = await maybeOne(d.pool, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM billing_accounts WHERE owner_id = $1', [ownerId]);
  if (!r) throw new NotFoundError('No billing account.');
  return openJson(key(d), header(ownerId), r.state_ciphertext, State);
}
/** Takes credits for written notes, in the caller's transaction, with the account row locked. */
export async function charge(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string, c: { amount: number; label: string }): Promise<void> {
  const r = await maybeOne(db, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM billing_accounts WHERE owner_id = $1 FOR UPDATE', [ownerId]);
  if (!r) throw new NotFoundError('No billing account.', { context: { ownerId } });
  const s = openJson(key(d), header(ownerId), r.state_ciphertext, State);
  const next = { balance: s.balance - c.amount, history: [...s.history, { id: id128(), at: new Date().toISOString(), label: c.label, amount: -c.amount }] };
  await exec(db, 'UPDATE billing_accounts SET state_ciphertext = $2, version = version + 1 WHERE owner_id = $1', [ownerId, sealJson(key(d), header(ownerId), toJson(next))]);
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
