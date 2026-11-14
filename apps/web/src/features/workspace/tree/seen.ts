/*
 * What's new to you in a workspace: what someone else made in the last ten minutes, until you open it. Full screen, its row
 * in the list says New. What you made never does: Alcove says what's yours (`WorkspaceItem.mine`). What you open is kept in
 * this browser for your account, with where you were (places.ts), wherever it opens: on the page, full screen or beside the
 * Drive; in a call's workspace; or as a board on your stage in a call (call/boards/callBoard.ts). Another device doesn't
 * know, so something opened only there says New here until its ten minutes are up.
 */
import type { WorkspaceItem, WorkspacePlaces } from '@alcove/api';
import { useEffect, useState } from 'react';
import { hearPlaces, placesKey, placesOf, rememberPlaces } from './places';

/** How long something someone else made says New, unopened. */
const NEW_MS = 10 * 60_000;
/**
 * How long an opening is kept: an hour, well past New, so a clock a few minutes off Alcove's doesn't bring New back to
 * something opened. Older ones go as the next is kept.
 */
const SEEN_MS = 60 * 60_000;
const NOTHING: Readonly<Record<string, number>> = {};

/** `id` was opened at `now`. */
export const seenIn = (was: WorkspacePlaces, id: string, now: number): WorkspacePlaces => ({
  ...was, seen: { ...Object.fromEntries(Object.entries(was.seen).filter(([, at]) => now - at < SEEN_MS)), [id]: now }
});

/** A document or board was opened here: wherever its workspace is listed, it stops saying New. */
export const rememberSeen = (owner: string | null, id: string): void => rememberPlaces(owner, (p) => seenIn(p, id, Date.now()));

/** Whether a row says New: someone else made it in the last ten minutes and it hasn't been opened here. A folder never does. */
export const saysNew = (item: WorkspaceItem, seen: Readonly<Record<string, number>>, now: number): boolean =>
  !item.mine && item.kind !== 'folder' && now - Date.parse(item.createdAt) < NEW_MS && seen[item.id] === undefined;

const seenBy = (owner: string | null): Readonly<Record<string, number>> => (owner === null ? NOTHING : placesOf(owner).seen);

/**
 * What's been opened here lately, for the list to say New by: read once, then again only as it changes, in this tab or in
 * another of this browser's, such as a board opened on a call's stage. The list draws often (who's where, what's typed), and
 * reading this browser's record each time it does would be work for nothing. Nothing without an account.
 */
export function useSeen(owner: string | null): Readonly<Record<string, number>> {
  const [read, setRead] = useState(() => ({ owner, seen: seenBy(owner) }));
  /* Another account's, as one signs in in its place: read again for this one. */
  if (read.owner !== owner) setRead({ owner, seen: seenBy(owner) });
  useEffect(() => {
    if (owner === null) return undefined;
    const again = () => setRead({ owner, seen: seenBy(owner) });
    const key = placesKey(owner);
    const elsewhere = (e: StorageEvent) => { if (e.key === key) again(); };
    addEventListener('storage', elsewhere);
    const stop = hearPlaces(owner, again);
    return () => { removeEventListener('storage', elsewhere); stop(); };
  }, [owner]);
  return read.seen;
}
