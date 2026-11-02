import {
  MeetingNotesSettingSchema, MeetingStatusSchema, NotesAudienceSchema, RsvpSchema, firstName,
  type CallLink, type Meeting, type MeetingInput, type MeetingNotesSetting, type Patch
} from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../context';
import { b64u, random } from '../crypto';
import { exec, tx, type Db } from '../db';
import { ApiError, notFound } from '../errors';
import { createItem, getItem, listItems, lockItem, saveRevision, type Loaded } from '../vault';
import { me, preferences } from './account';

export const MeetingManifest = z.object({
  title: z.string(), startsAt: z.string(), endsAt: z.string(),
  guests: z.array(z.object({ email: z.string(), rsvp: RsvpSchema })),
  notes: MeetingNotesSettingSchema, audience: NotesAudienceSchema, code: z.string(), status: MeetingStatusSchema,
  duration: z.number().optional(), noteId: z.string().optional()
});
export type MeetingManifest = z.infer<typeof MeetingManifest>;

const LETTERS = 'abcdefghijkmnpqrstuvwxyz';
function makeCode(): string {
  const b = random(10);
  const ch = (i: number) => LETTERS[(b[i] ?? 0) % LETTERS.length] ?? 'a';
  return `${ch(0)}${ch(1)}${ch(2)}-${ch(3)}${ch(4)}${ch(5)}${ch(6)}-${ch(7)}${ch(8)}${ch(9)}`;
}

async function toMeeting(o: Owner, m: Loaded<MeetingManifest>): Promise<Meeting> {
  const host = await me(o);
  const { guests, duration, noteId, ...rest } = m.manifest;
  return {
    id: m.itemId, ...rest, host, isHost: true, guests: guests.map((g) => ({ email: g.email, rsvp: g.rsvp })),
    ...(duration !== undefined ? { duration } : {}), ...(noteId !== undefined ? { noteId } : {})
  };
}
const all = (o: Owner, db: Db = o.pool) => listItems(o, db, 'meeting', MeetingManifest);

export async function upcoming(o: Owner): Promise<Meeting[]> {
  const cutoff = Date.now() - 60 * 60_000;
  const ms = (await all(o)).filter((m) => (m.manifest.status === 'scheduled' || m.manifest.status === 'live') && new Date(m.manifest.endsAt).getTime() > cutoff);
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
  return (await all(o, db)).find((m) => m.manifest.code === code && m.manifest.status !== 'cancelled');
}
export async function byCode(o: Owner, code: string): Promise<Meeting | null> {
  const m = await findByCode(o, code);
  return m ? toMeeting(o, m) : null;
}

function validTimes(startsAt: string, minutes: number) {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime()) || minutes < 5 || minutes > 600) throw new ApiError('invalid', 'Pick a valid start time and length.');
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + minutes * 60_000).toISOString() };
}
export async function create(o: Owner, input: MeetingInput): Promise<Meeting> {
  const manifest: MeetingManifest = {
    title: input.title.trim() || 'Untitled call', ...validTimes(input.startsAt, input.durationMinutes),
    guests: [...new Set(input.guests.map((g) => g.trim().toLowerCase()).filter(Boolean))].map((email) => ({ email, rsvp: 'pending' as const })),
    notes: input.notes, audience: input.audience, code: makeCode(), status: 'scheduled'
  };
  const { itemId } = await tx(o.pool, (c) => createItem(o, c, 'meeting', manifest));
  return get(o, itemId);
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
  await tx(o.pool, (c) => updateManifest(o, c, id, (m) => {
    const minutes = patch.durationMinutes ?? Math.round((new Date(m.endsAt).getTime() - new Date(m.startsAt).getTime()) / 60_000);
    const times = patch.startsAt !== undefined || patch.durationMinutes !== undefined ? validTimes(patch.startsAt ?? m.startsAt, minutes) : {};
    const guests = patch.guests ? patch.guests.map((e) => e.trim().toLowerCase()).filter(Boolean).map((email) => m.guests.find((g) => g.email === email) ?? { email, rsvp: 'pending' as const }) : m.guests;
    return { ...m, ...times, guests, title: patch.title?.trim() || m.title, notes: patch.notes ?? m.notes, audience: patch.audience ?? m.audience };
  }));
  return get(o, id);
}
export async function setNotes(o: Owner, id: string, notes: MeetingNotesSetting): Promise<Meeting> { return update(o, id, { notes }); }
/** Cancelling deletes the meeting for good: every revision and its calls (with their chat). Notes stay. */
export async function cancel(o: Owner, id: string): Promise<void> {
  await tx(o.pool, async (c) => {
    await lockItem(o, c, id);
    const m = await getItem(o, c, 'meeting', id, MeetingManifest, 'That meeting');
    if (m.manifest.status === 'live') throw new ApiError('conflict', 'That call is happening now. Leave it first.');
    await exec(c, 'DELETE FROM items WHERE owner_id = $1 AND item_id = $2', [o.ownerId, id]);
    await exec(c, 'DELETE FROM operations WHERE owner_id = $1', [o.ownerId]);
  });
}

/** A call that starts now: used by "Start a call now" and "Get a link to share". */
export async function startNow(o: Owner, notes?: MeetingNotesSetting): Promise<{ code: string }> {
  const prefs = await preferences(o);
  const name = firstName((await me(o)).name);
  const start = new Date();
  const manifest: MeetingManifest = {
    title: `${name}’s call`, startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 60 * 60_000).toISOString(), guests: [],
    notes: notes ?? (prefs.notesDefault === 'always' ? prefs.keep : prefs.notesDefault === 'never' ? 'off' : 'ask'),
    audience: 'everyone', code: makeCode(), status: 'scheduled'
  };
  await tx(o.pool, (c) => createItem(o, c, 'meeting', manifest));
  return { code: manifest.code };
}
export async function createLink(o: Owner, notes: MeetingNotesSetting): Promise<CallLink> {
  const { code } = await startNow(o, notes);
  // The fragment will carry the call's end-to-end key once other people can join; browsers never send it to the server.
  return { code, url: `${o.cfg.WEB_ORIGIN}/join/${code}#k=${b64u(random(16))}`, notes };
}
export { notFound };
