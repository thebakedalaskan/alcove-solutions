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
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * What a limit counts. Bytes, money (micro-USD: $0.50 is 500000) and time (seconds) can be written with a unit: `512MiB`,
 * `$0.50`, `30d`. Minutes and counts are whole numbers.
 */
export type LimitUnit = 'bytes' | 'micro-usd' | 'seconds' | 'minutes' | 'count';
export interface LimitSpec {
  /** What it is while nothing's set. */
  default: number;
  /** What no value can take it below or past. */
  floor: number;
  ceiling: number;
  unit: LimitUnit;
  /** What it measures, for `limits list`. */
  measures: string;
}

/**
 * Every limit there is (docs: Plans and usage, and Deployment › Changing a limit): each plan's notes, storage, files and
 * shared workspaces, and its price; what an hour of notes is reckoned at, when AI stops and when an organizer is told
 * it's close; how long a plan's period and its grace last; the longest call and the most people in one; and what one
 * person uploads in a day, everywhere. A ceiling leaves room to raise a default a long way, except a file's: a whole file
 * is read in one response, which is cut at 280 seconds and past 16 MiB can't pick up where it stopped, so 512 MiB needs
 * about 15 Mbit/s to download whole and 4 GiB about 120 Mbit/s. Zero is a value: none.
 */
export const LIMITS = {
  'plan.free.notes_minutes': { default: 300, floor: 0, ceiling: 60_000, unit: 'minutes', measures: 'Free: the notes a period brings, reckoned at ai.hour_micro_usd an hour.' },
  'plan.free.storage_bytes': { default: 10 * GiB, floor: 0, ceiling: TiB, unit: 'bytes', measures: 'Free: what an account stores, its uploads and its recordings.' },
  'plan.free.file_bytes': { default: 512 * MiB, floor: 0, ceiling: MAX_MEDIA_BYTES, unit: 'bytes', measures: 'Free: one file.' },
  'plan.free.shared_workspaces': { default: 1, floor: 0, ceiling: 1_000, unit: 'count', measures: 'Free: shared workspaces an account makes (a call’s own don’t count).' },
  'plan.pro.price_micro_usd': { default: 20_000_000, floor: 0, ceiling: 10_000_000_000, unit: 'micro-usd', measures: 'Pro: one period.' },
  'plan.period_seconds': { default: 30 * DAY, floor: MINUTE, ceiling: 365 * DAY, unit: 'seconds', measures: 'A plan’s period: notes renew, and paid time runs, in these.' },
  'plan.grace_seconds': { default: 15 * DAY, floor: 0, ceiling: 90 * DAY, unit: 'seconds', measures: 'Once an account is over its plan’s limits: how long until what’s over stops taking more.' },
  'ai.hour_micro_usd': { default: 500_000, floor: 1, ceiling: 100_000_000, unit: 'micro-usd', measures: 'What an hour of notes is reckoned at, to give the AI allowance as time.' },
  'ai.stop_micro_usd': { default: 5_000, floor: 0, ceiling: 10_000_000, unit: 'micro-usd', measures: 'What’s left of an allowance when transcription and every AI request stop.' },
  'ai.warn_seconds': { default: 300, floor: 0, ceiling: HOUR, unit: 'seconds', measures: 'Notes left, at a call’s own pace, when its organizer is told.' },
  'ai.fallback_input_micro_usd': { default: 1_000_000, floor: 0, ceiling: 100_000_000, unit: 'micro-usd', measures: 'A million input tokens of a model NEAR AI lists no price for.' },
  'ai.fallback_output_micro_usd': { default: 4_000_000, floor: 0, ceiling: 100_000_000, unit: 'micro-usd', measures: 'A million output tokens of a model NEAR AI lists no price for.' },
  'ai.image_tokens': { default: 1_500, floor: 0, ceiling: 100_000, unit: 'count', measures: 'The input tokens one image is taken to be at most, before NEAR AI says.' },
  'call.max_seconds': { default: 10 * HOUR, floor: 10 * MINUTE, ceiling: 48 * HOUR, unit: 'seconds', measures: 'The longest a call runs: it ends then, everyone told 5 minutes before.' },
  'call.max_people': { default: 100, floor: 2, ceiling: 1_000, unit: 'count', measures: 'The most people in a call at once, those waiting to be let in included.' },
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

const SIZES: Record<string, number> = { bytes: 1, KiB, MiB, GiB, TiB };
const TIMES: Record<string, number> = { s: 1, m: MINUTE, h: HOUR, d: DAY };
/**
 * A value as someone types it for `limits set`, or as `limits list` shows it: a whole number, for bytes maybe with a unit
 * (`512MiB`, `100 GiB`), for time maybe with one (`30d`, `10 h`, `90s`), and money maybe in dollars (`$0.50`, `$20`).
 */
export function parseValue(name: LimitName, typed: string): number | undefined {
  const unit = LIMITS[name].unit;
  const dollars = /^\$(\d+)(?:\.(\d{1,6}))?$/.exec(typed.trim());
  if (dollars) {
    if (unit !== 'micro-usd') return undefined;
    const value = Number(dollars[1] ?? '') * 1_000_000 + Number((dollars[2] ?? '').padEnd(6, '0'));
    return Number.isSafeInteger(value) ? value : undefined;
  }
  const m = /^(\d+)\s*(bytes|KiB|MiB|GiB|TiB|s|m|h|d)?$/.exec(typed.trim());
  const digits = m?.[1];
  if (!m || digits === undefined) return undefined;
  const typedUnit = m[2];
  const scale = typedUnit === undefined ? 1 : unit === 'bytes' ? SIZES[typedUnit] : unit === 'seconds' ? TIMES[typedUnit] : undefined;
  if (scale === undefined) return undefined;
  const value = Number(digits) * scale;
  return Number.isSafeInteger(value) ? value : undefined;
}

/** A value as someone reads it: bytes and time in the largest unit it's a whole number of, money in dollars. */
export function shown(name: LimitName, value: number): string {
  const unit = LIMITS[name].unit;
  if (unit === 'micro-usd') return `$${(value / 1_000_000).toFixed(6).replace(/0{1,4}$/, '')}`;
  if (value === 0 || (unit !== 'bytes' && unit !== 'seconds')) return String(value);
  const steps = unit === 'bytes' ? [['TiB', TiB], ['GiB', GiB], ['MiB', MiB], ['KiB', KiB]] as const : [['d', DAY], ['h', HOUR], ['m', MINUTE]] as const;
  for (const [u, size] of steps) if (value % size === 0) return `${value / size} ${u}`;
  return unit === 'bytes' ? `${value} bytes` : `${value} s`;
}

/** Why a value can't be set, or nothing if it can: whatever a limit's bounds don't allow is refused here, not held to them. */
export function refusedValue(name: LimitName, value: number | undefined): string | undefined {
  const { floor, ceiling } = LIMITS[name];
  if (value === undefined) return 'a value is a whole number; bytes may have a unit (512MiB), time one too (30d, 10h), and money is in dollars ($0.50)';
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
