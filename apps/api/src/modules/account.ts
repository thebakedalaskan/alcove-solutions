/*
 * Accounts: signing in, the profile and preferences. A sign-in identity (provider account and
 * verified email) is found by keyed hashes; the profile itself is a sealed item. Google sign-in is
 * real (../google.ts); Microsoft and single sign-on are demo identities for now (../demo.ts).
 */
import { PreferencesSchema, type Patch, type Person, type Preferences, type Session, type SignInBody, type SignInProvider } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { blindIndex, equalBytes } from '../crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { demoDay, demoIdentity, isSharedDemo } from '../demo';
import type { Identity } from '../identity';
import { ForbiddenError, NotFoundError } from '../errors';
import { log } from '../log';
import { createOwner, masterKey, openOwner, ownerFrom } from '../owners';
import { closeSession, openSession } from '../sessions';
import { createItem, listItems, saveRevision } from '../vault';
import { forgetAnswers } from './access';
import { takeAllBack } from './additions';
import { queueDelete } from './audio';
import { openAccount } from './billing';
import { forgetAccess, grantToRevoke, revokeGrant, unreachable, withdraw } from './calendar';
import { create as createMeeting, findUpcoming } from './meetings';
import { deleteOwnNote, heldNoteIds } from './notes';
import { photoUrl } from './photos';
import { portraitFor } from './portraits';
import { eventsToWithdraw } from './repeats';
import { forget as forgetRings } from './rings';
import { forgetAccount, moveAddress } from './workspaces';

const alog = log.child({ component: 'account' });

export const Profile = z.object({
  name: z.string(),
  email: z.string(),
  photoUrl: z.string().optional(),
  /** A demo account, with a sample calendar and company directory. */
  sample: z.boolean(),
  preferences: PreferencesSchema,
  /** Colleagues this person has invited to Alcove. */
  invited: z.array(z.string())
});
export type Profile = z.infer<typeof Profile>;

const DEFAULT_PREFERENCES: Preferences = {
  notesDefault: 'on', notesLanguage: 'call', summaryLength: 'short', addToCalendar: true, showOtherMeetings: true, recordOffline: true,
  notifications: { beforeCall: 5, notesReady: true, sharedWithYou: true, notesRequested: true, followUpDue: false, tagged: true },
  pinned: [], groups: []
};

async function profileItem(o: Owner, db: Db) {
  const [p] = await listItems(o, db, 'profile', Profile);
  if (!p) throw new NotFoundError('Your profile is missing.', { context: { ownerId: o.ownerId } });
  return p;
}
/** `db`: a transaction reads on its own connection. Waiting for a second one while it holds a lock can use up the pool. */
export const profile = async (o: Owner, db: Db = o.pool): Promise<Profile> => (await profileItem(o, db)).manifest;

async function changeProfile(o: Owner, db: Db, fn: (p: Profile) => Profile): Promise<Profile> {
  const [p] = await listItems(o, db, 'profile', Profile);
  if (!p) throw new NotFoundError('Your profile is missing.', { context: { ownerId: o.ownerId } });
  const next = fn(p.manifest);
  await saveRevision(o, db, p.itemId, p.revisionId, next);
  return next;
}
export const updateProfile = (o: Owner, fn: (p: Profile) => Profile): Promise<Profile> => tx(o.pool, (c) => changeProfile(o, c, fn));

/** `db`: a transaction reads on its own connection. */
export async function me(o: Owner, db: Db = o.pool): Promise<Person> {
  const p = await profile(o, db);
  // A provider photo is served through Alcove (modules/photos.ts): browsers never fetch it from the provider.
  const photo = photoUrl(o, p.photoUrl);
  return { id: o.ownerId, name: p.name, email: p.email, ...(photo ? { photoUrl: photo } : {}), portrait: portraitFor(p.email) };
}

export async function sessionFor(o: Owner): Promise<Session> {
  if (!o.session) throw new NotFoundError('No session.', { context: { ownerId: o.ownerId } });
  const p = await profile(o);
  return { user: await me(o), ownerId: o.ownerId, provider: o.session.provider, sample: p.sample, createdAt: o.session.createdAt.toISOString(), expiresAt: o.session.expiresAt.toISOString() };
}

const IdentityRow = z.object({ owner_id: z.string(), created_at: timestamp, email_index: bytea });

/** Signs in a demo identity: Microsoft as Art Vandelay, or single sign-on as the email typed. */
export const demoSignIn = (d: Deps, body: SignInBody) => signIn(d, demoIdentity(body.provider, body.email), body.provider);

/**
 * Signs a verified identity in and opens a session. The first sign-in creates the account: its keys,
 * its profile from the provider, and its credits; a demo identity also gets the sample calendar.
 */
