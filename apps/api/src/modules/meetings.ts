/*
 * Meetings: scheduled calls, and calls that start now. The organizer invites people by email and
 * decides when scheduling whether the call has notes; everyone invited gets them. With Google
 * Calendar connected, a scheduled call is also a calendar event, which sends the invitations.
 */
import { MeetingStatusSchema, NotesSettingSchema, firstName, type InstantCallInput, type Meeting, type MeetingInput, type NotesSetting, type Patch } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { id128, random } from '../crypto';
import { exec, tx, type Db } from '../db';
import { ConflictError, ValidationError } from '../errors';
import { log } from '../log';
import { lockOwner } from '../owners';
import { createItem, getItem, listItems, lockItem, saveRevision, type Loaded } from '../vault';
import { me, preferences } from './account';
import * as calendar from './calendar';
import { personOf } from './portraits';

const mlog = log.child({ component: 'meetings' });

export const MeetingManifest = z.object({
  title: z.string(), startsAt: z.string(), endsAt: z.string(),
  /** Email addresses of everyone invited besides the organizer. */
  guests: z.array(z.string()),
  notes: NotesSettingSchema, code: z.string(), status: MeetingStatusSchema,
  duration: z.number().optional(), noteId: z.string().optional(),
  /** The Google Calendar event that carries this call, and its link. */
  calendarEventId: z.string().optional(), calendarUrl: z.string().optional(),
  /** The series the call is in: a random ID its calls share. */
  seriesId: z.string().optional(),
  /** The recurring Google Calendar event this call is an occurrence of (Google's ID for the whole series). */
  recurringEventId: z.string().optional()
});
export type MeetingManifest = z.infer<typeof MeetingManifest>;

const LETTERS = 'abcdefghijkmnpqrstuvwxyz';
function makeCode(): string {
  const b = random(10);
  const ch = (i: number) => LETTERS[(b[i] ?? 0) % LETTERS.length] ?? 'a';
  return `${ch(0)}${ch(1)}${ch(2)}-${ch(3)}${ch(4)}${ch(5)}${ch(6)}-${ch(7)}${ch(8)}${ch(9)}`;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** Lower-cased, unique, without the organizer, and every one a real address. */
function cleanGuests(emails: string[], organizerEmail: string): string[] {
  const out = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].filter((e) => e !== organizerEmail.toLowerCase());
  const bad = out.filter((e) => !EMAIL.test(e));
  if (bad.length) throw new ValidationError('Invite people by their full email address.', { context: { invalid: bad.length } });
  if (out.length > 100) throw new ValidationError('A call can have at most 100 people invited.', { context: { guests: out.length } });
  return out;
}

export async function toMeeting(o: Owner, m: Loaded<MeetingManifest>): Promise<Meeting> {
  const { guests, duration, noteId, calendarEventId: _event, calendarUrl, seriesId, recurringEventId: _recurring, ...rest } = m.manifest;
  return {
    id: m.itemId, ...rest, organizer: await me(o), isOrganizer: true, guests: guests.map((e) => personOf(e)),
    ...(duration !== undefined ? { duration } : {}), ...(noteId !== undefined ? { noteId } : {}), ...(calendarUrl ? { calendarUrl } : {}), ...(seriesId ? { seriesId } : {})
  };
}
export const all = (o: Owner, db: Db = o.pool) => listItems(o, db, 'meeting', MeetingManifest);

export async function upcoming(o: Owner): Promise<Meeting[]> {
  const cutoff = Date.now() - 60 * 60_000;
  const ms = (await all(o)).filter((m) => m.manifest.status !== 'ended' && new Date(m.manifest.endsAt).getTime() > cutoff);
  ms.sort((a, b) => a.manifest.startsAt.localeCompare(b.manifest.startsAt));
  return Promise.all(ms.map((m) => toMeeting(o, m)));
}
export async function past(o: Owner): Promise<Meeting[]> {
  const ms = (await all(o)).filter((m) => m.manifest.status === 'ended');
  ms.sort((a, b) => b.manifest.startsAt.localeCompare(a.manifest.startsAt));
  return Promise.all(ms.map((m) => toMeeting(o, m)));
}
export async function get(o: Owner, id: string): Promise<Meeting> { return toMeeting(o, await getItem(o, o.pool, 'meeting', id, MeetingManifest, 'That meeting')); }
export async function findByCode(o: Owner, code: string, db: Db = o.pool): Promise<Loaded<MeetingManifest> | undefined> {
  return (await all(o, db)).find((m) => m.manifest.code === code);
}
export async function byCode(o: Owner, code: string): Promise<Meeting | null> {
  const m = await findByCode(o, code);
  return m ? toMeeting(o, m) : null;
}

