/*
 * What a document or board holds (docs: Data and storage › Documents). Its content is a Yjs document, which this module
 * keeps without looking inside: each update from a browser is sealed and appended to a log under the `documents` row's
 * lock, the log folds into one sealed snapshot now and then, and whole states are kept as versions. Yjs updates can arrive
 * twice and in any order, so nothing here needs a receipt. Who can do what is modules/workspaceAccess.ts's to say.
 *
 * The row's lock is held only to write: taking a `seq`, sealing one update, swapping in a snapshot someone already worked
 * out. Reading a document and working on it happens outside it, so nobody's typing waits on someone else's big document.
 *
 * Only `searchText` and what's in documentText.ts read what's inside, and they say what they read by `kind`, so a board can
 * say its own. Everything else is the same for anything that holds a Y.Doc.
 *
 * Server code reads and writes a document with `readDocument` and `writeDocument`: what it writes goes through the same log
 * and reaches every browser as any other update.
 */
import {
  DOC_FRAGMENT, DOC_SEED, MAX_DOC_AWARENESS_BYTES, MAX_DOC_BYTES, MAX_DOC_UPDATE_BYTES, PortraitStyleSchema, SearchDocSchema, type DocClosed, type DocLiveEvent, type DocVersionReason, type DocVersionSummary, type SearchDoc
} from '@alcove/api';
import type { StreamingApi } from 'hono/utils/stream';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type pg from 'pg';
import * as Y from 'yjs';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, fromUtf8, id128, openJson, openRecord, sealJson, sealRecord, stateKey, toJson, unb64u, utf8, type RecordHeader } from '../crypto';
import { bigintText, bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { AppError, ConflictError, ForbiddenError, UnavailableError, ValidationError, notFound } from '../errors';
import { publish, type Hub, type HubEvent } from '../live/hub';
import { roomFor, type Room, type Snapshot } from '../live/room';
import { LiveStream, type Line, type Step } from '../live/stream';
import { log } from '../log';
import { findOwner } from '../owners';
import {
  change, limitKey, personIn, requireDocument, roleOf, standingIn, trashOf, workspaceFor, workspaceKey, type Credentials, type Reader, type StoredItem, type Who, type Workspace
} from './workspaceAccess';
import { documentText, type ContentKind } from './documentText';
import { portraitFor } from './portraits';

const dlog = log.child({ component: 'documents' });

/** How much of a log folds into a snapshot, whichever comes first. */
const COMPACT_UPDATES = 200;
const COMPACT_BYTES = 1024 * 1024;
/** A version is kept at most this often while people edit. */
const VERSION_EVERY_MS = 10 * 60_000;
/** What a document keeps of its past: older versions go, so a document edited for months stays a size that can be stored. The newest always stays. */
const MAX_VERSIONS = 200;
const MAX_VERSION_BYTES = 64 * 1024 * 1024;
/** How long the tree's `editedAt` may lag what's been typed, so nobody rewrites the tree for every key. */
const TOUCH_EVERY_MS = 60_000;
/** The most carets one update speaks for: a browser has one, and each must fit in a notice with who it is. */
const MAX_AWARENESS_CLIENTS = 4;
/** Yjs's update that says nothing. */
const NOTHING = new Uint8Array([0, 0]);

/*
 * An instance serves hundreds of streams in a little memory, and a Y.Doc takes many times the size of what it was read
 * from. So documents of any size are read a few at a time, and there's a limit to how much of them can be on its way to
 * browsers at once: past it, opening another waits for the browser to try again.
 */
const BIG_DOC_BYTES = 256 * 1024;
const BIG_DOCS_AT_ONCE = 2;
const SENDING_BYTES = 64 * 1024 * 1024;

/** Takes turns: at most `n` at once, first come first served. */
class Turns {
  private readonly waiting: (() => void)[] = [];
  private busy = 0;
  constructor(private readonly n: number) {}
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.busy < this.n) this.busy++;
    else await new Promise<void>((go) => { this.waiting.push(go); });
    try {
      return await work();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.busy--;
    }
  }
}
const bigDocs = new Turns(BIG_DOCS_AT_ONCE);
const inTurn = <T>(bytes: number, work: () => Promise<T>): Promise<T> => (bytes > BIG_DOC_BYTES ? bigDocs.run(work) : work());
const sending = { bytes: 0 };

export const kindOf = (item: StoredItem): ContentKind => (item.kind === 'board' ? 'board' : 'document');

/** Where something's kept: a workspace and its keys, opened for this request. */
export type Place = Pick<Workspace, 'owner' | 'workspaceId'>;
/** That, and its tree, to say what kind of thing something is. */
export type Held = Pick<Workspace, 'owner' | 'workspaceId' | 'state'>;

function requireContent(w: Held, documentId: string): void {
  const item = w.state.items[documentId];
  if (!item || item.kind === 'folder') throw notFound('That document', { workspaceId: w.workspaceId, documentId });
}

/* ---------- records ---------- */

/** Someone who changed a document, as a version names them. Never an address. */
const EditorSchema = z.object({ id: z.string(), name: z.string(), portrait: PortraitStyleSchema.optional().catch(undefined) });
export type Editor = z.infer<typeof EditorSchema>;
export const editorOf = (o: Owner, r: Reader): Editor => {
  const { id, name, portrait } = personIn(o, r);
  return { id, name, ...(portrait ? { portrait } : {}) };
};

const contentKey = (o: Owner, documentId: string): Uint8Array => stateKey(o.root, o.ownerId, `document:${documentId}`);
const at = (p: Place, documentId: string) => ({ v: 1 as const, ownerId: p.owner.ownerId, workspaceId: p.workspaceId, documentId });
const updateHeader = (p: Place, documentId: string, seq: number): RecordHeader => ({ ...at(p, documentId), kind: 'document-update', seq });
const snapshotHeader = (p: Place, documentId: string, throughSeq: number): RecordHeader => ({ ...at(p, documentId), kind: 'document-snapshot', throughSeq });
const editorsHeader = (p: Place, documentId: string, throughSeq: number): RecordHeader => ({ ...at(p, documentId), kind: 'document-editors', throughSeq });
const versionHeader = (p: Place, documentId: string, versionId: string, part: 'info' | 'state'): RecordHeader => ({ ...at(p, documentId), kind: 'document-version', versionId, part });
const awarenessHeader = (p: Place, documentId: string): RecordHeader => ({ ...at(p, documentId), kind: 'document-awareness' });