export async function signIn(d: Deps, who: Identity, provider: SignInProvider): Promise<{ owner: Owner; sessionId: string; isNew: boolean }> {
  const subject = blindIndex(masterKey(d), 'subject', who.subject);
  const email = blindIndex(masterKey(d), 'email', who.email);

  const found = await tx(d.pool, async (c) => {
    // Two first sign-ins at once must not make two accounts: serialise on the identity.
    await exec(c, 'SELECT pg_advisory_xact_lock($1)', [Buffer.from(subject.slice(0, 8)).readBigInt64BE()]);
    const existing = await maybeOne(c, IdentityRow, 'SELECT owner_id, created_at, email_index FROM identities WHERE subject_index = $1', [subject]);
    if (existing) {
      // The provider's verified email can change; notes shared by email follow the current one.
      await exec(c, 'UPDATE identities SET last_used_at = now(), email_index = $2 WHERE subject_index = $1', [subject, email]);
      // And what the account has in workspaces moves with it, along with the profile, so nothing reads the new rows under the old address.
      if (!equalBytes(existing.email_index, email)) {
        await changeProfile(await openOwner(d, existing.owner_id, undefined, c), c, (p) => ({ ...p, email: who.email }));
        await moveAddress(d, c, existing.owner_id, existing.email_index, who.email);
      }
      return { ownerId: existing.owner_id, isNew: false };
    }
    const { ownerId, root } = await createOwner(d, c);
    await exec(c, 'INSERT INTO identities (subject_index, owner_id, email_index) VALUES ($1,$2,$3)', [subject, ownerId, email]);
    const o = ownerFrom(d, ownerId, root, undefined);
    const p: Profile = { name: who.name, email: who.email, ...(who.photoUrl ? { photoUrl: who.photoUrl } : {}), sample: who.sample, preferences: DEFAULT_PREFERENCES, invited: [] };
    await createItem(o, c, 'profile', p);
    await openAccount(d, c, ownerId);
    return { ownerId, isNew: true };
  });

  const { id, session } = await openSession(d, found.ownerId, provider);
  const owner = await openOwner(d, found.ownerId, session);
  if (!found.isNew) await refreshProfile(owner, who);
  if (who.sample) await seedCalendar(owner);
  alog.info(found.isNew ? 'account created' : 'signed in', { ownerId: found.ownerId, provider });
  return { owner, sessionId: id, isNew: found.isNew };
}

/** The provider is where someone's name, email and photo are kept; Alcove follows it. */
async function refreshProfile(o: Owner, who: Identity): Promise<void> {
  const p = await profile(o);
  if (p.name === who.name && p.email === who.email && p.photoUrl === who.photoUrl) return;
  await updateProfile(o, (x) => ({ name: who.name, email: who.email, ...(who.photoUrl ? { photoUrl: who.photoUrl } : {}), sample: x.sample, preferences: x.preferences, invited: x.invited }));
  alog.info('profile updated from provider', { ownerId: o.ownerId });
}

/** The sample calendar for demo accounts: when nothing of theirs is coming up, the demo day is put on it. */
async function seedCalendar(o: Owner): Promise<void> {
  if ((await findUpcoming(o)).length) return;
  for (const m of demoDay(new Date())) await createMeeting(o, m);
  alog.info('demo calendar placed', { ownerId: o.ownerId });
}

export async function signOut(o: Owner): Promise<void> {
  if (o.session) await closeSession(o, o.session);
}

/** How long Google has, in all, to cancel an account's calls when it's deleted. The deletion goes ahead after that. */
const CANCEL_MS = 10_000;
/** How long Google has to revoke the grant once the account is gone. */
const REVOKE_MS = 3_000;

/**
 * Refuses the shared demo account. Otherwise first cancels on Google Calendar the calls Upcoming lists (their
 * guests are told; an event moved to Alcove from the organizer's own calendar stays as it was) and remembers
 * its Google refresh token. Both are best effort, and Google gets 10 seconds for the cancelling: a failure is
 * logged and never blocks the deletion. After the commit, Google is told to revoke the token, with 3 seconds
 * of its own, once the audio objects have been dealt with.
 *
 * Deletes this account for good, with everything it owns, in one transaction: its meetings and series with
 * their calls and call links; every note it organized, each the way deleting a note does, so everyone loses it;
 * what it added to other people's shared notes (its own words: a row found by a keyed hash, so nothing of theirs is
 * opened); its access to the notes other people gave its address and what it answered on their calls (unless another
 * account signs in with that address too); its place in every workspace and on every document given to that
 * address, on the same condition, and what its calls gave people's seats in workspaces; and the account's row, which takes its own notes on anyone's notes, sign-in identity, sessions, profile (pins and groups with it),
 * Google connection, receipts, notes jobs and credits with it. Then the LiveKit rooms of its calls still
 * going are closed, which takes everyone in them out, as ending a call does; the audio and shared-screen
 * objects are deleted, and any the store refuses are queued in object_gc for maintenance. Notes it shared on
 * stay with whoever has them: nothing is written into anyone else's vault (docs: privacy-keys-and-sessions › Deletion).
 */
