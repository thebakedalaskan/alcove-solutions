/*
 * The calls ahead, as Calls lists them: your Alcove calls and the ones you're invited to, and, with Google Calendar
 * connected, the meetings on it with someone else on them (Home's own `aheadOf` puts them in order, a series by its next call
 * only). Grouped by day, with the calls waiting for a guest to pick a time apart from the rest, and said in words: who's on
 * each, and how the people invited have answered.
 */
import type { CalendarEvent, Meeting, Person, Rsvp } from '@alcove/api';
import { aheadOf, isOffered, peopleOn, seriesIdOf, type Ahead } from '~/features/home/day';
import { repeatLineHere } from '~/features/calls/scheduling/words';
import { byEmail, callName, sameEmail } from '~/lib/people';
import { daysFromToday, hm, hoursAndMinutes, shortDay, weekday } from '~/lib/time';
import { plural } from '~/lib/words';

export type { Ahead };

/** What Calls lists ahead: every Alcove call, and the calendar's meetings with someone else on them. */
export const listedAhead = (calls: readonly Meeting[], events: readonly CalendarEvent[], me: string | undefined, now: number): Ahead[] =>
  aheadOf(calls, events, now).filter((a) => a.kind === 'call' || peopleOn(a, me).length > 0);

/** A call offering a guest times: it waits for them to pick one, and has no day yet. */
export const waitsForTime = (a: Ahead): a is Extract<Ahead, { kind: 'call' }> => isOffered(a);

/** The day a call ahead is on, as its group says it: "Later today", "Tomorrow", then the date ("Tue 10 Nov"). */
export function dayGroup(iso: string, now: Date): { key: string; label: string; days: number } {
  const at = new Date(iso);
  const days = Math.max(0, daysFromToday(at, now));
  return { key: String(days), label: days === 0 ? 'Later today' : days === 1 ? 'Tomorrow' : shortDay(at), days };
}

/** Calls ahead with a time, by day, soonest first. */
export function byDay(ahead: readonly Ahead[], now: Date): { key: string; label: string; days: number; rows: Ahead[] }[] {
  const groups = new Map<string, { key: string; label: string; days: number; rows: Ahead[] }>();
  for (const a of ahead) {
    if (waitsForTime(a)) continue;
    const g = dayGroup(a.startsAt, now);
    const has = groups.get(g.key);
    if (has) has.rows.push(a);
    else groups.set(g.key, { ...g, rows: [a] });
  }
  return [...groups.values()].sort((a, b) => a.days - b.days);
}

/** How long a call ahead is: "30 min", "1 h". */
export const lengthOf = (a: { startsAt: string; endsAt: string }): string =>
  hoursAndMinutes(Math.max(5, Math.round((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000)));

/** When it starts, as its row says it: "Now" once it's going, else the time ("09:00"). */
export function timeOf(a: Ahead, now: number): string {
  if (a.kind === 'call' && a.call.status === 'live') return 'Now';
  return Date.parse(a.startsAt) <= now ? 'Now' : hm(a.startsAt);
}

/** "Priya, Kofi, Ines and you", "Rui and you", "Just you"; for a big call whose people aren't shown, how many. */
export function whoWithYou(a: Ahead, me: string | undefined): string {
  const others = peopleOn(a, me);
  if (a.kind === 'call' && a.call.guests.length < a.call.guestCount) return plural(a.call.guestCount + 1, 'person', 'people');
  if (!others.length) return 'Just you';
  const names = others.map(callName);
  return names.length <= 3 ? `${names.join(', ')} and you` : `${names.slice(0, 3).join(', ')}, ${names.length - 3} more and you`;
}

/** Your own answer to a call you're invited to, as it's said back to you. */
export const ANSWERED: Record<Rsvp, string> = { yes: 'You’re going', maybe: 'You might go', no: 'You’re not going' };

/**
 * How the people invited to your call have answered, quietly, when there's something to say: "Aiko hasn't answered",
 * "Kofi can't come, Priya might come", "3 haven't answered". A call on Google Calendar can be answered there, which the list
 * doesn't read (opening the call does), so for one of those only what was said in Alcove is told: who can't come or might.
 */
export function othersAnswered(m: Meeting): string | undefined {
  if (!m.isOrganizer || m.offer || !m.guestCount) return undefined;
  const named = (answer: Rsvp | null) => (m.answers ?? []).filter((a) => a.answer === answer).map((a) => m.guests.find((g) => sameEmail(g, a)) ?? byEmail(a.email));
  const said = (people: Person[], count: number, one: string, many: string) => {
    if (!count) return undefined;
    if (people.length && people.length === count && count <= 2) return `${people.map(callName).join(' and ')} ${count === 1 ? one : many}`;
    return `${count} ${many}`;
  };
  const silent = m.calendarUrl ? 0 : m.rsvps.waiting;
  const parts = [
    said(named('no'), m.rsvps.no, 'can’t come', 'can’t come'),
    said(named('maybe'), m.rsvps.maybe, 'might come', 'might come'),
    said(named(null), silent, 'hasn’t answered', 'haven’t answered')
  ].filter((p) => p !== undefined);
  return parts.length ? parts.join(', ') : undefined;
}

/** The times a guest picks from, in your time: "Jonas picks from Fri 11:00, Mon 14:00 or Tue 10:00". */
export function offeredLine(m: Meeting, now: Date): string {
  const times = (m.offer?.times ?? []).map((t) => { const at = new Date(t); return `${daysFromToday(at, now) < 7 ? weekday(at).slice(0, 3) : shortDay(at)} ${hm(at)}`; });
  const [one] = m.guests;
  const who = m.isOrganizer ? (one && m.guests.length === 1 ? callName(one) : 'They') : 'You';
  const list = times.length <= 1 ? times.join('') : `${times.slice(0, -1).join(', ')} or ${times.at(-1) ?? ''}`;
  return `${who} ${who === 'You' ? 'pick' : 'picks'} from ${list}`;
}

/** What a call's series is, beside its name: how it repeats, or that it's in one. */
export function seriesTag(a: Ahead): string | undefined {
  if (a.kind === 'call' && a.call.repeat) return repeatLineHere(a.call.repeat, new Date(a.startsAt));
  return seriesIdOf(a) ? 'In a series' : undefined;
}

/** A series with a call ahead, for the rail: its next call. */
export interface SeriesAhead { id: string; title: string; next: Ahead }
/** Each series with a call ahead, by its next call, soonest first. */
export function seriesAhead(ahead: readonly Ahead[]): SeriesAhead[] {
  const seen = new Map<string, SeriesAhead>();
  for (const a of ahead) {
    const id = seriesIdOf(a);
    if (id && !seen.has(id)) seen.set(id, { id, title: a.title, next: a });
  }
  return [...seen.values()];
}

/** When a series' next call is, on the rail: "Today 17:30", "Thu 09:00", "Tue 17 Nov". */
export function nextLabel(a: Ahead, now: Date): string {
  if (waitsForTime(a)) return 'Picking';
  const at = new Date(a.startsAt);
  const days = daysFromToday(at, now);
  if (days <= 0) return `Today ${hm(at)}`;
  return days < 7 ? `${weekday(at).slice(0, 3)} ${hm(at)}` : shortDay(at);
}

/** Whether someone is on a call ahead: invited to it, or running it. */
export const isOn = (a: Ahead, p: Person): boolean =>
  [...(a.kind === 'call' ? [a.call.organizer, ...a.call.guests] : [a.event.organizer, ...a.event.guests])].some((x) => sameEmail(x, p));
