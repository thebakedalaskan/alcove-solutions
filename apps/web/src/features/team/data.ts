/*
 * What the app says about people, worked out from what it already has: the Team page's lines, and the people you have notes
 * with (`peopleOf`), whom search offers in the palette and on Calls. A call counts once it has notes, for the people on it
 * who still have them, and not for anyone the notes reached afterwards. What's coming up is your Alcove calls and the coming
 * week of your calendar, which is all of it Alcove reads, so nothing here claims to know a whole month.
 */
import type { CalendarEvent, Group, GroupShare, Meeting, NoteFound, NoteSummary, Person, Team } from '@alcove/api';
import { aheadOf, isOffered, peopleOn, started } from '~/features/calls/list/ahead';
import { byEmail, sameEmail } from '~/lib/people';
import { daysFromToday, hm, pastDay } from '~/lib/time';
import { plural } from '~/lib/words';

export type Member = Team['members'][number];

const key = (email: string) => email.trim().toLowerCase();
const time = (iso: string) => new Date(iso).getTime();

/** A call you were on: not a room recording, and not notes someone shared with you afterwards. */
const yourCall = (n: NoteSummary) => n.kind === 'call' && n.received?.role !== 'shared';
/** The addresses on a call: everyone with its notes, but for the people they were shared with afterwards. Anyone who removed them isn't there to count. */
function onCall(n: NoteSummary): Set<string> {
  const later = new Set(n.sharedWith.map(key));
  return new Set(n.people.map((p) => key(p.email)).filter((e) => !later.has(e)));
}

/** You and someone: the calls you've had, the latest of them, how many meetings are coming up, and the next one if it's today. */
export interface Meets { calls: number; last?: string | undefined; coming: number; next?: string | undefined }

/** How you meet each person, by address, from your notes and from what's ahead. Each call or meeting counts once. */
export function meetings(notes: NoteSummary[], calls: Meeting[], events: CalendarEvent[], me: string, now: Date): (email: string) => Meets {
  const all = new Map<string, Meets>();
  const of = (email: string): Meets => {
    const had = all.get(key(email));
    if (had) return had;
    const m: Meets = { calls: 0, coming: 0 };
    all.set(key(email), m);
    return m;
  };
  for (const n of notes.filter(yourCall)) {
    for (const email of onCall(n)) {
      const m = of(email);
      m.calls += 1;
      if (!m.last || time(n.startedAt) > time(m.last)) m.last = n.startedAt;
    }
  }
  for (const a of aheadOf(calls, events, now.getTime())) {
    if (started(a, now.getTime())) continue;
    const today = !isOffered(a) && daysFromToday(new Date(a.startsAt), now) === 0;
    for (const p of peopleOn(a, me)) {
      const m = of(p.email);
      m.coming += 1;
      if (today && (!m.next || time(a.startsAt) < time(m.next))) m.next = a.startsAt;
    }
  }
  return (email) => all.get(key(email)) ?? { calls: 0, coming: 0 };
}

/** What's true between you and someone, in a few words: "Next call · 14:00", "2 meetings coming up" or "Last call · Mon". Nothing before the first. */
export function callLine(m: Meets, now: Date): string | undefined {
  if (m.next) return `Next call · ${hm(m.next)}`;
  if (m.coming) return `${plural(m.coming, 'meeting')} coming up`;
  return m.last ? `Last call · ${pastDay(m.last, now)}` : undefined;
}

/** Someone known only by the address they were invited at. */
export const addressOnly = (p: Person) => !p.name || p.name === p.email;
/** How someone is listed: their name, or their address when that's all there is. */
export const listed = (p: Person) => (addressOnly(p) ? p.email : p.name);

/** The people you meet most first, then by name. */
export const byMeetings = (meets: (email: string) => Meets) => (a: Member, b: Member) => {
  const often = (m: Member) => { const x = meets(m.person.email); return x.calls + x.coming; };
  return often(b) - often(a) || listed(a.person).localeCompare(listed(b.person));
};

/** Whoever you meet soonest or met latest first: a call to come beats one that's been, then by name. */
export const byRecency = (meets: (email: string) => Meets) => (a: Member, b: Member) => {
  const when = (m: Member) => { const x = meets(m.person.email); return x.next ? Number.MAX_SAFE_INTEGER - time(x.next) : x.last ? time(x.last) : 0; };
  return when(b) - when(a) || listed(a.person).localeCompare(listed(b.person));
};

