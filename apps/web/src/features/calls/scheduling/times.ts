/*
 * When a call can happen: three good times from what's known of everyone's calendars, and every call of a repeat at
 * the same clock time where the organizer is, whatever the clocks do in between. No screen in here: this is arithmetic.
 */
import { MAX_SERIES_CALLS, type Interval, type RepeatRule } from '@alcove/api';

const DAY = 86_400_000;
const MINUTE = 60_000;

/* ---------- days and clock times in a time zone ---------- */

/** A calendar day counted from 1970, the same everywhere: days can be added without any clock changing under them. */
type DayNumber = number;
const dayNumber = (y: number, m: number, d: number): DayNumber => Math.round(Date.UTC(y, m - 1, d) / DAY);
const weekdayOf = (day: DayNumber): number => new Date(day * DAY).getUTCDay();
const dateOf = (day: DayNumber) => { const d = new Date(day * DAY); return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }; };
const isoDay = (day: DayNumber): string => new Date(day * DAY).toISOString().slice(0, 10);

interface Wall { year: number; month: number; day: number; hour: number; minute: number; second: number }

const zones = new Map<string, Intl.DateTimeFormat>();
function zone(timeZone: string): Intl.DateTimeFormat {
  const known = zones.get(timeZone);
  if (known) return known;
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  zones.set(timeZone, f);
  return f;
}
/** What a clock on the wall in `timeZone` says at this moment. */
function wallAt(at: number, timeZone: string): Wall {
  const parts = zone(timeZone).formatToParts(new Date(at));
  const of = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: of('year'), month: of('month'), day: of('day'), hour: of('hour'), minute: of('minute'), second: of('second') };
}
const wallAsUtc = (w: Wall) => Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
/** How far ahead of UTC the clocks in `timeZone` are at this moment, in milliseconds. */
const offsetAt = (at: number, timeZone: string) => wallAsUtc(wallAt(at, timeZone)) - Math.floor(at / 1000) * 1000;

/**
 * The moment a wall clock in `timeZone` says this. Where the clocks go back the time happens twice, and it's the
 * first; where they go forward it doesn't happen at all, and it's read with the offset from before, so 02:30 is 03:30.
 */
function momentOf(w: Wall, timeZone: string): number {
  const want = wallAsUtc(w);
  const before = want - offsetAt(want - DAY, timeZone);
  const after = want - offsetAt(want + DAY, timeZone);
  if (wallAsUtc(wallAt(before, timeZone)) === want) return before;
  return wallAsUtc(wallAt(after, timeZone)) === want ? after : before;
}

/** The day a moment falls on in `timeZone`, as `YYYY-MM-DD`. */
export function localDay(at: Date, timeZone: string): string {
  const w = wallAt(at.getTime(), timeZone);
  return isoDay(dayNumber(w.year, w.month, w.day));
}
/** The weekday a moment falls on in `timeZone`: 0 is Sunday. */
export function localWeekday(at: Date, timeZone: string): number {
  const w = wallAt(at.getTime(), timeZone);
  return weekdayOf(dayNumber(w.year, w.month, w.day));
}

/* ---------- repeats ---------- */

/** The day of a month a weekday falls on: `week` 1 to 4, or -1 for the last. */
function weekdayOfMonth(year: number, month: number, week: number, weekday: number): DayNumber {
  if (week === -1) {
    const last = dayNumber(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1) - 1;
    return last - ((weekdayOf(last) - weekday + 7) % 7);
  }
  const first = dayNumber(year, month, 1);
  return first + ((weekday - weekdayOf(first) + 7) % 7) + (week - 1) * 7;
}

/** "the third Thursday" of a month for this moment: a fifth one is "the last", since not every month has one. */
export function monthlyRule(at: Date, timeZone: string): Extract<RepeatRule, { every: 'month' }> {
  const w = wallAt(at.getTime(), timeZone);
  const nth = Math.ceil(w.day / 7);
  const week = nth === 1 ? 1 : nth === 2 ? 2 : nth === 3 ? 3 : nth === 4 ? 4 : -1;
  return { every: 'month', week, day: weekdayOf(dayNumber(w.year, w.month, w.day)) };
}

/**
 * When each call of a repeat starts, soonest first, as ISO times: `start` itself, then every day the rule gives up to and
 * including `until` (`YYYY-MM-DD` where the organizer is), at the same clock time in `timeZone`, at most MAX_SERIES_CALLS.
 * Weeks run Monday to Sunday, as a calendar's recurrence counts them.
 */