function validTimes(startsAt: string, minutes: number) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime()) || minutes < 5 || minutes > 600) throw new ValidationError('Pick a valid start time and length.', { context: { validStart: !Number.isNaN(start.getTime()), minutes } });
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * 60_000).toISOString() };
}

export async function create(o: Owner, input: MeetingInput): Promise<Meeting> {
  const organizer = await me(o);
  const manifest: MeetingManifest = {
    title: input.title.trim() || 'Untitled call', ...validTimes(input.startsAt, input.durationMinutes),
    guests: cleanGuests(input.guests, organizer.email), notes: input.notes, code: makeCode(), status: 'scheduled'
  };
  const { itemId } = await tx(o.pool, (c) => createItem(o, c, 'meeting', manifest));
  mlog.info('meeting scheduled', { meetingId: itemId, guests: manifest.guests.length, notes: manifest.notes });
  await placeOnCalendar(o, itemId, manifest);
  return get(o, itemId);
}

/** The calendar is a courtesy: if Google is down the call still exists, without a calendar link. */
async function placeOnCalendar(o: Owner, id: string, manifest: MeetingManifest): Promise<void> {
  try {
    const placed = await calendar.place(o, id, manifest);
    if (placed) await tx(o.pool, (c) => updateManifest(o, c, id, (m) => ({ ...m, calendarEventId: placed.eventId, ...(placed.url ? { calendarUrl: placed.url } : {}) })));
  } catch (e) {
    mlog.warn('call not placed on calendar', { meetingId: id, err: e });
  }
}

/** Read-modify-write of one meeting's manifest under a row lock. */
export async function updateManifest(o: Owner, db: Db, id: string, fn: (m: MeetingManifest) => MeetingManifest): Promise<MeetingManifest> {
  await lockItem(o, db, id);
  const cur = await getItem(o, db, 'meeting', id, MeetingManifest, 'That meeting');
  const next = fn(cur.manifest);
  await saveRevision(o, db, id, cur.revisionId, next);
  return next;
}
export async function update(o: Owner, id: string, patch: Patch<MeetingInput>): Promise<Meeting> {
  const organizer = await me(o);
  const next = await tx(o.pool, (c) => updateManifest(o, c, id, (m) => {
    if (m.status !== 'scheduled') throw new ConflictError('Only a call that hasn’t started can be changed.', { context: { meetingId: id, status: m.status } });
    const minutes = patch.durationMinutes ?? Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000);
    const times = patch.startsAt !== undefined || patch.durationMinutes !== undefined ? validTimes(patch.startsAt ?? m.startsAt, minutes) : {};
    return { ...m, ...times, title: patch.title?.trim() || m.title, notes: patch.notes ?? m.notes, guests: patch.guests ? cleanGuests(patch.guests, organizer.email) : m.guests };
  }));
  mlog.info('meeting updated', { meetingId: id, fields: Object.keys(patch).length });
  if (next.calendarEventId) {
    try { await calendar.change(o, next.calendarEventId, id, next); } catch (e) { mlog.warn('calendar event not updated', { meetingId: id, err: e }); }
  } else await placeOnCalendar(o, id, next);
  return get(o, id);
}

/** Cancelling deletes the meeting for good: every revision and its calls (with their chat). Notes stay. A calendar event goes too, and its guests are told. */
export async function cancel(o: Owner, id: string): Promise<void> {
  const eventId = await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    const m = await getItem(o, c, 'meeting', id, MeetingManifest, 'That meeting');
    if (m.manifest.status === 'live') throw new ConflictError('That call is happening now. Leave it first.', { context: { meetingId: id } });
    await exec(c, 'DELETE FROM items WHERE owner_id = $1 AND item_id = $2', [o.ownerId, id]);
    await exec(c, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
    return m.manifest.calendarEventId;
  });
  mlog.info('meeting cancelled', { meetingId: id });
  if (eventId) {
    try { await calendar.withdraw(o, eventId, id); } catch (e) { mlog.warn('calendar event not cancelled', { meetingId: id, err: e }); }
  }
}

/**
 * Makes one of the organizer's own calendar events an Alcove call: same title, time and guests; the
 * event gets the Alcove link, and its guests are sent the update. Doing it twice returns the same call.
 * Every occurrence of one recurring event made an Alcove call is in the same series.
 */
