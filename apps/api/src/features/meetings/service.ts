/*
 * Meetings: scheduled calls, and calls that start now. The organizer invites people by email and
 * decides when scheduling whether the call has notes; everyone invited gets them. With Google
 * Calendar connected, a scheduled call is also a calendar event, which sends the invitations.
 * Everyone invited finds the call on their own account too, and says whether they're coming
 * (./access.ts). A call can offer times instead of settling on one, until someone with its link picks, and calls can
 * repeat, as one series with one link (./repeats.ts).
 */
import { DEFAULT_NOTES_CHOICES, MAX_CALL_DOCUMENTS, MeetingStatusSchema, NotesChoicesSchema, NotesSettingSchema, firstName, type CallDocument, type ChangeScope, type GuestAnswer, type InstantCallInput, type Meeting, type MeetingInput, type NotesSetting, type Patch, type Person, type ProposalAnswer, type Repeat, type Rsvp } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { id128, random } from '../../keys/crypto';
import { exec, tx, type Db } from '../../platform/db';
import { ConflictError, ValidationError, notFound } from '../../platform/errors';
import { log } from '../../platform/log';
import { lockOwner } from '../../keys/owners';
import { createItem, findItem, findItems, getItem, listItems, lockItem, saveRevision, type Loaded } from '../../keys/vault';
import { accessOf, answer as saveAnswer, countsFrom, countsOf, dropInvites, dropProposals, finished, invitedMeetings, inviteKey, locateInvited, propose as saveProposal, reconcileAccess, standing, syncAccess, type Access, type Invited } from './access';
import { me, profile, type Profile } from '../profile/profile';
import * as calendar from './calendar';
import { followInvites, invitesOf } from './homes';
import type { Calls } from '../workspaces/calls';
import { indexCode } from './codes';
import { boardsFrom, documentsFor, keptIds, shownOn, validDocuments } from '../workspaces/library/library';
import { personOf } from '../profile/portraits';
import { cancelInSeries, changeInSeries, leadsTo, repeatsOf, schedule } from './repeats';
import { accountReader, requireRole, workspaceFor } from '../workspaces/access';

const mlog = log.child({ component: 'meetings' });

export const MeetingManifest = z.object({
  title: z.string(), startsAt: z.string(), endsAt: z.string(),
  /** Email addresses of everyone invited besides the organizer. */
  guests: z.array(z.string()),
  notes: NotesSettingSchema, code: z.string(), status: MeetingStatusSchema,
  duration: z.number().optional(), noteId: z.string().optional(),
  /**
   * The Google Calendar event that carries this call, and its link. `adopted`: the organizer made the event in
   * Google Calendar and then moved it to Alcove (adopt), so it's theirs, and deleting the account leaves it there.
   * `master`: the event is an occurrence of the series' recurring event with this ID.
   */
  calendarEvent: z.object({ id: z.string(), url: z.string().optional(), adopted: z.boolean(), master: z.string().optional() }).optional(),
  /** The series the call is in: a random ID its calls share. */
  seriesId: z.string().optional(),
  /** The recurring Google Calendar event this call is an occurrence of (Google's ID for the whole series). */
  recurringEventId: z.string().optional(),
  /**
   * The guests who were added during a call: let in from its link (people signed in, whom the organizer let in), or
   * rung, once there are any. Kept with the meeting, so removing one from any run of the call takes them off the invite.
   */
  addedFromLink: z.array(z.string()).optional(),
  /** Started now rather than scheduled: on nobody's calendar, and not listed until someone is in it. */
  instant: z.boolean().default(false),
  /** What the notes keep. */
  choices: NotesChoicesSchema.default(DEFAULT_NOTES_CHOICES),
  /** Everyone joins with their microphone and camera off. */
  joinMuted: z.boolean().default(false),
  /** The documents brought to the call, by the IDs features/workspaces/library/library.ts gives them. Nothing about them is kept here. */
  documents: z.array(z.string()).default([]),
  /** The workspace the call uses (features/calls/workspace/workspace.ts). Null until one's chosen, or someone opens Workspace. It carries to the next call in a series. */
  workspaceId: z.string().nullable().default(null),
  /** The agenda this call has, for the next call in its series to carry on from. Only where it is: what it says stays in the document. */
  agenda: z.object({ workspaceId: z.string(), documentId: z.string() }).nullable().default(null),
  /** Times offered to a guest, until someone with the link picks one: no calendar event until then. */
  offer: z.object({ times: z.array(z.string()) }).optional(),
  /** The link code of the series this call repeats in: it leads to whichever of its calls is on now or next. */
  seriesCode: z.string().optional(),
  /** Until when it's claimed for the calendar: Google is being asked for its event, and nobody else asks meanwhile. */
  placing: z.string().optional(),
  /**
   * While it offers times: the events holding each of them on the organizer's calendar, which nobody else is invited
   * to. They go when someone picks, or the call is cancelled. Calls from before holds have none.
   */
  holds: z.array(z.object({ at: z.string(), eventId: z.string() })).default([])
});
export type MeetingManifest = z.infer<typeof MeetingManifest>;
/** One time a call offers, held on its organizer's calendar. */
export type Hold = MeetingManifest['holds'][number];

