/*
 * Who someone is, which every feature shows: their profile, a sealed item in their vault, with their name, address and
 * photo as their provider has them (features/account/account.ts follows the provider at each sign-in), and their
 * preferences. How someone looks when they have no photo is ./portraits.ts; a provider's photo comes through ./photos.ts.
 */
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_SOUND_PREFERENCES, PreferencesSchema, type Patch, type Person, type Preferences } from '@alcove/api';
import { z } from 'zod';
import type { Owner } from '../../platform/context';
import { tx, type Db } from '../../platform/db';
import { NotFoundError } from '../../platform/errors';
import { log } from '../../platform/log';
import { listItems, saveRevision, lockItem } from '../../keys/vault';
import { photoUrl } from './photos';
import { portraitFor } from './portraits';
import { carryModel } from './carry-model';

const alog = log.child({ component: 'account' });

/**
 * Preferences as a profile keeps them, and as GET and PATCH /v1/account/preferences send them. How long a summary is
 * stopped being a choice (every note gets the short summary, with the full summary under it), but the release before
 * this one opens a profile, and reads the preferences it's sent, only when they have `summaryLength`: its app may still
 * be open in a tab, or served while this one deploys. So it's still written, as it was, and still sent. This release's
 * app doesn't declare it, so its schema drops it. The next release takes it off the wire and out of the profile together.
 */
const StoredPreferences = PreferencesSchema.extend({ summaryLength: z.enum(['short', 'detailed']).default('short') });
type StoredPreferences = z.infer<typeof StoredPreferences>;

export const Profile = z.object({
  name: z.string(),
  email: z.string(),
  photoUrl: z.string().optional(),
  /** A demo account, with a sample calendar and company directory. */
  sample: z.boolean(),
  preferences: z.preprocess(carryModel, StoredPreferences),
  /** Colleagues this person has invited to Alcove. */
  invited: z.array(z.string())
});
export type Profile = z.infer<typeof Profile>;

/** What a new account starts with. */
export const DEFAULT_PREFERENCES: StoredPreferences = {
  notesDefault: 'on', notesLanguage: 'call', summaryLength: 'short', addToCalendar: true, showOtherMeetings: true, showSoloEvents: false, recordOffline: true,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  sounds: DEFAULT_SOUND_PREFERENCES,
  pinned: [], groups: [], model: null, notificationsPausedUntil: null
};

async function profileItem(o: Owner, db: Db) {
  const [p] = await listItems(o, db, 'profile', Profile);
  if (!p) throw new NotFoundError('Your profile is missing.', { context: { ownerId: o.ownerId } });
  return p;
}
/** `db`: a transaction reads on its own connection. Waiting for a second one while it holds a lock can use up the pool. */
export const profile = async (o: Owner, db: Db = o.pool): Promise<Profile> => (await profileItem(o, db)).manifest;

/** In the caller's transaction (`db`), as a sign-in with a new address changes it. */
export async function changeProfile(o: Owner, db: Db, fn: (p: Profile) => Profile): Promise<Profile> {
  // Changes take turns: two at once, like a setting and the workspace someone just opened, are both kept.
  await lockItem(o, db, (await profileItem(o, db)).itemId);
  const p = await profileItem(o, db);
  const next = fn(p.manifest);
  await saveRevision(o, db, p.itemId, p.revisionId, next);
  return next;
}
export const updateProfile = (o: Owner, fn: (p: Profile) => Profile): Promise<Profile> => tx(o.pool, (c) => changeProfile(o, c, fn));

/** `db`: a transaction reads on its own connection. */
export async function me(o: Owner, db: Db = o.pool): Promise<Person> {
  const p = await profile(o, db);
  // A provider photo is served through Alcove (features/profile/photos.ts): browsers never fetch it from the provider.
  const photo = photoUrl(o, p.photoUrl);
  return { id: o.ownerId, name: p.name, email: p.email, ...(photo ? { photoUrl: photo } : {}), portrait: portraitFor(p.email) };
}

/**
 * Preferences as they stand, with the `summaryLength` the release before reads (StoredPreferences). Pins that point at
 * notes this person no longer has are dropped here and the cleaned list is saved. `held`: the notes they have, asked only
 * when there are pins (features/notes/service.ts › heldNoteIds).
 */
export async function preferences(o: Owner, held: () => Promise<Set<string>>): Promise<StoredPreferences> {
  const prefs = (await profile(o)).preferences;
  if (!prefs.pinned.length) return prefs;
  const has = await held();
  if (prefs.pinned.every((id) => has.has(id))) return prefs;
  const next = await updateProfile(o, (p) => ({ ...p, preferences: { ...p.preferences, pinned: p.preferences.pinned.filter((id) => has.has(id)) } }));
  alog.info('stale pins dropped', { ownerId: o.ownerId, pins: next.preferences.pinned.length });
  return next.preferences;
}
/** Takes a note off this person's pins, when they delete it or remove it from their notes. */
export async function unpin(o: Owner, noteId: string): Promise<void> {
  if (!(await profile(o)).preferences.pinned.includes(noteId)) return;
  await updateProfile(o, (p) => ({ ...p, preferences: { ...p.preferences, pinned: p.preferences.pinned.filter((id) => id !== noteId) } }));
}
/**
 * Changes what the patch has, and answers with the preferences as they stand then, `summaryLength` included (StoredPreferences).
 * `held`: as for `preferences`, asked only when the patch pins something.
 */
export async function updatePreferences(o: Owner, patch: Patch<Preferences>, held: () => Promise<Set<string>>): Promise<StoredPreferences> {
  if (patch.pinned?.length) {
    const has = await held();
    if (patch.pinned.some((id) => !has.has(id))) throw new NotFoundError('Those notes don’t exist.', { context: { pins: patch.pinned.length } });
  }
  return (await updateProfile(o, (p) => ({ ...p, preferences: {
    notesDefault: patch.notesDefault ?? p.preferences.notesDefault,
    notesLanguage: patch.notesLanguage ?? p.preferences.notesLanguage,
    // Not a choice any more: kept as it was, and not changed by a tab on the release before that sends it (StoredPreferences).
    summaryLength: p.preferences.summaryLength,
    addToCalendar: patch.addToCalendar ?? p.preferences.addToCalendar,
    showOtherMeetings: patch.showOtherMeetings ?? p.preferences.showOtherMeetings,
    showSoloEvents: patch.showSoloEvents ?? p.preferences.showSoloEvents,
    recordOffline: patch.recordOffline ?? p.preferences.recordOffline,
    notifications: patch.notifications ?? p.preferences.notifications,
    sounds: patch.sounds ?? p.preferences.sounds,
    pinned: patch.pinned ?? p.preferences.pinned,
    groups: patch.groups ?? p.preferences.groups,
    model: patch.model === undefined ? p.preferences.model : patch.model,
    // Null resumes; a time already past is kept as given and means nothing is paused.
    notificationsPausedUntil: patch.notificationsPausedUntil === undefined ? p.preferences.notificationsPausedUntil : patch.notificationsPausedUntil
  } }))).preferences;
}
