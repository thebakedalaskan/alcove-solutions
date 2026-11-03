/* Billing state is sealed under Kservice's accounting key, never under owner keys (docs: payments-and-usage). */
import type { CreditBalance } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../crypto';
import { NotFoundError } from '../errors';
import { bytea, exec, maybeOne, type Db } from '../db';

export const PER_MINUTE = 25;
export const WELCOME_CREDITS = 10_000;
/** Every change to the balance, kept with it so charges can be explained. */
const Entry = z.object({ id: z.string(), at: z.string(), label: z.string(), amount: z.number() });
const State = z.object({ balance: z.number(), history: z.array(Entry) });
const key = (d: Deps) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'billing', ownerId, keyVersion: '1' });

export async function openAccount(d: Deps, db: Db, ownerId: string): Promise<void> {
  const state = { balance: WELCOME_CREDITS, history: [{ id: id128(), at: new Date().toISOString(), label: 'Welcome credits', amount: WELCOME_CREDITS }] };
  await exec(db, 'INSERT INTO billing_accounts (owner_id, state_ciphertext, version) VALUES ($1,$2,0)', [ownerId, sealJson(key(d), header(ownerId), toJson(state))]);
}
async function read(d: Deps, ownerId: string) {
  const r = await maybeOne(d.pool, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM billing_accounts WHERE owner_id = $1', [ownerId]);
  if (!r) throw new NotFoundError('No billing account.');
  return openJson(key(d), header(ownerId), r.state_ciphertext, State);
}
export async function balance(d: Deps, ownerId: string): Promise<CreditBalance> {
  const s = await read(d, ownerId);
  return { balance: s.balance, granted: s.history.reduce((sum, e) => sum + Math.max(0, e.amount), 0), perMinute: PER_MINUTE };
}
