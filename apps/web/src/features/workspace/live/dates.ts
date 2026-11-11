/*
 * When a follow-up is due, as people say it. The notes keep the words ("Friday", "end of March"), and a document's date tag
 * is a day on the calendar, so a date that can be read as one goes in as a tag, and anything vaguer stays in words.
 */
import { hm, shortDay } from '~/lib/time';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const dayOn = (from: Date, add: number) => new Date(from.getFullYear(), from.getMonth(), from.getDate() + add);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const indexOf = (names: string[], word: string | undefined) => (word === undefined ? -1 : names.indexOf(word.slice(0, 3)));

/** The next time that day of the month comes round, in this month if it hasn't gone. */
function nextDayOfMonth(day: number, now: Date): Date | null {
  if (day < 1 || day > 31) return null;
  const today = dayOn(now, 0);
  for (let ahead = 0; ahead < 3; ahead++) {
    const d = new Date(today.getFullYear(), today.getMonth() + ahead, day);
    if (d.getDate() === day && d >= today) return d;
  }
  return null;
}
/** That day of that month, this year or, once it's gone, next year. */
function nextDate(day: number, month: number, now: Date): Date | null {
  const today = dayOn(now, 0);
  const d = new Date(today.getFullYear(), month, day);
  if (d.getMonth() !== month) return null;
  return d >= today ? d : new Date(today.getFullYear() + 1, month, day);
}

/**
 * The day `words` means, as YYYY-MM-DD, or null when they don't name one. A day and a month run together, as they're typed
 * after `@` (12dec, 12thdec, dec12), read as if there were a space. Months by name only: 3/4 is a different day in
 * different countries.
 */
export function dateOf(words: string, now: Date): string | null {
  const said = words.trim().toLowerCase().replace(/[.,]/g, '').replace(/^(by|on|due|until|before)\s+/, '').replace(/^(the|this)\s+/, '')
    .replace(/^(\d{1,2}(?:st|nd|rd|th)?)(?=[a-z]{3})/, '$1 ').replace(/^([a-z]{3,})(?=\d)/, '$1 ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(said)) return said;
  if (said === 'today') return iso(dayOn(now, 0));
  if (said === 'tomorrow') return iso(dayOn(now, 1));
  const parts = said.split(/\s+/);
  const next = parts[0] === 'next';
  const [first, second, third] = next ? parts.slice(1) : parts;
  const weekday = indexOf(WEEKDAYS, first);
  if (parts.length === (next ? 2 : 1) && weekday >= 0 && first !== undefined && /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.test(first)) {
    const ahead = ((weekday - now.getDay() + 7) % 7) || 7;
    return iso(dayOn(now, next && ahead < 7 ? ahead + 7 : ahead));
  }
  const number = (w: string | undefined) => (w !== undefined && /^\d{1,2}(st|nd|rd|th)?$/.test(w) ? Number.parseInt(w, 10) : null);
  // Fri 6 Nov says the same as 6 Nov.
  const [a, b] = weekday >= 0 && third !== undefined ? [second, third] : [first, second];
  const day = number(a);
  if (day !== null && b === undefined) { const d = nextDayOfMonth(day, now); return d && iso(d); }
  const month = indexOf(MONTHS, day !== null ? b : a);
  const dayOfMonth = day ?? number(b);
  if (month < 0 || dayOfMonth === null) return null;
  const d = nextDate(dayOfMonth, month, now);
  return d && iso(d);
}

/** A day as the follow-ups show it: Today, or Fri 6 Nov, with its year outside this one, as its date tag says it. */
export function dayWords(date: string, now: Date): string {
  const [y, m, d] = date.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return date;
  const day = new Date(y, m - 1, d);
  if (iso(day) === iso(now)) return 'Today';
  return y === now.getFullYear() ? shortDay(day) : `${shortDay(day)} ${y}`;
}

/** When something's due, in words: the day if it names one, what was said if it doesn't, and No date when nobody said. */
export function dueWords(due: string | undefined, now: Date): string {
  if (!due) return 'No date';
  const date = dateOf(due, now);
  return date ? dayWords(date, now) : due;
}

/** A moment a block keeps, as the time of day where you are. */
export const clockOf = (at: string): string => (Number.isNaN(Date.parse(at)) ? at : hm(at));

/**
 * What a line of a `live` block says on its right: when it's due, or else when it was said. Blocks keep the moment and the
 * words as they were said, the same in every browser, so a day is worked out from when it was said. It never says Today,
 * which wouldn't be true for long.
 */
export function liveWhen(l: { at: string; due?: string | undefined }): string {
  if (!l.due) return clockOf(l.at);
  const said = Date.parse(l.at);
  const date = Number.isNaN(said) ? null : dateOf(l.due, new Date(said));
  return date ? shortDay(new Date(`${date}T12:00:00`)) : l.due;
}