/**
 * Everyone the app knows by address, with a name and portrait where it has them: your team first, then
 * the people in your notes, calls and meetings. Anyone else is shown by their address.
 */
export function knownPeople(team: Team | null | undefined, notes: NoteSummary[], calls: Meeting[], events: CalendarEvent[]): (email: string) => Person {
  const all = new Map<string, Person>();
  const add = (p: Person) => {
    const had = all.get(key(p.email));
    // Someone known only by their address gives way to the same person with a name.
    if (!had || (addressOnly(had) && !addressOnly(p))) all.set(key(p.email), p);
  };
  for (const m of team?.members ?? []) add(m.person);
  for (const n of notes) n.people.forEach(add);
  for (const c of calls) [c.organizer, ...c.guests].forEach(add);
  for (const e of events) [e.organizer, ...e.guests].forEach(add);
  return (email) => all.get(key(email)) ?? byEmail(key(email));
}

/** How a list shows someone: their title, that they aren't on Alcove yet, or their address; and an empty arch until they're on it. */
export interface Shown { about?: string | undefined; ghost: boolean }
export function shownOf(team: Team | null | undefined): (p: Person) => Shown {
  const members = new Map((team?.members ?? []).map((m) => [key(m.person.email), m]));
  return (p) => {
    const m = members.get(key(p.email));
    if (m && !m.onAlcove) return { about: 'Not on Alcove yet', ghost: true };
    return { about: m?.title ?? (addressOnly(p) ? undefined : p.email), ghost: false };
  };
}

/** The notes you both have, newest first. */
export const notesWith = (notes: NoteSummary[], person: Person) => notes.filter((n) => n.people.some((p) => sameEmail(p, person)));

/** How many of your calls had everyone in the group on them. */
export function groupCalls(g: Group, notes: NoteSummary[]): number {
  return notes.filter((n) => {
    if (!yourCall(n)) return false;
    const on = onCall(n);
    return g.emails.every((e) => on.has(key(e)));
  }).length;
}
/** "3 people · 12 calls" */
export function groupLine(g: Group, calls: number): string {
  const people = plural(g.emails.length, 'person', 'people');
  return calls ? `${people} · ${plural(calls, 'call')}` : people;
}

/** A note shared with a group: the note, who shared it, with which of their groups, and when. */
export interface SharedNote extends GroupShare { note: NoteSummary }

/** Every share of a note with a group, in all the notes you have, newest first. */
export const groupShares = (notes: NoteSummary[]): SharedNote[] =>
  notes.flatMap((note) => note.groupShares.map((s) => ({ note, ...s }))).sort((a, b) => time(b.at) - time(a.at));

/** Someone you have notes with, as search offers them. */
export interface Someone {
  person: Person;
  /** Their title on your team, when they're on it. */
  title: string | undefined;
  /** Calls you have the notes of together (a recording in the room isn't a call). */
  calls: number;
  /** Notes you have together, calls or not. */
  notes: number;
  /** When your newest note with them started. */
  last: string;
}

/**
 * Everyone in your notes but you, named and titled as your team has them, the people you have most calls with first.
 * Someone on your team you have no notes with has nothing to find, so isn't offered. One pass over your notes, which come
 * newest first, so the first note someone's in is their newest.
 */
export function peopleOf(notes: NoteFound[], team: Team | null | undefined, me: string | undefined): Someone[] {
  const mine = me?.toLowerCase();
  const found = new Map<string, Omit<Someone, 'title'>>();
  for (const n of notes) {
    for (const p of n.people) {
      const key = p.email.toLowerCase();
      if (key === mine) continue;
      const known = found.get(key);
      if (!known) { found.set(key, { person: p, calls: n.kind === 'call' ? 1 : 0, notes: 1, last: n.startedAt }); continue; }
      // Someone known only by their address in one note may have a name in another.
      if (known.person.name === known.person.email) known.person = p;
      if (n.kind === 'call') known.calls++;
      known.notes++;
    }
  }
  const members = new Map((team?.members ?? []).map((m) => [m.person.email.toLowerCase(), m] as const));
  return [...found].map(([key, s]): Someone => {
    const member = members.get(key);
    // Known only by their address in your notes, but by name on your team.
    const named = member && s.person.name === s.person.email ? { ...s.person, name: member.person.name } : s.person;
    return { ...s, person: named, title: member?.title };
  }).sort((a, b) => b.calls - a.calls || b.notes - a.notes || a.person.name.localeCompare(b.person.name));
}
