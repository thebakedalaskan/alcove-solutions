/*
 * Plans (docs: Plans and usage): which plan each account is on, the USD balance it buys plans with, and when upkeep
 * next has something to do for it. Sealed under Kservice's accounting key, never under owner keys: the row says only
 * whose it is and when it's due. An account's row is made when it signs up, or the first time it's touched after the
 * release that brought plans (on Free, with time to get within Free's limits if it's over them).
 */
import type { BalanceEntry, PlanKind } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../context';
import { id128, openJson, sealJson, serviceKey, toJson, unb64u } from '../../crypto';
import { bytea, exec, maybeOne, rows, tx, type Db } from '../../db';
import { InternalError, PlanLimitError } from '../../errors';
import { limitsNow, type Limits } from '../../limits';
import { log } from '../../log';
import { settlePayers, usedBytes } from './storage';

const plog = log.child({ component: 'plans' });
/** How many changes to the balance are kept with it, to explain it. */
const HISTORY = 50;
/** How many accounts upkeep gives a row, and looks at, each time. */
const BATCH = 100;

const Entry = z.object({ id: z.string(), at: z.string(), label: z.string(), microUsd: z.number().int() });
/**
 * Limits held as they were while an account gets within its plan's (null: no limit then), until `until`: after a plan
 * ends, or at the release that brought plans for an account already over Free's.
 */
const Grace = z.object({ until: z.string(), storageBytes: z.number().int().nullable() });
export const PlanAccount = z.object({
  balanceMicroUsd: z.number().int(),
  history: z.array(Entry),
  /** Where Free's periods are counted from. */
  freeFrom: z.string(),
  /** Whether the account hasn't been shown the plans to pick from yet. */
  choose: z.boolean(),
  grace: Grace.nullable()
});
export type PlanAccount = z.infer<typeof PlanAccount>;

type Service = Pick<Deps, 'cfg' | 'pool'>;
const key = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const header = (ownerId: string) => ({ v: 1 as const, kind: 'plan-account', ownerId, keyVersion: '1' });
const seal = (d: Pick<Deps, 'cfg'>, ownerId: string, a: PlanAccount) => sealJson(key(d), header(ownerId), toJson(a));
const Row = z.object({ state_ciphertext: bytea });

/** The plan an account is on now, the period it's in and what the plan brings. */
export interface InForce {
  kind: PlanKind;
  from: number;
  to: number;
  notesMinutes: number;
  storageBytes: number;
  fileBytes: number;
}

/** The plan in force at `now`: Free, in periods counted from `freeFrom`. */
export function inForce(a: PlanAccount, l: Limits, now = Date.now()): InForce {
  const period = l.get('plan.period_seconds') * 1000;
  const start = Date.parse(a.freeFrom);
  const n = Math.max(0, Math.floor((now - start) / period));
  return {
    kind: 'free', from: start + n * period, to: start + (n + 1) * period,
    notesMinutes: l.get('plan.free.notes_minutes'), storageBytes: l.get('plan.free.storage_bytes'), fileBytes: l.get('plan.free.file_bytes')
  };
}

/** The limits an account is held to now: its plan's, or, during a grace, the more of those and the grace's (null: none). */
export function heldTo(a: PlanAccount, p: InForce, now = Date.now()): { storageBytes: number | null } {
  const g = a.grace && Date.parse(a.grace.until) > now ? a.grace : null;
  if (!g) return { storageBytes: p.storageBytes };
  const more = (plan: number | null, held: number | null) => (plan === null || held === null ? null : Math.max(plan, held));
  return { storageBytes: more(p.storageBytes, g.storageBytes) };
}

/** When upkeep should next look at an account: when its grace ends, if it has one. */
const dueAt = (a: PlanAccount): Date | null => (a.grace ? new Date(a.grace.until) : null);

/** A new account's plan, in the sign-up transaction: Free from now, with the plans to pick from shown first. */
export async function open(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string): Promise<void> {
  const a: PlanAccount = { balanceMicroUsd: 0, history: [], freeFrom: new Date().toISOString(), choose: true, grace: null };
  await exec(db, 'INSERT INTO plan_accounts (owner_id, state_ciphertext, due_at) VALUES ($1,$2,NULL)', [ownerId, seal(d, ownerId, a)]);
}

/**
 * The row for an account from before plans, on Free from now. If it's already over Free's limits it keeps working as it
 * did for the grace period: no limit on storage until then. Nothing happens if another request made
 * the row first.
 */
async function carryOver(d: Service, db: Db, ownerId: string): Promise<void> {
  const l = await limitsNow(d, db);
  const now = Date.now();
  const over = (await usedBytes(db, ownerId)) > l.get('plan.free.storage_bytes');
  const grace = over ? { until: new Date(now + l.get('plan.grace_seconds') * 1000).toISOString(), storageBytes: null } : null;
  const a: PlanAccount = { balanceMicroUsd: 0, history: [], freeFrom: new Date(now).toISOString(), choose: true, grace };
  const made = await exec(db, 'INSERT INTO plan_accounts (owner_id, state_ciphertext, due_at) VALUES ($1,$2,$3) ON CONFLICT (owner_id) DO NOTHING', [ownerId, seal(d, ownerId, a), dueAt(a)]);
  if (made) plog.info('plan account carried over', { ownerId, grace: over });
}

