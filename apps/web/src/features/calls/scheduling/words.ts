/* What starting and scheduling a call says: sentences that depend on the call, so every view says them the same way. */
import type { Meeting, Person, Repeat, RepeatRule, RsvpCounts } from '@alcove/api';
import { callName, someNames } from '~/lib/people';
import { daysFromToday, hm, shortDay, timeZone, weekday } from '~/lib/time';
import { localWeekday, monthlyRule, type Slot } from './times';

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
/** "Thu 5 Nov, 14:00 – 14:45" */
export const timeLine = (at: Date, minutes: number) => `${shortDay(at)}, ${hm(at)} – ${hm(new Date(at.getTime() + minutes * 60_000))}`;

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

const invited = (n: number) => (n === 1 ? 'gets' : 'get');
/** "Jamie gets an invitation.", "7 people get an invitation." */
export function invitationLine(guests: readonly Person[]): string {
  const [one] = guests;
  return `${one && guests.length === 1 ? callName(one) : `${guests.length} people`} ${invited(guests.length)} an invitation.`;
}

/** Above the times: who they suit, in as many words as are true. */
export function whenLine({ guests, slots, source, failed, unknown }: {
  guests: readonly Person[]; slots: readonly Slot[]; source: 'google' | 'sample' | 'none'; failed: boolean;
  /** How many guests' calendars can't be read. */
  unknown: number;
}): string {
  if (failed) return 'Calendars can’t be read just now, so these are open working hours.';
  if (source === 'none') return 'No calendar is connected, so these are open working hours.';
  const [one] = guests;
  if (!one) return 'These times are free on your calendar.';
  if (unknown === guests.length) return `You can’t see ${guests.length === 1 ? `${callName(one)}’s calendar` : 'their calendars'}. These times are free on yours.`;
  const [best] = slots;
  const all = slots.length > 0 && slots.every((s) => s.free === s.of);
  const guarded = unknown ? ' Guests’ calendars stay private.' : '';
  if (all && !unknown) return guests.length === 1 ? `You and ${callName(one)} are free at these times.` : `All ${guests.length + 1} of you are free at these times.`;
  if (all) return `Everyone whose calendar you can see is free at these times.${guarded}`;
  if (!best) return '';
  return slots.every((s) => s.free * 2 > s.of) ? `Most of you are free at these times.${guarded}` : `These times suit the most people.${guarded}`;
}
/** Under a time, when it doesn't suit everyone. */
export const freeLine = (s: Slot) => (s.of > 1 && s.free < s.of ? `${s.free} of ${s.of} free` : '');

/** "5 coming, 1 maybe, 1 hasn’t answered" */
export function answersLine(r: RsvpCounts): string {
  const parts = [
    r.yes && `${r.yes} coming`, r.maybe && `${r.maybe} maybe`, r.no && `${r.no} can’t come`,
    r.waiting && `${r.waiting} ${r.waiting === 1 ? 'hasn’t' : 'haven’t'} answered`
  ].filter((p) => typeof p === 'string');
  return parts.join(', ');
}

/** What a call's notes keep, in a row's words. */
export const notesWord = (m: { notes: 'on' | 'off'; choices: { keepTranscript: boolean } }) => (m.notes === 'off' ? 'No notes' : m.choices.keepTranscript ? 'Notes and transcript' : 'Notes only');

/** Who a guest is, in "Waiting for Jamie to pick". */
export const pickerName = (m: Meeting) => (m.guests.length ? someNames(m.guests, 1) : 'your guest');
/** The line under a call that offers times: the organizer waits for someone, and someone invited can pick. */
export const waitingLine = (m: Meeting) => (m.isOrganizer ? `Waiting for ${pickerName(m)} to pick` : 'A time is being picked');
