/*
 * The day as Home tells it: what's ahead (Alcove calls and, unless they're hidden, the other meetings on
 * the calendar), what already happened today (today's notes), when follow-ups are due, the words for
 * how many of each, and how often a series meets.
 */
import type { CalendarEvent, Meeting, NoteSummary, OpenAction, Person } from '@alcove/api';
import { callName, sameEmail, someNames } from '~/lib/people';
import { daysFromToday, shortDay, weekday } from '~/lib/time';

/** Something ahead: one of your Alcove calls, or another meeting on your calendar. */
export type Ahead =
  | { kind: 'call'; id: string; title: string; startsAt: string; endsAt: string; call: Meeting }
  | { kind: 'event'; id: string; title: string; startsAt: string; endsAt: string; event: CalendarEvent };

/** Alcove calls that are going or still to come, and calendar meetings that haven't ended, soonest first. */
export function aheadOf(calls: readonly Meeting[], events: readonly CalendarEvent[], now: number): Ahead[] {
  return [
    ...calls.filter((m) => m.status === 'live' || (m.status === 'scheduled' && new Date(m.endsAt).getTime() > now))
      .map((m): Ahead => ({ kind: 'call', id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, call: m })),
    ...events.filter((e) => new Date(e.endsAt).getTime() > now)
      .map((e): Ahead => ({ kind: 'event', id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, event: e }))
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** The series it continues, when it's in one: an Alcove call's, or a recurring meeting's you've held in Alcove. */
export const seriesIdOf = (a: Ahead) => (a.kind === 'call' ? a.call.seriesId : a.event.seriesId);

/** "Every Tuesday" when the series' three newest calls (newest first) were seven days apart, otherwise nothing. */
export function everyWeek(calls: readonly { startedAt: string }[]): string | undefined {
  const [a, b, c] = calls;
  if (!a || !b || !c) return undefined;
  const apart = (x: { startedAt: string }, y: { startedAt: string }) => daysFromToday(new Date(x.startedAt), new Date(y.startedAt));
  return apart(a, b) === 7 && apart(b, c) === 7 ? `Every ${weekday(new Date(a.startedAt))}` : undefined;
}

/** It has started: a live call, or a meeting whose time has come. */
export const started = (a: Ahead, now: number) => (a.kind === 'call' && a.call.status === 'live') || new Date(a.startsAt).getTime() <= now;

const organizerOf = (a: Ahead) => (a.kind === 'call' ? a.call.organizer : a.event.organizer);
const yours = (a: Ahead) => (a.kind === 'call' ? a.call.isOrganizer : a.event.isOrganizer);

/** Everyone else on it: the guests, and the organizer when that isn't you. */
export function peopleOn(a: Ahead, me: string | undefined): Person[] {
  const guests = a.kind === 'call' ? a.call.guests : a.event.guests;
  const all = yours(a) ? guests : [organizerOf(a), ...guests];
  return me ? all.filter((p) => !sameEmail(p, { email: me })) : all;
}

/**
 * Who, in words: "Theo", "Priya, Kofi and Aiko", "Maya’s call" when it's someone else's, or "Just you".
 * `names` is how many to name before "and 3 more".
 */
export function whoOn(a: Ahead, me: string | undefined, names = 3): string {
  if (!yours(a)) return `${callName(organizerOf(a))}’s call`;
  const people = peopleOn(a, me);
  return people.length ? someNames(people, names) : 'Just you';
}

/**
 * Today's line: the notes from earlier today, what's going now, and what's still to come today, each
 * soonest first. Now falls between what's going and what's coming; the first of those is up next. `soon`
 * is the next seven days after today.
 */
export function todayOf(notes: readonly NoteSummary[], ahead: readonly Ahead[], now: number) {
  // A call that's going shows as the call, not as its note being recorded.
  const calls = new Set(ahead.flatMap((a) => (a.kind === 'call' ? [a.id] : [])));
  const past = notes
    .filter((n) => daysFromToday(new Date(n.startedAt), new Date(now)) === 0 && !(n.meetingId && calls.has(n.meetingId)))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const going = ahead.filter((a) => started(a, now));
  const coming = ahead.filter((a) => !started(a, now) && daysFromToday(new Date(a.startsAt), new Date(now)) === 0);
  const soon = ahead.filter((a) => { const d = daysFromToday(new Date(a.startsAt), new Date(now)); return d >= 1 && d <= 7; });
  return { past, going, coming, soon };
}

/* ---------- words ---------- */

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] as const;
/** A small count in words, a bigger one in digits: "two", "12". */
export const inWords = (n: number) => WORDS[n] ?? String(n);
/** "one decision", "four calls" */
export const counted = (n: number, one: string, many = `${one}s`) => `${inWords(n)} ${n === 1 ? one : many}`;
export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The line under the greeting: how many calls are left today, then what waits on you. "Four more calls
 * today. One decision and one follow-up are waiting for you."
 */
export function ledeOf({ left, happened, decisions, suggested }: { left: number; happened: number; decisions: number; suggested: number }): string {
  const calls = left === 0
    ? (happened ? 'No more calls today.' : 'No calls today.')
    : `${capital(inWords(left))} ${happened ? 'more ' : ''}${left === 1 ? 'call' : 'calls'} today.`;
  const waiting = [decisions && counted(decisions, 'decision'), suggested && counted(suggested, 'follow-up')].filter((w) => typeof w === 'string');
  if (!waiting.length) return calls;
  return `${calls} ${capital(waiting.join(' and '))} ${decisions + suggested === 1 ? 'is' : 'are'} waiting for you.`;
}

/* ---------- when follow-ups are due ---------- */

/**
 * When a follow-up is due, from its words, counted from when they were said: the latest change to the due
 * date, or else the call. "tomorrow" said yesterday is today; "next week" said last Friday is this week.
 * A day ("Friday", "Nov 5", "EOD") is that day. A span ("next week", "in two weeks", "end of March") is due
 * at its end and keeps its words, as the chip shows them. Words with no date in them ("ASAP", "later")
 * stay as words.
 */
export type Due = { kind: 'day'; at: Date; words?: string | undefined } | { kind: 'words'; text: string };

/** When the due words were said: the latest change to them, or else the call. */
export function dueFrom(a: Pick<OpenAction, 'changes' | 'noteStartedAt'>): string {
  return [...a.changes].reverse().find((c) => c.what === 'due')?.at ?? a.noteStartedAt;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;
/* Whole words only: "month" isn't Monday, "sunset" isn't Sunday, "wedding" isn't Wednesday. */
const WEEKDAY = '(sun(?:day)?|mon(?:day)?|tues?(?:day)?|wed(?:s|nesday)?|thu(?:rs?(?:day)?)?|fri(?:day)?|sat(?:urday)?)\\.?';
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const COUNT: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const re = (src: string) => new RegExp(`^${src}$`);
const PATTERNS = {
  /* "Friday next week", "by Tuesday next week" */
  dayNextWeek: re(`${WEEKDAY}\\s+next\\s+week`),
  /* "Friday", "next Friday", "this Friday", "Fri pm", "Friday-ish" */
  weekday: new RegExp(`^(next\\s+|this\\s+)?${WEEKDAY}(?![a-z])`),
  /* "Nov 5", "Fri 13 Nov", "5 November", "Oct 30th" */
  monthDay: re(`(?:${WEEKDAY}\\s+)?${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?`),
  dayMonth: re(`(?:${WEEKDAY}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}`),
  /* "end of March", "mid-December", "March" */
  month: re(`(?:(end|mid|early|late|start|beginning)(?:\\s+of)?[\\s-]+)?${MONTH}`),
  /* "in two weeks", "in 3 days", "in a month" */
  inSome: re(`in\\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})\\s+(days?|weeks?|months?)`),
  quarter: re(`q([1-4])`)
};

export function dueOf(due: string | undefined, said: string): Due | undefined {
  const words = due?.trim();
  if (!words) return undefined;
  const from = new Date(said);
  const noon = (d: Date) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
  const plus = (days: number, base = from) => { const x = noon(base); x.setDate(x.getDate() + days); return x; };
  const day = (at: Date): Due => ({ kind: 'day', at: noon(at) });
  const span = (at: Date): Due => ({ kind: 'day', at: noon(at), words: capital(words) });
  // Weeks run Monday to Sunday; a week is due by its Sunday.
  const sunday = (weeksOn: number) => plus(6 - ((from.getDay() + 6) % 7) + 7 * weeksOn);
  const monthEnd = (y: number, m: number) => new Date(y, m + 1, 0, 12);
  // A month or date without a year is the one around when it was said: this year, unless that's long past.
  const onOrAfter = (d: (y: number) => Date) => {
    const y = from.getFullYear();
    return d(y).getTime() < from.getTime() - 31 * 86_400_000 ? d(y + 1) : d(y);
  };
  const monthOf = (name: string | undefined) => MONTH_NAMES.findIndex((n) => n === name?.slice(0, 3));
  const dayOf = (name: string | undefined) => DAY_NAMES.findIndex((n) => n === name?.slice(0, 3));

  // "due by", "by", "before", "end of the day" in front of a day are just the way it was put.
  const t = words.toLowerCase().replace(/[,!?]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:(?:due|by|on|before|until|no later than|end of (?:the )?day|eod)\s+)+(?=\S)/, '');
  if (/^(?:today|tonight|eod|end of (?:the )?day|end of today)(?:\s+(?:eod|end of (?:the )?day))?$/.test(t) || /^today\b/.test(t)) return day(from);
  if (/^tomorrow\b/.test(t)) return day(plus(1));
  if (/^(?:this\s+)?week$|^(?:end of|by end of)\s+(?:the\s+)?week$|^eow$|^(?:this\s+|the\s+)?weekend$|^end of this week$/.test(t)) return span(sunday(0));
  if (/^(?:early\s+|end of\s+|late\s+|by end of\s+)?next\s+week$/.test(t)) return span(sunday(1));
  if (/^(?:this\s+)?month$|end of (?:the |this )?month|\bmonth[\s-]end\b/.test(t)) return span(monthEnd(from.getFullYear(), from.getMonth()));
  if (/^(?:early\s+|end of\s+|late\s+)?next\s+month$/.test(t)) return span(monthEnd(from.getFullYear(), from.getMonth() + 1));
  if (/^(?:end of\s+)?next\s+quarter$/.test(t)) return span(monthEnd(from.getFullYear(), Math.floor(from.getMonth() / 3) * 3 + 5));
  if (/^(?:end of\s+)?next\s+year$/.test(t)) return span(new Date(from.getFullYear() + 1, 11, 31, 12));

  let m = PATTERNS.dayNextWeek.exec(t);
  if (m) {
    const i = dayOf(m[1]);
    if (i >= 0) return day(plus(7 - ((from.getDay() + 6) % 7) + ((i + 6) % 7)));
  }
  m = PATTERNS.monthDay.exec(t) ?? PATTERNS.dayMonth.exec(t);
  if (m) {
    const [mm, dd] = PATTERNS.monthDay.test(t) ? [monthOf(m[2]), Number(m[3])] : [monthOf(m[3]), Number(m[2])];
    if (mm >= 0 && dd >= 1 && dd <= 31) return day(onOrAfter((y) => new Date(y, mm, dd, 12)));
  }
  m = PATTERNS.weekday.exec(t);
  if (m) {
    const i = dayOf(m[2]);
    if (i >= 0) {
      // The next one after it was said; "next Friday" a week further on when this week still has one.
      let off = (i - from.getDay() + 7) % 7 || 7;
      if (m[1]?.startsWith('next') && off < 7) off += 7;
      return day(plus(off));
    }
  }
  m = PATTERNS.month.exec(t);
  if (m) {
    const mm = monthOf(m[2]);
    // Mid-month is the 15th, early in it the 7th, otherwise it's due by the month's end.
    const by = m[1] === 'mid' ? 15 : m[1] === 'early' || m[1] === 'start' || m[1] === 'beginning' ? 7 : 0;
    if (mm >= 0) return span(onOrAfter((y) => (by ? new Date(y, mm, by, 12) : monthEnd(y, mm))));
  }
  m = PATTERNS.inSome.exec(t);
  if (m) {
    const n = COUNT[m[1] ?? ''] ?? Number(m[1]);
    const unit = m[2] ?? '';
    if (unit.startsWith('day')) return day(plus(n));
    if (unit.startsWith('week')) return span(plus(7 * n));
    const x = noon(from);
    x.setMonth(x.getMonth() + n);
    return span(x);
  }
  m = PATTERNS.quarter.exec(t);
  if (m) {
    const q = Number(m[1]);
    return span(onOrAfter((y) => monthEnd(y, q * 3 - 1)));
  }
  return { kind: 'words', text: capital(words) };
}

export type DueGroup = 'overdue' | 'week' | 'later' | 'none';
/** Your follow-ups are grouped in this order, and each group only shows when it has something. */
export const DUE_GROUPS: readonly { id: DueGroup; label: string }[] = [
  { id: 'overdue', label: 'Overdue' }, { id: 'week', label: 'This week' }, { id: 'later', label: 'Later' }, { id: 'none', label: 'No date' }
];

export function groupOf(d: Due | undefined, now: Date): DueGroup {
  if (!d || d.kind === 'words') return 'none';
  const n = daysFromToday(d.at, now);
  if (n < 0) return 'overdue';
  // Weeks run Monday to Sunday.
  return n <= 6 - ((now.getDay() + 6) % 7) ? 'week' : 'later';
}

/** The due chip: "Today", "Tomorrow", "Thu" this week, else "Fri 30 Oct"; a span's own words; or the words as said. */
export function dueLabel(d: Due, now: Date): string {
  if (d.kind === 'words') return d.text;
  if (d.words) return d.words;
  const n = daysFromToday(d.at, now);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  return n > 1 && n < 7 ? weekday(d.at).slice(0, 3) : shortDay(d.at);
}
