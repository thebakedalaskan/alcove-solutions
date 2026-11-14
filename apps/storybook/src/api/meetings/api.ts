/*
 * Calls ahead and calendars, as the stand-in answers for them (packages/api-http/src/meetings/api.ts is the real client's):
 * scheduling, moving and cancelling a call, answering one, asking to move it, and what a calendar says, yours and other
 * people's busy time.
 */
import { DEFAULT_NOTES_CHOICES, type AlcoveApi, type Busy, type CallDocument, type ChangeScope, type ID, type Interval, type Meeting, type MeetingInput, type Patch, type ProposalAnswer, type Rsvp } from '@alcove/api';
import { personAt } from '../../world/people';
import type { World } from '../../world/world';
import { answer, refused } from '../answer';
import { me, nextId } from '../state';

const meetingIn = (w: World, id: string): Meeting => {
  const m = w.meetings.find((x) => x.id === id);
  if (!m) throw refused('not-found', 'That call isn’t there any more.');
  return m;
};
/** The call a link's code opens: the call's own, or its series'. */
export const byCode = (w: World, code: string): Meeting | undefined => w.meetings.find((m) => m.code === code || m.seriesCode === code);

/** A new call's link code, `abc-defg-hij`. */
function newCode(): string {
  const letters = (n: number) => Array.from({ length: n }, () => 'abcdefghijkmnpqrstuvwxyz'.charAt(Math.floor(Math.random() * 24))).join('');
  return `${letters(3)}-${letters(4)}-${letters(3)}`;
}
export const addMinutes = (at: string, minutes: number) => new Date(Date.parse(at) + minutes * 60_000).toISOString();

/* ---------- busy time ---------- */

/** Someone's working day, the same every time for the same address and day: two or three calls and lunch. */
function workday(email: string, day: Date): Interval[] {
  let h = 7;
  for (const c of `${email}${day.toDateString()}`) h = (h * 31 + c.charCodeAt(0)) % 2147483647;
  const roll = (sides: number) => { h = (h * 16807) % 2147483647; return h % sides; };
  const at = (half: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9, half * 30).toISOString();
  const lunch = 6 + roll(3);
  const blocks: Interval[] = [{ from: at(lunch), to: at(lunch + 2) }];
  for (let i = 0, n = 2 + roll(2); i < n; i++) { const from = roll(14); blocks.push({ from: at(from), to: at(from + 1 + roll(2)) }); }
  return blocks;
}
/** What someone's calendar says on a day: the world's times for them that day, or else their made-up working day. */
function busyOn(w: World, email: string, day: Date): Interval[] {
  const said = w.calendars?.[email.trim().toLowerCase()];
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const to = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  const that = (said ?? []).filter((i) => Date.parse(i.from) < to && Date.parse(i.to) > from);
  return said && that.length ? that : workday(email, day);
}
function busyFor(w: World, emails: string[], range: { from: string; to: string }): Busy {
  const days: Date[] = [];
  for (let d = new Date(range.from); d.getTime() <= Date.parse(range.to); d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) if (d.getDay() !== 0 && d.getDay() !== 6) days.push(d);
  const inside = (i: Interval) => i.to > range.from && i.from < range.to;
  const mine: Interval[] = [...w.meetings.filter((m) => m.status !== 'ended').map((m) => ({ from: m.startsAt, to: m.endsAt })), ...w.calendar.events.map((e) => ({ from: e.startsAt, to: e.endsAt }))];
  const domain = w.session?.user.email.split('@')[1] ?? '';
  // With no calendar connected (or Google's access withdrawn) your own calls are all that's known, as the server says.
  if (w.calendar.source === 'none' || w.calendar.needsAccess) {
    return { source: 'none', you: w.meetings.filter((m) => m.status !== 'ended').map((m) => ({ from: m.startsAt, to: m.endsAt })).filter(inside), people: emails.map((email) => ({ email, busy: null })) };
  }
  return {
    source: 'sample',
    you: mine.filter(inside),
    people: emails.map((email) => ({ email, busy: email.endsWith(`@${domain}`) ? days.flatMap((d) => busyOn(w, email, d)).filter(inside) : null }))
  };
}
function documentsFor(w: World, ids: string[] | undefined): CallDocument[] {
  const all = w.documents.workspaces.flatMap((s) => s.documents);
  return (ids ?? []).flatMap((id) => { const d = all.find((x) => x.id === id); return d ? [{ id, kind: d.kind, by: d.by, name: d.name }] : []; });
}
/** A call as the server makes one from what was asked: yours, with a new link, and a calendar's or a guest's way to pick a time. */
export function meetingFrom(w: World, input: MeetingInput): Meeting {
  const id = nextId('m');
  const guests = input.guests.map(personAt);
  const startsAt = input.offer?.[0] ?? input.startsAt;
  const repeat = input.repeat ? { rule: input.repeat.rule, until: input.repeat.until, timeZone: input.repeat.timeZone } : undefined;
  return {
    id, title: input.title, startsAt, endsAt: addMinutes(startsAt, input.durationMinutes), organizer: me(), isOrganizer: true, guests, guestCount: guests.length,
    notes: input.notes, choices: input.choices ?? DEFAULT_NOTES_CHOICES, code: newCode(), status: 'scheduled', instant: false, joinMuted: input.joinMuted ?? false,
    documents: documentsFor(w, input.documents), workspaceId: null, rsvps: { yes: 0, maybe: 0, no: 0, waiting: guests.length }, rsvp: null,
    answers: guests.map((g) => ({ email: g.email, answer: null })), proposals: [],
    ...(input.offer ? { offer: { times: input.offer } } : { calendarUrl: `https://calendar.example.com/events/${id}` }),
    ...(repeat ? { repeat, seriesId: nextId('series'), seriesCode: newCode() } : {})
  };
}

