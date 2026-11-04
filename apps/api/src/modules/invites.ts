/*
 * The invite, changed during a call. Someone signed in whom the organizer lets in from the link is added to it, so
 * they get the notes like everyone invited by email; removing them from the call takes them off it again. The
 * call's calendar event isn't changed: Google would email everyone on it in the middle of the call. Runs in the
 * call's transaction, after its row lock (the same order as ending a call: call, then meeting, then note).
 */
import type { Owner } from '../context';
import type { Db } from '../db';
import { updateManifest } from './meetings';
import { updateNote } from './notes';

/** Where a call's invite lives: its meeting, and its note once notes have been on. */
export interface InviteOf { meetingId: string; noteId: string | null }

const has = (list: string[], email: string) => list.some((e) => e.toLowerCase() === email);

/** Adds addresses (lower-cased) to the call's invite and to its note's, skipping any already there. */
export async function addToInvite(o: Owner, db: Db, at: InviteOf, emails: string[]): Promise<void> {
  await updateManifest(o, db, at.meetingId, (m) => ({ ...m, guests: [...m.guests, ...emails.filter((e) => !has(m.guests, e))] }));
  if (!at.noteId) return;
  await updateNote(o, db, at.noteId, (n) => {
    const add = emails.filter((e) => !has(n.invited, e));
    return add.length ? { ...n, invited: [...n.invited, ...add] } : n;
  });
}

/** Takes an address (lower-cased) off the call's invite and its note's. */
export async function takeOffInvite(o: Owner, db: Db, at: InviteOf, email: string): Promise<void> {
  await updateManifest(o, db, at.meetingId, (m) => ({ ...m, guests: m.guests.filter((e) => e.toLowerCase() !== email) }));
  if (!at.noteId) return;
  await updateNote(o, db, at.noteId, (n) => (has(n.invited, email) ? { ...n, invited: n.invited.filter((e) => e.toLowerCase() !== email) } : n));
}
