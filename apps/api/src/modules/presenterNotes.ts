/*
 * What someone keeps beside a document for presenting it, and beside each frame of a board (docs: Data and storage ›
 * Presenter notes). They're theirs alone: sealed under their own account's keys, whoever else can open the document, and
 * bound to the workspace and the document, and a frame's to its frame, so a record can't be moved to another. Reaching them
 * needs the document, by the same rule as everything else in a workspace, and an account to keep them under, which someone in
 * a call by its link doesn't have.
 */
import { MAX_FRAMES_NOTED, type PresenterFrameNotes, type PresenterNotes } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, equalBytes, fromUtf8, mac, openJson, openRecord, sealJson, sealRecord, stateKey, utf8, type RecordHeader } from '../crypto';
import { bytea, exec, maybeOne, rows } from '../db';
import { ConflictError, ForbiddenError, IntegrityError, notFound } from '../errors';
import { log } from '../log';
import { requireDocument, workspaceFor, type Reader, type Workspace } from './workspaceAccess';

const plog = log.child({ component: 'presenter-notes' });

const key = (o: Owner, documentId: string): Uint8Array => stateKey(o.root, o.ownerId, `presenter-notes:${documentId}`);
const header = (o: Owner, workspaceId: string, documentId: string): RecordHeader => ({ v: 1, kind: 'presenter-notes', ownerId: o.ownerId, workspaceId, documentId });
const Row = z.object({ body_ciphertext: bytea });

/** A document someone can open, and the account to keep their notes on it under. With `board`, it has to be a board. */
async function reach(d: Deps, reader: Reader, workspaceId: string, documentId: string, board = false): Promise<{ o: Owner; w: Workspace }> {
  const w = await workspaceFor(d, reader, workspaceId);
  const { item } = requireDocument(reader, w, documentId, 'read');
  if (board && item.kind !== 'board') throw notFound('That board', { workspaceId, documentId });
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

/* ---------- a board's, frame by frame ---------- */

const frameKey = (o: Owner, boardId: string): Uint8Array => stateKey(o.root, o.ownerId, `presenter-frame-notes:${boardId}`);
/** Which frame a row is: a keyed hash under the account's own key, so nothing a browser named is kept in the clear. */
const frameIndex = (k: Uint8Array, frame: string): Uint8Array => mac(k, utf8(`frame:${frame}`));
const frameHeader = (o: Owner, workspaceId: string, boardId: string, index: Uint8Array): RecordHeader =>
  ({ v: 1, kind: 'presenter-frame-notes', ownerId: o.ownerId, workspaceId, documentId: boardId, frame: b64u(index) });
/** What a frame's record holds: the frame, so a board's notes come back by frame, and what's kept beside it. */
const FrameNote = z.object({ frame: z.string(), text: z.string() });
const FrameRow = z.object({ frame_index: bytea, body_ciphertext: bytea });

/** Someone's notes beside each frame of a board, by frame. A record that isn't for the frame its row is for doesn't open. */
export async function readFrames(d: Deps, reader: Reader, workspaceId: string, boardId: string): Promise<PresenterFrameNotes> {
  const { o, w } = await reach(d, reader, workspaceId, boardId, true);
  const k = frameKey(o, boardId);
  const kept = await rows(d.pool, FrameRow, 'SELECT frame_index, body_ciphertext FROM presenter_frame_notes WHERE owner_id = $1 AND workspace_owner_id = $2 AND document_id = $3', [o.ownerId, w.owner.ownerId, boardId]);
  const frames: Record<string, string> = {};
  for (const r of kept) {
    const note = openJson(k, frameHeader(o, workspaceId, boardId, r.frame_index), r.body_ciphertext, FrameNote);
    if (!equalBytes(frameIndex(k, note.frame), r.frame_index)) throw new IntegrityError('A frame’s notes aren’t that frame’s.', { context: { workspaceId, documentId: boardId } });
    frames[note.frame] = note.text;
  }
  return { frames };
}

/**
 * Keeps one frame's notes, or with nothing in them, keeps nothing. Up to `MAX_FRAMES_NOTED` frames of a board have them: a
 * frame past that is refused, and the ones kept can still change. Two new ones at once can take it one past.
 */
export async function writeFrame(d: Deps, reader: Reader, workspaceId: string, boardId: string, frame: string, text: string): Promise<void> {
  const { o, w } = await reach(d, reader, workspaceId, boardId, true);
  const k = frameKey(o, boardId);
  const index = frameIndex(k, frame);
  const where = [o.ownerId, w.owner.ownerId, boardId, index];
  if (!text) {
    await exec(d.pool, 'DELETE FROM presenter_frame_notes WHERE owner_id = $1 AND workspace_owner_id = $2 AND document_id = $3 AND frame_index = $4', where);
    plog.debug('frame notes cleared', { workspaceId, documentId: boardId });
    return;
  }
  const Counted = z.object({ n: z.number(), here: z.boolean() });
  const counted = await maybeOne(d.pool, Counted, `SELECT count(*)::int AS n, coalesce(bool_or(frame_index = $4), false) AS here FROM presenter_frame_notes
                                                   WHERE owner_id = $1 AND workspace_owner_id = $2 AND document_id = $3`, where);
  if (counted && counted.n >= MAX_FRAMES_NOTED && !counted.here) {
    throw new ConflictError(`You keep notes beside ${MAX_FRAMES_NOTED} frames of this board already. Clear some to add more.`, { context: { workspaceId, documentId: boardId }, level: 'info' });
  }
  await exec(d.pool, `INSERT INTO presenter_frame_notes (owner_id, workspace_owner_id, document_id, frame_index, body_ciphertext) VALUES ($1,$2,$3,$4,$5)
                      ON CONFLICT (owner_id, workspace_owner_id, document_id, frame_index) DO UPDATE SET body_ciphertext = EXCLUDED.body_ciphertext`,
  [...where, sealJson(k, frameHeader(o, workspaceId, boardId, index), { frame, text })]);
  plog.debug('frame notes kept', { workspaceId, documentId: boardId, bytes: text.length });
}