/** One update as it's kept, with who sent it, for the next version to say. */
const StoredUpdate = z.object({ by: EditorSchema.nullable().default(null), update: z.string() });
const StoredEditors = z.array(EditorSchema);
const StoredVersionInfo = z.object({ by: z.array(EditorSchema).default([]), callId: z.string().nullable().default(null), reason: z.enum(['edits', 'call', 'restore']).default('edits') });

/* ---------- the log ---------- */

interface Logged { seq: number; update: Uint8Array; by: Editor | null }
interface Base { throughSeq: number; state: Uint8Array; editors: Editor[] }
/** A document's log: what it starts from, if anything, and what came after that. */
interface DocLog { base: Base | null; rows: Logged[]; head: number }

const LogRow = z.object({ seq: bigintText, update_ciphertext: bytea });
const BaseRow = z.object({ through_seq: bigintText, snapshot_ciphertext: bytea, editors_ciphertext: bytea });

/** The whole log. The rows come first and the snapshot second: a compaction between the two leaves rows the snapshot also has, which Yjs doesn't mind, and never a gap. */
async function readLog(p: Place, documentId: string): Promise<DocLog> {
  const key = contentKey(p.owner, documentId);
  const found = await rows(p.owner.pool, LogRow, 'SELECT seq, update_ciphertext FROM document_updates WHERE owner_id = $1 AND document_id = $2 ORDER BY seq', [p.owner.ownerId, documentId]);
  const logged = found.map((r): Logged => {
    const stored = openJson(key, updateHeader(p, documentId, r.seq), r.update_ciphertext, StoredUpdate);
    return { seq: r.seq, update: unb64u(stored.update), by: stored.by };
  });
  const row = await maybeOne(p.owner.pool, BaseRow, 'SELECT through_seq, snapshot_ciphertext, editors_ciphertext FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
  const base = row ? {
    throughSeq: row.through_seq, state: openRecord(key, snapshotHeader(p, documentId, row.through_seq), row.snapshot_ciphertext),
    editors: openJson(key, editorsHeader(p, documentId, row.through_seq), row.editors_ciphertext, StoredEditors)
  } : null;
  return { base, rows: logged, head: Math.max(logged.at(-1)?.seq ?? 0, base?.throughSeq ?? 0) };
}

/**
 * The state a log comes to. Going through a Y.Doc rather than `Y.mergeUpdates` lets go of what was deleted: only that it's
 * gone is kept, so a word someone took out isn't sent to the next person who opens it. A client that was offline still
 * merges, because a deleted thing keeps its place in the sequence, and whatever someone typed inside something that was
 * deleted goes with it, as it would have anyway.
 */
function docFrom(l: Pick<DocLog, 'base' | 'rows'>): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    if (l.base) Y.applyUpdate(doc, l.base.state);
    for (const r of l.rows) Y.applyUpdate(doc, r.update);
  });
  return doc;
}

const DocRow = z.object({ next_seq: bigintText, updates_since_snapshot: z.number(), bytes_since_snapshot: bigintText, snapshot_bytes: bigintText, version_seq: bigintText, version_at: timestamp.nullable(), created_at: timestamp });
type DocRow = z.infer<typeof DocRow>;
const DOC_COLUMNS = 'next_seq, updates_since_snapshot, bytes_since_snapshot, snapshot_bytes, version_seq, version_at, created_at';
/** Holds a document's row: everything that writes to its log takes turns here, on every instance. Hold it only to write. */
async function lockDocument(c: pg.PoolClient, p: Place, documentId: string): Promise<DocRow> {
  const row = await maybeOne(c, DocRow, `SELECT ${DOC_COLUMNS} FROM documents WHERE owner_id = $1 AND document_id = $2 FOR NO KEY UPDATE`, [p.owner.ownerId, documentId]);
  if (!row) throw notFound('That document', { workspaceId: p.workspaceId, documentId });
  return row;
}
async function documentRow(p: Place, documentId: string): Promise<DocRow> {
  const row = await maybeOne(p.owner.pool, DocRow, `SELECT ${DOC_COLUMNS} FROM documents WHERE owner_id = $1 AND document_id = $2`, [p.owner.ownerId, documentId]);
  if (!row) throw notFound('That document', { workspaceId: p.workspaceId, documentId });
  return row;
}
const sizeOf = (row: DocRow): number => row.snapshot_bytes + row.bytes_since_snapshot;

async function writeSnapshot(db: Db, p: Place, documentId: string, throughSeq: number, state: Uint8Array, editors: Editor[]): Promise<void> {
  const key = contentKey(p.owner, documentId);
  await exec(db, `INSERT INTO document_snapshots (owner_id, document_id, through_seq, snapshot_ciphertext, editors_ciphertext) VALUES ($1,$2,$3,$4,$5)
                  ON CONFLICT (owner_id, document_id) DO UPDATE SET through_seq = EXCLUDED.through_seq, snapshot_ciphertext = EXCLUDED.snapshot_ciphertext, editors_ciphertext = EXCLUDED.editors_ciphertext`, [
    p.owner.ownerId, documentId, throughSeq, sealRecord(key, snapshotHeader(p, documentId, throughSeq), state), sealJson(key, editorsHeader(p, documentId, throughSeq), toJson(editors))
  ]);
}

const byId = (editors: Editor[]): Editor[] => [...new Map(editors.map((e) => [e.id, e])).values()];
const SnapshotAt = z.object({ through_seq: bigintText });
interface Keep { reason: DocVersionReason; callId: string | null }

/**
 * Folds the log through `through` into a snapshot, with a version kept of it if asked: a whole state, so that it opens
 * whatever happens to the log after it. A version says who changed the document since the last one, and that starts over.
 *
 * The work happens outside any lock, because what's in the log up to `through` never changes. The row's lock is taken only
 * to swap it in, and only if the snapshot is still the one this started from: otherwise someone else folded it first, on
 * this instance or another, and nothing is written. That's `raced`.
 */
