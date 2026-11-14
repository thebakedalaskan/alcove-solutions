/*
 * A document's versions (docs: Data and storage › Documents): the list anyone who can open it reads, one version streamed a
 * part at a time, keeping one now, and putting one back for anyone who can edit it.
 */
import { randomClient, type DocVersionSummary } from '@alcove/api';
import type { StreamingApi } from 'hono/utils/stream';
import { z } from 'zod';
import type { Deps } from '../../../platform/context';
import { b64u, openJson } from '../../../keys/crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../../platform/db';
import { ClientTakenError, ConflictError, UnavailableError, notFound } from '../../../platform/errors';
import { runDoc } from './pool';
import { publish, type Hub } from '../../../live/hub';
import { log } from '../../../platform/log';
import { change, isItemId, limitKey, requireDocument, workspaceFor, workspaceVersion, type Reader } from '../access';
import { StoredVersionInfo, openVersionPart, versionInfoHeader } from './work';
import { portraitFor } from '../../profile/portraits';
import {
  contentKey, atOf, type Place, type Keep, documentRow, fold, type Held, requireContent, lockDocument, DocRow, jobFor, writeSnapshot, settleFigures, kindOf, sealedLog, report, byLimits, tooLong,
  markOf, append, editorOf
} from './documents';
import { trafficOn, lineFor, takeSending, asAscii } from './traffic';
import { noteClients, nobody, requireNewClients, WRITE_TRIES, workedOutAgain } from './clients';
import { REPLACED } from './live';

const dlog = log.child({ component: 'documents' });
/** How long a restore can hold a document, in case the instance doing it goes. */
const HELD_SECONDS = 120;

/* ---------- versions ---------- */

const summarise = (id: string, at: Date, info: z.infer<typeof StoredVersionInfo>): DocVersionSummary => ({
  id, at: at.toISOString(), by: info.by.map((e) => ({ name: e.name, portrait: e.portrait ?? portraitFor(e.id) })), callId: info.callId, reason: info.reason
});
const VersionRow = z.object({ version_id: z.string(), info_ciphertext: bytea, created_at: timestamp, parts: z.number() });

export async function versions(d: Deps, reader: Reader, workspaceId: string, documentId: string): Promise<DocVersionSummary[]> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  const found = await rows(d.pool, VersionRow, 'SELECT version_id, info_ciphertext, created_at, parts FROM document_versions WHERE owner_id = $1 AND document_id = $2 ORDER BY created_at DESC, version_id', [w.owner.ownerId, documentId]);
  const key = contentKey(w.owner, documentId);
  return found.map((r) => summarise(r.version_id, r.created_at, openJson(key, versionInfoHeader(atOf(w, documentId), r.version_id), r.info_ciphertext, StoredVersionInfo)));
}

async function versionRow(p: Place, documentId: string, versionId: string): Promise<z.infer<typeof VersionRow>> {
  const none = () => notFound('That version', { workspaceId: p.workspaceId, documentId, versionId });
  if (!isItemId(versionId)) throw none();
  const r = await maybeOne(p.owner.pool, VersionRow, 'SELECT version_id, info_ciphertext, created_at, parts FROM document_versions WHERE owner_id = $1 AND document_id = $2 AND version_id = $3', [p.owner.ownerId, documentId, versionId]);
  if (!r) throw none();
  return r;
}
const PartRow = z.object({ state_ciphertext: bytea });
const partOf = async (p: Place, documentId: string, versionId: string, part: number): Promise<Uint8Array> => {
  const r = await maybeOne(p.owner.pool, PartRow, 'SELECT state_ciphertext FROM document_version_parts WHERE owner_id = $1 AND document_id = $2 AND version_id = $3 AND part = $4', [p.owner.ownerId, documentId, versionId, part]);
  if (!r) throw notFound('That version', { workspaceId: p.workspaceId, documentId, versionId });
  return r.state_ciphertext;
};

/** Reads of a version under way on each instance: each holds a request, and a reader can be as slow as they like. */
const versionReads = new WeakMap<Hub, { open: number }>();
function takeVersionRead(d: Deps): () => void {
  const reads = versionReads.get(d.hub) ?? { open: 0 };
  versionReads.set(d.hub, reads);
  const { sending } = trafficOn(d.hub);
  if (reads.open >= d.cfg.DOC_VERSION_READS || sending > d.cfg.DOC_SENDING_MB * 1024 * 1024) throw new UnavailableError('Too many documents are on their way right now. Try again in a moment.', { context: { open: reads.open, sending } });
  reads.open++;
  let holding = true;
  return () => { if (holding) { holding = false; reads.open--; } };
}

