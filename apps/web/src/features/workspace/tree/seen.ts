/*
 * What's new to you in a workspace: what someone else made in the last ten minutes, until you open it. Full screen, its row
 * in the list says New. What you made never does: Alcove says what's yours (`WorkspaceItem.mine`). What you open is kept in
 * this browser for your account, with where you were (places.ts), wherever it opens: on the page, full screen or beside the
 * Drive; in a call's workspace; or as a board on your stage in a call (call/boards/callBoard.ts). Another device doesn't
 * know, so something opened only there says New here until its ten minutes are up.
 */
import type { WorkspaceItem, WorkspacePlaces } from '@alcove/api';
import { useEffect, useState } from 'react';
import { placesKey, placesOf, rememberPlaces } from './places';

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

/**
 * What's been opened here lately, for the list to say New by: read as it's drawn, and again as another tab of this browser
 * opens something, such as a board on a call's stage. Nothing without an account.
 */
export function useSeen(owner: string | null): Readonly<Record<string, number>> {
  const [, heard] = useState(0);
  useEffect(() => {
    if (owner === null) return undefined;
    const key = placesKey(owner);
    const changed = (e: StorageEvent) => { if (e.key === key) heard((n) => n + 1); };
    addEventListener('storage', changed);
    return () => removeEventListener('storage', changed);
  }, [owner]);
  return owner === null ? NOTHING : placesOf(owner).seen;
}
