/*
 * Opening a document: what's kept for it on this device goes with it, so edits made offline survive a reload and send on
 * return. The page holds one for as long as the document's open; anything else opens one just long enough to make a change.
 * This is the only place that asks for one, and everyone waits for it, so it can take a moment to load what it needs.
 *
 * SEAM, until feat/ws-docs-2 is on main. That fix round gives a session `localCopy`, `size` and `discardUnsaved`, its status
 * `unsent`, the contract `MAX_DOC_ITEMS`, and the API `saveCopy`. These are their shapes, and `unsent.ts` works them out from
 * what main has. When it lands: the types and `MAX_DOC_ITEMS` come from `@alcove/api`, `openDocument` returns what
 * `document()` gives, `useSaveCopy` calls `api.workspaces.saveCopy`, and `unsent.ts` goes.
 */
import type { DocSession as SessionNow, DocStatus as StatusNow } from '@alcove/api';
import type { Doc } from 'yjs';
import { api } from '~/lib/api';
import { canKeepEdits, keptUpdates } from './keep';

/** `unsent`: something here hasn't reached Alcove. With `refused` or `closed`, it may not get there by itself. */
export interface DocStatus extends StatusNow { unsent: boolean }
/** Everything in a document as it stands here. `text`: to read or copy, a line to a block. `state`: to save as a new document. */
export interface DocLocalCopy { text: string; state: Uint8Array }
/** How much a document holds here, beside `MAX_DOC_BYTES` and `MAX_DOC_ITEMS`. `items`: what's on its page. */
export interface DocSize { bytes: number; items: number }
export interface DocSession extends Omit<SessionNow, 'getSnapshot'> {
  getSnapshot(): DocStatus;
  /** What's here now, for someone whose words aren't reaching Alcove, however the session ended, until `close()`. */
  localCopy(): DocLocalCopy;
  /** What this document comes to here, for the editor to check a paste against the limits. */
  size(): DocSize;
  /** Lets go of everything unsent, here and in what's kept, and closes the session: only for someone who chose to. */
  discardUnsaved(): Promise<void>;
}
/** How many items a document's page can hold. */
export const MAX_DOC_ITEMS = 150_000;

export async function openDocument(workspaceId: string, documentId: string, owner: string | null, pass: string | undefined): Promise<DocSession> {
  const keep = owner && canKeepEdits() ? keptUpdates(owner, workspaceId, documentId) : undefined;
  const { holding, withUnsent } = await import('./unsent');
  const held = keep && holding(keep);
  const session = await api.workspaces.document(workspaceId, documentId, { pass, keep: held?.keep });
  held?.watch(session);
  return withUnsent(session, keep);
}

/** Opens a document, makes a change, and lets it go: closing sends what's waiting, and what can't go yet stays kept. */
export async function withDocument(workspaceId: string, documentId: string, owner: string | null, pass: string | undefined, work: (doc: Doc) => void | Promise<void>): Promise<void> {
  const session = await openDocument(workspaceId, documentId, owner, pass);
  try {
    await session.ready;
    await work(session.doc);
  } finally {
    session.close();
  }
}
