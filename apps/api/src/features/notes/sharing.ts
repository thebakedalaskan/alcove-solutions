/*
 * Giving a note to more people (docs: Privacy, keys and sessions › Who can read a note): by address, from someone who has
 * it, or by a link someone opens. Each is a `note_access` row by the keyed hash of their address, and their name on the note.
 */
import { type Note } from '@alcove/api';
import type { Owner } from '../../platform/context';
import { b64u } from '../../keys/crypto';
import { tx, type Db } from '../../platform/db';
import { ValidationError } from '../../platform/errors';
import { log } from '../../platform/log';
import { lockItem } from '../../keys/vault';
import { profile } from '../profile/profile';
import { locate, holders } from './access';
import { Sharer, same, emailIndex, SharedWith, updateNote, grant } from './manifest';
import { get } from './service';

const nlog = log.child({ component: 'notes' });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/**
 * Shares the notes with more people: by address, or with one of the sharer's groups (its addresses,
 * and its name for everyone it reaches to see). Anyone who has the notes can share them on. People
 * who have them already are skipped; someone who removed them gets them again.
 */
export async function share(o: Owner, id: string, to: { emails: string[]; group?: string | undefined }): Promise<Note> {
  const { owner, note } = await locate(o, id);
  if (note.manifest.status === 'recording') throw new ValidationError('These notes can be shared once the call ends.', { context: { noteId: id } });
  const wanted = [...new Set(to.emails.map((e) => e.trim().toLowerCase()))];
  if (!wanted.length || wanted.some((e) => !EMAIL.test(e))) throw new ValidationError('Share by full email address.', { context: { noteId: id, emails: wanted.length } });
  const sharer = await profile(o);
  const by: Sharer = { id: o.ownerId, name: sharer.name, email: sharer.email };
  const organizer = owner.ownerId === o.ownerId ? sharer.email : (await profile(owner)).email;
  const at = new Date().toISOString();
  const added = await tx(owner.pool, async (c) => {
    // Who has the notes, read under the note's lock: two shares at once can't both add someone.
    await lockItem(owner, c, id);
    const holding = await holders(owner, c, id);
    const fresh = new Set(wanted.filter((e) => !same(e, organizer) && !holding.has(b64u(emailIndex(owner, e)))));
    if (!fresh.size) return 0;
    const given = [...fresh].map((email): SharedWith => ({ email, by, ...(to.group ? { group: to.group } : {}), at, link: false }));
    // Someone given the notes again, after removing them, is listed once: as they have them now.
    await updateNote(owner, c, id, (n) => ({ ...n, shared: [...n.shared.filter((s) => !fresh.has(s.email)), ...given] }));
    await grant(owner, c, id, [...fresh], 'shared');
    return fresh.size;
  });
  nlog.info('notes shared', { noteId: id, asked: wanted.length, added, toGroup: to.group !== undefined, byOrganizer: owner.ownerId === o.ownerId });
  return get(o, id);
}

/**
 * Gives a note to one more account, as shared by `by` through a link they made (links.ts), in the caller's transaction,
 * holding the note's lock. The organizer, and anyone who has it already, are skipped. Says whether they got it now.
 */
export async function giveByLink(owner: Owner, db: Db, noteId: string, email: string, organizerEmail: string, by: Sharer, at: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  if (same(address, organizerEmail) || (await holders(owner, db, noteId)).has(b64u(emailIndex(owner, address)))) return false;
  // Someone given the notes again, after removing them, is listed once: as they have them now.
  await updateNote(owner, db, noteId, (n) => ({ ...n, shared: [...n.shared.filter((x) => !same(x.email, address)), { email: address, by, at, link: true }] }));
  await grant(owner, db, noteId, [address], 'shared');
  return true;
}
