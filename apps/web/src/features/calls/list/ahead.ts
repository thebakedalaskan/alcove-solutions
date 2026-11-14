/*
 * The calls ahead: your Alcove calls and the ones you're invited to, and, with Google Calendar connected, the other meetings
 * on it, soonest first and a series by its next call only (`aheadOf`). What Home and the side panel show of them
 * (`aheadShown`), what can be joined right now (`joinable`), and how Calls lists them: grouped by day, with the calls waiting
 * for a guest to pick a time apart from the rest, and said in words (who's on each, and how the people invited have answered).
 */
import type { CalendarEvent, Meeting, Person, Rsvp } from '@alcove/api';
import { repeatLineHere } from '~/features/calls/scheduling/words';
import { byEmail, callName, sameEmail } from '~/lib/people';
import { daysFromToday, hm, hoursAndMinutes, minutesUntil, shortDay, untilLabel, weekday } from '~/lib/time';
import { plural } from '~/lib/words';

/** Something ahead: one of your Alcove calls, or another meeting on your calendar. */
export type Ahead =
  | { kind: 'call'; id: string; title: string; startsAt: string; endsAt: string; call: Meeting }
  | { kind: 'event'; id: string; title: string; startsAt: string; endsAt: string; event: CalendarEvent };

/** A call that's offering times: `startsAt` means nothing until someone picks one. */
export const isOffered = (a: Ahead) => a.kind === 'call' && !!a.call.offer;

/** Still to come: a call offering times until the last of them has gone, anything else until it ends. */
const stillOn = (m: Meeting, now: number) => {
  if (m.status === 'live') return true;
  if (m.status !== 'scheduled') return false;
  const last = m.offer?.times.at(-1);
  return new Date(last ?? m.endsAt).getTime() > now;
};

/**
 * Alcove calls that are going or still to come, and calendar meetings that haven't ended, soonest first. A series
 * shows its next call only, and a calendar event that's a copy of a listed call, as someone invited has in their
 * own calendar, isn't listed twice.
 */
export function aheadOf(calls: readonly Meeting[], events: readonly CalendarEvent[], now: number): Ahead[] {
  const series = new Set<string>();
  const listed = [...calls].filter((m) => stillOn(m, now)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).filter((m) => {
    if (!m.seriesId) return true;
    if (series.has(m.seriesId)) return false;
    series.add(m.seriesId);
    return true;
  });
  const codes = new Set(calls.flatMap((m) => [m.code, ...(m.seriesCode ? [m.seriesCode] : [])]));
  return [
    ...listed.map((m): Ahead => ({ kind: 'call', id: m.id, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, call: m })),
    ...events.filter((e) => new Date(e.endsAt).getTime() > now && !(e.alcoveCode && codes.has(e.alcoveCode)))
      .map((e): Ahead => ({ kind: 'event', id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, event: e }))
  ].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * What's ahead as Home and the side panel list it: your Alcove calls, and the other meetings on your calendar unless
 * Show my other meetings on Home is off.
 */
export const aheadShown = (calls: readonly Meeting[] | undefined, events: readonly CalendarEvent[] | undefined, showOthers: boolean | undefined, now: number): Ahead[] =>
  aheadOf(calls ?? [], showOthers === false ? [] : events ?? [], now);

/** The series it continues, when it's in one: an Alcove call's, or a recurring meeting's you've held in Alcove. */
export const seriesIdOf = (a: Ahead) => (a.kind === 'call' ? a.call.seriesId : a.event.seriesId);

/** It has started: a live call, or a meeting whose time has come. A call nobody has picked a time for hasn't. */
export const started = (a: Ahead, now: number) => !isOffered(a) && ((a.kind === 'call' && a.call.status === 'live') || new Date(a.startsAt).getTime() <= now);

const organizerOf = (a: Ahead) => (a.kind === 'call' ? a.call.organizer : a.event.organizer);
const yours = (a: Ahead) => (a.kind === 'call' ? a.call.isOrganizer : a.event.isOrganizer);

/** Everyone else on it: the guests, and the organizer when that isn't you. */
export function peopleOn(a: Ahead, me: string | undefined): Person[] {
  const guests = a.kind === 'call' ? a.call.guests : a.event.guests;
  const all = yours(a) ? guests : [organizerOf(a), ...guests];
  return me ? all.filter((p) => !sameEmail(p, { email: me })) : all;
}

/**
 * A calendar event with nobody else on it: your own time, not a call. Upcoming counts these at its foot and lists them,
 * quieter, only when you ask (Show my own events on Home); Calls' list and week leave them out.
 */
export const isSolo = (a: Ahead, me: string | undefined) => a.kind === 'event' && peopleOn(a, me).length === 0;

/** How long before a call Home offers to join it. */
const JOIN_AHEAD_MS = 5 * 60_000;

/** It starts in the next few minutes, when Home offers to join it and Upcoming counts down to it. */
export const startsSoon = (a: Ahead, now: number) => !isOffered(a) && !started(a, now) && new Date(a.startsAt).getTime() - now <= JOIN_AHEAD_MS;

/**
 * The call to offer at the top of Home: one that's going, or else one with someone else on it that starts in the next
 * few minutes. A meeting needs a link to join by. Anything further off stays out of the way: people join from their
 * calendar. `within` is how far ahead it looks: Home's few minutes, unless the side panel asks for its ten.
 */
export function joinable(ahead: readonly Ahead[], me: string | undefined, now: number, within = JOIN_AHEAD_MS): Ahead | undefined {
  return ahead.find((a) => a.kind === 'call' && a.call.status === 'live') ?? ahead.find((a) => {
    if (isOffered(a) || (a.kind === 'event' && !a.event.join)) return false;
    return new Date(a.startsAt).getTime() - now <= within && peopleOn(a, me).length > 0;
  });
}

/** A call is going once someone's in it. A meeting elsewhere goes by the clock. */
export const going = (a: Ahead, now: number) => (a.kind === 'call' ? a.call.status === 'live' : started(a, now));
/** When it starts, as Home's line and the side panel say it: "Starts in 4 min", or "Happening now". */
export const whenLine = (a: Ahead, now: number) => (going(a, now) ? 'Happening now' : `Starts ${untilLabel(minutesUntil(a.startsAt, now))}`);

/** What Calls lists ahead: every Alcove call, and the calendar's meetings with someone else on them. */
export const listedAhead = (calls: readonly Meeting[], events: readonly CalendarEvent[], me: string | undefined, now: number): Ahead[] =>
  aheadOf(calls, events, now).filter((a) => !isSolo(a, me));

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