async function fold(p: Place, documentId: string, through: number, keep?: Keep): Promise<{ raced: boolean; versionId: string | null }> {
  const l = await readLog(p, documentId);
  const from = l.base?.throughSeq ?? null;
  const reach = Math.max(through, from ?? 0);
  if (!keep && from !== null && reach === from) return { raced: false, versionId: null };
  const covered = l.rows.filter((r) => r.seq <= reach && r.seq > (from ?? 0));
  const doc = docFrom({ base: l.base, rows: covered });
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  const editors = byId([...(l.base?.editors ?? []), ...covered.flatMap((r) => (r.by ? [r.by] : []))]);
  const versionId = keep ? id128() : null;
  const key = contentKey(p.owner, documentId);
  const info = keep && versionId ? sealJson(key, versionHeader(p, documentId, versionId, 'info'), toJson({ by: editors, callId: keep.callId, reason: keep.reason })) : null;
  const sealed = keep && versionId ? sealRecord(key, versionHeader(p, documentId, versionId, 'state'), state) : null;
  const wrote = await tx(p.owner.pool, async (c) => {
    await lockDocument(c, p, documentId);
    const now = await maybeOne(c, SnapshotAt, 'SELECT through_seq FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
    if ((now?.through_seq ?? null) !== from) return false;
    if (versionId && info && sealed) {
      await exec(c, 'INSERT INTO document_versions (owner_id, document_id, version_id, info_ciphertext, state_ciphertext) VALUES ($1,$2,$3,$4,$5)', [p.owner.ownerId, documentId, versionId, info, sealed]);
      await exec(c, `DELETE FROM document_versions v USING (
          SELECT version_id, row_number() OVER newest AS n, sum(octet_length(state_ciphertext)) OVER newest AS bytes
          FROM document_versions WHERE owner_id = $1 AND document_id = $2 WINDOW newest AS (ORDER BY created_at DESC, version_id)
        ) kept WHERE v.owner_id = $1 AND v.document_id = $2 AND v.version_id = kept.version_id AND kept.n > 1 AND (kept.n > $3 OR kept.bytes > $4)`, [p.owner.ownerId, documentId, MAX_VERSIONS, MAX_VERSION_BYTES]);
    }
    await writeSnapshot(c, p, documentId, reach, state, keep ? [] : editors);
    await exec(c, 'DELETE FROM document_updates WHERE owner_id = $1 AND document_id = $2 AND seq <= $3', [p.owner.ownerId, documentId, reach]);
    await exec(c, `UPDATE documents SET updates_since_snapshot = greatest(updates_since_snapshot - $3, 0), bytes_since_snapshot = greatest(bytes_since_snapshot - $4, 0), snapshot_bytes = $5
      ${keep ? ', version_seq = $6, version_at = now()' : ''} WHERE owner_id = $1 AND document_id = $2`,
    [p.owner.ownerId, documentId, covered.length, covered.reduce((n, r) => n + r.update.length, 0), state.length, ...(keep ? [reach] : [])]);
    return true;
  });
  if (wrote) dlog.debug('document folded', { workspaceId: p.workspaceId, documentId, through: reach, updates: covered.length, bytes: state.length, version: versionId });
  return { raced: !wrote, versionId: wrote ? versionId : null };
}

/** Each hub's documents being folded now: one at a time is enough, and other instances are stopped by `fold` itself. */
const foldingByHub = new WeakMap<Hub, Set<string>>();
function foldingOn(hub: Hub): Set<string> {
  const busy = foldingByHub.get(hub) ?? new Set<string>();
  foldingByHub.set(hub, busy);
  return busy;
}

/** What an update that just landed leaves to do. */
interface Tending { size: number; through: number; keep: Keep | undefined }
/**
 * After an update lands: a version of what was there before it, if ten minutes of editing have gone by; a compaction, if the
 * log has grown, or the document is full and this took something out of it. Both stop just short of the update itself,
 * which streams are reading at this moment. None of this is worth an update, which is safe by now, and a document that won't
 * open stops nobody else: a failure is logged, and the next update tries again.
 */
function tendingAfter(row: DocRow, seq: number, bytes: number, grows: boolean, callId: string | null): Tending | null {
  const version = seq - 1 > row.version_seq && Date.now() - (row.version_at ?? row.created_at).getTime() >= VERSION_EVERY_MS;
  const compact = row.updates_since_snapshot + 1 >= COMPACT_UPDATES || row.bytes_since_snapshot + bytes >= COMPACT_BYTES || (!grows && sizeOf(row) >= MAX_DOC_BYTES);
  if (!version && !compact) return null;
  return { size: sizeOf(row), through: seq - 1, keep: version ? { reason: 'edits', callId } : undefined };
}
async function tend(p: Place, documentId: string, t: Tending): Promise<void> {
  const busy = foldingOn(p.owner.hub);
  const key = roomKey(p.workspaceId, documentId);
  if (busy.has(key)) return;
  busy.add(key);
  try {
    await inTurn(t.size, () => fold(p, documentId, t.through, t.keep));
  } catch (e) {
    dlog.warn('document not folded', { workspaceId: p.workspaceId, documentId, err: e });
  } finally {
    busy.delete(key);
  }
}

/** Puts an update at the end of the log, under the row's lock, and tells every instance when the transaction commits. */
async function append(c: pg.PoolClient, p: Place, documentId: string, row: DocRow, update: Uint8Array, by: Editor | null): Promise<number> {
  const seq = row.next_seq;
  await exec(c, 'INSERT INTO document_updates (owner_id, document_id, seq, update_ciphertext) VALUES ($1,$2,$3,$4)', [
    p.owner.ownerId, documentId, seq, sealJson(contentKey(p.owner, documentId), updateHeader(p, documentId, seq), toJson({ by, update: b64u(update) }))
  ]);
  await exec(c, 'UPDATE documents SET next_seq = $3, updates_since_snapshot = updates_since_snapshot + 1, bytes_since_snapshot = bytes_since_snapshot + $4 WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId, seq + 1, update.length]);
  await publish(c, p.workspaceId, `${documentId}:${seq}`);
  return seq;
}

/** A document's size is capped, so nobody can fill the disk with one. Someone who's reached it can still take things out. */
function requireRoom(p: Place, documentId: string, row: DocRow, update: Uint8Array): void {
  const bytes = sizeOf(row) + update.length;
  if (bytes > MAX_DOC_BYTES) throw new ValidationError('This document is too long to add to. Delete something from it first.', { context: { workspaceId: p.workspaceId, documentId, bytes } });
}
/** A real update: this is what every browser will apply, so nothing that isn't one goes in the log. Says whether it adds anything, or only takes away. */
function adds(update: Uint8Array): boolean {
  try {
    return Y.decodeUpdate(update).structs.length > 0;
  } catch (e) {
    throw new ValidationError('That isn’t an update.', { cause: e, context: { bytes: update.length } });
  }
}

/**
 * An update from a browser, sealed and appended in one transaction. Under the workspace's lock, so nothing lands after
 * someone loses access, and under the document's, so `seq`s commit in order and any reader who's seen one has seen all
 * before it. `seq` is where it landed.
 */
export async function appendUpdate(d: Deps, reader: Reader, workspaceId: string, documentId: string, update: Uint8Array): Promise<{ seq: number }> {
  if (!update.length || update.length > MAX_DOC_UPDATE_BYTES) throw new ValidationError('That update is empty or too large.', { context: { bytes: update.length } });
  const grows = adds(update);
  const { w, seq, stale, tending } = await tx(d.pool, async (c) => {
    const opened = await workspaceFor(d, reader, workspaceId, c, 'hold');
    const { item } = requireDocument(reader, opened, documentId, 'edit');
    const row = await lockDocument(c, opened, documentId);
    if (grows) requireRoom(opened, documentId, row, update);
    const landed = await append(c, opened, documentId, row, update, editorOf(opened.owner, reader));
    return { w: opened, seq: landed, stale: Date.now() - Date.parse(item.editedAt) >= TOUCH_EVERY_MS, tending: tendingAfter(row, landed, update.length, grows, reader.seat?.callId ?? null) };
  });
  if (tending) await tend(w, documentId, tending);
  if (stale) await touch(d, reader, workspaceId, documentId);
  return { seq };
}
/** The tree follows what's written, about a minute behind. The update is safe by now, so this can't fail it. */
async function touch(d: Deps, who: Who, workspaceId: string, documentId: string): Promise<void> {
  try {
    await change(d, who, workspaceId, (w) => {
      const item = w.state.items[documentId];
      if (item && Date.now() - Date.parse(item.editedAt) >= TOUCH_EVERY_MS) w.state = { ...w.state, items: { ...w.state.items, [documentId]: { ...item, editedAt: new Date().toISOString() } } };
    });
  } catch (e) {
    dlog.at(e instanceof AppError && e.status < 500 ? 'info' : 'warn', 'the tree’s edited time wasn’t moved on', { workspaceId, documentId, err: e });
  }
}

/* ---------- reading and writing a document on the server ---------- */

/** A document's state, for code that has decided the reader may have it (`requireDocument`). Destroy it when you're done. */
export async function readDocument(w: Held, documentId: string): Promise<Y.Doc> {
  requireContent(w, documentId);
  return inTurn(sizeOf(await documentRow(w, documentId)), async () => docFrom(await readLog(w, documentId)));
}

/**
 * Changes a document on the server, for code that has decided it may be: `edit` is handed the document as it stands and
 * changes it as a browser would, and the update is appended and reaches everyone like any other. Anyone typing meanwhile
 * merges with it. A change that changes nothing writes nothing. `by` is who it's for, if anyone. Refused in Trash, like an edit.
 */
export async function writeDocument(w: Held, documentId: string, edit: (doc: Y.Doc) => void, opts: { by?: Editor | null | undefined; callId?: string | null | undefined } = {}): Promise<{ seq: number }> {
  requireContent(w, documentId);
  if (trashOf(w.state, documentId)) throw new ConflictError('This is in Trash. Restore it to change it.', { context: { workspaceId: w.workspaceId, documentId } });
  const doc = await readDocument(w, documentId);
  const updates: Uint8Array[] = [];
  doc.on('update', (u: Uint8Array) => { updates.push(u); });
  doc.transact(() => edit(doc));
  doc.destroy();
  if (!updates.length) return { seq: (await documentRow(w, documentId)).next_seq - 1 };
  const update = Y.mergeUpdates(updates);
  const { seq, tending } = await tx(w.owner.pool, async (c) => {
    const row = await lockDocument(c, w, documentId);
    requireRoom(w, documentId, row, update);
    const landed = await append(c, w, documentId, row, update, opts.by ?? null);
    return { seq: landed, tending: tendingAfter(row, landed, update.length, true, opts.callId ?? null) };
  });
  if (tending) await tend(w, documentId, tending);
  return { seq };
}

/** Makes a document's title say `name`, in a copy. */
function retitle(doc: Y.Doc, name: string): void {
  const title = doc.getXmlFragment(DOC_FRAGMENT).get(0);
  if (!(title instanceof Y.XmlElement) || title.nodeName !== 'title') return;
  doc.transact(() => {
    if (title.length) title.delete(0, title.length);
    const words = new Y.XmlText();
    title.insert(0, [words]);
    words.insert(0, name);
  });
}
/**
 * New documents have their title and first line before anyone opens them, in the caller's transaction: a snapshot of the
 * seed, through nothing, with an empty log on top. They come from the server, so a browser that can only read never has to
 * write, and two people opening one at once find one title.
 */
export async function startContent(p: Place, db: Db, documentIds: string[]): Promise<void> {
  if (!documentIds.length) return;
  const sealed = documentIds.map((id) => ({
    snapshot: Buffer.from(sealRecord(contentKey(p.owner, id), snapshotHeader(p, id, 0), DOC_SEED)), editors: Buffer.from(sealJson(contentKey(p.owner, id), editorsHeader(p, id, 0), []))
  }));
  await exec(db, `INSERT INTO document_snapshots (owner_id, document_id, through_seq, snapshot_ciphertext, editors_ciphertext)
                  SELECT $1, t.id, 0, t.snapshot, t.editors FROM unnest($2::text[], $3::bytea[], $4::bytea[]) AS t(id, snapshot, editors)`, [p.owner.ownerId, documentIds, sealed.map((s) => s.snapshot), sealed.map((s) => s.editors)]);
  await exec(db, 'UPDATE documents SET snapshot_bytes = $3 WHERE owner_id = $1 AND document_id = ANY($2::text[])', [p.owner.ownerId, documentIds, DOC_SEED.length]);
}
/**
 * A copy holds what `from` holds now, as its first update, and a document's title says what the tree calls the copy. It's
 * done after the copy is in the tree, outside any lock, one at a time: a folder of big documents mustn't hold up everyone
 * typing in the workspace, and anyone who opens a copy meanwhile merges with it. One whose records won't open leaves its
 * copy as it started, and the rest are made all the same.
 */
export async function copyContent(p: Place, from: string, to: string, kind: ContentKind, name: string): Promise<void> {
  try {
    await inTurn(sizeOf(await documentRow(p, from)), async () => {
      const l = await readLog(p, from);
      if (!l.base && !l.rows.length) return;
      const doc = docFrom(l);
      if (kind === 'document' && name) retitle(doc, name);
      const state = Y.encodeStateAsUpdate(doc);
      doc.destroy();
      await tx(p.owner.pool, async (c) => { await append(c, p, to, await lockDocument(c, p, to), state, null); });
    });
  } catch (e) {
    dlog.warn('document not copied', { workspaceId: p.workspaceId, documentId: from, err: e });
  }
}

/* ---------- versions ---------- */

const summarise = (id: string, at: Date, info: z.infer<typeof StoredVersionInfo>): DocVersionSummary => ({
  id, at: at.toISOString(), by: info.by.map((e) => ({ name: e.name, portrait: e.portrait ?? portraitFor(e.id) })), callId: info.callId, reason: info.reason
});
const VersionRow = z.object({ version_id: z.string(), info_ciphertext: bytea, created_at: timestamp });

export async function versions(d: Deps, reader: Reader, workspaceId: string, documentId: string): Promise<DocVersionSummary[]> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  const found = await rows(d.pool, VersionRow, 'SELECT version_id, info_ciphertext, created_at FROM document_versions WHERE owner_id = $1 AND document_id = $2 ORDER BY created_at DESC, version_id', [w.owner.ownerId, documentId]);
  const key = contentKey(w.owner, documentId);
  return found.map((r) => summarise(r.version_id, r.created_at, openJson(key, versionHeader(w, documentId, r.version_id, 'info'), r.info_ciphertext, StoredVersionInfo)));
}

const VersionState = VersionRow.extend({ state_ciphertext: bytea });
async function readVersion(p: Place, documentId: string, versionId: string, db: Db): Promise<DocVersionSummary & { state: Uint8Array }> {
  const r = await maybeOne(db, VersionState, 'SELECT version_id, info_ciphertext, state_ciphertext, created_at FROM document_versions WHERE owner_id = $1 AND document_id = $2 AND version_id = $3', [p.owner.ownerId, documentId, versionId]);
  if (!r) throw notFound('That version', { workspaceId: p.workspaceId, documentId, versionId });
  const key = contentKey(p.owner, documentId);
  return { ...summarise(r.version_id, r.created_at, openJson(key, versionHeader(p, documentId, r.version_id, 'info'), r.info_ciphertext, StoredVersionInfo)), state: openRecord(key, versionHeader(p, documentId, r.version_id, 'state'), r.state_ciphertext) };
}
export async function version(d: Deps, reader: Reader, workspaceId: string, documentId: string, versionId: string): Promise<DocVersionSummary & { update: string }> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  const { state, ...summary } = await readVersion(w, documentId, versionId, d.pool);
  return { ...summary, update: b64u(state) };
}

