/*
 * When a call can happen: the soonest time everyone is free, the next one after a clash, the times a guest is offered,
 * a call that stops at midnight, and every call of a repeat at the same clock time where the organizer is, whatever the
 * clocks do in between. No screen in here: this is arithmetic.
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

/* ---------- a call's day ---------- */

/** Midnight at the end of the day `at` falls on, where you are: a call ends by then. */
export const dayEnd = (at: Date): Date => new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);

/**
 * How long a call meant to last `minutes` from `at` is: a call ends on the day it starts, so one whose end would pass
 * midnight stops there. The length it was meant to have is kept by whoever asks, so moving it earlier gives it back.
 */
export const lengthAt = (at: Date, minutes: number): number => Math.max(0, Math.min(minutes, Math.round((dayEnd(at).getTime() - at.getTime()) / MINUTE)));

/* ---------- a time typed ---------- */

/** The shortest and the longest a call can be, in minutes: the server's limits. */
export const SHORTEST_CALL = 5;
export const LONGEST_CALL = 600;
/** Times are typed in steps of this many minutes. */
export const TYPED_STEP = 5;

/**
 * Why a time typed can't be used: it isn't a time a 24-hour clock says ("9", "2pm", "25:00"), it's gone, the end comes
 * before the start, or the call is too long or too short.
 */
export type Untimely = 'unread' | 'gone' | 'backwards' | 'long' | 'short';
export type Retimed = { ok: true; at: Date; minutes: number } | { ok: false; why: Untimely };

/**
 * A call at `at` for `minutes`, with its start or its end typed as a clock time (`HH:MM`, to the nearest 5 minutes);
 * anything a 24-hour clock doesn't say is `unread`. A start moves the call on its own day and keeps its length, and it
 * can't have gone already. An end sets the length, up to 10 hours, on the same day: a call ends by midnight, so an end
 * can be 24:00 (or 00:00, which can only mean the same), and one before the start is `backwards`.
 */
export function retime(at: Date, minutes: number, which: 'start' | 'end', typed: string, now: Date): Retimed {
  const m = /^(\d{1,2})[:.]?(\d{2})(?::\d{2})?$/.exec(typed.trim());
  const hours = Number(m?.[1] ?? Number.NaN);
  const mins = Number(m?.[2] ?? Number.NaN);
  const midnight = which === 'end' && hours === 24 && mins === 0;
  if (!midnight && !(hours >= 0 && hours <= 23 && mins >= 0 && mins <= 59)) return { ok: false, why: 'unread' };
  const step = Math.round((hours * 60 + mins) / TYPED_STEP) * TYPED_STEP;
  const clock = which === 'start' ? Math.min(DAY / MINUTE - TYPED_STEP, step) : step === 0 ? DAY / MINUTE : Math.min(DAY / MINUTE, step);
  const on = new Date(at.getFullYear(), at.getMonth(), at.getDate(), Math.floor(clock / 60), clock % 60);
  if (which === 'start') return on.getTime() <= now.getTime() ? { ok: false, why: 'gone' } : { ok: true, at: on, minutes };
  const length = Math.round((on.getTime() - at.getTime()) / MINUTE);
  if (length <= 0) return { ok: false, why: 'backwards' };
  if (length < SHORTEST_CALL) return { ok: false, why: 'short' };
  if (length > LONGEST_CALL) return { ok: false, why: 'long' };
  return { ok: true, at, minutes: length };
}

/* ---------- the week ---------- */

/** The working day, in local hours: the soonest time keeps inside it, and the week greys what's outside it. */
export const WORK_FROM = 9;
export const WORK_TO = 17;

/** The Monday a week starts on, for the week `at` falls in, where you are. */
const mondayOf = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate() - ((at.getDay() + 6) % 7));
/** The seven days of a week, Monday to Sunday: the week `from` falls in, `weeks` on. */
export function weekDays(from: Date, weeks: number): Date[] {
  const monday = mondayOf(from);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7 * weeks + i));
}
/** How many weeks on from the week `from` falls in is the week `at` falls in. */
export const weeksTo = (from: Date, at: Date): number => Math.round((mondayOf(at).getTime() - mondayOf(from).getTime()) / (7 * DAY));

/* ---------- when people are free ---------- */

/** How far ahead calendars are read, and the soonest time is looked for. */
export const AHEAD_DAYS = 15;
/** A time picked for you leaves at least this long to get ready. */
const NOTICE = 10 * MINUTE;