/**
 * The organizer's view of who answered and who asked to move a call, kept in step with a change to it as the server
 * keeps it: someone taken off goes, answer and request with them, and a call that moves lets go of every request.
 */
function followGuests(m: Meeting, emails: string[], moved: boolean): Pick<Meeting, 'answers' | 'proposals'> {
  if (!m.isOrganizer) return {};
  return {
    answers: emails.map((email) => m.answers?.find((a) => a.email === email) ?? { email, answer: null }),
    proposals: moved ? [] : (m.proposals ?? []).filter((p) => emails.includes(p.email))
  };
}
/** You, invited, asking the organizer to move a call: they see it on theirs, and you see your own. */
function proposeIn(w: World, id: string, startsAt: string): Meeting {
  const m = meetingIn(w, id);
  if (m.isOrganizer) throw refused('not-found', 'That call isn’t there any more.');
  if (m.offer) throw refused('conflict', 'A time is still being picked for this call.');
  if (Date.parse(startsAt) <= Date.now()) throw refused('invalid', 'Ask for a time that’s still to come.');
  const next: Meeting = { ...m, proposals: [{ email: me().email, startsAt: new Date(startsAt).toISOString() }] };
  w.meetings = w.meetings.map((x) => (x.id === id ? next : x));
  return next;
}
/** The organizer answering a request: Move it moves the call there and lets go of every request; Keep lets go of this one. */
function answerProposalIn(w: World, id: string, email: string, reply: ProposalAnswer): Meeting {
  const m = meetingIn(w, id);
  const asked = m.isOrganizer ? m.proposals?.find((p) => p.email === email) : undefined;
  if (!asked) throw refused('not-found', 'That request to move the call doesn’t exist, or you don’t have access to it.');
  const minutes = Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000);
  const next: Meeting = reply === 'move'
    ? { ...m, startsAt: asked.startsAt, endsAt: addMinutes(asked.startsAt, minutes), proposals: [] }
    : { ...m, proposals: (m.proposals ?? []).filter((p) => p.email !== email) };
  w.meetings = w.meetings.map((x) => (x.id === id ? next : x));
  return next;
}