/** How often keeping a version tries again when a compaction got there first. */
const KEEP_TRIES = 4;
/** Keeps a version as it stands, unless the newest already says this. Its ID, or null when nothing changed since. */
async function keepNow(p: Place, documentId: string, keep: Keep): Promise<string | null> {
  for (let tries = 0; tries < KEEP_TRIES; tries++) {
    const row = await documentRow(p, documentId);
    if (row.next_seq - 1 <= row.version_seq) return null;
    const { raced, versionId } = await inTurn(sizeOf(row), () => fold(p, documentId, row.next_seq - 1, keep));
    if (!raced) return versionId;
  }
  throw new ConflictError('This document is changing too fast to keep a version of. Try again.', { context: { workspaceId: p.workspaceId, documentId } });
}
/** Keeps a version of a document as it stands, with a call to file it under, if anything changed since the last one. Its ID, or null when nothing did. */
export function keepVersion(w: Held, documentId: string, keep: Keep): Promise<string | null> {
  requireContent(w, documentId);
  return keepNow(w, documentId, keep);
}

const RESTORING = Symbol('restoring');
/**
 * The update that makes `current` say what `version` says, whatever's in it. Yjs only moves forward, so going back is
 * something new: replaying what happened since onto the version and undoing it writes what was deleted again, and deletes
 * what was added. A version holds a whole state, so it doesn't matter what garbage collection has let go of since.
 */
