/*
 * Opening a document: what's kept for it on this device goes with it, so edits made offline survive a reload and send on
 * return. The page holds one for as long as the document's open; anything else opens one just long enough to make a change.
 * This is the only place that asks for one, and everyone waits for it, so it can take a moment to load what it needs.
 */
import type { DocSession } from '@alcove/api';
import type { Doc } from 'yjs';
import { api } from '~/lib/api';
import { canKeepEdits, keptUpdates } from './keep';

/** `keep` false: nothing it writes is kept on this device, for a session that only says how an upload's going. */
export async function openDocument(workspaceId: string, documentId: string, owner: string | null, pass: string | undefined, keep = true): Promise<DocSession> {
  return api.workspaces.document(workspaceId, documentId, { pass, keep: keep && owner && canKeepEdits() ? keptUpdates(owner, workspaceId, documentId) : undefined });
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
