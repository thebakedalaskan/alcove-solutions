/* What starting and scheduling a call says: sentences that depend on the call, so every view says them the same way. */
import type { Meeting, Person, Repeat, RepeatRule } from '@alcove/api';
import { callName, listNames, someNames } from '~/lib/people';
import { daysFromToday, hm, shortDay, timeZone, weekday } from '~/lib/time';
import { dayEnd, localWeekday, monthlyRule, type Untimely } from './times';

/** What cancelling a call does, said before it's done, and said once it's done. */
export const cancelNote = (m: Meeting, many = false) => `${many ? 'They come' : 'It comes'} off your calendar${m.calendarUrl ? ', and everyone invited is told' : ''}.`;
export const cancelledLine = (m: Meeting, many = false) => `${many ? 'Calls' : 'Call'} cancelled.${m.calendarUrl && m.guestCount ? ' Everyone invited is told.' : ''}`;
/** What Undo did after a cancel: it's a new call, so the link is new and the answers start over. */
export const restoredLine = (m: Meeting) => `Call scheduled again with a new link. The old one won’t work${m.guestCount ? ', and answers start over' : ''}.`;

/** "Tomorrow", "Fri 6 Nov" */
export function dayWord(at: Date, now: Date): string {
  const n = daysFromToday(at, now);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : shortDay(at);
}
/** "Thu 14:00", or further off, "Thu 19 Nov, 16:00". */
export function shortTime(at: Date, now: Date): string {
  return daysFromToday(at, now) < 7 ? `${weekday(at).slice(0, 3)} ${hm(at)}` : `${shortDay(at)}, ${hm(at)}`;
}
/** "today 15:30", "tomorrow 15:30", "Fri 15:30", "Fri 20 Nov, 15:30": when, as the scheduler's button says it. */
export function whenWords(at: Date, now: Date): string {
  const n = daysFromToday(at, now);
  return n === 0 ? `today ${hm(at)}` : n === 1 ? `tomorrow ${hm(at)}` : shortTime(at, now);
}
/** Where a call `minutes` long ends, as a clock says it: one that ends at midnight ends at 24:00, not at the next day's 00:00. */
export const endHm = (at: Date, minutes: number): string => {
  const end = new Date(at.getTime() + minutes * 60_000);
  return end.getTime() === dayEnd(at).getTime() ? '24:00' : hm(end);
};
/** "Thu 5 Nov, 14:00 – 14:45" */
export const timeLine = (at: Date, minutes: number) => `${shortDay(at)}, ${hm(at)} – ${endHm(at, minutes)}`;
/** "45 min", "1 h", "1 h 15 min" */
export const lengthLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

