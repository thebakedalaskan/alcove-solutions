/* Billing state is sealed under Kservice's accounting key, never under owner keys (docs: payments-and-usage). */
import type { CreditBalance, CreditEvent, CreditPack } from '@alcove/api';
import { CreditEventSchema } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../crypto';
import { ApiError } from '../errors';
import { bytea, exec, maybeOne, type Db } from '../db';

export const PER_MINUTE = 25;
export const WELCOME_CREDITS = 10_000;
const State = z.object({ balance: z.number(), history: z.array(CreditEventSchema) });
const key = (d: Deps) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'billing', ownerId, keyVersion: '1' });

export async function openAccount(d: Deps, db: Db, ownerId: string): Promise<void> {
  const state = { balance: WELCOME_CREDITS, history: [{ id: id128(), at: new Date().toISOString(), label: 'Welcome credits', detail: 'Added when you created your account', amount: WELCOME_CREDITS }] };
  await exec(db, 'INSERT INTO billing_accounts (owner_id, state_ciphertext, version) VALUES ($1,$2,0)', [ownerId, sealJson(key(d), header(ownerId), toJson(state))]);
}
async function read(d: Deps, ownerId: string) {
  const r = await maybeOne(d.pool, z.object({ state_ciphertext: bytea }), 'SELECT state_ciphertext FROM billing_accounts WHERE owner_id = $1', [ownerId]);
  if (!r) throw new ApiError('not-found', 'No billing account.');
  return openJson(key(d), header(ownerId), r.state_ciphertext, State);
}
export async function balance(d: Deps, ownerId: string): Promise<CreditBalance> { return { balance: (await read(d, ownerId)).balance, perMinute: PER_MINUTE }; }
export async function history(d: Deps, ownerId: string): Promise<CreditEvent[]> { return (await read(d, ownerId)).history; }
export const PACKS: CreditPack[] = [
  { id: 'p10', credits: 10_000, priceUsdc: 10 },
  { id: 'p50', credits: 50_000, priceUsdc: 45, badge: 'Save 10%' },
  { id: 'p100', credits: 100_000, priceUsdc: 80, badge: 'Save 20%' }
];
