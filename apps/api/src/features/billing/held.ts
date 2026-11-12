/*
 * What an account is held to now (docs: Plans and usage › Storage, › Team): its plan in force, the storage it's counted
 * against with any grace, and the largest file it takes. On Team that's the team's pool (features/billing/teams.ts),
 * shared by everyone licensed; otherwise its own (features/billing/storage.ts) against its plan, or a grace's.
 */
import type { Deps } from '../../context';
import { type Db } from '../../db';
import { PlanLimitError } from '../../errors';
import { limitsNow } from '../../limits';
import { graceUntil, heldTo, planNow, type InForce } from './plans';
import { usedBytes } from './storage';
import { poolOf } from './teams';

type Service = Pick<Deps, 'cfg' | 'pool'>;

/**
 * Where an account's storage stands at `now`: what it's counted as storing (its own, or its team's pool), what its plan
 * gives (`planBytes`), what it's held to now (`heldBytes`: a grace's, if one runs and gives more; null: no limit), and
 * when the grace running ends.
 */
export interface StorageNow { p: InForce; usedBytes: number; planBytes: number; heldBytes: number | null; graceUntil: number | null }
export async function storageOf(d: Service, db: Db, ownerId: string, now = Date.now()): Promise<StorageNow> {
  const { a, p, license } = await planNow(d, db, ownerId, now);
  if (p.kind === 'team' && license) {
    const pool = await poolOf(d, db, license.teamId, now);
    return { p, usedBytes: pool.usedBytes, planBytes: pool.bytes, heldBytes: pool.heldBytes, graceUntil: pool.graceUntil };
  }
  const l = await limitsNow(d, db);
  return { p, usedBytes: await usedBytes(db, ownerId), planBytes: p.storageBytes, heldBytes: heldTo(a, p, l, now).storageBytes, graceUntil: graceUntil(a, p, l, now) };
}

/** Whether storing `adding` more bytes keeps an account within what it's held to. */
export async function mayStore(d: Service, db: Db, payerId: string, adding: number): Promise<boolean> {
  const s = await storageOf(d, db, payerId);
  return s.heldBytes === null || s.usedBytes + adding <= s.heldBytes;
}

/** Refuses storing `adding` more bytes for an account that it has no room for. */
export async function requireRoom(d: Service, db: Db, payerId: string, adding: number, context: Record<string, string | number>): Promise<void> {
  if (await mayStore(d, db, payerId, adding)) return;
  throw new PlanLimitError('Your storage is full. Delete something, or move to a plan with more room.', 'storage', { context: { ...context, ownerId: payerId } });
}

/** What an account may store now, its plan's, its team's pool's or its grace's (null: no limit). */
export async function storageLimitOf(d: Service, db: Db, ownerId: string): Promise<number | null> {
  return (await storageOf(d, db, ownerId)).heldBytes;
}

/** The largest file an account's plan takes. */
export async function fileBytesFor(d: Service, db: Db, payerId: string): Promise<number> {
  return (await planNow(d, db, payerId)).p.fileBytes;
}