/**
 * A version as it's kept, a part at a time, so a reader who stops reading holds one part and no more. Nothing's written until
 * it's known they can have it, and it stops if they lose it on the way.
 */
export async function version(d: Deps, reader: Reader, workspaceId: string, documentId: string, versionId: string, address: string): Promise<(out: StreamingApi) => Promise<void>> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  const r = await versionRow(w, documentId, versionId);
  const key = contentKey(w.owner, documentId);
  const at = atOf(w, documentId);
  const summary = summarise(r.version_id, r.created_at, openJson(key, versionInfoHeader(at, r.version_id), r.info_ciphertext, StoredVersionInfo));
  const release = takeVersionRead(d);
  return async (out) => {
    const until = Date.now() + d.cfg.LIVE_STREAM_MS;
    try {
      if (!(await lineFor(d, out, `${JSON.stringify({ type: 'version', ...summary, parts: r.parts })}\n`))) return;
      let current = w;
      for (let part = 0; part < r.parts; part++) {
        if (out.aborted || Date.now() > until) { out.abort(); return; }
        if ((await workspaceVersion(d, workspaceId)) !== current.version) {
          current = await workspaceFor(d, reader, workspaceId);
          requireDocument(reader, current, documentId, 'read');
        }
        const bytes = openVersionPart(at, key, r.version_id, part, r.parts, await partOf(w, documentId, r.version_id, part));
        const room = takeSending(d, limitKey(reader), address, asAscii(bytes.length));
        const wrote = await lineFor(d, out, `{"type":"part","update":"${b64u(bytes)}"}\n`).finally(room.release);
        if (!wrote) return;
      }
    } catch (e) {
      dlog.info('version not sent to the end', { workspaceId, documentId, versionId, err: e });
      out.abort();
    } finally {
      release();
    }
  };
}

/** How often keeping a version tries again when a compaction got there first. */
const KEEP_TRIES = 4;
/** Keeps a version as it stands, unless the newest already says this. Its ID, or null when nothing changed since. */
async function keepNow(p: Place, documentId: string, keep: Keep): Promise<string | null> {
  for (let tries = 0; tries < KEEP_TRIES; tries++) {
    const row = await documentRow(p, documentId);
    if (row.next_seq - 1 <= row.version_seq) return null;
    const { raced, versionId } = await fold(p, documentId, row.next_seq - 1, keep);
    if (!raced) return versionId;
  }
  throw new ConflictError('This document is changing too fast to keep a version of. Try again.', { context: { workspaceId: p.workspaceId, documentId } });
}
/** Keeps a version of a document as it stands, with a call to file it under, if anything changed since the last one. Its ID, or null when nothing did. */
export function keepVersion(w: Held, documentId: string, keep: Keep): Promise<string | null> {
  requireContent(w, documentId);
  return keepNow(w, documentId, keep);
}