/** Who's busy, of the stretches each calendar gives: those that overlap a call at `at` for `minutes`. */
export function busyAt<T extends Interval>(list: readonly T[], at: Date, minutes: number): T[] {
  const from = at.getTime();
  const to = from + lengthAt(at, minutes) * MINUTE;
  return list.filter((i) => Date.parse(i.from) < to && Date.parse(i.to) > from);
}
const freeAt = (calendars: readonly (readonly Interval[])[], at: Date, minutes: number) => calendars.every((c) => !busyAt(c, at, minutes).length);

/** The first time on the hour or half hour at `at` or after it, where you are. */
function halfHourFrom(at: number): Date {
  const d = new Date(at);
  const floor = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes() < 30 ? 0 : 30);
  return floor.getTime() < at ? new Date(floor.getFullYear(), floor.getMonth(), floor.getDate(), floor.getHours(), floor.getMinutes() + 30) : floor;
}
/** The next half hour at least 10 minutes from now: where a call goes when the time it had has gone. */
export const nextHalfHour = (now: Date): Date => halfHourFrom(now.getTime() + NOTICE);

/**
 * The working half hours from `from` (and at least 10 minutes from now) for `days` days: on weekdays, from 09:00 with the
 * call over by 17:00, where you are.
 */
function workingHalfHours(from: Date, now: Date, minutes: number, days = AHEAD_DAYS): Date[] {
  const out: Date[] = [];
  const start = halfHourFrom(Math.max(from.getTime(), now.getTime() + NOTICE));
  const until = new Date(start.getFullYear(), start.getMonth(), start.getDate() + days).getTime();
  for (let t = start; t.getTime() < until; t = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes() + 30)) {
    const clock = t.getHours() * 60 + t.getMinutes();
    if (t.getDay() !== 0 && t.getDay() !== 6 && clock >= WORK_FROM * 60 && clock + minutes <= WORK_TO * 60) out.push(t);
  }
  return out;
}

/**
 * The soonest free half hour: the first time on the hour or half hour, at least 10 minutes from now, on a weekday, from
 * 09:00 with the call over by 17:00, when you and everyone whose calendar can be read are free. If nothing in the days
 * read suits everyone, the soonest you're free; failing that, the next working half hour.
 */
export function soonestFree({ now, minutes, you, people }: { now: Date; minutes: number; you: readonly Interval[]; people: readonly (readonly Interval[])[] }): Date {
  const all = workingHalfHours(now, now, minutes);
  return all.find((t) => freeAt([you, ...people], t, minutes)) ?? all.find((t) => freeAt([you], t, minutes)) ?? all[0] ?? nextHalfHour(now);
}

/** On a clash: the soonest free half hour from the clashing time on, for you and everyone whose calendar can be read. */
export function nextFree({ from, now, minutes, you, people }: { from: Date; now: Date; minutes: number; you: readonly Interval[]; people: readonly (readonly Interval[])[] }): Date | null {
  return workingHalfHours(from, now, minutes).find((t) => freeAt([you, ...people], t, minutes)) ?? null;
}

/** Whether a call at `at` for `minutes` is outside the working day: before 09:00, past 17:00, or at the weekend. */
export function outsideWork(at: Date, minutes: number): boolean {
  const clock = at.getHours() * 60 + at.getMinutes();
  return at.getDay() === 0 || at.getDay() === 6 || clock < WORK_FROM * 60 || clock + lengthAt(at, minutes) > WORK_TO * 60;
}

/**
 * The times a guest is offered when they pick: `at`, then the same time on each of the next two weekdays you're free
 * then, or the soonest you're free on that day. Never random: each says why it's there.
 */
export function offerTimes({ at, now, minutes, you }: { at: Date; now: Date; minutes: number; you: readonly Interval[] }): Date[] {
  const out = [at];
  const clock = at.getHours() * 60 + at.getMinutes();
  for (let k = 1; out.length < 3 && k < 40; k++) {
    const day = new Date(at.getFullYear(), at.getMonth(), at.getDate() + k);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const same = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(clock / 60), clock % 60);
    if (clock >= WORK_FROM * 60 && clock + minutes <= WORK_TO * 60 && freeAt([you], same, minutes)) { out.push(same); continue; }
    const soon = workingHalfHours(day, now, minutes, 1).find((t) => freeAt([you], t, minutes));
    if (soon) out.push(soon);
  }
  return out;
}