function backTo(current: Y.Doc, version: Uint8Array): Uint8Array {
  const past = new Y.Doc({ gc: false });
  Y.applyUpdate(past, version);
  const roots = [...new Set([...past.share.keys(), ...current.share.keys()])].map((name) => past.get(name));
  const undo = new Y.UndoManager(roots, { trackedOrigins: new Set([RESTORING]), captureTimeout: 0 });
  Y.applyUpdate(past, Y.encodeStateAsUpdate(current, Y.encodeStateVector(past)), RESTORING);
  undo.undo();
  const update = Y.encodeStateAsUpdate(past, Y.encodeStateVector(current));
  undo.destroy();
  past.destroy();
  return update;
}
/**
 * Makes a document what it was, for everyone, as one update. What it says now is kept as a version first, unless the
 * newest version already says it. All the work happens outside any lock: anyone typing meanwhile merges with it, as they
 * would with anyone else. The tree's name follows its title: a browser renames what it types, and this wasn't typed.
 */
export async function restoreVersion(d: Deps, reader: Reader, workspaceId: string, documentId: string, versionId: string): Promise<void> {
  const w = await workspaceFor(d, reader, workspaceId);
  const kind = kindOf(requireDocument(reader, w, documentId, 'edit').item);
  const { state } = await readVersion(w, documentId, versionId, d.pool);
  await keepNow(w, documentId, { reason: 'restore', callId: reader.seat?.callId ?? null });
  const { update, title } = await inTurn(sizeOf(await documentRow(w, documentId)), async () => {
    const doc = docFrom(await readLog(w, documentId));
    const back = backTo(doc, state);
    Y.applyUpdate(doc, back);
    const words = documentText(doc, kind).title;
    doc.destroy();
    return { update: back, title: words };
  });
  const name = title.replace(/\s+/g, ' ').trim().slice(0, 200);
  await change(d, reader, workspaceId, async (locked, c) => {
    const { item } = requireDocument(reader, locked, documentId, 'edit');
    await append(c, locked, documentId, await lockDocument(c, locked, documentId), update, editorOf(locked.owner, reader));
    if (name && name !== item.name) locked.state = { ...locked.state, items: { ...locked.state.items, [documentId]: { ...item, name, editedAt: new Date().toISOString() } } };
  });
  dlog.info('document restored', { workspaceId, documentId, versionId });
}