const LETTERS = 'abcdefghijkmnpqrstuvwxyz';
export function makeCode(): string {
  const b = random(10);
  const ch = (i: number) => LETTERS[(b[i] ?? 0) % LETTERS.length] ?? 'a';
  return `${ch(0)}${ch(1)}${ch(2)}-${ch(3)}${ch(4)}${ch(5)}${ch(6)}-${ch(7)}${ch(8)}${ch(9)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** The most people a call can have invited, however they were added. */
export const MAX_GUESTS = 300;
/** Past this many invited, someone invited sees how many, and not who. */
const NAMED_GUESTS = 25;
/** A real address, as invites keep it. */
export const isGuestAddress = (email: string) => EMAIL.test(email);
/** Lower-cased, unique, without the organizer, and every one a real address. */
function cleanGuests(emails: string[], organizerEmail: string): string[] {
  const out = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].filter((e) => e !== organizerEmail.toLowerCase());
  const bad = out.filter((e) => !isGuestAddress(e));
  if (bad.length) throw new ValidationError('Invite people by their full email address.', { context: { invalid: bad.length } });
  if (out.length > MAX_GUESTS) throw new ValidationError(`A call can have at most ${MAX_GUESTS} people invited.`, { context: { guests: out.length } });
  return out;
}

/**
 * What showing calls to someone takes, read once for a whole list. `keyOf` is the organizer's `inviteKey`, kept for
 * every address the list has: the calls of a series share their guests.
 */
interface Reading { organizer: Person; viewer: Profile; reader: Owner; documents: ReadonlyMap<string, CallDocument>; access: ReadonlyMap<string, Access>; repeats: ReadonlyMap<string, Repeat>; keyOf: (email: string) => string }
/** `inviteKey` for one organizer, each address worked out once. */
function invites(owner: Owner): (email: string) => string {
  const keys = new Map<string, string>();
  return (email) => { const k = keys.get(email) ?? inviteKey(owner, email); keys.set(email, k); return k; };
}
/** Everything brought to these calls, by ID, as `viewer` may know it: a workspace is read once, however many calls it's on. */
async function broughtTo(viewer: Owner, meetings: Loaded<MeetingManifest>[]): Promise<ReadonlyMap<string, CallDocument>> {
  const ids = [...new Set(meetings.flatMap((m) => m.manifest.documents))];
  if (!ids.length) return new Map();
  return new Map((await documentsFor(viewer, ids, await accountReader(viewer))).map((d) => [d.id, d]));
}
/** `viewer` reading these calls of `owner`, who can be the same account. */
const reading = async (owner: Owner, viewer: Owner, meetings: Loaded<MeetingManifest>[]): Promise<Reading> =>
  ({ organizer: await me(owner), viewer: await profile(viewer), reader: viewer, documents: await broughtTo(viewer, meetings), access: await accessOf(owner, meetings.map((m) => m.itemId)), repeats: await repeatsOf(owner, meetings), keyOf: invites(owner) });

/** A call as anyone on it sees it. What's only for its organizer, and who's on it, go on top of this. */
function onCall(m: Loaded<MeetingManifest>, r: Reading) {
  const { guests, duration, noteId: _note, calendarEvent: _event, seriesId, seriesCode, offer, documents, recurringEventId: _recurring, addedFromLink: _added, placing: _placing, workspaceId: _workspace, agenda: _agenda, holds: _holds, ...rest } = m.manifest;
  const repeat = seriesId && seriesCode ? r.repeats.get(seriesId) : undefined;
  return {
    id: m.itemId, ...rest, organizer: r.organizer, guestCount: guests.length, documents: documents.flatMap((id) => { const d = r.documents.get(id); return d ? [shownOn(r.reader, m.itemId, d)] : []; }), workspaceId: null, rsvps: countsOf(r.access.get(m.itemId), guests.length),
    ...(duration !== undefined ? { duration } : {}), ...(seriesId ? { seriesId } : {}), ...(offer ? { offer } : {}), ...(repeat ? { repeat } : {})
  };
}
/** A call as its organizer sees it: who everyone is, what each of them answered, and the times they've asked for. */
function asOrganizer(m: Loaded<MeetingManifest>, r: Reading): Meeting {
  const { guests, noteId, calendarEvent, seriesCode, workspaceId } = m.manifest;
  return {
    ...onCall(m, r), isOrganizer: true, guests: guests.map((e) => personOf(e)), rsvp: null, workspaceId, ...standing(r.access.get(m.itemId), guests, r.keyOf),
    ...(noteId !== undefined ? { noteId } : {}), ...(calendarEvent?.url ? { calendarUrl: calendarEvent.url } : {}), ...(seriesCode ? { seriesCode } : {})
  };
}
/**
 * A call as someone invited sees it, `you` being their `inviteKey`. Past NAMED_GUESTS they see how many are invited,
 * not who. What each person answered is the organizer's: they see how many, their own answer, and the time they asked
 * to move it to. The note and the calendar link are the organizer's. A series' link is theirs only if their invitation
 * carried it, which takes a calendar.
 */
function asInvited(m: Loaded<MeetingManifest>, r: Reading, you: string): Meeting {
  const { guests, calendarEvent, seriesCode } = m.manifest;
  const mine = r.access.get(m.itemId)?.get(you);
  return {
    ...onCall(m, r), isOrganizer: false, guests: guests.length > NAMED_GUESTS ? [] : guests.map((e) => personOf(e)), rsvp: mine?.answer ?? null,
    proposals: mine?.proposal ? [{ email: r.viewer.email, startsAt: mine.proposal }] : [],
    ...(seriesCode && calendarEvent ? { seriesCode } : {})
  };
}

export async function toMeeting(o: Owner, m: Loaded<MeetingManifest>): Promise<Meeting> { return asOrganizer(m, await reading(o, o, [m])); }
export const all = (o: Owner, db: Db = o.pool) => listItems(o, db, 'meeting', MeetingManifest);

/** How long a call is, in minutes. */
export const minutesOf = (m: Pick<MeetingManifest, 'startsAt' | 'endsAt'>) => Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000);
/** Over, as far as Upcoming goes: it ended, or it's an hour past its time. While a call offers times, that's the last of them. */
export function isOver(m: MeetingManifest): boolean {
  const last = m.offer?.times.at(-1);
  const end = last ? new Date(last).getTime() + minutesOf(m) * 60_000 : new Date(m.endsAt).getTime();
  return m.status === 'ended' || end <= Date.now() - 60 * 60_000;
}
/** Started now, and nobody has come in yet: it's a lobby, not a call to list. */
export const unjoined = (m: MeetingManifest) => m.instant && m.status === 'scheduled';

/** Whether Upcoming lists a call: every one that hasn't ended (begun or not), until an hour after its time is up. A call started now waits until someone is in it. */
const listed = (m: Loaded<MeetingManifest>) => !isOver(m.manifest) && !unjoined(m.manifest);
/** The meetings Upcoming lists, as stored. */
export const findUpcoming = async (o: Owner): Promise<Loaded<MeetingManifest>[]> => (await all(o)).filter(listed);
/** The calls you're invited to that Upcoming lists, each organizer's read together. */
async function invitedTo(o: Owner): Promise<Meeting[]> {
  const out: Meeting[] = [];
  for (const { organizer, meetings } of await invitedMeetings(o)) {
    const r = await reading(organizer, o, meetings);
    const you = inviteKey(o, r.viewer.email);
    out.push(...meetings.map((m) => asInvited(m, r, you)));
  }
  return out;
}
export async function upcoming(o: Owner): Promise<Meeting[]> {
  const mine = await all(o);
  // A call nobody held has no end to take its invite with it, and everyone on it may have no account to read it.
  await dropInvites(o, o.pool, mine.filter((m) => finished(m.manifest)).map((m) => m.itemId));
  const ms = mine.filter(listed);
  const r: Reading = { organizer: await me(o), viewer: await profile(o), reader: o, documents: await broughtTo(o, ms), access: await reconcileAccess(o, ms), repeats: await repeatsOf(o, ms), keyOf: invites(o) };
  return [...ms.map((m) => asOrganizer(m, r)), ...await invitedTo(o)].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
export async function past(o: Owner): Promise<Meeting[]> {
  const ms = (await all(o)).filter((m) => m.manifest.status === 'ended');
  ms.sort((a, b) => b.manifest.startsAt.localeCompare(a.manifest.startsAt));
  const r = await reading(o, o, ms);
  return ms.map((m) => asOrganizer(m, r));
}
/** One of your own calls, without asking Google who answered there: what scheduling or changing one hands back. */
const own = async (o: Owner, id: string) => toMeeting(o, await getItem(o, o.pool, 'meeting', id, MeetingManifest, 'That meeting'));
/** A call you're invited to, as you see it. */
const invitedCall = async (o: Owner, { organizer, meeting }: Invited) => {
  const r = await reading(organizer, o, [meeting]);
  return asInvited(meeting, r, inviteKey(o, r.viewer.email));
};

/** How long Google has to say who answered there, when an organizer opens one of their calls. */
const CALENDAR_ANSWERS_MS = 3000;
/**
 * What everyone answered, for the organizer opening a call that's on their calendar: for anyone with no answer in
 * Alcove, what they said in Google, read now and stored nowhere. If Google can't say, the answers stay Alcove's.
 */
async function withCalendarAnswers(o: Owner, m: Loaded<MeetingManifest>, answers: GuestAnswer[]): Promise<GuestAnswer[]> {
  const { calendarEvent } = m.manifest;
  if (!calendarEvent || answers.every((a) => a.answer)) return answers;
  try {
    const said = await calendar.answers(o, calendarEvent.id, AbortSignal.timeout(CALENDAR_ANSWERS_MS));
    return answers.map((a) => (a.answer ? a : { ...a, answer: said.get(a.email.toLowerCase()) ?? null }));
  } catch (e) {
    mlog.warn('calendar answers not read', { meetingId: m.itemId, err: e });
    return answers;
  }
}

/** One of your calls, or one you're invited to that isn't over. */
export async function get(o: Owner, id: string): Promise<Meeting> {
  const mine = await findItem(o, o.pool, 'meeting', id, MeetingManifest);
  if (!mine) return invitedCall(o, await locateInvited(o, id));
  const r = await reading(o, o, [mine]);
  const shown = asOrganizer(mine, r);
  const answers = await withCalendarAnswers(o, mine, shown.answers ?? []);
  return { ...shown, answers, rsvps: countsFrom(answers) };
}
/** Says whether you're coming to a call you're invited to, and shows you the call. */
export async function answer(o: Owner, id: string, value: Rsvp): Promise<Meeting> { return invitedCall(o, await saveAnswer(o, id, value)); }
/** Asks the organizer of a call you're invited to to move it, and shows you the call with what you asked. */
export async function propose(o: Owner, id: string, startsAt: string): Promise<Meeting> { return invitedCall(o, await saveProposal(o, id, startsAt)); }

/**
 * Answers someone's request to move one of your calls. Moving it changes its time as Change the time does, which
 * tells everyone through a connected calendar and lets go of every request, since they were asked of the time it had.
 * Keeping it lets go of this one request.
 */
export async function answerProposal(o: Owner, id: string, email: string, answer: ProposalAnswer, calls: Calls): Promise<Meeting> {
  const asked = (await accessOf(o, [id])).get(id)?.get(inviteKey(o, email))?.proposal;
  if (!asked) throw notFound('That request to move the call', { meetingId: id });
  if (answer === 'keep') {
    await dropProposals(o, o.pool, [id], email);
    mlog.info('request to move a call answered', { meetingId: id, moved: false });
    return own(o, id);
  }
  if (new Date(asked).getTime() <= Date.now()) throw new ConflictError('That time has passed. Pick another one.', { context: { meetingId: id } });
  const moved = await update(o, id, { startsAt: asked }, undefined, calls);
  mlog.info('request to move a call answered', { meetingId: id, moved: true });
  return moved;
}

/** What a call is called, and when it starts: nothing yet while it still offers times. */
export interface CallTitle { title: string; startsAt: string | null }
const titleOf = (m: MeetingManifest): CallTitle => ({ title: m.title, startsAt: m.offer ? null : m.startsAt });
/** Titles of whichever of these calls are the account's own, read together from their manifests: nothing else, and never Google. */
export async function ownCallTitles(o: Owner, ids: string[]): Promise<Map<string, CallTitle>> {
  if (!ids.length) return new Map();
  return new Map((await findItems(o, o.pool, 'meeting', ids, MeetingManifest)).map((m) => [m.itemId, titleOf(m.manifest)]));
}
/** The title of a call the account is invited to and that isn't over, by the check reading it takes, from its manifest alone. */
export async function invitedCallTitle(o: Owner, id: string): Promise<CallTitle> { return titleOf((await locateInvited(o, id)).meeting.manifest); }

/** A call of yours by its code, or by its series' code the call that's on now or next. */
export async function findByCode(o: Owner, code: string, db: Db = o.pool): Promise<Loaded<MeetingManifest> | undefined> {
  const mine = await all(o, db);
  return mine.find((m) => m.manifest.code === code) ?? leadsTo(mine.filter((m) => m.manifest.seriesCode === code));
}
export async function byCode(o: Owner, code: string): Promise<Meeting | null> {
  const m = await findByCode(o, code);
  return m ? toMeeting(o, m) : null;
}

export function validTimes(startsAt: string, minutes: number) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime()) || minutes < 5 || minutes > 600) throw new ValidationError('Pick a valid start time and length.', { context: { validStart: !Number.isNaN(start.getTime()), minutes } });
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * 60_000).toISOString() };
}

/** Times to offer, as they're kept: real times still to come, none twice, soonest first. */
function offeredTimes(times: string[]): string[] {
  const at = [...new Set(times.map((t) => new Date(t).getTime()))].sort((a, b) => a - b);
  if (at.length !== times.length || at.some((t) => Number.isNaN(t) || t <= Date.now())) throw new ValidationError('Offer different times that are still to come.', { context: { times: times.length } });
  return at.map((t) => new Date(t).toISOString());
}

/** A new call, in the caller's transaction: its item, where its code leads, and who's invited to it. */
async function store(o: Owner, db: Db, manifest: MeetingManifest): Promise<string> {
  const { itemId } = await createItem(o, db, 'meeting', manifest);
  // Anyone with the link finds the call by its code.
  await indexCode(o, db, { ownerId: o.ownerId, meetingId: itemId, code: manifest.code });
  await syncAccess(o, db, itemId, manifest.guests);
  return itemId;
}

/** A call only takes a workspace its organizer can edit in. One they can't reach reads the same as one that isn't there. */
async function requireWorkspace(o: Owner, workspaceId: string | null | undefined): Promise<void> {
  if (workspaceId) requireRole(await workspaceFor(o, await accountReader(o), workspaceId), 'edit');
}

export async function create(o: Owner, input: MeetingInput): Promise<Meeting> {
  if (input.offer && input.repeat) throw new ValidationError('A call that repeats can’t offer times.', { context: { times: input.offer.length } });
  const organizer = await me(o);
  await validDocuments(o, input.documents ?? []);
  await requireWorkspace(o, input.workspaceId);
  const offered = input.offer ? offeredTimes(input.offer) : undefined;
  const manifest: MeetingManifest = {
    title: input.title.trim() || 'Untitled call', ...validTimes(offered?.[0] ?? input.startsAt, input.durationMinutes),
    guests: cleanGuests(input.guests, organizer.email), notes: input.notes, code: makeCode(), status: 'scheduled',
    instant: false, choices: input.choices ?? DEFAULT_NOTES_CHOICES, joinMuted: input.joinMuted ?? false, documents: input.documents ?? [], workspaceId: input.workspaceId ?? null, agenda: null, holds: [], ...(offered ? { offer: { times: offered } } : {})
  };
  if (input.repeat) return own(o, await schedule(o, manifest, input.repeat));
  const itemId = await tx(o.pool, (c) => store(o, c, manifest));
  mlog.info('meeting scheduled', { meetingId: itemId, guests: manifest.guests.length, notes: manifest.notes, offered: offered?.length ?? 0 });
  // A call offering times has none to put on a calendar until one is picked: the times are held there instead.
  if (offered) await placeHolds(o, itemId);
  else await placeOnCalendar(o, itemId);
  return own(o, itemId);
}

/* ---------- holds: the times a call offers, on its organizer's calendar until someone picks ---------- */

/** Takes holds off the calendar, quietly, as far as Google lets it: one that won't go is logged and left. */
async function releaseHolds(o: Owner, meetingId: string, holds: readonly Hold[]): Promise<void> {
  for (const h of holds) {
    try { await calendar.release(o, h.eventId); } catch (e) { mlog.warn('held time not cleared from calendar', { meetingId, err: e }); }
  }
}

/**
 * Holds each time a call offers on the organizer's calendar, as an event of theirs nobody else is invited to, so nothing
 * else lands there while the guest picks. Like the call's own event it's a courtesy: if Google fails, the call offers
 * its times all the same. Google is asked holding nothing, and the holds are kept only if the call still offers times
 * by then: a pick or a cancel that came first takes them straight off again.
 */
async function placeHolds(o: Owner, id: string): Promise<void> {
  try {
    if (!(await calendar.places(o))) return;
    const m = await findItem(o, o.pool, 'meeting', id, MeetingManifest);
    if (!m?.manifest.offer) return;
    const placed: Hold[] = [];
    try {
      for (const at of m.manifest.offer.times) placed.push({ at, eventId: await calendar.hold(o, id, m.manifest, at) });
    } catch (e) {
      await releaseHolds(o, id, placed);
      throw e;
    }
    const kept = await tx(o.pool, async (c) => {
      await lockItem(o, c, id);
      const cur = await findItem(o, c, 'meeting', id, MeetingManifest);
      if (!cur?.manifest.offer) return false;
      await saveRevision(o, c, id, cur.revisionId, { ...cur.manifest, holds: [...cur.manifest.holds, ...placed] });
      return true;
    });
    if (!kept) await releaseHolds(o, id, placed);
    mlog.info('offered times held on calendar', { meetingId: id, holds: placed.length, kept });
  } catch (e) {
    mlog.warn('offered times not held on calendar', { meetingId: id, err: e });
  }
}

/** How long a call stays claimed for the calendar: longer than Google gets to answer, and a process that dies lets go of it by this. */
const PLACING_MS = 60_000;
/** Whether someone is asking Google for this call's event now. */
export const isPlacing = (m: MeetingManifest): boolean => m.placing !== undefined && new Date(m.placing).getTime() > Date.now();
/** What a call's calendar event says. */
const onEvent = (m: MeetingManifest) => JSON.stringify([m.title, m.startsAt, m.endsAt, m.notes, m.guests]);

/** Claims a call for the calendar, under its lock, unless it needs no event or someone's already asking for one. */
const claimPlacing = (o: Owner, id: string) => tx(o.pool, async (c) => {
  await lockItem(o, c, id);
  const cur = await findItem(o, c, 'meeting', id, MeetingManifest);
  if (!cur || cur.manifest.calendarEvent || cur.manifest.offer || isPlacing(cur.manifest)) return undefined;
  const claimed: MeetingManifest = { ...cur.manifest, placing: new Date(Date.now() + PLACING_MS).toISOString() };
  await saveRevision(o, c, id, cur.revisionId, claimed);
  return claimed;
});
/** Lets go of the claim, with the event if Google gave one. The call as it is now, unless it went meanwhile. */
const finishPlacing = (o: Owner, id: string, placed: { eventId: string; url?: string | undefined } | null) => tx(o.pool, async (c) => {
  await lockItem(o, c, id);
  const cur = await findItem(o, c, 'meeting', id, MeetingManifest);
  if (!cur) return undefined;
  const { placing: _done, ...m } = cur.manifest;
  const next: MeetingManifest = placed ? { ...m, calendarEvent: { id: placed.eventId, ...(placed.url ? { url: placed.url } : {}), adopted: false } } : m;
  await saveRevision(o, c, id, cur.revisionId, next);
  return next;
});

/**
 * The calendar is a courtesy: if Google is down the call still exists, without a calendar link. A call has at most one
 * event, so whoever puts it there claims it first, under its lock, and asks Google holding nothing: a change or a pick
 * that gets here meanwhile finds the claim and leaves it. Whatever changed while Google was asked goes to the event once
 * it's there, and a call that went meanwhile takes the event with it.
 */
async function placeOnCalendar(o: Owner, id: string): Promise<void> {
  try {
    if (!(await calendar.places(o))) return;
    const claimed = await claimPlacing(o, id);
    if (!claimed) return;
    const placed = await calendar.place(o, id, claimed).catch((e: unknown) => { mlog.warn('call not placed on calendar', { meetingId: id, err: e }); return null; });
    const now = await finishPlacing(o, id, placed);
    if (!placed) return;
    if (!now) await calendar.withdraw(o, placed.eventId, id);
    else if (onEvent(now) !== onEvent(claimed)) await calendar.change(o, placed.eventId, id, now);
  } catch (e) {
    mlog.warn('call not placed on calendar', { meetingId: id, err: e });
  }
}

/** Read-modify-write of one meeting's manifest under a row lock. */
export async function updateManifest(o: Owner, db: Db, id: string, fn: (m: MeetingManifest) => MeetingManifest): Promise<MeetingManifest> {
  await lockItem(o, db, id);
  const cur = await getItem(o, db, 'meeting', id, MeetingManifest, 'That meeting');
  const next = fn(cur.manifest);
  // What changes nothing writes nothing: every save is a revision, and those are kept.
  if (next !== cur.manifest) await saveRevision(o, db, id, cur.revisionId, next);
  return next;
}
/** Whether a change is one a call's calendar event shows. Google emails everyone about an update, so nothing else goes to it. */
export const showsOnEvent = (p: Patch<MeetingInput>) => [p.title, p.startsAt, p.durationMinutes, p.guests, p.notes].some((v) => v !== undefined);

/**
 * A call with a change made to it. Only a call that hasn't started changes. While it offers times it has no time of
 * its own to move, and the times offered stay as they are: cancelling it and offering others is how they change.
 */
export function withChange(m: MeetingManifest, patch: Patch<MeetingInput>, organizerEmail: string, meetingId: string): MeetingManifest {
  if (m.status !== 'scheduled') throw new ConflictError('Only a call that hasn’t started can be changed.', { context: { meetingId, status: m.status } });
  if (m.offer && patch.startsAt !== undefined) throw new ConflictError('This call is waiting for someone to pick a time. Cancel it to set one yourself.', { context: { meetingId } });
  const times = patch.startsAt !== undefined || patch.durationMinutes !== undefined ? validTimes(patch.startsAt ?? m.startsAt, patch.durationMinutes ?? minutesOf(m)) : {};
  return {
    ...m, ...times, title: patch.title?.trim() || m.title, notes: patch.notes ?? m.notes, guests: patch.guests ? cleanGuests(patch.guests, organizerEmail) : m.guests,
    choices: patch.choices ?? m.choices, joinMuted: patch.joinMuted ?? m.joinMuted, documents: patch.documents ?? m.documents, workspaceId: patch.workspaceId === undefined ? m.workspaceId : patch.workspaceId
  };
}

/**
 * Changes one call and who's invited to it, without touching its calendar event. A call that moves lets go of the times
 * people asked to move it to: they were asked of where it was.
 */
export async function changeCall(o: Owner, id: string, patch: Patch<MeetingInput>): Promise<MeetingManifest> {
  const organizer = await me(o);
  const next = await tx(o.pool, async (c) => {
    let was = '';
    const changed = await updateManifest(o, c, id, (m) => { was = m.startsAt; return withChange(m, patch, organizer.email, id); });
    await syncAccess(o, c, id, changed.guests);
    if (changed.startsAt !== was) await dropProposals(o, c, [id]);
    return changed;
  });
  mlog.info('meeting updated', { meetingId: id, fields: Object.keys(patch).length });
  return next;
}

/**
 * Changes a call that hasn't started, or more than one in a series (./repeats.ts). A call started now, or one offering
 * times, stays off the calendar: renaming a lobby emails nobody. A change to who's invited reaches the home made for the
 * calls it changed, as a change in the call does (./homes.ts), which asks the calls about their rooms' boards (`calls`).
 */
export async function update(o: Owner, id: string, sent: Patch<MeetingInput>, scope: ChangeScope | undefined, calls: Calls): Promise<Meeting> {
  if (sent.offer !== undefined) throw new ValidationError('The times a call offers can’t be changed. Cancel it and offer others.', { context: { meetingId: id } });
  await requireWorkspace(o, sent.workspaceId);
  const { manifest } = await getItem(o, o.pool, 'meeting', id, MeetingManifest, 'That meeting');
  const patch = sent.documents ? { ...sent, documents: keptIds(o, id, manifest.documents, sent.documents) } : sent;
  await validDocuments(o, patch.documents ?? [], manifest.documents);
  const invites = patch.guests ? await invitesOf(o, id, manifest) : null;
  if (manifest.seriesCode || patch.repeat || scope === 'following') {
    await changeInSeries(o, id, manifest, patch, scope);
  } else {
    const next = await changeCall(o, id, patch);
    if (next.calendarEvent) {
      if (showsOnEvent(patch)) {
        try { await calendar.change(o, next.calendarEvent.id, id, next); } catch (e) { mlog.warn('calendar event not updated', { meetingId: id, err: e }); }
      }
    } else if (!next.instant && !next.offer) await placeOnCalendar(o, id);
    // Held times say which call they're for, so they take its new name: nobody else sees them, so nobody is told.
    else if (next.offer && patch.title !== undefined && next.title !== manifest.title) await retitleHolds(o, id, next);
  }
  if (invites) await followInvites(o, invites, calls);
  return own(o, id);
}

/**
 * Settles a call that offers times on one of them, for whoever has its link (calls.pick). The first pick wins, under
 * the call's lock: it takes the offer away, so any later one is refused. The call goes on the calendar then, which
 * sends the invitations.
 */
export async function pickTime(o: Owner, id: string, at: string): Promise<void> {
  const when = new Date(at).getTime();
  let held: Hold[] = [];
  await tx(o.pool, (c) => updateManifest(o, c, id, ({ offer, holds, ...m }) => {
    if (!offer) throw new ConflictError('A time has already been picked for this call.', { context: { meetingId: id } });
    const time = offer.times.find((t) => new Date(t).getTime() === when);
    if (!time || when <= Date.now()) throw new ValidationError('That time isn’t on offer.', { context: { meetingId: id, offered: offer.times.length } });
    held = holds;
    return { ...m, holds: [], ...validTimes(time, minutesOf(m)) };
  }));
  mlog.info('time picked for a call', { meetingId: id, holds: held.length });
  // The holds clear, the picked one with them, and the call takes its place with its invitations.
  await releaseHolds(o, id, held);
  await placeOnCalendar(o, id);
}

/** Gives a call's held times its new name. */
async function retitleHolds(o: Owner, id: string, m: MeetingManifest): Promise<void> {
  for (const h of m.holds) {
    try { await calendar.retitleHold(o, h.eventId, m); } catch (e) { mlog.warn('held time not renamed on calendar', { meetingId: id, err: e }); }
  }
}

/**
 * Cancelling deletes the meeting for good: every revision, its calls (with their chat) and everyone's answers. Notes
 * stay. A calendar event goes too, and its guests are told. A call in a series can take later ones with it
 * (./repeats.ts); an older kind of series has nothing to go by but each call, so its calls go one at a time.
 */
export async function cancel(o: Owner, id: string, scope?: ChangeScope | undefined): Promise<void> {
  const { manifest } = await getItem(o, o.pool, 'meeting', id, MeetingManifest, 'That meeting');
  if (manifest.seriesId && manifest.seriesCode) return cancelInSeries(o, id, manifest.seriesId, scope);
  if (scope === 'following') throw new ConflictError('This call doesn’t repeat, so there are no later calls to cancel with it.', { context: { meetingId: id } });
  const { eventId, holds } = await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    const m = await getItem(o, c, 'meeting', id, MeetingManifest, 'That meeting');
    if (m.manifest.status === 'live') throw new ConflictError('That call is happening now. Leave it first.', { context: { meetingId: id } });
    await exec(c, 'DELETE FROM items WHERE owner_id = $1 AND item_id = $2', [o.ownerId, id]);
    await exec(c, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
    return { eventId: m.manifest.calendarEvent?.id, holds: m.manifest.holds };
  });
  mlog.info('meeting cancelled', { meetingId: id, holds: holds.length });
  if (eventId) {
    try { await calendar.withdraw(o, eventId, id); } catch (e) { mlog.warn('calendar event not cancelled', { meetingId: id, err: e }); }
  }
  await releaseHolds(o, id, holds);
}

/**
 * Makes one of the organizer's own calendar events an Alcove call: same title, time and guests; the
 * event gets the Alcove link, and its guests are sent the update. Doing it twice returns the same call.
 * Every occurrence of one recurring event made an Alcove call is in the same series.
 */
export async function adopt(o: Owner, eventId: string, notes?: NotesSetting | undefined): Promise<Meeting> {
  const held = (await all(o)).find((m) => m.manifest.calendarEvent?.id === eventId);
  if (held) return toMeeting(o, held);
  const organizer = await me(o);
  const e = await calendar.ownEvent(o, eventId);
  const setting = notes ?? (await profile(o)).preferences.notesDefault;
  const made = await tx(o.pool, async (c) => {
    // One at a time per account, reading the calls only once it's this one's turn: two quick adopts
    // of one recurring event's occurrences share a series, and one event adopted twice is one call.
    await lockOwner(o, c);
    const mine = await all(o, c);
    const again = mine.find((m) => m.manifest.calendarEvent?.id === eventId);
    if (again) return { itemId: again.itemId, manifest: again.manifest, created: false };
    const recurring = e.recurringEventId;
    const before = recurring ? mine.filter((m) => m.manifest.recurringEventId === recurring).sort((a, b) => b.manifest.startsAt.localeCompare(a.manifest.startsAt))[0] : undefined;
    const series = recurring ? { seriesId: before?.manifest.seriesId ?? id128(), recurringEventId: recurring } : {};
    const manifest: MeetingManifest = {
      title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, guests: cleanGuests(e.guests, organizer.email),
      notes: setting, code: makeCode(), status: 'scheduled', calendarEvent: { id: eventId, ...(e.url ? { url: e.url } : {}), adopted: true }, ...series,
      instant: false, choices: DEFAULT_NOTES_CHOICES, joinMuted: false, documents: [], workspaceId: before?.manifest.workspaceId ?? null, agenda: null, holds: []
    };
    return { itemId: await store(o, c, manifest), manifest, created: true };
  });
  if (made.created) {
    await calendar.change(o, eventId, made.itemId, made.manifest, e.description);
    mlog.info('calendar event moved to Alcove', { meetingId: made.itemId, guests: made.manifest.guests.length, recurring: !!made.manifest.recurringEventId });
  }
  return own(o, made.itemId);
}

/**
 * Deletes this account's calls that were started now and that nobody joined, once they're a day old. Backing out of a
 * lobby cancels its call; a tab that just closed never says so. Deleted as cancelling a call deletes it.
 */
async function sweepUnjoined(o: Owner, db: Db): Promise<number> {
  const cutoff = Date.now() - 86_400_000;
  // Not a call in a series that repeats: if it went this way, the series would be left without it, unasked.
  const stale = (await all(o, db)).filter((m) => unjoined(m.manifest) && !m.manifest.seriesCode && m.createdAt.getTime() < cutoff).map((m) => m.itemId);
  if (!stale.length) return 0;
  await exec(db, 'DELETE FROM items WHERE owner_id = $1 AND item_id = ANY($2::text[])', [o.ownerId, stale]);
  await exec(db, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
  return stale.length;
}

/**
 * A call that starts now: "<first name>'s call" unless it has a title, with the default notes setting unless set. What it
 * brings comes from the organizer's own library, as a scheduled call's does: Start a call here on a board brings the board.
 */
export async function startNow(o: Owner, input: InstantCallInput): Promise<{ code: string }> {
  const organizer = await me(o);
  const notes = input.notes ?? (await profile(o)).preferences.notesDefault;
  const documents = input.documents ?? [];
  await validDocuments(o, documents);
  const start = new Date();
  const manifest: MeetingManifest = {
    title: input.title?.trim() || `${firstName(organizer.name)}’s call`, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
    guests: cleanGuests(input.guests ?? [], organizer.email), notes, code: makeCode(), status: 'scheduled',
    instant: true, choices: DEFAULT_NOTES_CHOICES, joinMuted: false, documents, workspaceId: null, agenda: null, holds: []
  };
  const { itemId, swept } = await tx(o.pool, async (c) => ({ swept: await sweepUnjoined(o, c), itemId: await store(o, c, manifest) }));
  mlog.info('instant call created', { meetingId: itemId, guests: manifest.guests.length, notes, documents: documents.length, swept });
  return { code: manifest.code };
}

/* ---------- series: calls that follow on from each other ---------- */

/**
 * Schedules the next call in a call's series, starting the series if the call isn't in one: the
 * same title, people, length, notes setting and what it brings, with the boards open for everyone in this
 * one too, at `startsAt`, which has to be still to come and
 * after the call. The app sends the same clock time a week on, worked out where the organizer is,
 * so a change of the clocks in between doesn't move it. It goes on the calendar like any scheduled
 * call. An occurrence of a recurring Google Calendar event has its next one on the calendar already,
 * so that one is made an Alcove call from there instead.
 */
export async function scheduleNext(o: Owner, id: string, startsAt: string): Promise<Meeting> {
  // The boards open for everyone in this call are brought to the next, read before anything's held, as it opens workspaces.
  const boards = await boardsFrom(o, (await findItem(o, o.pool, 'meeting', id, MeetingManifest))?.manifest.noteId);
  const made = await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    const cur = await getItem(o, c, 'meeting', id, MeetingManifest, 'That meeting');
    const from = cur.manifest;
    if (from.recurringEventId) throw new ConflictError('This call repeats on your Google Calendar, so its next one is there already. Use Alcove for it from Home.', { context: { meetingId: id } });
    const times = validTimes(startsAt, minutesOf(from));
    const start = new Date(times.startsAt).getTime();
    if (start <= new Date(from.startsAt).getTime()) throw new ValidationError('The next call has to start after this one.', { context: { meetingId: id } });
    if (start <= Date.now()) throw new ValidationError('The next call has to start in the future.', { context: { meetingId: id } });
    const seriesId = from.seriesId ?? id128();
    if (!from.seriesId) await saveRevision(o, c, id, cur.revisionId, { ...from, seriesId });
    const manifest: MeetingManifest = {
      title: from.title, ...times, guests: from.guests, notes: from.notes, code: makeCode(), status: 'scheduled', seriesId, instant: false, choices: from.choices, joinMuted: from.joinMuted,
      documents: [...new Set([...from.documents, ...boards])].slice(0, MAX_CALL_DOCUMENTS), workspaceId: from.workspaceId, agenda: null, holds: [], ...(from.seriesCode ? { seriesCode: from.seriesCode } : {})
    };
    return { itemId: await store(o, c, manifest), manifest, started: !from.seriesId };
  });
  mlog.info('next call in a series scheduled', { meetingId: made.itemId, after: id, seriesStarted: made.started, guests: made.manifest.guests.length, notes: made.manifest.notes, documents: made.manifest.documents.length, boards: boards.length });
  await placeOnCalendar(o, made.itemId);
  return own(o, made.itemId);
}

/** Your series that follow recurring Google Calendar events, by Google's ID for each: how an occurrence not yet in Alcove finds its series. */
export async function recurringSeries(o: Owner): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const { manifest: m } of await all(o)) if (m.recurringEventId && m.seriesId) out.set(m.recurringEventId, m.seriesId);
  return out;
}
