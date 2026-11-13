/*
 * What an account is held to now (docs: Plans and usage › Storage, › Team): its plan in force, the storage it's counted
 * against with any grace, and the largest file it takes. On Team that's the team's pool (features/billing/teams.ts),
 * shared by everyone licensed; otherwise its own (features/billing/storage.ts) against its plan, or a grace's.
 */
import type { PlanKind } from '@alcove/api';
import type { Deps } from '../../context';
import { type Db } from '../../db';
import { PlanLimitError } from '../../errors';
import { limitsNow, type LimitName } from '../../limits';
import type { LogContext } from '../../log';
import { graceUntil, heldTo, planNow, type InForce } from './plans';
import { takenOver, usedBytes } from './storage';
import { poolOf } from './teams';

type Service = Pick<Deps, 'cfg' | 'pool'>;

/**
 * Where an account's storage stands at `now`: what it's counted as storing (its own, or its team's pool), what its plan
 * gives (`planBytes`), what it's held to now (`heldBytes`: a grace's, if one runs and gives more, with what workspaces
 * whose payment moved to it held then on top while theirs run; null: no limit), and when the soonest grace running ends.
 */
export interface StorageNow { p: InForce; usedBytes: number; planBytes: number; heldBytes: number | null; graceUntil: number | null }
export async function storageOf(d: Service, db: Db, ownerId: string, now = Date.now()): Promise<StorageNow> {
  const { a, p, license } = await planNow(d, db, ownerId, now);
  if (p.kind === 'team' && license) {
    const pool = await poolOf(d, db, license.teamId, now);
    const taken = await takenOver(db, { teamId: license.teamId }, now);
    return { p, usedBytes: pool.usedBytes, planBytes: pool.bytes, heldBytes: pool.heldBytes + taken.bytes, graceUntil: soonest(pool.graceUntil, taken.until) };
  }
  const l = await limitsNow(d, db);
  const taken = await takenOver(db, { ownerId }, now);
  const held = heldTo(a, p, l, now).storageBytes;
  return { p, usedBytes: await usedBytes(db, ownerId), planBytes: p.storageBytes, heldBytes: held === null ? null : held + taken.bytes, graceUntil: soonest(graceUntil(a, p, l, now), taken.until) };
}
/** The sooner of two ends, either of which may not be running (null). */
const soonest = (x: number | null, y: number | null): number | null => (x === null ? y : y === null ? x : Math.min(x, y));

/** Each plan's storage limit and largest file by their names in the limits table, as refusals log them. */
const STORAGE_LIMIT = { free: 'plan.free.storage_bytes', pro: 'plan.pro.storage_bytes', team: 'plan.team.storage_bytes' } as const satisfies Record<PlanKind, LimitName>;
const FILE_LIMIT = { free: 'plan.free.file_bytes', pro: 'plan.pro.file_bytes', team: 'plan.team.file_bytes' } as const satisfies Record<PlanKind, LimitName>;

/**
 * An account's storage as a check, and a refusal's log line, read it: its plan's storage limit by name (on Team, a license's
 * share of the pool, which is `planBytes`), what it's counted as storing, what it's held to now (null: no limit; past the
 * plan's while a grace runs, `grace`).
 */
export interface Room { limit: LimitName; usedBytes: number; planBytes: number; heldBytes: number | null; grace: boolean }
export async function roomOf(d: Service, db: Db, ownerId: string): Promise<Room> {
  const s = await storageOf(d, db, ownerId);
  return { limit: STORAGE_LIMIT[s.p.kind], usedBytes: s.usedBytes, planBytes: s.planBytes, heldBytes: s.heldBytes, grace: s.graceUntil !== null };
}
/** Whether `adding` more bytes keep a room within what it's held to, with `kept` of it still free. */
export const fits = (r: Room, adding: number, kept = 0): boolean => r.heldBytes === null || r.usedBytes + adding + kept <= r.heldBytes;
/**
 * What a refusal for room says in its log line (docs: Logging and errors): the plan's limit by its name, what's stored,
 * what was being added, and what it's held to now (`grace`: a grace holds it past the plan's). Sizes, and nothing stored.
 */
export const roomContext = (r: Room, adding: number): LogContext =>
  ({ limit: r.limit, usedBytes: r.usedBytes, addingBytes: adding, limitBytes: r.heldBytes ?? r.planBytes, grace: r.grace });

/** Whether storing `adding` more bytes keeps an account within what it's held to. */
export async function mayStore(d: Service, db: Db, payerId: string, adding: number): Promise<boolean> {
  return fits(await roomOf(d, db, payerId), adding);
}

/** Refuses storing `adding` more bytes for an account that it has no room for, logging the limit and the sizes. */
export async function requireRoom(d: Service, db: Db, payerId: string, adding: number, context: LogContext): Promise<void> {
  const room = await roomOf(d, db, payerId);
  if (fits(room, adding)) return;
  throw new PlanLimitError('Your storage is full. Delete something, or move to a plan with more room.', 'storage', { context: { ...context, ...roomContext(room, adding), ownerId: payerId } });
}

/** The largest file an account's plan takes, and that limit's name. */
export async function fileLimitOf(d: Service, db: Db, payerId: string): Promise<{ limit: LimitName; bytes: number }> {
  const { p } = await planNow(d, db, payerId);
  return { limit: FILE_LIMIT[p.kind], bytes: p.fileBytes };
}