/** An account's plan, made first if it has none yet. `lock` holds its row for the rest of the caller's transaction. */
export async function accountOf(d: Service, db: Db, ownerId: string, lock = false): Promise<PlanAccount> {
  const read = () => maybeOne(db, Row, `SELECT state_ciphertext FROM plan_accounts WHERE owner_id = $1${lock ? ' FOR UPDATE' : ''}`, [ownerId]);
  let r = await read();
  if (!r) {
    await carryOver(d, db, ownerId);
    r = await read();
  }
  if (!r) throw new InternalError('A plan account was made and isn’t there.', { context: { ownerId } });
  return openJson(key(d), header(ownerId), r.state_ciphertext, PlanAccount);
}

/** Saves an account's plan, in the caller's transaction, which holds its row. */
export async function save(d: Pick<Deps, 'cfg'>, db: Db, ownerId: string, a: PlanAccount): Promise<void> {
  await exec(db, 'UPDATE plan_accounts SET state_ciphertext = $2, due_at = $3, version = version + 1 WHERE owner_id = $1', [ownerId, seal(d, ownerId, a), dueAt(a)]);
}

/** A change to the balance, with what it was for, kept with it (the latest HISTORY). */
const withEntry = (a: PlanAccount, microUsd: number, label: string): PlanAccount =>
  ({ ...a, balanceMicroUsd: a.balanceMicroUsd + microUsd, history: [...a.history, { id: id128(), at: new Date().toISOString(), label, microUsd }].slice(-HISTORY) });

/** Adds money to the balance, in the caller's transaction, with the account's row locked. */
export async function credit(d: Service, db: Db, ownerId: string, microUsd: number, label: string): Promise<void> {
  const a = await accountOf(d, db, ownerId, true);
  await save(d, db, ownerId, withEntry(a, microUsd, label));
}

/** The balance's history as its owner sees it, newest first. */
export const historyOf = (a: PlanAccount): BalanceEntry[] => [...a.history].reverse().map((e) => ({ id: e.id, at: e.at, label: e.label, microUsd: e.microUsd }));

/** Whether storing `adding` more bytes keeps an account within what it's held to. */
export async function mayStore(d: Service, db: Db, payerId: string, adding: number): Promise<boolean> {
  const a = await accountOf(d, db, payerId);
  const held = heldTo(a, inForce(a, await limitsNow(d, db)));
  return held.storageBytes === null || (await usedBytes(db, payerId)) + adding <= held.storageBytes;
}

/** Refuses storing `adding` more bytes for an account that it has no room for. */
export async function requireRoom(d: Service, db: Db, payerId: string, adding: number, context: Record<string, string | number>): Promise<void> {
  if (await mayStore(d, db, payerId, adding)) return;
  throw new PlanLimitError('Your storage is full. Delete something, or move to a plan with more room.', 'storage', { context: { ...context, ownerId: payerId } });
}

/** What an account may store now, its plan's or its grace's (null: no limit). */
export async function storageLimitOf(d: Service, db: Db, ownerId: string): Promise<number | null> {
  const a = await accountOf(d, db, ownerId);
  return heldTo(a, inForce(a, await limitsNow(d, db))).storageBytes;
}

/** The largest file an account's plan takes. */
export async function fileBytesFor(d: Service, db: Db, payerId: string): Promise<number> {
  const a = await accountOf(d, db, payerId);
  return inForce(a, await limitsNow(d, db)).fileBytes;
}

/**
 * Upkeep for plans, each part on its own: settles who pays for workspaces nobody does, gives every account from before
 * plans its row (so a grace runs out even for someone who never comes back), and ends graces that are over. Returns how many
 * accounts it settled, gave a row and looked at.
 */
export async function upkeep(d: Service): Promise<{ settled: number; carried: number; due: number }> {
  const settled = await settlePayers(d.pool);
  const missing = await rows(d.pool, z.object({ owner_id: z.string() }), `
    SELECT DISTINCT i.owner_id FROM identities i WHERE NOT EXISTS (SELECT 1 FROM plan_accounts p WHERE p.owner_id = i.owner_id) LIMIT $1`, [BATCH]);
  for (const m of missing) await tx(d.pool, (c) => carryOver(d, c, m.owner_id));
  let due = 0;
  for (;;) {
    const one = await tx(d.pool, async (c) => {
      const r = await maybeOne(c, z.object({ owner_id: z.string(), state_ciphertext: bytea }),
        'SELECT owner_id, state_ciphertext FROM plan_accounts WHERE due_at <= now() ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED');
      if (!r) return false;
      const a = openJson(key(d), header(r.owner_id), r.state_ciphertext, PlanAccount);
      const now = Date.now();
      const next = a.grace && Date.parse(a.grace.until) <= now ? { ...a, grace: null } : a;
      if (next !== a) plog.info('grace ended', { ownerId: r.owner_id });
      await save(d, c, r.owner_id, next);
      return true;
    });
    if (!one) break;
    if (++due >= BATCH) break;
  }
  return { settled, carried: missing.length, due };
}