/**
 * Every document a reader can open, as words, one line each, for searching in their browser. Nothing in Trash. Refused
 * here, before a line is written, like anything else. One that won't open is left out, and the rest still come.
 */
export async function searchText(d: Deps, reader: Reader, workspaceId: string): Promise<(out: StreamingApi) => Promise<void>> {
  const w = await workspaceFor(d, reader, workspaceId);
  const opens = Object.entries(w.state.items).filter(([id, item]) => item.kind !== 'folder' && roleOf(reader, w, id, item) !== undefined && !trashOf(w.state, id));
  return async (out) => {
    for (const [id, item] of opens) {
      if (out.aborted) return;
      let line: SearchDoc;
      try {
        const doc = await readDocument(w, id);
        line = SearchDocSchema.parse({ id, kind: item.kind, name: item.name, ...documentText(doc, kindOf(item)) });
        doc.destroy();
      } catch (e) {
        dlog.warn('document not read for search', { workspaceId, documentId: id, err: e });
        continue;
      }
      await out.write(`${JSON.stringify(line)}\n`);
    }
  };
}

/* ---------- awareness: where everyone's caret is, never stored ---------- */

interface Caret { client: number; clock: number; state: unknown }
const CaretState = z.object({ user: z.object({ id: z.string() }).optional() });
/** What y-protocols sends, without an Awareness to apply it to. Anything else isn't awareness. */
function caretsIn(update: Uint8Array): Caret[] {
  try {
    const decoder = decoding.createDecoder(update);
    const count = decoding.readVarUint(decoder);
    if (count > MAX_AWARENESS_CLIENTS) throw new Error('too many clients');
    const carets = Array.from({ length: count }, (): Caret => ({ client: decoding.readVarUint(decoder), clock: decoding.readVarUint(decoder), state: JSON.parse(decoding.readVarString(decoder)) }));
    if (decoding.hasContent(decoder)) throw new Error('something follows it');
    return carets;
  } catch (e) {
    throw new ValidationError('That isn’t awareness.', { cause: e, context: { bytes: update.length } });
  }
}
/** The same carets, each saying who it is as the server knows them, whatever it said before. A caret going away says nothing. */
function stamped(carets: Caret[], user: { id: string; name: string; callIdentity: string | null }): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, carets.length);
  for (const c of carets) {
    encoding.writeVarUint(encoder, c.client);
    encoding.writeVarUint(encoder, c.clock);
    encoding.writeVarString(encoder, JSON.stringify(c.state === null ? null : { ...(typeof c.state === 'object' ? c.state : {}), user }));
  }
  return encoding.toUint8Array(encoder);
}

/**
 * A browser's caret, passed on sealed through Postgres to every instance, and kept nowhere. Anyone who can open a document
 * can say where they are in it, under the name the server knows them by. Yjs names carets by the browser's random client,
 * so someone else's client is refused here: their caret stays theirs.
 */
export async function awareness(d: Deps, reader: Reader, workspaceId: string, documentId: string, update: Uint8Array): Promise<void> {
  if (!update.length || update.length > MAX_DOC_AWARENESS_BYTES) throw new ValidationError('That awareness is empty or too large.', { context: { bytes: update.length } });
  const carets = caretsIn(update);
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  const { id, name } = personIn(w.owner, reader);
  const room = docRooms(d.hub).get(roomKey(workspaceId, documentId));
  if (room && carets.some((c) => !room.mayMove(c.client, id))) throw new ForbiddenError('That caret is someone else’s.', { context: { workspaceId, documentId } });
  const sealed = sealRecord(workspaceKey(w.owner), awarenessHeader(w, documentId), stamped(carets, { id, name, callIdentity: reader.seat?.viewer.pass.identity ?? null }));
  await publish(d.pool, workspaceId, `${documentId}:${AWARENESS}${fromUtf8(sealed)}`);
}

/* ---------- live ---------- */

/** After a document's ID, a notice is either the seq of an update or this and a sealed caret. */
const AWARENESS = 'a:';
/** What a room remembers for streams that are a little behind: past this, they're told to start again from where they got to. */
const RECENT_UPDATES = 256;
const RECENT_BYTES = 1024 * 1024;
/** Where someone was a moment ago can go. */
const RECENT_CARETS = 32;

type UpdateLine = Extract<DocLiveEvent, { type: 'update' }>;
type CaretLine = Extract<DocLiveEvent, { type: 'awareness' }>;

/**
 * Everyone who has a document open on this instance, and the one thing they share: the lines not everyone has been told.
 * Each notice is read once here, and each stream only keeps its place, so a stream costs a number however big the
 * document is. A stream that falls behind what's remembered is dropped, and its browser picks up from its last `seq`.
 */
class DocRoom {
  private readonly streams = new Set<DocStream>();
  private recent: UpdateLine[] = [];
  /** The last seq that's been let go of with someone still to hear it, if they're behind it they start again. */
  private floor = 0;
  /** How far this room has read, and how far notices say there is. */
  private last = 0;
  private want = 0;
  private lost = false;
  private heardCarets: string[] = [];
  private carets: { n: number; line: CaretLine }[] = [];
  private caretsHeard = 0;
  /** Whose each caret is, from what's been heard. */
  private readonly clients = new Map<number, string>();
  private pumping = false;
  private again = false;
  private off: (() => void) | undefined;
  /** Done once this room is listening, and knows where the log is. */
  readonly ready: Promise<void>;