/** Nothing lands until this lets go: a restore reads the log and writes on top of it, and anything between the two would be undone with no version holding it. It's a mark and not a lock, because a big document takes a while, and everyone typing would each hold a connection waiting. */
async function hold(p: Place, documentId: string): Promise<void> {
  await tx(p.owner.pool, async (c) => {
    const row = await lockDocument(c, p, documentId);
    if (row.held) throw new ConflictError('Someone’s already putting this back to an earlier version.', { context: { workspaceId: p.workspaceId, documentId } });
    await exec(c, 'UPDATE documents SET held_until = now() + make_interval(secs => $3) WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId, HELD_SECONDS]);
  });
}
const letGo = (db: Db, p: Place, documentId: string) => exec(db, 'UPDATE documents SET held_until = NULL WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);

/**
 * What's there won't open, so there's nothing to merge with: the version becomes the document, and everyone's stream ends, for
 * them to open it afresh. Every Yjs client it has had stays had, as the server's, at what the version holds of it: nothing is
 * written as one again, by the server or anyone, so what's in other versions under it stays the only thing it ever said (a
 * board's template among them), and anything still in a browser from before is refused, because it would build on what's no
 * longer there.
 */
async function replaceWith(p: Place, documentId: string, row: DocRow, version: { versionId: string; parts: Uint8Array[] }): Promise<void> {
  const through = row.next_seq - 1;
  const made = await runDoc(p.owner.docs, 'reset', { at: atOf(p, documentId), key: contentKey(p.owner, documentId), through, version }, { ...jobFor(p, documentId, row), big: true });
  await tx(p.owner.pool, async (c) => {
    await lockDocument(c, p, documentId);
    await exec(c, 'DELETE FROM document_updates WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
    await exec(c, "UPDATE document_clients SET next_clock = 0, people = ''::bytea WHERE owner_id = $1 AND document_id = $2", [p.owner.ownerId, documentId]);
    await writeSnapshot(c, p, documentId, through, made.snapshot, made.editors);
    await noteClients(c, p, documentId, made.seen.blocks, nobody);
    await settleFigures(c, p, documentId, made.shape, through);
    await exec(c, 'UPDATE documents SET closed_until = NULL, held_until = NULL WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
    await publish(c, p.workspaceId, `${documentId}:${REPLACED}`);
  });
  dlog.warn('document replaced by a version, as it wouldn’t open', { workspaceId: p.workspaceId, documentId, versionId: version.versionId });
}
/**
 * Makes a document what it was, for everyone, as one update. What it says now is kept as a version first, unless the newest
 * version already says it, and nothing lands between that and the restore, so whatever this undoes is in a version. Anyone
 * typing waits a moment, and merges with it. The tree's name follows its title: a browser renames what it types, and this
 * wasn't typed. It won't make a document bigger than it can be: then nobody could type in it.
 */
export async function restoreVersion(d: Deps, reader: Reader, workspaceId: string, documentId: string, versionId: string): Promise<void> {
  const w = await workspaceFor(d, reader, workspaceId);
  const kind = kindOf(requireDocument(reader, w, documentId, 'edit').item);
  const v = await versionRow(w, documentId, versionId);
  const parts = await Promise.all(Array.from({ length: v.parts }, (_, part) => partOf(w, documentId, versionId, part)));
  await hold(w, documentId);
  try {
    const before = await documentRow(w, documentId);
    if (before.closed) {
      await replaceWith(w, documentId, before, { versionId, parts });
      return;
    }
    await keepNow(w, documentId, { reason: 'restore', callId: reader.seat?.callId ?? null });
    // What's new in it is written as a client of its own, as anything the server changes is: one taken by chance is worked out again.
    for (let tries = 1; ; tries++) {
      const row = await documentRow(w, documentId);
      const log = await sealedLog(w, documentId);
      const made = await runDoc(d.docs, 'restore', { ...log, version: { versionId, parts }, kind, as: randomClient() }, jobFor(w, documentId, row, limitKey(reader)));
      report(w, documentId, made.found);
      if (byLimits(w, made.shape.bytes, made.shape.items - made.shape.retired)) throw tooLong(w, documentId, made.shape.bytes, made.shape.items);
      const name = made.title.replace(/\s+/g, ' ').trim().slice(0, 200);
      try {
        await change(d, reader, workspaceId, async (locked, c) => {
          const { item } = requireDocument(reader, locked, documentId, 'edit');
          const at = await lockDocument(c, locked, documentId);
          if (made.seen.blocks.length || made.seen.deletes.length) {
            await requireNewClients(c, locked, documentId, at, { read: markOf(log), clients: made.seen.blocks.some((b) => b.client === made.as) ? [made.as] : [], what: 'restore' });
            await append(c, locked, documentId, at, made.update, editorOf(locked.owner, reader), made.seen, nobody);
          }
          await letGo(c, locked, documentId);
          if (name && name !== item.name) locked.state = { ...locked.state, items: { ...locked.state.items, [documentId]: { ...item, name, editedAt: new Date().toISOString() } } };
        });
        break;
      } catch (e) {
        if (!(e instanceof ClientTakenError) || tries >= WRITE_TRIES) throw e;
        workedOutAgain(workspaceId, documentId, 'restore', tries);
      }
    }
    dlog.info('document restored', { workspaceId, documentId, versionId });
  } finally {
    await letGo(d.pool, w, documentId).catch((e: unknown) => dlog.warn('a restore’s hold wasn’t let go of', { workspaceId, documentId, err: e }));
  }
}
