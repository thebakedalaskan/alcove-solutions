/*
 * Limits that can change while the service runs, without a deploy (docs: Deployment and acceptance › Changing a limit).
 * Each is named here with its default, which holds while nothing's set, and a floor and a ceiling, which hold whatever is:
 * a value read from the database is trusted no further than this file allows, so a typo can't make anything unsafe. A row
 * in `service_limits` overrides a default. One that isn't a value at all is ignored, with a line in the log, and its limit
 * keeps its default. Each instance reads the rows again once its copy is LIMITS_CACHE_MS old, so a change made from
 * `limits set` or the database's console is in force everywhere within that, and every instance that sees one says so.
 */
import { MAX_MEDIA_BYTES } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from './context';
import { exec, maybeOne, rows, timestamp, type Db } from './db';
import { log } from './log';

const llog = log.child({ component: 'limits' });
const KiB = 1024;
const MiB = 1024 * KiB;
const GiB = 1024 * MiB;
const TiB = 1024 * GiB;

export interface LimitSpec {
  /** What it is while nothing's set. */
  default: number;
  /** What no value can take it below or past. */
  floor: number;
  ceiling: number;
  /** What it counts. Bytes can be written with a unit: `512MiB`. */
  unit: 'bytes';
  /** What it measures, for `limits list`. */
  measures: string;
}

/**
 * Every limit there is. Storage, so far: a file, a workspace's files, and what one person uploads in a day, the same for
 * everyone, guests included. A ceiling is ten times the default, room to raise it a long way, except a file's: a whole file
 * is read in one response, which is cut at 280 seconds and past 16 MiB can't pick up where it stopped, so 512 MiB needs
 * about 15 Mbit/s to download whole and 4 GiB about 120 Mbit/s. Zero is a value: none.
 */
export const LIMITS = {
  'media.file_bytes': { default: 512 * MiB, floor: 0, ceiling: MAX_MEDIA_BYTES, unit: 'bytes', measures: 'One file.' },
  'media.workspace_bytes': { default: 100 * GiB, floor: 0, ceiling: TiB, unit: 'bytes', measures: 'What a workspace stores, sealed (its stored_bytes).' },
  'media.account_day_bytes': { default: 20 * GiB, floor: 0, ceiling: 200 * GiB, unit: 'bytes', measures: 'What one person uploads in a day (UTC), in every workspace.' }
} as const satisfies Record<string, LimitSpec>;
export type LimitName = keyof typeof LIMITS;
export const isLimitName = (name: string): name is LimitName => Object.hasOwn(LIMITS, name);
export const LIMIT_NAMES: LimitName[] = Object.keys(LIMITS).filter(isLimitName);

/** The limits in force, as one instance has them. */
export interface Limits { get(name: LimitName): number }

const Row = z.object({ name: z.string(), value: z.string(), updated_at: timestamp });
export type LimitRow = z.infer<typeof Row>;
/** Every row, by name. A bigint is read as its text, so nothing about it is lost before it's checked. */
export const limitRows = (db: Db): Promise<LimitRow[]> => rows(db, Row, 'SELECT name, value::text AS value, updated_at FROM service_limits ORDER BY name');

/** What a row's value means for a limit: what's in force, held to its bounds, or why it can't be used at all. */
export function valueOf(name: LimitName, raw: string): { value: number; clamped: boolean } | { refused: string } {
  const v = Number(raw);
  if (!Number.isFinite(v)) return { refused: 'not a number' };
  if (!Number.isInteger(v)) return { refused: 'not a whole number' };
  if (v < 0) return { refused: 'less than nothing' };
  const { floor, ceiling } = LIMITS[name];
  const value = Math.min(ceiling, Math.max(floor, v));
  return { value, clamped: value !== v };
}

/** What the rows come to: each limit's value in force, and every row that's ignored or held to its bounds. */
export interface Reading {
  values: Map<LimitName, number>;
  ignored: { name: string; value: number; why: string }[];
  clamped: { name: LimitName; value: number; used: number }[];
}
export function readRows(found: LimitRow[]): Reading {
  const values = new Map(LIMIT_NAMES.map((name) => [name, LIMITS[name].default]));
  const reading: Reading = { values, ignored: [], clamped: [] };
  for (const r of found) {
    if (!isLimitName(r.name)) { reading.ignored.push({ name: r.name, value: Number(r.value), why: 'not a limit' }); continue; }
    const v = valueOf(r.name, r.value);
    if ('refused' in v) { reading.ignored.push({ name: r.name, value: Number(r.value), why: v.refused }); continue; }
    if (v.clamped) reading.clamped.push({ name: r.name, value: Number(r.value), used: v.value });
    values.set(r.name, v.value);
  }
  return reading;
}