export async function deleteAccount(o: Owner): Promise<void> {
  const t0 = performance.now();
  const [existing] = await listItems(o, o.pool, 'profile', Profile);
  // Another deletion committed after this request was signed in: there's nothing left to delete.
  if (!existing) { alog.info('account already deleted', { ownerId: o.ownerId }); return; }
  if (isSharedDemo(existing.manifest)) throw new ForbiddenError('This is the shared demo account, so it can’t be deleted.', { context: { ownerId: o.ownerId } });
  let refreshToken: string | undefined;
  try {
    refreshToken = await grantToRevoke(o);
  } catch (e) {
    alog.warn('google grant not read, so it won’t be revoked', { ownerId: o.ownerId, err: e });
  }
  const calendar = await withdrawCalls(o);
  const gone = await tx(o.pool, async (c) => {
    // Calls, then recordings, then the account: the order ending a call or a recording takes them in, so
    // one ending at the same moment finishes first, or waits for this, instead of deadlocking. A second
    // deletion at the same time waits here, and then finds nothing left.
    await exec(c, 'SELECT 1 FROM calls WHERE owner_id = $1 FOR UPDATE', [o.ownerId]);
    await exec(c, 'SELECT 1 FROM recordings WHERE owner_id = $1 FOR UPDATE', [o.ownerId]);
    if (!(await exec(c, 'SELECT 1 FROM owners WHERE owner_id = $1 FOR UPDATE', [o.ownerId]))) return undefined;
    const [p] = await listItems(o, c, 'profile', Profile);
    if (!p) throw new NotFoundError('Your profile is missing.', { context: { ownerId: o.ownerId } });
    // The rooms of its calls still going, to close once the calls are gone.
    const rooms = (await rows(c, z.object({ room_name: z.string() }), "SELECT room_name FROM calls WHERE owner_id = $1 AND state = 'live' AND room_name IS NOT NULL", [o.ownerId])).map((r) => r.room_name);
    const callIds = (await rows(c, z.object({ call_id: z.string() }), 'SELECT call_id FROM calls WHERE owner_id = $1', [o.ownerId])).map((r) => r.call_id);
    // Meetings first, with their calls, call links and chat, so no note is left with a meeting to be unlinked from.
    const meetings = await exec(c, "DELETE FROM items WHERE owner_id = $1 AND kind IN ('meeting', 'series')", [o.ownerId]);
    const notes = await rows(c, z.object({ item_id: z.string() }), "SELECT item_id FROM items WHERE owner_id = $1 AND kind = 'note'", [o.ownerId]);
    const objects: string[] = [];
    let frames = 0;
    for (const n of notes) {
      const gone = await deleteOwnNote(o, c, n.item_id);
      objects.push(...gone.ids);
      frames += gone.frames;
    }
    // Its profile's address is the one it has other people's notes under (notes.ts › locate).
    const received = await exec(c, `DELETE FROM note_access WHERE email_index = $1 AND owner_id <> $2
                                    AND NOT EXISTS (SELECT 1 FROM identities WHERE email_index = $1 AND owner_id <> $2)`, [blindIndex(masterKey(o), 'email', p.manifest.email), o.ownerId]);
    const answers = await forgetAnswers(o, c, p.manifest.email);
    // Rings to its address, in other people's calls: its own calls' went with its meetings.
    const rings = await forgetRings(o, c, p.manifest.email);
    const workspaces = await forgetAccount(o, c, p.manifest.email, callIds);
    // Every other table keyed by the account cascades from its row.
    await exec(c, 'DELETE FROM owners WHERE owner_id = $1', [o.ownerId]);
    // After its row: taking its own notes with it waits for anything being added, which is here by now, or fails from now on.
    const added = await takeAllBack(o, c);
    return { meetings, notes: notes.length, objects, frames, received, answers, rings, added, rooms, workspaces };
  });
  if (!gone) { alog.info('account already deleted', { ownerId: o.ownerId }); return; }
  forgetAccess(o.ownerId);
  // Closing a call's room takes everyone out of it, which is how their browsers learn the call is over.
  for (const room of gone.rooms) await o.livekit.deleteRoom(room).catch((e: unknown) => alog.warn('call room not closed', { ownerId: o.ownerId, err: e }));
  // The audio and screens first: a slow Google mustn't hold them up.
  await queueDelete(o, gone.objects);
  await revokeGrant(o, refreshToken, AbortSignal.timeout(REVOKE_MS));
  alog.info('account deleted', {
    ownerId: o.ownerId, calendarCancelled: calendar.cancelled, calendarKept: calendar.kept, calendarNotCancelled: calendar.notCancelled,
    meetings: gone.meetings, notes: gone.notes, received: gone.received, answers: gone.answers, rings: gone.rings, added: gone.added, objects: gone.objects.length, frames: gone.frames, rooms: gone.rooms.length,
    workspaces: gone.workspaces.workspaces, workspacesDeleted: gone.workspaces.deleted, ms: Math.round(performance.now() - t0)
  });
}

