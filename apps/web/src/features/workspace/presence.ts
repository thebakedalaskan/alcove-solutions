/*
 * Who's where, from the workspace's stream. A connection is a window, so someone with two open is two entries in `here`; on
 * screen they're one person, at whichever of their windows says most. What the stream sends is already what you may know:
 * a document you can't open comes as `elsewhere`, with nothing to name it by. And where you are, which this window tells it.
 */
import type { CallPage, Person, WorkspaceHere, WorkspaceLive, WorkspaceWhere } from '@alcove/api';
import { useCallback, useEffect, useRef } from 'react';

/** Someone else here, as one person however many windows they have open. `page`: the call's own page they're on, said only to someone in that call. */
export interface Someone { person: Person; document: string | null; block: string | null; typing: boolean; elsewhere: boolean; callIdentity: string | null; page: CallPage | null }

/** What one of the call's own pages is called. */
export const pageName = (p: CallPage): string => (p === 'notes' ? 'Notes' : p === 'follow-ups' ? 'Follow-ups' : 'Transcript');

/** Which of someone's windows to go by: the one they're typing in, then one with something open, then the last that moved, which comes last. */
const weight = (h: WorkspaceHere): number => (h.typing ? 3 : h.document !== null || h.page !== null ? 2 : h.elsewhere ? 1 : 0);

/** Everyone but you, each once. */
export function othersIn(here: readonly WorkspaceHere[]): Someone[] {
  const best = new Map<string, WorkspaceHere>();
  for (const h of here) {
    if (h.isMe) continue;
    const was = best.get(h.person.id);
    if (!was || weight(h) >= weight(was)) best.set(h.person.id, h);
  }
  return [...best.values()].map(({ person, document, block, typing, elsewhere, callIdentity, page }) => ({ person, document, block, typing, elsewhere, callIdentity, page }));
}

/** Who else has a document open, each once, in any of their windows. */
export function facesIn(here: readonly WorkspaceHere[], document: string): Person[] {
  const seen = new Map<string, Person>();
  for (const h of here) if (!h.isMe && h.document === document) seen.set(h.person.id, h.person);
  return [...seen.values()];
}

/** Where you are, as a page and the editor say it: whom you follow goes with it (`usePresence`). */
export type SaidPlace = Omit<WorkspaceWhere, 'following'>;

/**
 * Everyone can see you're in a document from the moment it's open, and that you've left once it's out of sight. The editor
 * says which line through what this returns, which says nothing while the workspace is out of sight. Whom you follow
 * (`following`, by `person.id`) goes with it, so they know you're with them; saying so again keeps the line last said.
 */
export function usePresence(store: WorkspaceLive, document: string | null, page: CallPage | null, closed: boolean, following: string | null): (where: SaidPlace) => void {
  const followingNow = useRef(following);
  followingNow.current = following;
  const said = useRef<SaidPlace>({ document: null, block: null, typing: false, page: null });
  useEffect(() => {
    said.current = { document: closed ? null : document, block: null, typing: false, page: closed ? null : page };
    store.present({ ...said.current, following: followingNow.current });
  }, [store, document, page, closed]);
  useEffect(() => { store.present({ ...said.current, following }); }, [store, following]);
  const closedNow = useRef(closed);
  closedNow.current = closed;
  return useCallback((where: SaidPlace) => {
    if (closedNow.current) return;
    said.current = where;
    store.present({ ...where, following: followingNow.current });
  }, [store]);
}