export function expandRepeat(rule: RepeatRule, start: Date, until: string, timeZone: string): string[] {
  const first = wallAt(start.getTime(), timeZone);
  const firstDay = dayNumber(first.year, first.month, first.day);
  const [y, m, d] = until.split('-').map(Number);
  const lastDay = dayNumber(y ?? 0, m ?? 1, d ?? 1);
  const out = [start.toISOString()];
  const add = (day: DayNumber) => out.push(new Date(momentOf({ ...first, ...dateOf(day) }, timeZone)).toISOString());
  if (rule.every === 'week') {
    const days = new Set(rule.days);
    const monday = firstDay - ((weekdayOf(firstDay) + 6) % 7);
    for (let week = monday; week <= lastDay && out.length < MAX_SERIES_CALLS; week += 7 * rule.weeks) {
      for (let day = week; day < week + 7 && day <= lastDay && out.length < MAX_SERIES_CALLS; day++) {
        if (day > firstDay && days.has(weekdayOf(day))) add(day);
      }
    }
    return out;
  }
  for (let i = 0; out.length < MAX_SERIES_CALLS; i++) {
    const month = first.month - 1 + i;
    const day = weekdayOfMonth(first.year + Math.floor(month / 12), (month % 12) + 1, rule.week, rule.day);
    if (day > lastDay) break;
    if (day > firstDay) add(day);
  }
  return out;
}

/** The last day of a repeat with this many calls, for when nobody has said when it ends. */
export function untilForCalls(rule: RepeatRule, start: Date, timeZone: string, calls: number): string {
  const all = expandRepeat(rule, start, '9999-12-31', timeZone);
  const last = all[Math.min(calls, all.length) - 1] ?? start.toISOString();
  return localDay(new Date(last), timeZone);
}

/* ---------- suggesting times ---------- */

/** The working day suggestions stay inside, in local hours, and how far ahead they look. */
const WORK_FROM = 9;
const WORK_TO = 17;
const WORKING_DAYS_AHEAD = 10;
/** A suggestion for today leaves this long to get ready. */
const LEAD = 2 * 60 * MINUTE;
/** Two suggestions on one day are at least this far apart. */
const APART = 90 * MINUTE;
/** The times of day people find easiest, best first, in minutes from midnight. */
const COMFORT = [600, 840, 660, 900, 630, 870, 690, 930, 780, 810, 960, 570, 990, 540, 720, 750];
const comfort = (minutes: number) => { const i = COMFORT.indexOf(minutes); return i < 0 ? COMFORT.length : i; };

/** A time and how many people it suits: `of` counts you and everyone whose calendar can be read. */
export interface Slot { at: Date; free: number; of: number }

type Range = readonly [number, number];
const toRanges = (list: readonly Interval[]): Range[] => list.map((i) => [new Date(i.from).getTime(), new Date(i.to).getTime()]);
const clash = (ranges: readonly Range[], from: number, to: number) => ranges.some(([a, b]) => a < to && b > from);

/** Who's free for `minutes` from `at`. */
export function slotAt(at: Date, minutes: number, you: readonly Interval[], people: readonly (readonly Interval[])[]): Slot {
  const from = at.getTime();
  const to = from + minutes * MINUTE;
  const free = people.filter((p) => !clash(toRanges(p), from, to)).length + (clash(toRanges(you), from, to) ? 0 : 1);
  return { at, free, of: people.length + 1 };
}

/** The next working days from `from`, that day included when it is one. */
export function workingDays(from: Date, count: number): Date[] {
  const out: Date[] = [];
  for (const d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); out.length < count; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(new Date(d));
  }
  return out;
}

/**
 * Up to `count` times to offer, best first. Never in the past, only inside working hours on weekdays, never when
 * you're busy, those that suit the most people first, and on different days while there are days to spread over. With
 * no calendars at all it still offers something sensible: good hours on the next working days. Today comes last: it
 * leaves people the least notice.
 */
export function suggestTimes({ now, minutes, you, people, count = 3 }: {
  now: Date; minutes: number; you: readonly Interval[]; people: readonly (readonly Interval[])[]; count?: number | undefined;
}): Slot[] {
  const mine = toRanges(you);
  const theirs = people.map(toRanges);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const pool: (Slot & { rank: number; clock: number })[] = [];
  workingDays(now, WORKING_DAYS_AHEAD).forEach((day, i) => {
    for (let clock = WORK_FROM * 60; clock + minutes <= WORK_TO * 60; clock += 30) {
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(clock / 60), clock % 60);
      const from = at.getTime();
      const to = from + minutes * MINUTE;
      if (from < now.getTime() + LEAD || clash(mine, from, to)) continue;
      const free = 1 + theirs.filter((p) => !clash(p, from, to)).length;
      pool.push({ at, free, of: theirs.length + 1, rank: day.getTime() === today ? WORKING_DAYS_AHEAD + 1 : i, clock });
    }
  });
  const picked: typeof pool = [];
  const better = (a: (typeof pool)[number], b: (typeof pool)[number]) => {
    const again = (s: (typeof pool)[number]) => (picked.some((p) => p.clock === s.clock) ? 1 : 0);
    return b.free - a.free || a.rank - b.rank || again(a) - again(b) || comfort(a.clock) - comfort(b.clock);
  };
  while (picked.length < count) {
    const best = pool.filter((s) => !picked.some((p) => p.rank === s.rank)).sort(better)[0];
    if (!best) break;
    picked.push(best);
  }
  while (picked.length < count) {
    const best = pool.filter((s) => picked.every((p) => Math.abs(p.at.getTime() - s.at.getTime()) >= APART)).sort(better)[0];
    if (!best) break;
    picked.push(best);
  }
  return picked.map(({ at, free, of }) => ({ at, free, of }));
}