export const meetingsApi: Pick<AlcoveApi, 'meetings' | 'calendar'> = {
  meetings: {
    upcoming: () => answer((w) => w.meetings.filter((m) => m.status !== 'ended' && (Date.parse(m.endsAt) > Date.now() || m.status === 'live' || !!m.offer)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))),
    past: () => answer((w) => w.meetings.filter((m) => m.status === 'ended').sort((a, b) => b.startsAt.localeCompare(a.startsAt))),
    get: (id: ID) => answer((w) => meetingIn(w, id)),
    byCode: (code: string) => answer((w) => byCode(w, code) ?? null),
    create: (input: MeetingInput) => answer((w) => { const m = meetingFrom(w, input); w.meetings.push(m); return m; }),
    update: (id: ID, input: Patch<MeetingInput>, _opts?: { scope?: ChangeScope | undefined }) => answer((w) => {
      const m = meetingIn(w, id);
      const startsAt = input.startsAt ?? m.startsAt;
      const minutes = input.durationMinutes ?? Math.round((Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000);
      const guests = input.guests ? input.guests.map(personAt) : m.guests;
      const next: Meeting = {
        ...m, title: input.title ?? m.title, startsAt, endsAt: addMinutes(startsAt, minutes), guests, guestCount: guests.length, notes: input.notes ?? m.notes,
        choices: input.choices ?? m.choices, joinMuted: input.joinMuted ?? m.joinMuted, documents: input.documents ? documentsFor(w, input.documents) : m.documents,
        ...followGuests(m, guests.map((g) => g.email), startsAt !== m.startsAt)
      };
      w.meetings = w.meetings.map((x) => (x.id === id ? next : x));
      return next;
    }),
    cancel: (id: ID) => answer((w) => { meetingIn(w, id); w.meetings = w.meetings.filter((m) => m.id !== id); }),
    answer: (id: ID, rsvp: Rsvp) => answer((w) => {
      const m = meetingIn(w, id);
      const next = { ...m, rsvp };
      w.meetings = w.meetings.map((x) => (x.id === id ? next : x));
      return next;
    }),
    scheduleNext: (id: ID, startsAt: string) => answer((w) => {
      const m = meetingIn(w, id);
      const seriesId = m.seriesId ?? nextId('series');
      const next: Meeting = { ...m, id: nextId('m'), code: newCode(), startsAt, endsAt: addMinutes(startsAt, (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 60_000), status: 'scheduled', seriesId, rsvp: null };
      w.meetings = [...w.meetings.map((x) => (x.id === id ? { ...x, seriesId } : x)), next];
      w.notes = w.notes.map((n) => (n.meetingId === id ? { ...n, seriesId } : n));
      return next;
    }),
    propose: (id: ID, startsAt: string) => answer((w) => proposeIn(w, id, startsAt)),
    answerProposal: (id: ID, email: string, reply: ProposalAnswer) => answer((w) => answerProposalIn(w, id, email, reply))
  },
  calendar: {
    get: (range) => answer((w) => ({ ...w.calendar, events: w.calendar.events.filter((e) => (range ? e.endsAt > range.from && e.startsAt < range.to : Date.parse(e.endsAt) > Date.now())) })),
    busy: (emails: string[], range) => answer((w) => busyFor(w, emails, range)),
    connectUrl: () => '#connecting-google-calendar',
    disconnect: () => answer((w) => { w.calendar = { source: 'google', needsAccess: true, events: [] }; return w.calendar; }),
    adopt: (eventId: ID, notes) => answer((w) => {
      const e = w.calendar.events.find((x) => x.id === eventId);
      if (!e) throw refused('not-found', 'That event isn’t on your calendar any more.');
      const m = meetingFrom(w, { title: e.title, startsAt: e.startsAt, durationMinutes: (Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60_000, guests: e.guests.map((g) => g.email), notes: notes ?? w.prefs.notesDefault });
      w.meetings.push(m);
      w.calendar = { ...w.calendar, events: w.calendar.events.filter((x) => x.id !== eventId) };
      return m;
    })
  }
};
