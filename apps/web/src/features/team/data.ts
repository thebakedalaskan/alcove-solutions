/*
 * What the Team page says about people, worked out from what the app already has: your notes (your last
 * call with someone, and how often you meet), today's calls and calendar, your team and your groups.
 */
import type { CalendarEvent, Group, GroupShare, Meeting, NoteSummary, Person, Team } from '@alcove/api';
import { byEmail } from '~/lib/people';
import { daysFromToday, hm, pastDay } from '~/lib/time';

export type Member = Team['members'][number];

const key = (email: string) => email.trim().toLowerCase();
const time = (iso: string) => new Date(iso).getTime();

/** Your calls with someone: the latest one in your notes, the next one later today, and how many this month. */
export interface Meets { last?: string | undefined; next?: string | undefined; month: number }

/**
 * How you meet each person, by address: the call notes they have too, and the Alcove calls and calendar
 * meetings you're both in. A call that has happened counts once, from its notes.
 */
export function meetings(notes: NoteSummary[], calls: Meeting[], events: CalendarEvent[], now: Date): (email: string) => Meets {
  const all = new Map<string, Meets>();
  const of = (email: string): Meets => {
    const had = all.get(key(email));
    if (had) return had;
    const m: Meets = { month: 0 };
    all.set(key(email), m);
    return m;
  };
  const thisMonth = (iso: string) => { const d = new Date(iso); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); };
  for (const n of notes) {
    if (n.kind !== 'call') continue;
    for (const p of n.people) {
      const m = of(p.email);
      if (!m.last || time(n.startedAt) > time(m.last)) m.last = n.startedAt;
      if (thisMonth(n.startedAt)) m.month += 1;
    }
  }
  const coming = [
    ...calls.filter((c) => c.status === 'scheduled').map((c) => ({ startsAt: c.startsAt, people: [c.organizer, ...c.guests] })),
    ...events.map((e) => ({ startsAt: e.startsAt, people: [e.organizer, ...e.guests] }))
  ];
  for (const c of coming) {
    const later = time(c.startsAt) > now.getTime() && daysFromToday(new Date(c.startsAt), now) === 0;
    for (const p of c.people) {
      const m = of(p.email);
      if (thisMonth(c.startsAt)) m.month += 1;
      if (later && (!m.next || time(c.startsAt) < time(m.next))) m.next = c.startsAt;
    }
  }
  return (email) => all.get(key(email)) ?? { month: 0 };
}

/** Under someone's name on their card: "Next call · 14:00" when there's one later today, else "Last call · Mon". */
export function callLine(m: Meets, now: Date): string {
  if (m.next) return `Next call · ${hm(m.next)}`;
  if (m.last) return `Last call · ${pastDay(m.last, now)}`;
  return 'No calls yet';
}
/** "3 meetings this month", or nothing before the first. */
export const monthLine = (m: Meets): string | undefined => (m.month ? `${m.month} ${m.month === 1 ? 'meeting' : 'meetings'} this month` : undefined);

/** Someone known only by the address they were invited at. */
export const addressOnly = (p: Person) => !p.name || p.name === p.email;
/** How someone is listed: their name, or their address when that's all there is. */
export const listed = (p: Person) => (addressOnly(p) ? p.email : p.name);

/** The people who meet you most first, then by name. */
export const byMeetings = (meets: (email: string) => Meets) => (a: Member, b: Member) =>
  meets(b.person.email).month - meets(a.person.email).month || listed(a.person).localeCompare(listed(b.person));

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

/** How many of your call notes someone in the group has too. */
export function groupCalls(g: Group, notes: NoteSummary[]): number {
  const members = new Set(g.emails.map(key));
  return notes.filter((n) => n.kind === 'call' && n.people.some((p) => members.has(key(p.email)))).length;
}
/** "3 people · 12 calls" */
export function groupLine(g: Group, calls: number): string {
  const people = `${g.emails.length} ${g.emails.length === 1 ? 'person' : 'people'}`;
  return calls ? `${people} · ${calls} ${calls === 1 ? 'call' : 'calls'}` : people;
}

/** A note shared with a group: the note, who shared it, with which of their groups, and when. */
export interface SharedNote extends GroupShare { note: NoteSummary }

/** Every share of a note with a group, in all the notes you have, newest first. */
export const groupShares = (notes: NoteSummary[]): SharedNote[] =>
  notes.flatMap((note) => note.groupShares.map((s) => ({ note, ...s }))).sort((a, b) => time(b.at) - time(a.at));