  constructor(private readonly d: Deps, private readonly ownerId: string, readonly workspaceId: string, readonly documentId: string, private readonly tree: Room, private readonly rooms: Map<string, DocRoom>) {
    this.ready = d.hub.subscribe(workspaceId, (e) => this.listen(e)).then(async (off) => {
      if (this.streams.size) this.off = off;
      else off();
      const row = await maybeOne(d.pool, z.object({ next_seq: bigintText }), 'SELECT next_seq FROM documents WHERE owner_id = $1 AND document_id = $2', [ownerId, documentId]);
      // Unless a notice got here first: then it's read from the start, which is only wasteful.
      if (!this.last) this.last = this.floor = (row?.next_seq ?? 1) - 1;
      void this.pump();
    });
  }
  private listen(e: HubEvent): void {
    if (e.kind === 'missed') { this.lost = true; void this.pump(); return; }
    if (e.kind !== 'notice' || !e.notice.startsWith(`${this.documentId}:`)) return;
    const rest = e.notice.slice(this.documentId.length + 1);
    const seq = Number(rest);
    if (rest.startsWith(AWARENESS)) this.heardCarets.push(rest.slice(AWARENESS.length));
    else if (Number.isSafeInteger(seq)) this.want = Math.max(this.want, seq);
    void this.pump();
  }
  join(s: DocStream): void { this.streams.add(s); }
  leave(s: DocStream): void {
    this.streams.delete(s);
    if (this.streams.size) return;
    this.off?.();
    if (this.rooms.get(roomKey(this.workspaceId, this.documentId)) === this) this.rooms.delete(roomKey(this.workspaceId, this.documentId));
  }
  /** Someone's caret is theirs: true unless this room has heard another person use that client. */
  mayMove(client: number, person: string): boolean { return (this.clients.get(client) ?? person) === person; }
  /** The next update after `seq`. `behind`: that's been let go of, so whoever's there has to start again. */
  updateAfter(seq: number): { behind: boolean; line: UpdateLine | undefined } {
    return { behind: seq < this.floor, line: this.recent.find((l) => l.seq > seq) };
  }
  /** The next caret after the `n`th heard. A stream too far behind skips to what's remembered. */
  caretAfter(n: number): { n: number; line: CaretLine } | undefined { return this.carets.find((c) => c.n > n); }
  get caretsSoFar(): number { return this.caretsHeard; }
  get reached(): number { return this.last; }

  /** One read at a time, with keys opened for it and not kept, and one more if something's heard meanwhile. */
  private async pump(): Promise<void> {
    if (this.pumping) { this.again = true; return; }
    this.pumping = true;
    try {
      do {
        this.again = false;
        const heard = this.heardCarets.splice(0);
        const behind = this.lost || this.want > this.last;
        if (!heard.length && !behind) continue;
        // A change to who has what that was heard first is settled first, so nobody who lost this hears what comes after.
        await this.tree.settled();
        const owner = await findOwner(this.d, this.ownerId, undefined);
        if (!owner) continue;
        const p: Place = { owner, workspaceId: this.workspaceId };
        if (behind) await this.readUpdates(p);
        for (const text of heard) this.pass(p, text);
        for (const s of this.streams) s.nudge();
      } while (this.again);
    } catch (e) {
      dlog.warn('document not read for its streams', { workspaceId: this.workspaceId, documentId: this.documentId, err: e });
    } finally {
      this.pumping = false;
    }
  }
  private async readUpdates(p: Place): Promise<void> {
    const found = await readUpdatesAfter(p, this.documentId, this.last);
    this.lost = false;
    // A compaction took what this room hadn't read yet: anyone who hasn't been told it asks for it themselves.
    if (found.through > this.last && (found.lines[0]?.seq ?? Infinity) > this.last + 1) {
      this.floor = Math.max(this.floor, found.through);
      this.recent = this.recent.filter((l) => l.seq > found.through);
    }
    this.recent.push(...found.lines);
    this.last = Math.max(this.last, found.through, found.lines.at(-1)?.seq ?? 0);
    this.forget();
  }
  /** Lets go of what everyone's been told, and of what's too much to hold for anyone who hasn't. */
  private forget(): void {
    let told = Infinity;
    for (const s of this.streams) told = Math.min(told, s.position);
    const waiting = this.recent.filter((l) => l.seq > told);
    let bytes = waiting.reduce((n, l) => n + l.update.length, 0);
    let drop = 0;
    for (; waiting.length - drop > 1 && (waiting.length - drop > RECENT_UPDATES || bytes > RECENT_BYTES); drop++) {
      const gone = waiting[drop];
      if (!gone) break;
      bytes -= gone.update.length;
      this.floor = Math.max(this.floor, gone.seq);
    }
    this.recent = waiting.slice(drop);
  }
  private pass(p: Place, text: string): void {
    const update = openRecord(workspaceKey(p.owner), awarenessHeader(p, this.documentId), utf8(text));
    for (const c of caretsIn(update)) {
      const state = CaretState.safeParse(c.state);
      if (state.success && state.data.user) this.clients.set(c.client, state.data.user.id);
    }
    this.carets.push({ n: ++this.caretsHeard, line: { type: 'awareness', update: b64u(update) } });
    if (this.carets.length > RECENT_CARETS) this.carets.shift();
  }
}

