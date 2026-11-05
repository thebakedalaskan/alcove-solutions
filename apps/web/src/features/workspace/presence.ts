/*
 * Who's where, from the workspace's stream. A connection is a window, so someone with two open is two entries in `here`; on
 * screen they're one person, at whichever of their windows says most. What the stream sends is already what you may know:
 * a document you can't open comes as `elsewhere`, with nothing to name it by.
 */
import type { Person, WorkspaceHere } from '@alcove/api';

/** Someone else here, as one person however many windows they have open. */
export interface Someone { person: Person; document: string | null; block: string | null; typing: boolean; elsewhere: boolean; callIdentity: string | null }

/** Which of someone's windows to go by: the one they're typing in, then one with something open, then the last that moved, which comes last. */
const weight = (h: WorkspaceHere): number => (h.typing ? 3 : h.document !== null ? 2 : h.elsewhere ? 1 : 0);

/** Everyone but you, each once. */
export function othersIn(here: readonly WorkspaceHere[]): Someone[] {
  const best = new Map<string, WorkspaceHere>();
  for (const h of here) {
    if (h.isMe) continue;
    const was = best.get(h.person.id);
    if (!was || weight(h) >= weight(was)) best.set(h.person.id, h);
  }
  return [...best.values()].map(({ person, document, block, typing, elsewhere, callIdentity }) => ({ person, document, block, typing, elsewhere, callIdentity }));
}

/** Who else has a document open, each once, in any of their windows. */
export function facesIn(here: readonly WorkspaceHere[], document: string): Person[] {
  const seen = new Map<string, Person>();
  for (const h of here) if (!h.isMe && h.document === document) seen.set(h.person.id, h.person);
  return [...seen.values()];
}
