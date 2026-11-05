/*
 * What someone keeps beside a document for presenting it (docs: Data and storage › Presenter notes). They're theirs alone:
 * sealed under their own account's keys, whoever else can open the document, and bound to the workspace and the document, so
 * a record can't be moved to another. Reaching them needs the document, by the same rule as everything else in a workspace,
 * and an account to keep them under, which someone in a call by its link doesn't have.
 */
import type { PresenterNotes } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { fromUtf8, openRecord, sealRecord, stateKey, utf8, type RecordHeader } from '../crypto';
import { bytea, exec, maybeOne } from '../db';
import { ForbiddenError } from '../errors';
import { log } from '../log';
import { requireDocument, workspaceFor, type Reader, type Workspace } from './workspaceAccess';

const plog = log.child({ component: 'presenter-notes' });

const key = (o: Owner, documentId: string): Uint8Array => stateKey(o.root, o.ownerId, `presenter-notes:${documentId}`);
const header = (o: Owner, workspaceId: string, documentId: string): RecordHeader => ({ v: 1, kind: 'presenter-notes', ownerId: o.ownerId, workspaceId, documentId });
const Row = z.object({ body_ciphertext: bytea });

/** A document someone can open, and the account to keep their notes on it under. */
async function reach(d: Deps, reader: Reader, workspaceId: string, documentId: string): Promise<{ o: Owner; w: Workspace }> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  if (!reader.account) throw new ForbiddenError('You joined with the link, so there’s no account to keep notes under.', { context: { workspaceId, documentId } });
  return { o: reader.account.owner, w };
}

export async function read(d: Deps, reader: Reader, workspaceId: string, documentId: string): Promise<PresenterNotes> {
  const { o, w } = await reach(d, reader, workspaceId, documentId);
  const row = await maybeOne(d.pool, Row, 'SELECT body_ciphertext FROM presenter_notes WHERE owner_id = $1 AND workspace_owner_id = $2 AND document_id = $3', [o.ownerId, w.owner.ownerId, documentId]);
  return { text: row ? fromUtf8(openRecord(key(o, documentId), header(o, workspaceId, documentId), row.body_ciphertext)) : '' };
}

/** Keeps them, or with nothing in them, keeps nothing. */
export async function write(d: Deps, reader: Reader, workspaceId: string, documentId: string, text: string): Promise<void> {
  const { o, w } = await reach(d, reader, workspaceId, documentId);
  const where = [o.ownerId, w.owner.ownerId, documentId];
  if (!text) await exec(d.pool, 'DELETE FROM presenter_notes WHERE owner_id = $1 AND workspace_owner_id = $2 AND document_id = $3', where);
  else {
    await exec(d.pool, `INSERT INTO presenter_notes (owner_id, workspace_owner_id, document_id, body_ciphertext) VALUES ($1,$2,$3,$4)
                        ON CONFLICT (owner_id, workspace_owner_id, document_id) DO UPDATE SET body_ciphertext = EXCLUDED.body_ciphertext`, [...where, sealRecord(key(o, documentId), header(o, workspaceId, documentId), utf8(text))]);
  }
  plog.debug('presenter notes kept', { workspaceId, documentId, bytes: text.length });
}