export async function adopt(o: Owner, eventId: string, notes?: NotesSetting | undefined): Promise<Meeting> {
  const held = (await all(o)).find((m) => m.manifest.calendarEventId === eventId);
  if (held) return toMeeting(o, held);
  const organizer = await me(o);
  const e = await calendar.ownEvent(o, eventId);
  const setting = notes ?? (await preferences(o)).notesDefault;
  const made = await tx(o.pool, async (c) => {
    // One at a time per account, reading the calls only once it's this one's turn: two quick adopts
    // of one recurring event's occurrences share a series, and one event adopted twice is one call.
    await lockOwner(o, c);
    const mine = await all(o, c);
    const again = mine.find((m) => m.manifest.calendarEventId === eventId);
    if (again) return { itemId: again.itemId, manifest: again.manifest, created: false };
    const recurring = e.recurringEventId;
    const series = recurring ? { seriesId: mine.find((m) => m.manifest.recurringEventId === recurring)?.manifest.seriesId ?? id128(), recurringEventId: recurring } : {};
    const manifest: MeetingManifest = {
      title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, guests: cleanGuests(e.guests, organizer.email),
      notes: setting, code: makeCode(), status: 'scheduled', calendarEventId: eventId, ...(e.url ? { calendarUrl: e.url } : {}), ...series
    };
    return { itemId: (await createItem(o, c, 'meeting', manifest)).itemId, manifest, created: true };
  });
  if (made.created) {
    await calendar.change(o, eventId, made.itemId, made.manifest, e.description);
    mlog.info('calendar event moved to Alcove', { meetingId: made.itemId, guests: made.manifest.guests.length, recurring: !!made.manifest.recurringEventId });
  }
  return get(o, made.itemId);
}

/** A call that starts now: "<first name>'s call" unless it has a title, with the default notes setting unless set. */
export async function startNow(o: Owner, input: InstantCallInput): Promise<{ code: string }> {
  const organizer = await me(o);
  const notes = input.notes ?? (await preferences(o)).notesDefault;
  const start = new Date();
  const manifest: MeetingManifest = {
    title: input.title?.trim() || `${firstName(organizer.name)}’s call`, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
    guests: cleanGuests(input.guests ?? [], organizer.email), notes, code: makeCode(), status: 'scheduled'
  };
  const { itemId } = await tx(o.pool, (c) => createItem(o, c, 'meeting', manifest));
  mlog.info('instant call created', { meetingId: itemId, guests: manifest.guests.length, notes });
  return { code: manifest.code };
}

/* ---------- series: calls that follow on from each other ---------- */

/**
 * Schedules the next call in a call's series, starting the series if the call isn't in one: the
 * same title, people, length and notes setting, at `startsAt`, which has to be still to come and
 * after the call. The app sends the same clock time a week on, worked out where the organizer is,
 * so a change of the clocks in between doesn't move it. It goes on the calendar like any scheduled
 * call. An occurrence of a recurring Google Calendar event has its next one on the calendar already,
 * so that one is made an Alcove call from there instead.
 */
export async function scheduleNext(o: Owner, id: string, startsAt: string): Promise<Meeting> {
  const made = await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    const cur = await getItem(o, c, 'meeting', id, MeetingManifest, 'That meeting');
    const from = cur.manifest;
    if (from.recurringEventId) throw new ConflictError('This call repeats on your Google Calendar, so its next one is there already. Use Alcove for it from Home.', { context: { meetingId: id } });
    const minutes = Math.round((new Date(from.endsAt).getTime() - new Date(from.startsAt).getTime()) / 60_000);
    const times = validTimes(startsAt, minutes);
    const start = new Date(times.startsAt).getTime();
    if (start <= new Date(from.startsAt).getTime()) throw new ValidationError('The next call has to start after this one.', { context: { meetingId: id } });
    if (start <= Date.now()) throw new ValidationError('The next call has to start in the future.', { context: { meetingId: id } });
    const seriesId = from.seriesId ?? id128();
    if (!from.seriesId) await saveRevision(o, c, id, cur.revisionId, { ...from, seriesId });
    const manifest: MeetingManifest = { title: from.title, ...times, guests: from.guests, notes: from.notes, code: makeCode(), status: 'scheduled', seriesId };
    return { itemId: (await createItem(o, c, 'meeting', manifest)).itemId, manifest, started: !from.seriesId };
  });
  mlog.info('next call in a series scheduled', { meetingId: made.itemId, after: id, seriesStarted: made.started, guests: made.manifest.guests.length, notes: made.manifest.notes });
  await placeOnCalendar(o, made.itemId, made.manifest);
  return get(o, made.itemId);
}

/** Your series that follow recurring Google Calendar events, by Google's ID for each: how an occurrence not yet in Alcove finds its series. */
export async function recurringSeries(o: Owner): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const { manifest: m } of await all(o)) if (m.recurringEventId && m.seriesId) out.set(m.recurringEventId, m.seriesId);
  return out;
}