/**
 * Cancels on Google Calendar every call Upcoming lists, begun or not, as Cancel call does, so their guests are
 * told. A series' calls go with their recurring event, which tells everyone once. An event the organizer made in
 * Google Calendar and moved to Alcove is theirs, so it's kept as it was (its Alcove link stops working). Google has
 * CANCEL_MS in all: cancelling stops at the first timeout or network
 * failure, or when the time is up. Counts what was cancelled, kept, and not cancelled (failed, left when it
 * stopped, or with no calendar connected any more), with a warning that says why when something went wrong.
 */
async function withdrawCalls(o: Owner): Promise<{ cancelled: number; kept: number; notCancelled: number }> {
  const out = { cancelled: 0, kept: 0, notCancelled: 0 };
  const due: { meetingId: string; eventId: string }[] = [];
  try {
    const upcoming = await findUpcoming(o);
    for (const m of upcoming) {
      const event = m.manifest.calendarEvent;
      if (!event || event.master) continue;
      if (event.adopted) out.kept++;
      else due.push({ meetingId: m.itemId, eventId: event.id });
    }
    due.push(...await eventsToWithdraw(o, upcoming));
  } catch (e) {
    alog.warn('calendar events not cancelled', { ownerId: o.ownerId, err: e });
    return out;
  }
  const budget = AbortSignal.timeout(CANCEL_MS);
  let failure: unknown;
  for (const [i, d] of due.entries()) {
    if (budget.aborted) { out.notCancelled += due.length - i; failure = budget.reason; break; }
    try {
      const r = await withdraw(o, d.eventId, d.meetingId, budget);
      if (r === 'cancelled') out.cancelled++;
      else if (r === 'not-connected') out.notCancelled++;
    } catch (e) {
      out.notCancelled++;
      failure = e;
      // Google can't be reached, or the time is up: the calls left would fare no better.
      if (budget.aborted || unreachable(e)) { out.notCancelled += due.length - i - 1; break; }
    }
  }
  if (failure !== undefined) alog.warn('calendar events not cancelled', { ownerId: o.ownerId, cancelled: out.cancelled, notCancelled: out.notCancelled, err: failure });
  return out;
}

/** Preferences as they stand. Pins that point at notes this person no longer has are dropped here and the cleaned list is saved. */
export async function preferences(o: Owner): Promise<Preferences> {
  const prefs = (await profile(o)).preferences;
  if (!prefs.pinned.length) return prefs;
  const held = await heldNoteIds(o);
  if (prefs.pinned.every((id) => held.has(id))) return prefs;
  const next = await updateProfile(o, (p) => ({ ...p, preferences: { ...p.preferences, pinned: p.preferences.pinned.filter((id) => held.has(id)) } }));
  alog.info('stale pins dropped', { ownerId: o.ownerId, pins: next.preferences.pinned.length });
  return next.preferences;
}
/** Takes a note off this person's pins, when they delete it or remove it from their notes. */
export async function unpin(o: Owner, noteId: string): Promise<void> {
  if (!(await profile(o)).preferences.pinned.includes(noteId)) return;
  await updateProfile(o, (p) => ({ ...p, preferences: { ...p.preferences, pinned: p.preferences.pinned.filter((id) => id !== noteId) } }));
}
export async function updatePreferences(o: Owner, patch: Patch<Preferences>): Promise<Preferences> {
  if (patch.pinned?.length) {
    const held = await heldNoteIds(o);
    if (patch.pinned.some((id) => !held.has(id))) throw new NotFoundError('Those notes don’t exist.', { context: { pins: patch.pinned.length } });
  }
  return (await updateProfile(o, (p) => ({ ...p, preferences: {
    notesDefault: patch.notesDefault ?? p.preferences.notesDefault,
    notesLanguage: patch.notesLanguage ?? p.preferences.notesLanguage,
    summaryLength: patch.summaryLength ?? p.preferences.summaryLength,
    addToCalendar: patch.addToCalendar ?? p.preferences.addToCalendar,
    showOtherMeetings: patch.showOtherMeetings ?? p.preferences.showOtherMeetings,
    recordOffline: patch.recordOffline ?? p.preferences.recordOffline,
    notifications: patch.notifications ?? p.preferences.notifications,
    pinned: patch.pinned ?? p.preferences.pinned,
    groups: patch.groups ?? p.preferences.groups
  } }))).preferences;
}
