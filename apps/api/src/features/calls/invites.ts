/*
 * The invite, changed during a call. Someone signed in whom the organizer lets in from the link is added to it, so
 * they get the notes like everyone invited by email; removing them from the call takes them off it again. The meeting
 * keeps which guests came this way (`addedFromLink`), so that holds in any later run of the call too. The call's
 * calendar event isn't changed: Google would email everyone on it in the middle of the call. Someone the organizer
 * rings is added the same way (features/calls/ringing/rings.ts).
 *
 * Runs in the call's transaction, under its row lock, and then locks the note before the meeting, as ending a call
 * does.
 */
import type { Owner } from '../../platform/context';
import type { Db } from '../../platform/db';
import { getItem } from '../../keys/vault';
import { syncAccess } from '../meetings/access';
import { profile } from '../profile/profile';
import { MAX_GUESTS, MeetingManifest, isGuestAddress, updateManifest } from '../meetings/service';
import { updateNote } from '../notes/manifest';

/** Where a call's invite lives: its meeting, and its note once notes have been on. */
export interface InviteOf { meetingId: string; noteId: string | null }

const has = (list: string[], email: string) => list.some((e) => e.toLowerCase() === email);

/**
 * Adds addresses (lower-cased) to the call's invite and its note's, as invites take them (see `cleanGuests`): real
 * addresses, not the organizer's, nobody already there, and no more than the invite's limit. Past the limit they're
 * left out rather than refused, since the organizer's browser has let them in already. Returns the ones added.
 */
export async function addToInvite(o: Owner, db: Db, at: InviteOf, emails: string[]): Promise<string[]> {
  const now = (await getItem(o, db, 'meeting', at.meetingId, MeetingManifest, 'That meeting')).manifest.guests;
  const organizer = (await profile(o, db)).email.toLowerCase();
  const fresh = [...new Set(emails)].filter((e) => isGuestAddress(e) && e !== organizer && !has(now, e));
  const add = fresh.slice(0, Math.max(0, MAX_GUESTS - now.length));
  if (!add.length) return [];
  if (at.noteId) {
    await updateNote(o, db, at.noteId, (n) => {
      const more = add.filter((e) => !has(n.invited, e));
      return more.length ? { ...n, invited: [...n.invited, ...more] } : n;
    });
  }
  const next = await updateManifest(o, db, at.meetingId, (m) => ({ ...m, guests: [...m.guests, ...add], addedFromLink: [...(m.addedFromLink ?? []), ...add.filter((e) => !has(m.addedFromLink ?? [], e))] }));
  await syncAccess(o, db, at.meetingId, next.guests);
  return add;
}

/** Whether an address (lower-cased) is on the invite because someone was let in from the link. */
export async function addedFromLink(o: Owner, db: Db, meetingId: string, email: string): Promise<boolean> {
  return has((await getItem(o, db, 'meeting', meetingId, MeetingManifest, 'That meeting')).manifest.addedFromLink ?? [], email);
}

/** Takes an address (lower-cased) that came from the link off the call's invite and its note's. */
export async function takeOffInvite(o: Owner, db: Db, at: InviteOf, email: string): Promise<void> {
  if (at.noteId) await updateNote(o, db, at.noteId, (n) => (has(n.invited, email) ? { ...n, invited: n.invited.filter((e) => e.toLowerCase() !== email) } : n));
  const next = await updateManifest(o, db, at.meetingId, (m) => ({
    ...m, guests: m.guests.filter((e) => e.toLowerCase() !== email), addedFromLink: (m.addedFromLink ?? []).filter((e) => e.toLowerCase() !== email)
  }));
  await syncAccess(o, db, at.meetingId, next.guests);
}
