/*
 * Limits that can change while the service runs, without a deploy (docs: Deployment and acceptance › Changing a limit).
 * Each is named here with its default, which holds while nothing's set, and a floor and a ceiling, which hold whatever is:
 * a value read from the database is trusted no further than this file allows, so a typo can't make anything unsafe. A row
 * in `service_limits` overrides a default. One that isn't a value at all is ignored, with a line in the log, and its limit
 * keeps its default. Each instance reads the rows again once its copy is LIMITS_CACHE_MS old, so a change made from
 * `limits set` or the database's console is in force everywhere within that, and every instance that sees one says so.
 */
import { MAX_LICENSE_PERIODS } from '@alcove/api';
import pg from 'pg';
import { z } from 'zod';
import type { Config } from './config';
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
 * The largest file any plan takes for now, so every plan's file limit stops here: a whole file is read in one response,
 * so a bigger one waits until downloads can pick up where they stopped. Pro's and Team's 2 GiB are for then.
 */
const WHOLE_DOWNLOAD_BYTES = 512 * MiB;

/**
 * Every limit there is (docs: Plans and usage, and Deployment › Changing a limit): each plan's notes, storage and files, Pro's and
 * a team license's price and Pro's lower price for a year or more, the most months or licenses one purchase buys and when
 * Pro's end is told; more notes for a period, their price and the most bought at once; when a team's admin is told licenses
 * are low and how long an invite works; what an hour of notes is reckoned at, when AI stops and when an organizer is told
 * it's close, and how much of it guests in one call may spend; how long a plan's period and its grace last; the longest call,
 * the most people in one, and how many asks to join it one network may have waiting; what one person uploads in a day,
 * everywhere, and what others add in a day to an account's storage, what's kept of it for the account's own notes, and how
 * long a workspace's files wait to count against whoever its payment moves to. A ceiling leaves room to raise a default a
 * long way, except a file's, which is
 * WHOLE_DOWNLOAD_BYTES for every plan: a whole file is read in one response, which is cut at 280 seconds, so 512 MiB
 * already needs about 15 Mbit/s to download whole. Zero is a value: none.
 */
