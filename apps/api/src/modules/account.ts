/*
 * Accounts: signing in, the profile and preferences. A sign-in identity (provider account and
 * verified email) is found by keyed hashes; the profile itself is a sealed item. Google sign-in is
 * real (../google.ts); Microsoft and single sign-on are demo identities for now (../demo.ts).
 */
import { PreferencesSchema, type Patch, type Person, type Preferences, type Session, type SignInBody, type SignInProvider } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { blindIndex } from '../crypto';
import { exec, maybeOne, timestamp, tx } from '../db';
import { demoDay, demoIdentity } from '../demo';
import type { Identity } from '../identity';
import { NotFoundError } from '../errors';
import { log } from '../log';
import { createOwner, masterKey, openOwner, ownerFrom } from '../owners';
import { closeSession, openSession } from '../sessions';
import { createItem, listItems, saveRevision } from '../vault';
import { openAccount } from './billing';
import { create as createMeeting, upcoming } from './meetings';
import { portraitFor } from './portraits';

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

async function profileItem(o: Owner) {
  const [p] = await listItems(o, o.pool, 'profile', Profile);
  if (!p) throw new NotFoundError('Your profile is missing.', { context: { ownerId: o.ownerId } });
  return p;
}
export const profile = async (o: Owner): Promise<Profile> => (await profileItem(o)).manifest;

export async function updateProfile(o: Owner, fn: (p: Profile) => Profile): Promise<Profile> {
  return tx(o.pool, async (c) => {
    const [p] = await listItems(o, c, 'profile', Profile);
    if (!p) throw new NotFoundError('Your profile is missing.', { context: { ownerId: o.ownerId } });
    const next = fn(p.manifest);
    await saveRevision(o, c, p.itemId, p.revisionId, next);
    return next;
  });
}

export async function me(o: Owner): Promise<Person> {
  const p = await profile(o);
  return { id: o.ownerId, name: p.name, email: p.email, ...(p.photoUrl ? { photoUrl: p.photoUrl } : {}), portrait: portraitFor(p.email) };
}

export async function sessionFor(o: Owner): Promise<Session> {
  if (!o.session) throw new NotFoundError('No session.', { context: { ownerId: o.ownerId } });
  const p = await profile(o);
  return { user: await me(o), ownerId: o.ownerId, provider: o.session.provider, sample: p.sample, createdAt: o.session.createdAt.toISOString(), expiresAt: o.session.expiresAt.toISOString() };
}

const IdentityRow = z.object({ owner_id: z.string(), created_at: timestamp });

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
    const existing = await maybeOne(c, IdentityRow, 'SELECT owner_id, created_at FROM identities WHERE subject_index = $1', [subject]);
    if (existing) {
      // The provider's verified email can change; notes shared by email follow the current one.
      await exec(c, 'UPDATE identities SET last_used_at = now(), email_index = $2 WHERE subject_index = $1', [subject, email]);
      return { ownerId: existing.owner_id, isNew: false };
    }
    const { ownerId, root } = await createOwner(d, c);
    await exec(c, 'INSERT INTO identities (subject_index, owner_id, email_index) VALUES ($1,$2,$3)', [subject, ownerId, email]);
    const o = ownerFrom(d, ownerId, root, undefined);
    const p: Profile = { name: who.name, email: who.email, ...(who.photoUrl ? { photoUrl: who.photoUrl } : {}), sample: who.sample, preferences: { notesDefault: 'on' }, invited: [] };
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

/** The sample calendar for demo accounts: when nothing is coming up, the demo day is put on it. */
async function seedCalendar(o: Owner): Promise<void> {
  if ((await upcoming(o)).length) return;
  for (const m of demoDay(new Date())) await createMeeting(o, m);
  alog.info('demo calendar placed', { ownerId: o.ownerId });
}

export async function signOut(o: Owner): Promise<void> {
  if (o.session) await closeSession(o, o.session);
}

export const preferences = async (o: Owner): Promise<Preferences> => (await profile(o)).preferences;
export async function updatePreferences(o: Owner, patch: Patch<Preferences>): Promise<Preferences> {
  return (await updateProfile(o, (p) => ({ ...p, preferences: { notesDefault: patch.notesDefault ?? p.preferences.notesDefault } }))).preferences;
}
