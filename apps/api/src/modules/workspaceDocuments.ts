/*
 * What a document or board holds (docs: Data and storage › Documents). Its content is a Yjs document, which this module keeps
 * without looking inside: each update from a browser is checked (documentFirewall.ts), sealed and appended to a log under the
 * `documents` row's lock, the log folds into one sealed snapshot now and then, and whole states are kept as versions. Yjs
 * updates can arrive twice and in any order, so nothing here needs a receipt. Who can do what is modules/workspaceAccess.ts's
 * to say.
 *
 * Nothing here opens a document. What's in one came from browsers, and opening it can take any amount of time or memory, so
 * that's done by workers (live/docPool.ts, documentWork.ts), from sealed bytes, and what they find comes back as plain data.
 * The row's lock is held only to write: taking a `seq`, sealing one update, swapping in a snapshot someone already worked out.
 * Reading a document and working on it happens outside it, so nobody's typing waits on someone else's big document.
 *
 * Server code reads and writes a document with `readDocument` and `writeDocument`, by the names in documentOps.ts: what it
 * writes goes through the same log and reaches every browser as any other update.
 */
import {
  DOC_SEED, MAX_DOC_AWARENESS_BYTES, MAX_DOC_BYTES, MAX_DOC_UPDATE_BYTES, type DocClosed, type DocLiveEvent, type DocVersionReason, type DocVersionSummary
} from '@alcove/api';
import type { StreamingApi } from 'hono/utils/stream';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type pg from 'pg';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, concat, equalBytes, fromUtf8, id128, mac, openJson, openRecord, sealJson, sealRecord, stateKey, utf8, type RecordHeader } from '../crypto';
import { bigintText, bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../db';
import { AppError, ConflictError, ForbiddenError, TooLargeError, UnavailableError, ValidationError, notFound } from '../errors';
import { DocFailure } from '../live/docPool';
import { publish, type Hub, type HubEvent } from '../live/hub';
import { roomFor, type Room, type Snapshot } from '../live/room';
import { LiveStream, type Line, type Step } from '../live/stream';
import { log } from '../log';
import { findOwner } from '../owners';
import {
  change, editableBy, isItemId, limitKey, personIn, requireDocument, roleOf, standingIn, trashOf, workspaceFor, workspaceKey, workspaceVersion, type Credentials, type Reader, type StoredItem, type Who, type Workspace
} from './workspaceAccess';
import { MAX_NESTING, SERVER_CAPS, bringsNew, clientsOf, inspect, refusalGiven, type Block, type Inspected, type KnownClient } from './documentFirewall';
import { docEdits, docReads, type ArgsOf, type OpTable, type ResultOf } from './documentOps';
import type { ContentKind } from './documentText';
import { StoredVersionInfo, linesOf, openVersionPart, sealUpdate, snapshotHeader, editorsHeader, versionInfoHeader, type At, type Editor, type SealedLog } from './documentWork';
import { portraitFor } from './portraits';

const dlog = log.child({ component: 'documents' });
export type { Editor } from './documentWork';

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
/** Yjs's update that says nothing, as it goes on a line. */
const NOTHING = Buffer.from(b64u(new Uint8Array([0, 0])), 'latin1');
/** What's small enough to read or seal here: past this a worker does it, so one big update doesn't hold up everyone else. */
const INLINE_BYTES = 32 * 1024;
/** A document past either of these takes turns on the one worker that has the memory. */
const BIG_DOC_BYTES = 256 * 1024;
const BIG_DOC_ITEMS = 50_000;
/** There's a limit to how much of documents can be on its way to browsers at once: past it, opening another waits for the browser to try again. */
const SENDING_BYTES = 64 * 1024 * 1024;
/** How long a document that wouldn't open stays closed, so a tab trying again can't keep a worker busy. */
const CLOSED_SECONDS = 300;
/** How long a restore can hold a document, in case the instance doing it goes. */
const HELD_SECONDS = 120;
/** How long a document whose compaction failed is left before the next try, and how often a full one, which compacts with every update, can. */
const FOLD_AGAIN_MS = 60_000;
const FOLD_SOON_MS = 2_000;

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

export const editorOf = (o: Owner, r: Reader): Editor => {
  const { id, name, portrait } = personIn(o, r);
  return { id, name, ...(portrait ? { portrait } : {}) };
};

const contentKey = (o: Owner, documentId: string): Uint8Array => stateKey(o.root, o.ownerId, `document:${documentId}`);
const atOf = (p: Place, documentId: string): At => ({ ownerId: p.owner.ownerId, workspaceId: p.workspaceId, documentId });
const awarenessHeader = (p: Place, documentId: string): RecordHeader => ({ v: 1, ownerId: p.owner.ownerId, workspaceId: p.workspaceId, documentId, kind: 'document-awareness' });

/* ---------- who a client is ---------- */

/** Who's written as a client: a keyed hash for each way access knows them, bound to the document and the client, so no two rows can be linked. */
const PERSON_TAG_BYTES = 32;
function tagsFor(o: Owner, documentId: string, client: number, r: Who): Uint8Array[] {
  const key = stateKey(o.root, o.ownerId, `document-clients:${documentId}`);
  return r.principals.map((p) => mac(key, concat(utf8(`${client}:`), p)));
}
const tagsIn = (people: Uint8Array): Uint8Array[] => Array.from({ length: Math.floor(people.length / PERSON_TAG_BYTES) }, (_, i) => people.subarray(i * PERSON_TAG_BYTES, (i + 1) * PERSON_TAG_BYTES));
/** What the server writes belongs to nobody, so no browser can write as it. */
const nobody = (): Uint8Array => new Uint8Array(0);

const ClientRow = z.object({ client_id: bigintText, next_clock: bigintText, people: bytea });
async function knownClients(c: Db, p: Place, documentId: string, seen: Inspected): Promise<Map<number, KnownClient>> {
  const found = await rows(c, ClientRow, 'SELECT client_id, next_clock, people FROM document_clients WHERE owner_id = $1 AND document_id = $2 AND client_id = ANY($3::bigint[])', [p.owner.ownerId, documentId, clientsOf(seen)]);
  return new Map(found.map((r) => [r.client_id, { next: r.next_clock, people: tagsIn(r.people) }]));
}
/** Moves on how far each client has written, and gives anyone new to whoever wrote first. */
async function noteClients(c: Db, p: Place, documentId: string, blocks: Block[], people: (client: number) => Uint8Array): Promise<void> {
  if (!blocks.length) return;
  await exec(c, `INSERT INTO document_clients (owner_id, document_id, client_id, next_clock, people)
                 SELECT $1, $2, t.client, t.next, t.people FROM unnest($3::bigint[], $4::bigint[], $5::bytea[]) AS t(client, next, people)
                 ON CONFLICT (owner_id, document_id, client_id) DO UPDATE SET next_clock = greatest(document_clients.next_clock, EXCLUDED.next_clock)`, [
    p.owner.ownerId, documentId, blocks.map((b) => b.client), blocks.map((b) => b.to), blocks.map((b) => Buffer.from(people(b.client)))
  ]);
}

/* ---------- the log ---------- */

const LogRow = z.object({ seq: bigintText, update_ciphertext: bytea });
const BaseRow = z.object({ through_seq: bigintText, snapshot_ciphertext: bytea, editors_ciphertext: bytea });

/** The log, sealed, for a worker to open. The rows come first and the snapshot second: a compaction between the two leaves rows the snapshot also has, which Yjs doesn't mind, and never a gap. */
async function sealedLog(p: Place, documentId: string, through?: number | undefined): Promise<SealedLog> {
  const found = await rows(p.owner.pool, LogRow, `SELECT seq, update_ciphertext FROM document_updates WHERE owner_id = $1 AND document_id = $2${through === undefined ? '' : ' AND seq <= $3'} ORDER BY seq`, [p.owner.ownerId, documentId, ...(through === undefined ? [] : [through])]);
  const base = await maybeOne(p.owner.pool, BaseRow, 'SELECT through_seq, snapshot_ciphertext, editors_ciphertext FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
  return {
    at: atOf(p, documentId), key: contentKey(p.owner, documentId), rows: found.map((r) => ({ seq: r.seq, sealed: r.update_ciphertext })),
    base: base ? { throughSeq: base.through_seq, snapshot: base.snapshot_ciphertext, editors: base.editors_ciphertext } : null
  };
}

/** What a worker found wrong in a log, said here, where there's somewhere to say it. */
function report(p: Place, documentId: string, found: { skipped: number[]; unreadable: number[]; pending: boolean }): void {
  for (const seq of [...found.skipped, ...found.unreadable]) dlog.warn('document row skipped', { workspaceId: p.workspaceId, documentId, seq, unreadable: found.unreadable.includes(seq) });
  if (found.pending) dlog.warn('document held something that could never apply', { workspaceId: p.workspaceId, documentId });
}

const DocRow = z.object({
  next_seq: bigintText, updates_since_snapshot: z.number(), bytes_since_snapshot: bigintText, snapshot_bytes: bigintText, snapshot_items: bigintText, items_since_snapshot: bigintText,
  snapshot_nesting: z.number(), nesting_since_snapshot: z.number(), version_seq: bigintText, version_at: timestamp.nullable(), created_at: timestamp, held: z.boolean(), closed: z.boolean()
});
type DocRow = z.infer<typeof DocRow>;
const DOC_COLUMNS = `next_seq, updates_since_snapshot, bytes_since_snapshot, snapshot_bytes, snapshot_items, items_since_snapshot, snapshot_nesting, nesting_since_snapshot, version_seq, version_at, created_at,
  coalesce(held_until > now(), false) AS held, coalesce(closed_until > now(), false) AS closed`;
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
const itemsOf = (row: DocRow): number => row.snapshot_items + row.items_since_snapshot;
/** The deepest a document's types could go: exact at a compaction, and everything since counts as if it nested below the deepest thing there. */
const nestingOf = (row: DocRow): number => row.snapshot_nesting + row.nesting_since_snapshot;
/** What a worker needs to know of a job on this document. */
const jobFor = (row: DocRow) => ({ big: sizeOf(row) > BIG_DOC_BYTES || itemsOf(row) > BIG_DOC_ITEMS, bytes: sizeOf(row) });

const byLimits = (p: Place, bytes: number, items: number, times = 1): boolean => bytes > MAX_DOC_BYTES * times || items > p.owner.cfg.DOC_ITEMS_MAX * times;
const tooLong = (p: Place, documentId: string, bytes: number, items: number) => new TooLargeError('This document is too long to add to. Delete something from it first.', { context: { workspaceId: p.workspaceId, documentId, bytes, items } });
/** How far past its limit a document can go on what isn't new content. Only what's deleted outright goes further. */
const CEILING = 2;
/**
 * A document's size is capped, in bytes and in items, because its memory follows items, so nobody can fill the disk or an
 * instance with one. What's refused is what would add to it: new text and new elements, past what the same update takes out.
 * Blocks leave a page by having attributes written and their words deleted, and joining two lines writes the same words
 * somewhere else, so all of that goes through, and a full document can always be made smaller. A move adds an element, so it
 * waits like anything else that adds one. That isn't free of limits, because a new attribute is an item too: there's a
 * ceiling on that, far past anything but someone doing it on purpose, and past that only deletes are taken. How deep things
 * nest is held the same way. All of this is what could be there, not what is: a refusal compacts the document, which finds
 * out, and the browser tries again with what it's holding.
 */
function requireRoom(p: Place, documentId: string, row: DocRow, bytes: number, seen: Inspected): void {
  const size = sizeOf(row) + bytes;
  const items = itemsOf(row) + seen.items;
  if (!seen.blocks.length) return;
  if (byLimits(p, size, items, CEILING) || (byLimits(p, size, items) && seen.content > seen.deleted) || (seen.nesting > 0 && nestingOf(row) + seen.nesting > MAX_NESTING)) throw tooLong(p, documentId, size, items);
}
const restoring = (p: Place, documentId: string) => new UnavailableError('This document is being put back to an earlier version. What’s here will go in a moment.', { context: { workspaceId: p.workspaceId, documentId } });

async function writeSnapshot(db: Db, p: Place, documentId: string, throughSeq: number, snapshot: Uint8Array, editors: Uint8Array): Promise<void> {
  await exec(db, `INSERT INTO document_snapshots (owner_id, document_id, through_seq, snapshot_ciphertext, editors_ciphertext) VALUES ($1,$2,$3,$4,$5)
                  ON CONFLICT (owner_id, document_id) DO UPDATE SET through_seq = EXCLUDED.through_seq, snapshot_ciphertext = EXCLUDED.snapshot_ciphertext, editors_ciphertext = EXCLUDED.editors_ciphertext`, [
    p.owner.ownerId, documentId, throughSeq, snapshot, editors
  ]);
}

const SnapshotAt = z.object({ through_seq: bigintText });
interface Keep { reason: DocVersionReason; callId: string | null }

async function writeVersion(c: Db, p: Place, documentId: string, versionId: string, v: { info: Uint8Array; parts: Uint8Array[]; bytes: number }): Promise<void> {
  await exec(c, 'INSERT INTO document_versions (owner_id, document_id, version_id, info_ciphertext, bytes, parts) VALUES ($1,$2,$3,$4,$5,$6)', [p.owner.ownerId, documentId, versionId, v.info, v.bytes, v.parts.length]);
  await exec(c, `INSERT INTO document_version_parts (owner_id, document_id, version_id, part, state_ciphertext)
                 SELECT $1, $2, $3, t.ord - 1, t.sealed FROM unnest($4::bytea[]) WITH ORDINALITY AS t(sealed, ord)`, [p.owner.ownerId, documentId, versionId, v.parts.map((part) => Buffer.from(part))]);
  await exec(c, `DELETE FROM document_versions v USING (
      SELECT version_id, row_number() OVER newest AS n, sum(bytes) OVER newest AS kept_bytes
      FROM document_versions WHERE owner_id = $1 AND document_id = $2 WINDOW newest AS (ORDER BY created_at DESC, version_id)
    ) kept WHERE v.owner_id = $1 AND v.document_id = $2 AND v.version_id = kept.version_id AND kept.n > 1 AND (kept.n > $3 OR kept.kept_bytes > $4)`, [p.owner.ownerId, documentId, MAX_VERSIONS, MAX_VERSION_BYTES]);
}

/**
 * Folds the log through `through` into a snapshot, with a version kept of it if asked: a whole state, so that it opens
 * whatever happens to the log after it. A version says who changed the document since the last one, and that starts over.
 *
 * The work happens outside any lock, because what's in the log up to `through` never changes, and it's proved to open again
 * before anything is deleted. The row's lock is taken only to swap it in, and only if the snapshot is still the one this
 * started from: otherwise someone else folded it first, on this instance or another, and nothing is written. That's `raced`.
 */
async function fold(p: Place, documentId: string, through: number, keep?: Keep): Promise<{ raced: boolean; versionId: string | null }> {
  const row = await documentRow(p, documentId);
  const l = await sealedLog(p, documentId, through);
  const from = l.base?.throughSeq ?? null;
  const reach = Math.max(through, from ?? 0);
  if (!keep && from !== null && reach === from) return { raced: false, versionId: null };
  const versionId = keep ? id128() : null;
  const covered = l.rows.filter((r) => r.seq > (from ?? 0));
  const made = await p.owner.docs.run('fold', { ...l, rows: covered, through: reach, keep: keep && versionId ? { ...keep, versionId } : null }, jobFor(row));
  report(p, documentId, made.found);
  const wrote = await tx(p.owner.pool, async (c) => {
    await lockDocument(c, p, documentId);
    const now = await maybeOne(c, SnapshotAt, 'SELECT through_seq FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
    if ((now?.through_seq ?? null) !== from) return false;
    if (versionId && made.version) await writeVersion(c, p, documentId, versionId, made.version);
    await writeSnapshot(c, p, documentId, reach, made.snapshot, made.editors);
    await exec(c, 'DELETE FROM document_updates WHERE owner_id = $1 AND document_id = $2 AND seq <= $3', [p.owner.ownerId, documentId, reach]);
    await settleFigures(c, p, documentId, made.shape, keep ? reach : null);
    return true;
  });
  if (wrote) dlog.debug('document folded', { workspaceId: p.workspaceId, documentId, through: reach, updates: covered.length, bytes: made.shape.bytes, items: made.shape.items, version: versionId });
  return { raced: !wrote, versionId: wrote ? versionId : null };
}
/** What a document comes to now a snapshot says it exactly, and what's left in the log on top. */
async function settleFigures(c: Db, p: Place, documentId: string, shape: { bytes: number; items: number; nesting: number }, versionSeq: number | null): Promise<void> {
  await exec(c, `UPDATE documents d SET snapshot_bytes = $3, snapshot_items = $4, snapshot_nesting = $5, updates_since_snapshot = r.n, bytes_since_snapshot = r.bytes, items_since_snapshot = r.items, nesting_since_snapshot = r.nesting
                 ${versionSeq === null ? '' : ', version_seq = $6, version_at = now()'}
                 FROM (SELECT count(*)::int AS n, coalesce(sum(bytes), 0) AS bytes, coalesce(sum(items), 0) AS items, coalesce(sum(nesting), 0)::int AS nesting FROM document_updates WHERE owner_id = $1 AND document_id = $2) r
                 WHERE d.owner_id = $1 AND d.document_id = $2`, [p.owner.ownerId, documentId, shape.bytes, shape.items, shape.nesting, ...(versionSeq === null ? [] : [versionSeq])]);
}

/** Each hub's documents being folded now, one at a time, and when each can next be tried. Other instances are stopped by `fold` itself. */
interface Folding { busy: Set<string>; notBefore: Map<string, number> }
const foldingByHub = new WeakMap<Hub, Folding>();
function foldingOn(hub: Hub): Folding {
  const folding = foldingByHub.get(hub) ?? { busy: new Set<string>(), notBefore: new Map<string, number>() };
  foldingByHub.set(hub, folding);
  return folding;
}

/** What an update that just landed leaves to do. `full`: it's for making room, which a full document wants after every update, so it takes turns. */
interface Tending { through: number; keep: Keep | undefined; full: boolean }
/**
 * After an update lands: a version of what was there before it, if ten minutes of editing have gone by; a compaction, if the
 * log has grown, or the document is full and this took something out of it. Both stop just short of the update itself,
 * which streams are reading at this moment. None of this is worth an update, which is safe by now, and a document that won't
 * open stops nobody else: a failure is logged, and it's tried again a little later.
 */
function tendingAfter(p: Place, row: DocRow, seq: number, bytes: number, callId: string | null): Tending | null {
  const version = seq - 1 > row.version_seq && Date.now() - (row.version_at ?? row.created_at).getTime() >= VERSION_EVERY_MS;
  const full = byLimits(p, sizeOf(row), itemsOf(row)) || nestingOf(row) > MAX_NESTING / 2;
  const compact = row.updates_since_snapshot + 1 >= COMPACT_UPDATES || row.bytes_since_snapshot + bytes >= COMPACT_BYTES || full;
  if (!version && !compact) return null;
  return { through: seq - 1, keep: version ? { reason: 'edits', callId } : undefined, full };
}
async function tend(p: Place, documentId: string, t: Tending): Promise<void> {
  const { busy, notBefore } = foldingOn(p.owner.hub);
  const key = roomKey(p.workspaceId, documentId);
  if (busy.has(key) || Date.now() < (notBefore.get(key) ?? 0)) return;
  busy.add(key);
  if (notBefore.size > 1000) notBefore.clear();
  try {
    await fold(p, documentId, t.through, t.keep);
    if (t.full) notBefore.set(key, Date.now() + FOLD_SOON_MS);
  } catch (e) {
    notBefore.set(key, Date.now() + FOLD_AGAIN_MS);
    dlog.warn('document not folded', { workspaceId: p.workspaceId, documentId, err: e });
  } finally {
    busy.delete(key);
  }
}

/** Puts an update at the end of the log, under the row's lock, and tells every instance when the transaction commits. */
async function append(c: pg.PoolClient, p: Place, documentId: string, row: DocRow, update: Uint8Array, by: Editor | null, seen: Inspected, people: (client: number) => Uint8Array): Promise<number> {
  const seq = row.next_seq;
  const at = atOf(p, documentId);
  const key = contentKey(p.owner, documentId);
  const sealed = update.length <= INLINE_BYTES ? sealUpdate(at, key, seq, by, update) : (await p.owner.docs.run('seal', { at, key, seq, by, update }, { big: false, bytes: update.length, first: true })).sealed;
  await exec(c, 'INSERT INTO document_updates (owner_id, document_id, seq, update_ciphertext, bytes, items, nesting) VALUES ($1,$2,$3,$4,$5,$6,$7)', [p.owner.ownerId, documentId, seq, sealed, update.length, seen.items, seen.nesting]);
  await exec(c, `UPDATE documents SET next_seq = $3, updates_since_snapshot = updates_since_snapshot + 1, bytes_since_snapshot = bytes_since_snapshot + $4, items_since_snapshot = items_since_snapshot + $5,
                 nesting_since_snapshot = nesting_since_snapshot + $6 WHERE owner_id = $1 AND document_id = $2`, [p.owner.ownerId, documentId, seq + 1, update.length, seen.items, seen.nesting]);
  await noteClients(c, p, documentId, seen.blocks, people);
  await publish(c, p.workspaceId, `${documentId}:${seq}`);
  return seq;
}

/** Why an update was refused goes in the logs, and nothing of what it said. A browser hears that it was. */
function refuseUpdate(workspaceId: string, documentId: string, why: string, bytes: number): ValidationError {
  dlog.info('update refused', { workspaceId, documentId, why, bytes });
  return new ValidationError('That isn’t an update Alcove can take.', { context: { workspaceId, documentId, why } });
}

/**
 * An update from a browser, sealed and appended in one transaction. Whoever can't write here hears so before anything of it is
 * read. It's checked in two steps: what can be told from the update alone, with nothing held, and what depends on the log,
 * under the workspace's lock, so nothing lands after someone loses access, and the document's, so `seq`s commit in order and
 * any reader who's seen one has seen all before it. `seq` is where it landed.
 */
export async function appendUpdate(d: Deps, reader: Reader, workspaceId: string, documentId: string, body: () => Promise<ArrayBuffer>): Promise<{ seq: number }> {
  const asked = await editableBy(d, reader, workspaceId, documentId);
  const update = new Uint8Array(await body());
  if (!update.length) throw new ValidationError('That update is empty.', { context: { workspaceId, documentId } });
  if (update.length > MAX_DOC_UPDATE_BYTES) throw new TooLargeError('That’s too much to save in one go.', { context: { workspaceId, documentId, bytes: update.length } });
  const { seen, why } = update.length <= INLINE_BYTES ? inspect(update) : await d.docs.run('inspect', { update }, { big: false, bytes: update.length });
  if (!seen) throw refuseUpdate(workspaceId, documentId, why ?? 'unknown', update.length);

  const landed = await tx(d.pool, async (c) => {
    const w = await editableBy(d, reader, workspaceId, documentId, c, 'hold');
    const row = await lockDocument(c, w, documentId);
    if (row.held) throw restoring(w, documentId);
    const known = await knownClients(c, w, documentId, seen);
    const why2 = refusalGiven(seen, known, (client, people) => tagsFor(w.owner, documentId, client, reader).some((t) => people.some((q) => equalBytes(t, q))));
    if (why2) throw refuseUpdate(workspaceId, documentId, why2, update.length);
    // Here before, whole: a retry, of what's safe already.
    if (!bringsNew(seen, known) && !seen.deletes.length) return { w, seq: row.next_seq - 1, stale: false, tending: null };
    requireRoom(w, documentId, row, update.length, seen);
    const tags = (client: number) => concat(...tagsFor(w.owner, documentId, client, reader));
    const seq = await append(c, w, documentId, row, update, editorOf(w.owner, reader), seen, tags);
    return { w, seq, stale: Date.now() - Date.parse(w.editedAt) >= TOUCH_EVERY_MS, tending: tendingAfter(w, row, seq, update.length, reader.seat?.callId ?? null) };
  }).catch(async (e: unknown) => {
    // What's counted is what could be there: much of it may be what's been deleted, or overwritten, which only a compaction shows, and nothing else may come along to start one. So this one reaches all the way: a stream reading the last row starts again, which is rare and safe. The browser tries again, and finds out.
    if (e instanceof TooLargeError) await tend(asked, documentId, { through: (await documentRow(asked, documentId)).next_seq - 1, keep: undefined, full: true });
    throw e;
  });
  if (landed.tending) await tend(landed.w, documentId, landed.tending);
  if (landed.stale) await touch(d, reader, workspaceId, documentId);
  return { seq: landed.seq };
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

type Reads = typeof docReads;
type Edits = typeof docEdits;
const reads: OpTable<Reads> = docReads;
const edits: OpTable<Edits> = docEdits;

/** Asks a document something, for code that has decided the reader may have it (`requireDocument`). What can be asked is in documentOps.ts. */
export async function readDocument<N extends keyof Reads>(w: Held, documentId: string, op: N, args: ArgsOf<Reads[N]>): Promise<ResultOf<Reads[N]>> {
  requireContent(w, documentId);
  const row = await documentRow(w, documentId);
  const done = await w.owner.docs.run('read', { ...(await sealedLog(w, documentId)), op, args }, jobFor(row));
  report(w, documentId, done.found);
  return reads[op].result.parse(done.value);
}

/** How often a change from the server is worked out again because someone wrote as its clients first. */
const WRITE_TRIES = 3;
/** Takes back the transaction writing a change from the server, `holding`'s part too, when someone wrote as its client first. It never leaves `writeDocument`. */
class ClientTaken extends Error {}

/**
 * Changes a document on the server, for code that has decided it may be: what can be done is in documentOps.ts, and it's done
 * to the document as it stands, as a browser would, and the update is appended and reaches everyone like any other. Anyone
 * typing meanwhile merges with it. A change that changes nothing writes nothing. `by` is who it's for, if anyone. `holding`
 * runs in the transaction that writes it, for what must still hold by then. Refused in Trash, like an edit.
 *
 * It's written only as clients the log doesn't have yet, checked under the row's lock: two updates under one client and
 * clock that say different things would leave browsers disagreeing for good. A change made as a fixed client (a board's
 * template) that finds someone got there first is worked out again on what's there now, which is how it happens once.
 */
export async function writeDocument<N extends keyof Edits>(
  w: Held, documentId: string, op: N, args: ArgsOf<Edits[N]>, opts: { by?: Editor | null | undefined; callId?: string | null | undefined; holding?: ((c: Db) => Promise<void>) | undefined } = {}
): Promise<{ seq: number; result: ResultOf<Edits[N]> }> {
  requireContent(w, documentId);
  if (trashOf(w.state, documentId)) throw new ConflictError('This is in Trash. Restore it to change it.', { context: { workspaceId: w.workspaceId, documentId } });
  for (let tries = 1; ; tries++) {
    const row = await documentRow(w, documentId);
    const done = await w.owner.docs.run('edit', { ...(await sealedLog(w, documentId)), op, args }, jobFor(row));
    report(w, documentId, done.found);
    const result = edits[op].result.parse(done.value);
    const { update, seen } = done;
    if (!update || !seen) return { seq: row.next_seq - 1, result };
    const landed = await tx(w.owner.pool, async (c) => {
      await opts.holding?.(c);
      const locked = await lockDocument(c, w, documentId);
      if (locked.held) throw restoring(w, documentId);
      const known = await knownClients(c, w, documentId, seen);
      if (seen.blocks.some((b) => known.has(b.client))) throw new ClientTaken();
      requireRoom(w, documentId, locked, update.length, seen);
      const seq = await append(c, w, documentId, locked, update, opts.by ?? null, seen, nobody);
      return { seq, tending: tendingAfter(w, locked, seq, update.length, opts.callId ?? null) };
    }).catch((e: unknown) => {
      if (e instanceof ClientTaken) return null;
      throw e;
    });
    if (landed) {
      if (landed.tending) await tend(w, documentId, landed.tending);
      return { seq: landed.seq, result };
    }
    dlog.debug('server change worked out again: its client has written here already', { workspaceId: w.workspaceId, documentId, op, tries });
    if (tries >= WRITE_TRIES) throw new ConflictError('This is changing too fast to change from here. Try again.', { context: { workspaceId: w.workspaceId, documentId, op } });
  }
}

const SEED = inspect(DOC_SEED, SERVER_CAPS).seen;
/**
 * New documents have their title and first line before anyone opens them, in the caller's transaction: a snapshot of the
 * seed, through nothing, with an empty log on top. They come from the server, so a browser that can only read never has to
 * write, and two people opening one at once find one title.
 */
export async function startContent(p: Place, db: Db, documentIds: string[]): Promise<void> {
  if (!documentIds.length || !SEED) return;
  const sealed = documentIds.map((id) => ({
    snapshot: Buffer.from(sealRecord(contentKey(p.owner, id), snapshotHeader(atOf(p, id), 0), DOC_SEED)), editors: Buffer.from(sealJson(contentKey(p.owner, id), editorsHeader(atOf(p, id), 0), []))
  }));
  await exec(db, `INSERT INTO document_snapshots (owner_id, document_id, through_seq, snapshot_ciphertext, editors_ciphertext)
                  SELECT $1, t.id, 0, t.snapshot, t.editors FROM unnest($2::text[], $3::bytea[], $4::bytea[]) AS t(id, snapshot, editors)
                  ON CONFLICT (owner_id, document_id) DO NOTHING`, [p.owner.ownerId, documentIds, sealed.map((s) => s.snapshot), sealed.map((s) => s.editors)]);
  await exec(db, 'UPDATE documents SET snapshot_bytes = $3, snapshot_items = $4 WHERE owner_id = $1 AND document_id = ANY($2::text[])', [p.owner.ownerId, documentIds, DOC_SEED.length, SEED.items]);
  for (const id of documentIds) await noteClients(db, p, id, SEED.blocks, nobody);
}
/** A document from before they were started like this has its start the first time someone opens it. */
async function started(p: Place, documentId: string, row: DocRow): Promise<void> {
  if (row.snapshot_bytes > 0 || row.next_seq > 1) return;
  await tx(p.owner.pool, async (c) => {
    const locked = await lockDocument(c, p, documentId);
    if (locked.snapshot_bytes === 0 && locked.next_seq === 1) await startContent(p, c, [documentId]);
  });
}
/**
 * A copy holds what `from` holds now, as its first update, and a document's title says what the tree calls the copy. It's
 * done after the copy is in the tree, outside any lock, one at a time: a folder of big documents mustn't hold up everyone
 * typing in the workspace, and anyone who opens a copy meanwhile merges with it. One whose records won't open leaves its
 * copy as it started, and the rest are made all the same.
 */
export async function copyContent(p: Place, from: string, to: string, kind: ContentKind, name: string): Promise<void> {
  try {
    const row = await documentRow(p, from);
    const made = await p.owner.docs.run('copy', { ...(await sealedLog(p, from)), name: kind === 'document' && name ? name : null }, jobFor(row));
    report(p, from, made.found);
    if (!made.seen.blocks.length) return;
    await tx(p.owner.pool, async (c) => { await append(c, p, to, await lockDocument(c, p, to), made.state, null, made.seen, nobody); });
  } catch (e) {
    dlog.warn('document not copied', { workspaceId: p.workspaceId, documentId: from, err: e });
  }
}

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

/** Writes one line, or gives up on a reader who hasn't taken it within a ping. */
async function lineFor(d: Deps, out: StreamingApi, text: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => { timer = setTimeout(() => resolve('late'), d.cfg.LIVE_PING_MS); });
  const wrote = await Promise.race([out.write(text), late]);
  clearTimeout(timer);
  if (wrote !== 'late') return true;
  out.abort();
  return false;
}

/** Reads of a version under way on each instance: each holds a request, and a reader can be as slow as they like. */
const versionReads = new WeakMap<Hub, { open: number }>();
function takeVersionRead(d: Deps): () => void {
  const reads = versionReads.get(d.hub) ?? { open: 0 };
  versionReads.set(d.hub, reads);
  if (reads.open >= d.cfg.DOC_VERSION_READS || sending.bytes > SENDING_BYTES) throw new UnavailableError('Too many documents are on their way right now. Try again in a moment.', { context: { open: reads.open, bytes: sending.bytes } });
  reads.open++;
  let holding = true;
  return () => { if (holding) { holding = false; reads.open--; } };
}

/**
 * A version as it's kept, a part at a time, so a reader who stops reading holds one part and no more. Nothing's written until
 * it's known they can have it, and it stops if they lose it on the way.
 */
export async function version(d: Deps, reader: Reader, workspaceId: string, documentId: string, versionId: string): Promise<(out: StreamingApi) => Promise<void>> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  const r = await versionRow(w, documentId, versionId);
  const key = contentKey(w.owner, documentId);
  const at = atOf(w, documentId);
  const summary = summarise(r.version_id, r.created_at, openJson(key, versionInfoHeader(at, r.version_id), r.info_ciphertext, StoredVersionInfo));
  const release = takeVersionRead(d);
  return async (out) => {
    let held = 0;
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
        held = bytes.length;
        sending.bytes += held;
        const wrote = await lineFor(d, out, `{"type":"part","update":"${b64u(bytes)}"}\n`);
        sending.bytes -= held;
        held = 0;
        if (!wrote) return;
      }
    } catch (e) {
      dlog.info('version not sent to the end', { workspaceId, documentId, versionId, err: e });
      out.abort();
    } finally {
      sending.bytes -= held;
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
 * them to open it afresh. Anything still in a browser from before finds its clients gone and is refused, because it would
 * build on what's no longer there.
 */
async function replaceWith(p: Place, documentId: string, row: DocRow, version: { versionId: string; parts: Uint8Array[] }): Promise<void> {
  const through = row.next_seq - 1;
  const made = await p.owner.docs.run('reset', { at: atOf(p, documentId), key: contentKey(p.owner, documentId), through, version }, { big: true, bytes: sizeOf(row) });
  await tx(p.owner.pool, async (c) => {
    await lockDocument(c, p, documentId);
    await exec(c, 'DELETE FROM document_updates WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
    await exec(c, 'DELETE FROM document_clients WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
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
    const row = await documentRow(w, documentId);
    const made = await d.docs.run('restore', { ...(await sealedLog(w, documentId)), version: { versionId, parts }, kind }, jobFor(row));
    report(w, documentId, made.found);
    if (byLimits(w, made.shape.bytes, made.shape.items)) throw tooLong(w, documentId, made.shape.bytes, made.shape.items);
    const name = made.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    await change(d, reader, workspaceId, async (locked, c) => {
      const { item } = requireDocument(reader, locked, documentId, 'edit');
      const at = await lockDocument(c, locked, documentId);
      if (made.seen.blocks.length || made.seen.deletes.length) await append(c, locked, documentId, at, made.update, editorOf(locked.owner, reader), made.seen, nobody);
      await letGo(c, locked, documentId);
      if (name && name !== item.name) locked.state = { ...locked.state, items: { ...locked.state.items, [documentId]: { ...item, name, editedAt: new Date().toISOString() } } };
    });
    dlog.info('document restored', { workspaceId, documentId, versionId });
  } finally {
    await letGo(d.pool, w, documentId).catch((e: unknown) => dlog.warn('a restore’s hold wasn’t let go of', { workspaceId, documentId, err: e }));
  }
}

/**
 * Every document a reader can open, as words, one line each, for searching in their browser. Nothing in Trash. Refused here,
 * before a line is written, like anything else. One that won't open is left out, and the rest still come. It stops as soon as
 * they can't read what's next: whatever changes who has what moves the workspace's version on.
 */
export async function searchText(d: Deps, reader: Reader, workspaceId: string): Promise<(out: StreamingApi) => Promise<void>> {
  const w = await workspaceFor(d, reader, workspaceId);
  const opens = Object.entries(w.state.items).filter(([id, item]) => item.kind !== 'folder' && roleOf(reader, w, id, item) !== undefined && !trashOf(w.state, id));
  return async (out) => {
    let current = w;
    for (const [id] of opens) {
      if (out.aborted) return;
      try {
        if ((await workspaceVersion(d, workspaceId)) !== current.version) current = await workspaceFor(d, reader, workspaceId);
      } catch (e) {
        dlog.debug('search stopped: access ended', { workspaceId, err: e });
        return;
      }
      const now = current.state.items[id];
      if (!now || roleOf(reader, current, id, now) === undefined || trashOf(current.state, id)) continue;
      let line: Uint8Array;
      try {
        const row = await documentRow(current, id);
        const done = await d.docs.run('searchLine', { ...(await sealedLog(current, id)), id, itemKind: now.kind, name: now.name, kind: kindOf(now) }, jobFor(row));
        report(current, id, done.found);
        line = done.line;
      } catch (e) {
        dlog.warn('document not read for search', { workspaceId, documentId: id, err: e });
        continue;
      }
      await out.write(line);
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
 * A browser's caret, passed on sealed through Postgres to every instance, and kept nowhere. It takes having the document open
 * here: a stream is checked on a clock and hears of every change to who has what, so a caret needs no looking up of its own,
 * and carets can come ten times a second. A browser sends none before its stream is up. The one thing sent after it is a
 * caret going away, which someone can always say of their own. Yjs names carets by the browser's random client, so someone
 * else's client is refused here: their caret stays theirs.
 */
export async function awareness(d: Deps, reader: Reader, workspaceId: string, documentId: string, update: Uint8Array): Promise<void> {
  if (!update.length || update.length > MAX_DOC_AWARENESS_BYTES) throw new ValidationError('That awareness is empty or too large.', { context: { bytes: update.length } });
  // Anyone with nothing open here hears the same whatever they send, and whether or not anyone else is in the room.
  const none = () => notFound('That document', { workspaceId, documentId });
  const room = docRooms(d.hub).get(roomKey(workspaceId, documentId));
  if (!room) throw none();
  const holding = room.holds(reader);
  let carets: Caret[];
  try {
    carets = caretsIn(update);
  } catch (e) {
    throw holding ? e : none();
  }
  const owner = await findOwner(d, room.ownerId, undefined);
  if (!owner) throw none();
  const p: Place = { owner, workspaceId };
  const { id, name } = personIn(owner, reader);
  if (!holding && !(carets.length > 0 && carets.every((c) => c.state === null && room.isTheirs(c.client, id)))) throw none();
  if (carets.some((c) => !room.mayMove(c.client, id))) throw new ForbiddenError('That caret is someone else’s.', { context: { workspaceId, documentId } });
  const sealed = sealRecord(workspaceKey(owner), awarenessHeader(p, documentId), stamped(carets, { id, name, callIdentity: reader.seat?.viewer.pass.identity ?? null }));
  await publish(d.pool, workspaceId, `${documentId}:${AWARENESS}${fromUtf8(sealed)}`);
}

/* ---------- live ---------- */

/** After a document's ID, a notice is the seq of an update, this and a sealed caret, or that it was replaced. */
const AWARENESS = 'a:';
const REPLACED = 'replaced';
/** What a room remembers for streams that are a little behind: past this, they're told to start again from where they got to. */
const RECENT_UPDATES = 256;
const RECENT_BYTES = 1024 * 1024;
/** Where someone was a moment ago can go. */
const RECENT_CARETS = 32;
/** How long to remember whose a caret is, and how many: carets renew themselves every 15 seconds, and go after 30. */
const CARET_OWNER_MS = 60_000;
const CARET_OWNERS = 1024;

/** A line of updates, as it's written, made once for everyone. */
interface UpdateLine { seq: number; bytes: number; text: string }
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
  /** Whose each caret is, from what's been heard, and when: the oldest first. */
  private readonly clients = new Map<number, { person: string; at: number }>();
  private pumping = false;
  private again = false;
  private off: (() => void) | undefined;
  /** Done once this room is listening, and knows where the log is. */
  readonly ready: Promise<void>;

  constructor(private readonly d: Deps, readonly ownerId: string, readonly workspaceId: string, readonly documentId: string, private readonly tree: Room, private readonly rooms: Map<string, DocRoom>) {
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
    if (rest === REPLACED) { for (const s of this.streams) s.replaced(); return; }
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
  /** Whether this reader has the document open here. */
  holds(who: Who): boolean { return [...this.streams].some((s) => s.isFor(who)); }
  /** Someone's caret is theirs: true unless this room has heard another person use that client. */
  mayMove(client: number, person: string): boolean { return (this.clients.get(client)?.person ?? person) === person; }
  /** The same, of a caret this room has heard from them. */
  isTheirs(client: number, person: string): boolean { return this.clients.get(client)?.person === person; }
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
  /**
   * Reads on from where this room got to. Rows are read before how far the snapshot reaches, so a compaction landing between
   * the two can't be taken for rows that were read: seqs have no gaps until a compaction makes one, so the rows themselves say
   * what's gone. Whoever hadn't been told what's gone asks for it themselves. If what was read stops short of what's been heard
   * of, it's read again, as a compaction may have landed since.
   */
  private async readUpdates(p: Place): Promise<void> {
    const before = this.last;
    const found = await readUpdatesAfter(p, this.documentId, this.last);
    this.lost = false;
    const first = found.lines[0]?.seq;
    const gone = first === undefined ? found.through : first - 1;
    if (gone > this.last) {
      this.floor = Math.max(this.floor, gone);
      this.recent = this.recent.filter((l) => l.seq > gone);
      this.last = gone;
    }
    this.recent.push(...found.lines);
    this.last = Math.max(this.last, found.reached);
    this.forget();
    if (this.want > this.last && this.last > before) this.again = true;
  }
  /** Lets go of what everyone's been told, and of what's too much to hold for anyone who hasn't. */
  private forget(): void {
    let told = Infinity;
    for (const s of this.streams) told = Math.min(told, s.position);
    const waiting = this.recent.filter((l) => l.seq > told);
    let bytes = waiting.reduce((n, l) => n + l.bytes, 0);
    let drop = 0;
    for (; waiting.length - drop > 1 && (waiting.length - drop > RECENT_UPDATES || bytes > RECENT_BYTES); drop++) {
      const gone = waiting[drop];
      if (!gone) break;
      bytes -= gone.bytes;
      this.floor = Math.max(this.floor, gone.seq);
    }
    this.recent = waiting.slice(drop);
  }
  private pass(p: Place, text: string): void {
    const update = openRecord(workspaceKey(p.owner), awarenessHeader(p, this.documentId), utf8(text));
    const now = Date.now();
    for (const c of caretsIn(update)) {
      const state = CaretState.safeParse(c.state);
      this.clients.delete(c.client);
      if (c.state !== null && state.success && state.data.user) this.clients.set(c.client, { person: state.data.user.id, at: now });
    }
    for (const [client, heard] of this.clients) {
      if (this.clients.size <= CARET_OWNERS && now - heard.at < CARET_OWNER_MS) break;
      this.clients.delete(client);
    }
    this.carets.push({ n: ++this.caretsHeard, line: { type: 'awareness', update: b64u(update) } });
    if (this.carets.length > RECENT_CARETS) this.carets.shift();
  }
}

/** What a room hears: the log past `after`, as lines, how far those rows reach, and how far the snapshot reaches, without reading it. A row that won't open has no line, and is passed over. */
async function readUpdatesAfter(p: Place, documentId: string, after: number): Promise<{ lines: UpdateLine[]; reached: number; through: number }> {
  const found = await rows(p.owner.pool, LogRow, 'SELECT seq, update_ciphertext FROM document_updates WHERE owner_id = $1 AND document_id = $2 AND seq > $3 ORDER BY seq', [p.owner.ownerId, documentId, after]);
  const sealed = found.map((r) => ({ seq: r.seq, sealed: r.update_ciphertext }));
  const at = atOf(p, documentId);
  const key = contentKey(p.owner, documentId);
  const bytes = sealed.reduce((n, r) => n + r.sealed.length, 0);
  const { lines } = bytes <= INLINE_BYTES ? linesOf({ at, key, rows: sealed }) : await p.owner.docs.run('lines', { at, key, rows: sealed }, { big: false, bytes, first: true });
  const snapshot = await maybeOne(p.owner.pool, SnapshotAt, 'SELECT through_seq FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
  return { lines, reached: found.at(-1)?.seq ?? after, through: snapshot?.through_seq ?? 0 };
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

/** What a stream starts with, once: it's let go of as soon as it's written. `ascii`: the update, as base64url, ready to go on a line. */
interface First { seq: number; ascii: Uint8Array }

const samePerson = (a: Who, b: Who): boolean => a.principals.some((p) => b.principals.some((q) => Buffer.compare(p, q) === 0));

/** One browser's stream of a document: who it's for, and how far they've been told. Nothing of the document stays here. */
class DocStream extends LiveStream<DocLiveEvent> {
  private first: First | null = null;
  /** How far this browser has been told. Until it starts, as far as the room had got when it joined: whatever comes after that is kept for it. */
  private at: number;
  private caretsTold: number;
  private why: DocClosed = 'access';
  private shut = false;

  constructor(d: Deps, room: Room, private readonly doc: DocRoom, credentials: Credentials, who: Who, version: number, release: () => void, private role: 'edit' | 'read', private trashed: boolean) {
    super(d, room, credentials, who, version, release, { workspaceId: doc.workspaceId, documentId: doc.documentId });
    this.at = doc.reached;
    this.caretsTold = doc.caretsSoFar;
  }
  get position(): number { return this.at; }
  /** Where it starts: what it read once it was listening, so nothing falls between the two. */
  start(first: First): void { this.first = first; this.at = first.seq; }
  nudge(): void { this.poke(); }
  isFor(who: Who): boolean { return samePerson(this.who, who); }
  /** What it was showing has been replaced, so nothing here carries on from it. */
  replaced(): void { this.why = 'unavailable'; this.shut = true; this.poke(); }

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
      await line.raw(`{"type":"sync","seq":${first.seq},"role":"${this.role}","trashed":${this.trashed},"update":"`);
      await line.raw(first.ascii);
      await line.raw('"}\n');
    } finally {
      sending.bytes -= first.ascii.length;
    }
  }
  protected async step(line: Line<DocLiveEvent>): Promise<Step> {
    if (this.shut) return 'lost';
    const s = this.nextSnapshot();
    if (s !== undefined && !(await this.show(s, line))) return 'lost';
    const { behind, line: update } = this.doc.updateAfter(this.at);
    if (behind) { this.end(); return 'idle'; }
    if (update) {
      this.at = update.seq;
      await line.raw(update.text);
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
    if (this.first) { sending.bytes -= this.first.ascii.length; this.first = null; }
    super.leave();
    this.doc.leave(this);
  }
}

/** What a browser at `after` doesn't have yet, and the seq that brings it to. There's a limit to what can be on its way to browsers, known before anything's opened. */
async function syncFrom(p: Place, documentId: string, row: DocRow, after: number): Promise<First> {
  if (after > 0 && row.next_seq === after + 1) return { seq: after, ascii: NOTHING };
  if (sending.bytes + sizeOf(row) > SENDING_BYTES) throw new UnavailableError('Too many documents are opening right now. Try again in a moment.', { context: { workspaceId: p.workspaceId, documentId, bytes: sizeOf(row) } });
  const made = await p.owner.docs.run('sync', { ...(await sealedLog(p, documentId)), after }, jobFor(row));
  report(p, documentId, made.found);
  return { seq: made.seq, ascii: made.ascii };
}

/** A document that took more than a worker has stays closed for a while, on every instance and after a restart, so nobody's tab trying again costs anyone anything. */
async function closeFor(p: Place, documentId: string, e: DocFailure): Promise<void> {
  dlog.warn('document unavailable', { workspaceId: p.workspaceId, documentId, reason: e.reason, err: e });
  await exec(p.owner.pool, 'UPDATE documents SET closed_until = now() + make_interval(secs => $3) WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId, CLOSED_SECONDS]);
}
const saysUnavailable = async (out: StreamingApi) => { await out.write(`${JSON.stringify({ type: 'closed', why: 'unavailable' } satisfies DocLiveEvent)}\n`); };

/**
 * Opens a document's stream: it hears of changes first and reads second, so nothing falls between them, and anyone who
 * can't open it is refused here, before a line is written. Runs until the reader loses it, the browser goes or can't keep
 * up, this instance shuts down, or it's time to let go. A document that won't open says so, as its stream's only line.
 */
export async function open(d: Deps, credentials: Credentials, reader: Reader, workspaceId: string, documentId: string, after: number, address: string): Promise<(out: StreamingApi) => Promise<void>> {
  const release = d.hub.admit('document', limitKey(reader), address);
  try {
    const w = await workspaceFor(d, reader, workspaceId);
    const { role, item } = requireDocument(reader, w, documentId, 'read');
    const row = await documentRow(w, documentId);
    if (row.closed) { release(); return saysUnavailable; }
    if (item.kind === 'document') await started(w, documentId, row);
    const tree = roomFor(d, workspaceId);
    const room = docRoomFor(d, w, documentId, tree);
    const stream = new DocStream(d, tree, room, credentials, { email: reader.email, principals: reader.principals }, w.version, release, role, trashOf(w.state, documentId) !== null);
    tree.join(stream);
    room.join(stream);
    try {
      await Promise.all([tree.ready, room.ready]);
      // Whatever changed before the room was listening: nothing did, usually, and that costs one small query.
      void tree.read();
      const first = await syncFrom(w, documentId, await documentRow(w, documentId), after);
      sending.bytes += first.ascii.length;
      stream.start(first);
    } catch (e) {
      tree.leave(stream);
      room.leave(stream);
      if (!(e instanceof DocFailure)) throw e;
      await closeFor(w, documentId, e);
      release();
      return saysUnavailable;
    }
    return (out) => stream.run(out);
  } catch (e) {
    release();
    throw e;
  }
}