/** What a room hears: the log past `after`, as lines, and how far the snapshot reaches, without reading it. */
async function readUpdatesAfter(p: Place, documentId: string, after: number): Promise<{ lines: UpdateLine[]; through: number }> {
  const key = contentKey(p.owner, documentId);
  const found = await rows(p.owner.pool, LogRow, 'SELECT seq, update_ciphertext FROM document_updates WHERE owner_id = $1 AND document_id = $2 AND seq > $3 ORDER BY seq', [p.owner.ownerId, documentId, after]);
  const lines = found.map((r): UpdateLine => ({ type: 'update', seq: r.seq, update: openJson(key, updateHeader(p, documentId, r.seq), r.update_ciphertext, StoredUpdate).update }));
  const snapshot = await maybeOne(p.owner.pool, SnapshotAt, 'SELECT through_seq FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
  return { lines, through: snapshot?.through_seq ?? 0 };
}

const roomKey = (workspaceId: string, documentId: string) => `${workspaceId}:${documentId}`;
/** Rooms are per hub, so two API instances in one process (as in tests) keep to their own. */
const docRoomsByHub = new WeakMap<Hub, Map<string, DocRoom>>();
function docRooms(hub: Hub): Map<string, DocRoom> {
  const rooms = docRoomsByHub.get(hub) ?? new Map<string, DocRoom>();
  docRoomsByHub.set(hub, rooms);
  return rooms;
}
function docRoomFor(d: Deps, w: Place, documentId: string, tree: Room): DocRoom {
  const rooms = docRooms(d.hub);
  const here = rooms.get(roomKey(w.workspaceId, documentId));
  if (here) return here;
  const room = new DocRoom(d, w.owner.ownerId, w.workspaceId, documentId, tree, rooms);
  rooms.set(roomKey(w.workspaceId, documentId), room);
  return room;
}

/** What a stream starts with, once: it's let go of as soon as it's written. */
interface First { seq: number; update: Uint8Array }

/** One browser's stream of a document: who it's for, and how far they've been told. Nothing of the document stays here. */
class DocStream extends LiveStream<DocLiveEvent> {
  private first: First | null = null;
  /** How far this browser has been told. Until it starts, as far as the room had got when it joined: whatever comes after that is kept for it. */
  private at: number;
  private caretsTold: number;
  private why: DocClosed = 'access';

  constructor(d: Deps, room: Room, private readonly doc: DocRoom, credentials: Credentials, who: Who, version: number, release: () => void, private role: 'edit' | 'read', private trashed: boolean) {
    super(d, room, credentials, who, version, release, { workspaceId: doc.workspaceId, documentId: doc.documentId });
    this.at = doc.reached;
    this.caretsTold = doc.caretsSoFar;
  }
  get position(): number { return this.at; }
  /** Where it starts: what it read once it was listening, so nothing falls between the two. */
  start(first: First): void { this.first = first; this.at = first.seq; }
  nudge(): void { this.poke(); }

  /** What this reader has now. False, saying why, when they've lost it. */
  private async show(s: Snapshot, line: Line<DocLiveEvent>): Promise<boolean> {
    const item = s?.state.items[this.doc.documentId];
    if (!s || !item) { this.why = 'deleted'; return false; }
    const role = roleOf(this.who, standingIn(s, this.who), this.doc.documentId, item);
    if (!role) {
      this.why = 'access';
      return this.someoneNew();
    }
    const trashed = trashOf(s.state, this.doc.documentId) !== null;
    if (role !== this.role || trashed !== this.trashed) {
      this.role = role;
      this.trashed = trashed;
      await line({ type: 'access', role, trashed });
    }
    return true;
  }
  protected async begin(line: Line<DocLiveEvent>): Promise<void> {
    const first = this.first;
    if (!first) return;
    this.first = null;
    try {
      await line({ type: 'sync', seq: first.seq, update: b64u(first.update), role: this.role, trashed: this.trashed });
    } finally {
      sending.bytes -= first.update.length;
    }
  }
  protected async step(line: Line<DocLiveEvent>): Promise<Step> {
    const s = this.nextSnapshot();
    if (s !== undefined && !(await this.show(s, line))) return 'lost';
    const { behind, line: update } = this.doc.updateAfter(this.at);
    if (behind) { this.end(); return 'idle'; }
    if (update) {
      this.at = update.seq;
      await line(update);
      return 'wrote';
    }
    const caret = this.doc.caretAfter(this.caretsTold);
    if (!caret) return 'idle';
    this.caretsTold = caret.n;
    await line(caret.line);
    return 'wrote';
  }
  protected ping(): DocLiveEvent { return { type: 'ping' }; }
  protected closed(session: boolean): DocLiveEvent { return { type: 'closed', why: session ? 'session' : this.why }; }
  protected override leave(): void {
    if (this.first) { sending.bytes -= this.first.update.length; this.first = null; }
    super.leave();
    this.doc.leave(this);
  }
}

/** What a browser at `after` doesn't have yet, and the seq that brings it to. Only a state: what was deleted since isn't sent. */
async function syncFrom(p: Place, documentId: string, after: number): Promise<First> {
  const row = await documentRow(p, documentId);
  if (after > 0 && row.next_seq === after + 1) return { seq: after, update: NOTHING };
  const first = await inTurn(sizeOf(row), async () => {
    const l = await readLog(p, documentId);
    const doc = docFrom(l);
    try {
      // From the start, past the log (it can't know more than the log does), or from before a compaction, which leaves no way to tell what's missing.
      if (after <= 0 || after > l.head || after < (l.base?.throughSeq ?? 0)) return { seq: l.head, update: Y.encodeStateAsUpdate(doc) };
      const known = docFrom({ base: l.base, rows: l.rows.filter((r) => r.seq <= after) });
      const vector = Y.encodeStateVector(known);
      known.destroy();
      return { seq: l.head, update: Y.encodeStateAsUpdate(doc, vector) };
    } finally {
      doc.destroy();
    }
  });
  if (sending.bytes + first.update.length > SENDING_BYTES) throw new UnavailableError('Too many documents are opening right now. Try again in a moment.', { context: { workspaceId: p.workspaceId, documentId, bytes: first.update.length } });
  return first;
}

/**
 * Opens a document's stream: it hears of changes first and reads second, so nothing falls between them, and anyone who
 * can't open it is refused here, before a line is written. Runs until the reader loses it, the browser goes or can't keep
 * up, this instance shuts down, or it's time to let go.
 */
export async function open(d: Deps, credentials: Credentials, reader: Reader, workspaceId: string, documentId: string, after: number): Promise<(out: StreamingApi) => Promise<void>> {
  const release = d.hub.admit('document', limitKey(reader));
  try {
    const w = await workspaceFor(d, reader, workspaceId);
    const { role } = requireDocument(reader, w, documentId, 'read');
    const tree = roomFor(d, workspaceId);
    const room = docRoomFor(d, w, documentId, tree);
    const stream = new DocStream(d, tree, room, credentials, { email: reader.email, principals: reader.principals }, w.version, release, role, trashOf(w.state, documentId) !== null);
    tree.join(stream);
    room.join(stream);
    try {
      await Promise.all([tree.ready, room.ready]);
      // Whatever changed before the room was listening: nothing did, usually, and that costs one small query.
      void tree.read();
      const first = await syncFrom(w, documentId, after);
      sending.bytes += first.update.length;
      stream.start(first);
    } catch (e) {
      tree.leave(stream);
      room.leave(stream);
      throw e;
    }
    return (out) => stream.run(out);
  } catch (e) {
    release();
    throw e;
  }
}