/** One instance's copy of the limits: when it was read, what it said, and which rows it has already said it can't use. */
interface Copy { at: number; values: Map<LimitName, number>; noted: Set<string>; reading: Promise<void> | undefined }
/** One copy per database, which is one per process outside tests. */
const copies = new WeakMap<Db, Copy>();

/**
 * Reads the rows into a copy and says what changed: a limit whose value is new, at info, with what it was and what it is,
 * so a change made at the database's console is logged too, and a row it can't use or had to hold to its bounds, once, at
 * warn. A copy starts at the defaults, so a process says which limits are set the first time it reads them. If the rows
 * can't be read, what was in force stays, until the next try.
 */
async function refresh(d: Pick<Deps, 'pool'>, copy: Copy): Promise<void> {
  copy.reading ??= (async () => {
    try {
      const r = readRows(await limitRows(d.pool));
      const noted = new Set<string>();
      for (const x of r.ignored) {
        const key = `ignored ${x.name} ${x.value}`;
        noted.add(key);
        if (!copy.noted.has(key)) llog.warn('service limit ignored', { limit: x.name, value: x.value, why: x.why });
      }
      for (const x of r.clamped) {
        const key = `clamped ${x.name} ${x.value}`;
        noted.add(key);
        if (!copy.noted.has(key)) llog.warn('service limit clamped', { limit: x.name, value: x.value, used: x.used, floor: LIMITS[x.name].floor, ceiling: LIMITS[x.name].ceiling });
      }
      copy.noted = noted;
      for (const name of LIMIT_NAMES) {
        const old = copy.values.get(name);
        const next = r.values.get(name);
        if (old !== next) llog.info('service limit changed', { limit: name, old, new: next });
      }
      copy.values = r.values;
    } catch (e) {
      llog.warn('service limits not read; keeping what was in force', { err: e });
    } finally {
      copy.at = performance.now();
      copy.reading = undefined;
    }
  })();
  await copy.reading;
}

/** The limits in force, from this instance's copy, read again first if it's older than LIMITS_CACHE_MS. */
export async function limitsNow(d: Pick<Deps, 'pool' | 'cfg'>): Promise<Limits> {
  let copy = copies.get(d.pool);
  if (!copy) {
    copy = { at: -Infinity, values: readRows([]).values, noted: new Set(), reading: undefined };
    copies.set(d.pool, copy);
  }
  if (performance.now() - copy.at >= d.cfg.LIMITS_CACHE_MS) await refresh(d, copy);
  const { values } = copy;
  return { get: (name) => values.get(name) ?? LIMITS[name].default };
}

const UNITS: Record<string, number> = { bytes: 1, KiB, MiB, GiB, TiB };
/** A value as someone types it for `limits set`, or as `limits list` shows it: a whole number, and for bytes maybe a unit (`512MiB`, `100 GiB`). */
export function parseValue(name: LimitName, typed: string): number | undefined {
  const m = /^(\d+)\s*(bytes|KiB|MiB|GiB|TiB)?$/.exec(typed.trim());
  const digits = m?.[1];
  if (!m || digits === undefined) return undefined;
  const unit = m[2];
  const value = Number(digits) * (unit === undefined || LIMITS[name].unit !== 'bytes' ? 1 : UNITS[unit] ?? Number.NaN);
  return Number.isSafeInteger(value) ? value : undefined;
}

/** A value as someone reads it: in the largest unit it's a whole number of. */
export function shown(name: LimitName, value: number): string {
  if (LIMITS[name].unit !== 'bytes' || value === 0) return String(value);
  for (const [unit, size] of [['TiB', TiB], ['GiB', GiB], ['MiB', MiB], ['KiB', KiB]] as const) if (value % size === 0) return `${value / size} ${unit}`;
  return `${value} bytes`;
}

/** Why a value can't be set, or nothing if it can: whatever a limit's bounds don't allow is refused here, not held to them. */
export function refusedValue(name: LimitName, value: number | undefined): string | undefined {
  const { floor, ceiling } = LIMITS[name];
  if (value === undefined) return 'a value is a whole number, and for bytes may have a unit: 512MiB, 100GiB';
  if (value < floor || value > ceiling) return `${name} goes from ${shown(name, floor)} to ${shown(name, ceiling)}`;
  return undefined;
}

/** Sets a limit, for `limits set`, and says what was in force before and what is now. The value has passed `refusedValue`. */
export async function setLimit(db: Db, name: LimitName, value: number): Promise<{ old: number; new: number }> {
  const before = await maybeOne(db, Row, 'SELECT name, value::text AS value, updated_at FROM service_limits WHERE name = $1', [name]);
  const was = before ? valueOf(name, before.value) : undefined;
  const old = was && 'value' in was ? was.value : LIMITS[name].default;
  await exec(db, 'INSERT INTO service_limits (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()', [name, value]);
  llog.info('service limit set', { limit: name, old, new: value });
  return { old, new: value };
}