const ORDINAL = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' } as const;
const dayName = (day: number) => weekday(new Date(2026, 10, 1 + day));
/** "Every Thursday", "Every 2 weeks on Thursday", "Every Mon, Wed and Fri", "Every month on the third Thursday" */
export function repeatLine(rule: RepeatRule): string {
  if (rule.every === 'month') return `Every month on the ${ORDINAL[rule.week]} ${dayName(rule.day)}`;
  const days = [...rule.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (rule.weeks === 1 && days.length === 5 && !days.includes(0) && !days.includes(6)) return 'Every weekday';
  const named = days.length === 1 ? dayName(days[0] ?? 0) : `${days.slice(0, -1).map((d) => dayName(d).slice(0, 3)).join(', ')} and ${dayName(days.at(-1) ?? 0).slice(0, 3)}`;
  return rule.weeks === 1 ? `Every ${named}` : `Every 2 weeks on ${named}`;
}
/**
 * A call's repeat as it reads here, from the call's own start. Its rule has the organizer's days, and a day away the same
 * call falls on another: Thursday evening in Toronto is Friday morning in Tokyo. A month's "third Thursday" isn't always
 * the third of the day it moves to, so that's read from this call.
 */
export function repeatLineHere(repeat: Repeat, at: Date): string {
  const { rule } = repeat;
  const here = timeZone();
  const days = localWeekday(at, here) - localWeekday(at, repeat.timeZone);
  if (!days) return repeatLine(rule);
  return repeatLine(rule.every === 'month' ? monthlyRule(at, here) : { ...rule, days: rule.days.map((d) => (d + days + 7) % 7) });
}

/** "1 call", "4 calls" */
export const callCount = (n: number) => `${n} ${n === 1 ? 'call' : 'calls'}`;

/* ---------- the scheduler's lines ---------- */

/**
 * Under the time once people whose calendars you can see are in: the soonest time you're all free, until you pick one
 * yourself, and then whether you're all free, outside working hours or not. When some calendars can't be read, it names
 * whose it counts: "The soonest time you and Priya are free".
 */
export function freeLine({ seen, everyone, picked, outside }: { seen: readonly Person[]; everyone: boolean; picked: boolean; outside: boolean }): string {
  const who = everyone ? (seen.length === 1 ? 'you’re both' : 'you’re all') : `you and ${listNames([...seen])} are`;
  return picked ? `${who.charAt(0).toUpperCase()}${who.slice(1)} free${outside ? ', outside working hours' : ''}` : `The soonest time ${who} free`;
}
/** On a clash: what you have then ("You have Design review then"), or who's busy ("Priya and Kofi are busy then"). */
export function busyLine({ yours, busy, people }: { yours: string | undefined; busy: boolean; people: readonly Person[] }): string {
  if (yours) return `You have ${yours} then`;
  if (busy) return 'You’re busy then';
  return `${listNames([...people])} ${people.length === 1 ? 'is' : 'are'} busy then`;
}
/** "Next free: 16:00" on the same day, "Next free: Fri 10:00" on another. */
export const nextFreeLabel = (next: Date, from: Date, now: Date) => `Next free: ${daysFromToday(next, from) === 0 ? hm(next) : shortTime(next, now)}`;
/** "You can’t see Jonas’s calendar.", "You can’t see the calendars of Jonas and Ines." */
export function unseenLine(people: readonly Person[]): string {
  const [one] = people;
  return one && people.length === 1 ? `You can’t see ${callName(one)}’s calendar.` : `You can’t see the calendars of ${listNames([...people])}.`;
}
/** "Aiko asked for Fri 11:00" */
export const askedLine = (who: Person | undefined, at: Date, now: Date) => `${who ? callName(who) : 'Someone'} asked for ${shortTime(at, now)}`;
/** "Doesn’t repeat", "Every Thursday · 4 calls" */
export const repeatWords = (rule: RepeatRule | null, calls: number) => (rule ? `${repeatLine(rule)} · ${callCount(calls)}` : 'Doesn’t repeat');

/** Who hears about a call as it's scheduled: Google's invitations, a demo calendar's, or nobody without one. */
export type Telling = 'google' | 'sample' | 'nobody';
/** The foot's line: what will happen when the button is pressed. */
export function footLine(f:
  | { kind: 'new'; guests: readonly Person[]; telling: Telling }
  | { kind: 'offer'; guest: Person | undefined; telling: Telling }
  | { kind: 'move'; meeting: Meeting; telling: Telling }
  | { kind: 'propose'; organizer: Person | undefined }): string {
  switch (f.kind) {
    case 'propose': return `${f.organizer ? callName(f.organizer) : 'The organizer'} sees it, and can move the call there.`;
    case 'move': {
      const m = f.meeting;
      if (!m.guestCount) return 'Nobody else is invited.';
      if (m.calendarUrl) return `Google Calendar tells ${listNames(m.guests)}.`;
      return f.telling === 'sample' ? `Your calendar tells ${listNames(m.guests)}.` : 'Nobody’s told until you send them the link.';
    }
    case 'offer': {
      const who = f.guest ? callName(f.guest) : 'your guest';
      return f.telling === 'google' ? `Your calendar holds the times until ${who} picks.` : `You get a link to send to ${who}.`;
    }
    case 'new': {
      if (!f.guests.length) return 'You’ll get a link to share.';
      const names = listNames([...f.guests]);
      if (f.telling === 'google') return `Google Calendar invites ${names}.`;
      if (f.telling === 'sample') return `${names} ${f.guests.length === 1 ? 'gets' : 'get'} an invitation.`;
      return 'Without a calendar, nobody is told. Share the link yourself.';
    }
  }
}

/** Why a time typed can't be used, under it. */
const UNTIMELY: Record<Untimely, string> = {
  unread: 'Type a 24-hour time, like 14:15.',
  gone: 'That time has passed. Pick one that’s still to come.',
  backwards: 'It has to end after it starts.',
  long: 'A call can last up to 10 hours.',
  short: 'A call lasts at least 5 minutes.'
};
export const untimelyLine = (why: Untimely): string => UNTIMELY[why];

/** Who a guest is, in "Waiting for Jamie to pick". */
export const pickerName = (m: Meeting) => (m.guests.length ? someNames(m.guests, 1) : 'your guest');
/** The line under a call that offers times: the organizer waits for someone, and someone invited can pick. */
export const waitingLine = (m: Meeting) => (m.isOrganizer ? `Waiting for ${pickerName(m)} to pick` : 'A time is being picked');