export const LIMITS = {
  'plan.free.notes_minutes': { default: 300, floor: 0, ceiling: 60_000, unit: 'minutes', measures: 'Free: the notes a period brings, reckoned at ai.hour_micro_usd an hour.' },
  'plan.free.storage_bytes': { default: 10 * GiB, floor: 0, ceiling: TiB, unit: 'bytes', measures: 'Free: what an account stores, its uploads and its recordings.' },
  'plan.free.file_bytes': { default: 512 * MiB, floor: 0, ceiling: WHOLE_DOWNLOAD_BYTES, unit: 'bytes', measures: 'Free: one file.' },
  'plan.pro.notes_minutes': { default: 3_000, floor: 0, ceiling: 600_000, unit: 'minutes', measures: 'Pro: the notes a period (a month of Pro) brings, reckoned at ai.hour_micro_usd an hour.' },
  'plan.pro.storage_bytes': { default: 100 * GiB, floor: 0, ceiling: 10 * TiB, unit: 'bytes', measures: 'Pro: what an account stores, its uploads and its recordings. Held this high for plan.grace_seconds after Pro ends.' },
  'plan.pro.file_bytes': { default: 512 * MiB, floor: 0, ceiling: WHOLE_DOWNLOAD_BYTES, unit: 'bytes', measures: 'Pro: one file.' },
  'plan.pro.price_micro_usd': { default: 20_000_000, floor: 0, ceiling: 10_000_000_000, unit: 'micro-usd', measures: 'Pro: one period.' },
  'plan.pro.yearly_price_micro_usd': { default: 16_000_000, floor: 0, ceiling: 10_000_000_000, unit: 'micro-usd', measures: 'Pro: one period, bought plan.pro.yearly_from_months or more at once. None while it’s 0 or not below plan.pro.price_micro_usd.' },
  'plan.pro.yearly_from_months': { default: 12, floor: 1, ceiling: 120, unit: 'count', measures: 'The fewest months of Pro one purchase buys at plan.pro.yearly_price_micro_usd. None while it’s more than plan.pro.max_months.' },
  'plan.pro.max_months': { default: 12, floor: 1, ceiling: 120, unit: 'count', measures: 'The most months of Pro one purchase buys.' },
  'plan.pro.remind_seconds': { default: 3 * DAY, floor: 0, ceiling: 30 * DAY, unit: 'seconds', measures: 'How long before Pro ends its owner is told, and a month is bought if renewing is on.' },
  'plan.team.price_micro_usd': { default: 40_000_000, floor: 0, ceiling: 10_000_000_000, unit: 'micro-usd', measures: 'Team: one license, a person for one period.' },
  'plan.team.yearly_price_micro_usd': { default: 32_000_000, floor: 0, ceiling: 10_000_000_000, unit: 'micro-usd', measures: 'Team: a license for a year, a person for one of its plan.team.yearly_periods periods. None while it’s 0 or not below plan.team.price_micro_usd.' },
  'plan.team.yearly_periods': { default: 12, floor: 0, ceiling: MAX_LICENSE_PERIODS, unit: 'count', measures: 'Team: how many periods a license for a year covers, at plan.team.yearly_price_micro_usd each. None while it’s 0 or 1.' },
  'plan.team.notes_minutes': { default: 3_000, floor: 0, ceiling: 600_000, unit: 'minutes', measures: 'Team: the notes a license’s period brings its member, reckoned at ai.hour_micro_usd an hour.' },
  'plan.team.storage_bytes': { default: 100 * GiB, floor: 0, ceiling: 10 * TiB, unit: 'bytes', measures: 'Team: the storage each live license adds to its team’s pool; also what someone who leaves a team is held to through plan.grace_seconds.' },
  'plan.team.file_bytes': { default: 512 * MiB, floor: 0, ceiling: WHOLE_DOWNLOAD_BYTES, unit: 'bytes', measures: 'Team: one file.' },
  'plan.hours.pack_minutes': { default: 600, floor: 1, ceiling: 60_000, unit: 'minutes', measures: 'More notes: the minutes one pack adds to the period it’s bought in, reckoned at ai.hour_micro_usd an hour.' },
  'plan.hours.price_micro_usd': { default: 15_000_000, floor: 0, ceiling: 10_000_000_000, unit: 'micro-usd', measures: 'More notes: one pack. At 0, more notes aren’t offered.' },
  'plan.hours.max_packs': { default: 5, floor: 1, ceiling: 100, unit: 'count', measures: 'More notes: the most packs one purchase buys.' },
  'plan.period_seconds': { default: 30 * DAY, floor: MINUTE, ceiling: 365 * DAY, unit: 'seconds', measures: 'A plan’s period: notes renew, and paid time runs, in these. A change applies from each account’s next period: one that has begun runs to its end as it began.' },
  'plan.grace_seconds': { default: 15 * DAY, floor: 0, ceiling: 90 * DAY, unit: 'seconds', measures: 'Once an account is over its plan’s limits: how long until what’s over stops taking more.' },
  'ai.hour_micro_usd': { default: 500_000, floor: 1, ceiling: 100_000_000, unit: 'micro-usd', measures: 'What an hour of notes is reckoned at, to give the AI allowance as time.' },
  'ai.stop_micro_usd': { default: 5_000, floor: 0, ceiling: 10_000_000, unit: 'micro-usd', measures: 'What’s left of an allowance when transcription and every AI request stop.' },
  'ai.warn_seconds': { default: 300, floor: 0, ceiling: HOUR, unit: 'seconds', measures: 'Notes left, at a call’s own pace, when its organizer is told.' },
  'ai.fallback_input_micro_usd': { default: 1_000_000, floor: 0, ceiling: 100_000_000, unit: 'micro-usd', measures: 'A million input tokens of a model NEAR AI lists no price for.' },
  'ai.fallback_output_micro_usd': { default: 4_000_000, floor: 0, ceiling: 100_000_000, unit: 'micro-usd', measures: 'A million output tokens of a model NEAR AI lists no price for.' },
  'ai.image_tokens': { default: 1_500, floor: 0, ceiling: 100_000, unit: 'count', measures: 'The input tokens one image is taken to be at most, before NEAR AI says.' },
  'ai.guests_call_percent': { default: 10, floor: 0, ceiling: 100, unit: 'count', measures: 'The most guests in one call spend between them of its organizer’s allowance for the period, in percent: their questions, catch-ups, AI on the call’s documents and boards, captions in another language and live notes of their own.' },
  'call.max_seconds': { default: 10 * HOUR, floor: 10 * MINUTE, ceiling: 48 * HOUR, unit: 'seconds', measures: 'The longest a call runs: it ends then, everyone told 5 minutes before.' },
  'call.max_people': { default: 100, floor: 2, ceiling: 1_000, unit: 'count', measures: 'The most people in a call at once. Asking to be let in takes no place: someone who asked is let in only while there’s room.' },
  'call.asks_per_address': { default: 10, floor: 1, ceiling: 1_000, unit: 'count', measures: 'The most asks to join one call waiting at once from one network (an address, or an IPv6 /64), so nobody can fill its host’s list of them.' },
  'team.max_licenses': { default: 500, floor: 1, ceiling: 100_000, unit: 'count', measures: 'The most team licenses one purchase buys.' },
  'team.low_licenses': { default: 5, floor: 0, ceiling: 100_000, unit: 'count', measures: 'Unconsumed licenses below which a team’s admin is told they’re running low.' },
  'team.invite_seconds': { default: DAY, floor: MINUTE, ceiling: 30 * DAY, unit: 'seconds', measures: 'How long a link to join a team works, once.' },
  'workspaces.max_made': { default: 1_000, floor: 1, ceiling: 100_000, unit: 'count', measures: 'The most workspaces one account makes, to stop one from making them without end.' },
  'media.account_day_bytes': { default: 20 * GiB, floor: 0, ceiling: 200 * GiB, unit: 'bytes', measures: 'What one person uploads in a day (UTC), in every workspace.' },
  'media.others_day_bytes': { default: 2 * GiB, floor: 0, ceiling: 200 * GiB, unit: 'bytes', measures: 'What someone signed in adds in a day (UTC) to another account’s storage, through the workspaces it pays for: four of Free’s largest files. Someone licensed on the same team adds to its pool as to their own.' },
  'media.guests_day_bytes': { default: 256 * MiB, floor: 0, ceiling: 200 * GiB, unit: 'bytes', measures: 'What guests in calls add between them in a day (UTC) to the storage of the account whose workspaces they work in.' },
  'media.payer_reserve_bytes': { default: GiB, floor: 0, ceiling: TiB, unit: 'bytes', measures: 'What’s kept of an account’s storage for its own notes and recordings: uploads by anyone else stop once its room would fall below this. About five hours of a call with a screen shared.' },
  'workspaces.payer_grace_seconds': { default: 15 * DAY, floor: 0, ceiling: 90 * DAY, unit: 'seconds', measures: 'When payment for a workspace moves to one of its admins because whoever paid for it left: how long until the files it held then count against their storage. As long as plan.grace_seconds, so every storage grace is the same time to sort things out.' }
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
/**
 * The rows, read on the caller's connection. A client is one `tx` holds: there, a read that fails is undone to a
 * savepoint, so the caller's transaction goes on with what was in force.
 */
async function rowsOn(db: Db): Promise<LimitRow[]> {
  if (db instanceof pg.Pool) return limitRows(db);
  await exec(db, 'SAVEPOINT service_limits_read');
  try {
    const read = await limitRows(db);
    await exec(db, 'RELEASE SAVEPOINT service_limits_read');
    return read;
  } catch (e) {
    await exec(db, 'ROLLBACK TO SAVEPOINT service_limits_read');
    throw e;
  }
}

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

/**
 * One instance's copy of the limits: when it was read, what it said, and which rows it has already said it can't use; the
 * read through the pool on its way, if one is; and how many reads have started, and which of them is in force.
 */
interface Copy { at: number; values: Map<LimitName, number>; noted: Set<string>; pooled: Promise<void> | undefined; started: number; applied: number }
/** One copy per database, which is one per process outside tests. */
const copies = new WeakMap<Db, Copy>();
function copyFor(pool: Db): Copy {
  const found = copies.get(pool);
  if (found) return found;
  const copy: Copy = { at: -Infinity, values: readRows([]).values, noted: new Set(), pooled: undefined, started: 0, applied: 0 };
  copies.set(pool, copy);
  return copy;
}

/**
 * Reads the rows on `db` into a copy and says what changed: a limit whose value is new, at info, with what it was and what
 * it is, so a change made at the database's console is logged too, and a row it can't use or had to hold to its bounds,
 * once, at warn. A copy starts at the defaults, so a process says which limits are set the first time it reads them. If the
 * rows can't be read, what was in force stays, until the next try. Reads on different connections can finish out of turn:
 * one that started before the read in force changes nothing.
 */
async function read(db: Db, copy: Copy): Promise<void> {
  const turn = ++copy.started;
  try {
    const r = readRows(await rowsOn(db));
    if (turn < copy.applied) return;
    copy.applied = turn;
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
  }
}

/**
 * The limits in force, from this instance's copy, read again first if it's older than LIMITS_CACHE_MS. Callers through the
 * pool hold no connection while they wait, so they share one read. Inside a transaction, pass its connection: the rows are
 * read there, and it waits on nothing else. A read through the pool may be waiting for a connection, and a transaction that
 * waited on it while holding one could wait on itself, or on the others waiting on its rows, until the pool gives up.
 */
export async function limitsNow(d: Pick<Deps, 'pool'> & { cfg: Pick<Config, 'LIMITS_CACHE_MS'> }, db: Db = d.pool): Promise<Limits> {
  const copy = copyFor(d.pool);
  if (performance.now() - copy.at >= d.cfg.LIMITS_CACHE_MS) {
    if (db instanceof pg.Pool) {
      copy.pooled ??= read(db, copy).finally(() => { copy.pooled = undefined; });
      await copy.pooled;
    } else {
      await read(db, copy);
    }
  }
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
