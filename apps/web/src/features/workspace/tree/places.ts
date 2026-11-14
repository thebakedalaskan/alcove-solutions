/*
 * Where someone was in their workspaces, remembered in this browser for each account and only by ID (nothing readable):
 * the documents they last had open in each, the folders they left open, and whether the list is tucked away. It goes when they sign out here or delete their account. A guest in a call has no account, so
 * nothing's kept for them.
 */
import { WorkspacePlacesSchema, type WorkspacePlaces } from '@alcove/api';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { log } from '~/lib/log';

const plog = log.child({ component: 'workspace' });
const NOWHERE: WorkspacePlaces = { documents: {}, recent: {}, folders: {}, listOff: false };
/** How many documents Find remembers opening in each workspace. */
const RECENT = 12;
const keyOf = (owner: string) => `alcove.workspace.${owner}`;

export function placesOf(owner: string | null | undefined): WorkspacePlaces {
  if (!owner) return NOWHERE;
  try {
    const raw = localStorage.getItem(keyOf(owner));
    if (raw === null) return NOWHERE;
    const read = WorkspacePlacesSchema.safeParse(JSON.parse(raw));
    return read.success ? read.data : NOWHERE;
  } catch (e) {
    plog.warn('couldn’t read where you were in your workspaces', { err: e });
    return NOWHERE;
  }
}

export function rememberPlaces(owner: string | null | undefined, change: (was: WorkspacePlaces) => WorkspacePlaces): void {
  if (!owner) return;
  try { localStorage.setItem(keyOf(owner), JSON.stringify(change(placesOf(owner)))); } catch (e) { plog.debug('this browser’s storage is unavailable', { err: e }); }
}

/** Whether you've tucked the list away, as you left it last: remembered as it changes. */
export function useOwnListOff(owner: string | null): [boolean, Dispatch<SetStateAction<boolean>>] {
  const [listOff, setListOff] = useState(() => placesOf(owner).listOff);
  useEffect(() => { rememberPlaces(owner, (p) => ({ ...p, listOff })); }, [owner, listOff]);
  return [listOff, setListOff];
}

/** A document was opened: it's the first thing Find offers next time. */
export const openedIn = (was: WorkspacePlaces, workspaceId: string, documentId: string): WorkspacePlaces => ({
  ...was, documents: { ...was.documents, [workspaceId]: documentId },
  recent: { ...was.recent, [workspaceId]: [documentId, ...(was.recent[workspaceId] ?? []).filter((id) => id !== documentId)].slice(0, RECENT) }
});

/** The account is gone from this browser, and so is what it remembered for it. */
export function forgetPlaces(owner: string): void {
  try { localStorage.removeItem(keyOf(owner)); } catch (e) { plog.debug('this browser’s storage is unavailable', { err: e }); }
}
