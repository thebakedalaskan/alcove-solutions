/*
 * What a document or board holds (docs: Data and storage › Documents). Its content is a Yjs document, which this module keeps
 * without looking inside: each update from a browser is checked (./firewall.ts, ./updates.ts), sealed and appended to a log
 * under the `documents` row's lock, the log folds into one sealed snapshot now and then, and whole states are kept as
 * versions (./versions.ts). Yjs updates can arrive twice and in any order, so nothing here needs a receipt. Who can do what is
 * features/workspaces/access.ts's to say; who each Yjs client is, ./clients.ts's.
 *
 * Nothing here opens a document. What's in one came from browsers, and opening it can take any amount of time or memory, so
 * that's done by workers (live/doc-pool.ts, ./work.ts), from sealed bytes, and what they find comes back as plain data.
 * The row's lock is held only to write: taking a `seq`, sealing one update, swapping in a snapshot someone already worked out.
 * Reading a document and working on it happens outside it, so nobody's typing waits on someone else's big document.
 *
 * Server code reads and writes a document with `readDocument` and `writeDocument`, by the names in ./ops.ts: what it
 * writes goes through the same log and reaches every browser as any other update. Every change the server makes to a document
 * goes through `writeDocument`, or `restoreVersion` to put one back as it was, and both write it only as Yjs clients the log
 * hasn't had (`requireNewClients`). What starts a log (the seed, a copy, words rescued into a new document) isn't a change.
 * A document live, carets and streams, is ./live.ts.
 */
import { DOC_SEED, MAX_DOC_BYTES, type DocVersionReason } from '@alcove/api';
import type pg from 'pg';
import { z } from 'zod';
import type { Owner } from '../../../platform/context';
import { id128, sealJson, sealRecord, stateKey } from '../../../keys/crypto';
import { bigintText, bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../../platform/db';
import { ClientTakenError, ConflictError, TooLargeError, UnavailableError, ValidationError, notFound } from '../../../platform/errors';
import { DocFailure } from '../../../live/doc-pool';
import { runDoc } from './pool';
import { publish, type Hub } from '../../../live/hub';
import { log } from '../../../platform/log';
import { personIn, trashOf, type Reader, type StoredItem, type Workspace } from '../access';
import { MAX_NESTING, SERVER_CAPS, inspect, type Inspected } from './firewall';
import { docEdits, docReads, type ArgsOf, type OpTable, type ResultOf } from './ops';
import type { ContentKind } from './text';
import { sealUpdate, snapshotHeader, editorsHeader, type At, type Editor, type SealedLog } from './work';
import { noteClients, requireNewClients, nobody, WRITE_TRIES, workedOutAgain } from './clients';

const dlog = log.child({ component: 'documents' });
export type { Editor } from './work';

/** How much of a log folds into a snapshot, whichever comes first. */
const COMPACT_UPDATES = 200;
const COMPACT_BYTES = 1024 * 1024;
/** A version is kept at most this often while people edit. */
const VERSION_EVERY_MS = 10 * 60_000;
/**
 * What a document keeps of its past, in bytes: past this the oldest go, so a document edited for months stays a size that can
 * be stored. The newest always stays. Nothing goes for being one of many: an old version is often the last to hold words
 * that were deleted since, and telling would mean opening every one of them.
 */
const MAX_VERSION_BYTES = 64 * 1024 * 1024;
/** What's small enough to read or seal here: past this a worker does it, so one big update doesn't hold up everyone else. */
export const INLINE_BYTES = 32 * 1024;
/** A document past either of these takes turns on the one worker that has the memory. A document of real blocks holds about 1,000 bytes an item, and at this many peaks well inside what the others have. */
export const BIG_DOC_BYTES = 256 * 1024;
const BIG_DOC_ITEMS = 25_000;
/** One update past this is sealed and read by that worker too: it goes through a few copies as text, which the others have no room for. */
export const BIG_UPDATE_BYTES = 4 * 1024 * 1024;
/** How long a document that wouldn't open stays closed, so a tab trying again can't keep a worker busy. */
const CLOSED_SECONDS = 300;
/** How long a document whose compaction failed is left before the next try, and how often a full one, which compacts with every update, can. */
const FOLD_AGAIN_MS = 60_000;
const FOLD_SOON_MS = 2_000;

export const kindOf = (item: StoredItem): ContentKind => (item.kind === 'board' ? 'board' : 'document');
export const roomKey = (workspaceId: string, documentId: string) => `${workspaceId}:${documentId}`;

/** Where something's kept: a workspace and its keys, opened for this request. */
export type Place = Pick<Workspace, 'owner' | 'workspaceId'>;
/** That, and its tree, to say what kind of thing something is. */
export type Held = Pick<Workspace, 'owner' | 'workspaceId' | 'state'>;

export function requireContent(w: Held, documentId: string): void {
  const item = w.state.items[documentId];
  if (!item || item.kind === 'folder') throw notFound('That document', { workspaceId: w.workspaceId, documentId });
}
/** What an operation says it's for, when it says. */
const SaysKind = z.object({ kind: z.enum(['document', 'board']) });
/**
 * An operation that goes by what kind of thing it's working on is for that kind: what the tree says this is, whatever the caller
 * says. A board's template written on a document would be frames beside its words.
 */
function requireKind(w: Held, documentId: string, args: unknown): void {
  const said = SaysKind.safeParse(args), item = w.state.items[documentId];
  if (said.success && item && said.data.kind !== kindOf(item)) throw new ValidationError(`That’s not a ${said.data.kind}.`, { context: { workspaceId: w.workspaceId, documentId, kind: said.data.kind } });
}
/** Where a log read ends: the next seq after its last row, or after its snapshot when it has none. */
export const markOf = (log: SealedLog): number => (log.rows.at(-1)?.seq ?? log.base?.throughSeq ?? 0) + 1;

/* ---------- records ---------- */

export const editorOf = (o: Owner, r: Reader): Editor => {
  const { id, name, portrait } = personIn(o, r);
  return { id, name, ...(portrait ? { portrait } : {}) };
};

export const contentKey = (o: Owner, documentId: string): Uint8Array => stateKey(o.root, o.ownerId, `document:${documentId}`);
export const atOf = (p: Place, documentId: string): At => ({ ownerId: p.owner.ownerId, workspaceId: p.workspaceId, documentId });

/* ---------- the log ---------- */

export const LogRow = z.object({ seq: bigintText, update_ciphertext: bytea });
const BaseRow = z.object({ through_seq: bigintText, snapshot_ciphertext: bytea, editors_ciphertext: bytea });

/** The log, sealed, for a worker to open. The rows come first and the snapshot second: a compaction between the two leaves rows the snapshot also has, which Yjs doesn't mind, and never a gap. */
export async function sealedLog(p: Place, documentId: string, through?: number | undefined): Promise<SealedLog> {
  const found = await rows(p.owner.pool, LogRow, `SELECT seq, update_ciphertext FROM document_updates WHERE owner_id = $1 AND document_id = $2${through === undefined ? '' : ' AND seq <= $3'} ORDER BY seq`, [p.owner.ownerId, documentId, ...(through === undefined ? [] : [through])]);
  const base = await maybeOne(p.owner.pool, BaseRow, 'SELECT through_seq, snapshot_ciphertext, editors_ciphertext FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
  return {
    at: atOf(p, documentId), key: contentKey(p.owner, documentId), rows: found.map((r) => ({ seq: r.seq, sealed: r.update_ciphertext })),
    base: base ? { throughSeq: base.through_seq, snapshot: base.snapshot_ciphertext, editors: base.editors_ciphertext } : null
  };
}

/** What a worker found wrong in a log, said here, where there's somewhere to say it. */
export function report(p: Place, documentId: string, found: { skipped: number[]; unreadable: number[]; pending: boolean }): void {
  for (const seq of [...found.skipped, ...found.unreadable]) dlog.warn('document row skipped', { workspaceId: p.workspaceId, documentId, seq, unreadable: found.unreadable.includes(seq) });
  if (found.pending) dlog.warn('document held something that could never apply', { workspaceId: p.workspaceId, documentId });
}

export const DocRow = z.object({
  next_seq: bigintText, updates_since_snapshot: z.number(), bytes_since_snapshot: bigintText, snapshot_bytes: bigintText, snapshot_items: bigintText, snapshot_retired_items: bigintText, items_since_snapshot: bigintText,
  snapshot_nesting: z.number(), nesting_since_snapshot: z.number(), version_seq: bigintText, version_at: timestamp.nullable(), created_at: timestamp, held: z.boolean(), closed: z.boolean()
});
export type DocRow = z.infer<typeof DocRow>;
const DOC_COLUMNS = `next_seq, updates_since_snapshot, bytes_since_snapshot, snapshot_bytes, snapshot_items, snapshot_retired_items, items_since_snapshot, snapshot_nesting, nesting_since_snapshot, version_seq, version_at, created_at,
  coalesce(held_until > now(), false) AS held, coalesce(closed_until > now(), false) AS closed`;
/** Holds a document's row: everything that writes to its log takes turns here, on every instance. Hold it only to write. */
export async function lockDocument(c: pg.PoolClient, p: Place, documentId: string): Promise<DocRow> {
  const row = await maybeOne(c, DocRow, `SELECT ${DOC_COLUMNS} FROM documents WHERE owner_id = $1 AND document_id = $2 FOR NO KEY UPDATE`, [p.owner.ownerId, documentId]);
  if (!row) throw notFound('That document', { workspaceId: p.workspaceId, documentId });
  return row;
}
export async function documentRow(p: Place, documentId: string): Promise<DocRow> {
  const row = await maybeOne(p.owner.pool, DocRow, `SELECT ${DOC_COLUMNS} FROM documents WHERE owner_id = $1 AND document_id = $2`, [p.owner.ownerId, documentId]);
  if (!row) throw notFound('That document', { workspaceId: p.workspaceId, documentId });
  return row;
}
export const sizeOf = (row: DocRow): number => row.snapshot_bytes + row.bytes_since_snapshot;
const itemsOf = (row: DocRow): number => row.snapshot_items + row.items_since_snapshot;
/** What's on its page: all of that, but for what the last compaction found had left it. */
const pageOf = (row: DocRow): number => Math.max(itemsOf(row) - row.snapshot_retired_items, 0);
/** The deepest a document's types could go: exact at a compaction, and everything since counts as if it nested below the deepest thing there. */
const nestingOf = (row: DocRow): number => row.snapshot_nesting + row.nesting_since_snapshot;
/** What a worker needs to know of a job on this document. `who`: whose turn it's on, which is the workspace's if nobody in particular asked. */
export const jobFor = (p: Place, documentId: string, row: DocRow, who: string = p.owner.ownerId) => ({ big: sizeOf(row) > BIG_DOC_BYTES || itemsOf(row) > BIG_DOC_ITEMS, bytes: sizeOf(row), who, doc: documentId });

export const byLimits = (p: Place, bytes: number, items: number, times = 1): boolean => bytes > MAX_DOC_BYTES * times || items > p.owner.cfg.DOC_ITEMS_MAX * times;
export const tooLong = (p: Place, documentId: string, bytes: number, items: number) => new TooLargeError('This document is too long to add to. Delete something from it first.', { context: { workspaceId: p.workspaceId, documentId, bytes, items } });
/** How far past its limit what's on a document's page, or its size, can be, which only a race between two updates comes near. */
const CEILING = 2;
/**
 * How much it can hold in all, as a multiple of that limit, whatever's on its page: what's been overwritten or deleted stays in
 * memory too. A document at both ceilings at once, of the worst shape measured, compacts with a third of its worker's memory
 * to spare, and ran out at about twice as much.
 */
export const HOLDS = 3;
/** What a document comes to, exactly, before an update and after it, from a worker that opened it. */
interface Weight { items: number; bytes: number; state: number }
export interface Weighed { before: Weight; after: Weight }
/**
 * A document's size is capped, in bytes and in items, because its memory follows items, so nobody can fill the disk or an
 * instance with one. The limit is on what's on its page: blocks are retired and words deleted, and a page someone emptied has
 * room, however much of that Yjs has to keep. One rule holds at the limit: an update goes in if it doesn't add to what's on
 * the page, counting what it adds against what it deletes and retires. So deletes, retires, joins and moves go through, whole,
 * and nothing ever has to be sent apart. The figures on the row are the most it could come to, so most updates are taken on
 * those alone, and one they can't settle is weighed exactly, by a worker that opens the document: `'weigh'`, and then again
 * with what that says. Bytes go the same way, by what's said on the page, since a move adds a little structure every time.
 *
 * Everything a document holds costs memory, on its page or not, so there are ceilings that nothing gets past but deletes: on
 * what's on the page and on its size, at twice the limit, and on all it holds, including every value a map key has had, which
 * Yjs keeps and no compaction can let go of. A document at its ceilings opens, folds and copies inside its worker: that's
 * where they were measured, and a copy lets go of what's been overwritten. How deep things nest is held the same way. Those
 * figures can be more than what's there, so a refusal compacts the document, which finds out, and it's judged again.
 */
export function requireRoom(p: Place, documentId: string, row: DocRow, bytes: number, seen: Inspected, weighed: Weighed | null): 'fits' | 'weigh' {
  if (!seen.blocks.length) return 'fits';
  const size = sizeOf(row) + bytes;
  const items = itemsOf(row) + seen.items;
  const page = pageOf(row) + seen.items;
  if (items > p.owner.cfg.DOC_ITEMS_MAX * HOLDS || byLimits(p, size, page, CEILING) || (seen.nesting > 0 && nestingOf(row) + seen.nesting > MAX_NESTING)) throw tooLong(p, documentId, size, items);
  if (!byLimits(p, size, page)) return 'fits';
  if (!weighed) return 'weigh';
  const { before, after } = weighed;
  if ((after.items <= p.owner.cfg.DOC_ITEMS_MAX || after.items <= before.items) && (after.state <= MAX_DOC_BYTES || after.bytes <= before.bytes)) return 'fits';
  throw tooLong(p, documentId, after.state, after.items);
}
export const restoring = (p: Place, documentId: string) => new UnavailableError('This document is being put back to an earlier version. What’s here will go in a moment.', { context: { workspaceId: p.workspaceId, documentId } });

export async function writeSnapshot(db: Db, p: Place, documentId: string, throughSeq: number, snapshot: Uint8Array, editors: Uint8Array): Promise<void> {
  await exec(db, `INSERT INTO document_snapshots (owner_id, document_id, through_seq, snapshot_ciphertext, editors_ciphertext) VALUES ($1,$2,$3,$4,$5)
                  ON CONFLICT (owner_id, document_id) DO UPDATE SET through_seq = EXCLUDED.through_seq, snapshot_ciphertext = EXCLUDED.snapshot_ciphertext, editors_ciphertext = EXCLUDED.editors_ciphertext`, [
    p.owner.ownerId, documentId, throughSeq, snapshot, editors
  ]);
}

export const SnapshotAt = z.object({ through_seq: bigintText });
export interface Keep { reason: DocVersionReason; callId: string | null }

async function writeVersion(c: Db, p: Place, documentId: string, versionId: string, v: { info: Uint8Array; parts: Uint8Array[]; bytes: number }): Promise<void> {
  await exec(c, 'INSERT INTO document_versions (owner_id, document_id, version_id, info_ciphertext, bytes, parts) VALUES ($1,$2,$3,$4,$5,$6)', [p.owner.ownerId, documentId, versionId, v.info, v.bytes, v.parts.length]);
  await exec(c, `INSERT INTO document_version_parts (owner_id, document_id, version_id, part, state_ciphertext)
                 SELECT $1, $2, $3, t.ord - 1, t.sealed FROM unnest($4::bytea[]) WITH ORDINALITY AS t(sealed, ord)`, [p.owner.ownerId, documentId, versionId, v.parts.map((part) => Buffer.from(part))]);
  await exec(c, `DELETE FROM document_versions v USING (
      SELECT version_id, row_number() OVER newest AS n, sum(bytes) OVER newest AS kept_bytes
      FROM document_versions WHERE owner_id = $1 AND document_id = $2 WINDOW newest AS (ORDER BY created_at DESC, version_id)
    ) kept WHERE v.owner_id = $1 AND v.document_id = $2 AND v.version_id = kept.version_id AND kept.n > 1 AND kept.kept_bytes > $3`, [p.owner.ownerId, documentId, MAX_VERSION_BYTES]);
}

/**
 * Folds the log through `through` into a snapshot, with a version kept of it if asked: a whole state, so that it opens
 * whatever happens to the log after it. A version says who changed the document since the last one, and that starts over.
 *
 * The work happens outside any lock, because what's in the log up to `through` never changes, and it's proved to open again
 * before anything is deleted. The row's lock is taken only to swap it in, and only if the snapshot is still the one this
 * started from: otherwise someone else folded it first, on this instance or another, and nothing is written. That's `raced`.
 */
export async function fold(p: Place, documentId: string, through: number, keep?: Keep): Promise<{ raced: boolean; wrote: boolean; versionId: string | null }> {
  const row = await documentRow(p, documentId);
  if (row.closed) return { raced: false, wrote: false, versionId: null };
  const l = await sealedLog(p, documentId, through);
  const from = l.base?.throughSeq ?? null;
  const reach = Math.max(through, from ?? 0);
  if (!keep && from !== null && reach === from) return { raced: false, wrote: false, versionId: null };
  const versionId = keep ? id128() : null;
  const covered = l.rows.filter((r) => r.seq > (from ?? 0));
  const made = await working(p, documentId, row, () => runDoc(p.owner.docs, 'fold', { ...l, rows: covered, through: reach, keep: keep && versionId ? { ...keep, versionId } : null }, jobFor(p, documentId, row)));
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
  return { raced: !wrote, wrote, versionId: wrote ? versionId : null };
}
/** What a document comes to now a snapshot says it exactly, and what's left in the log on top. */
export async function settleFigures(c: Db, p: Place, documentId: string, shape: { bytes: number; items: number; retired: number; nesting: number }, versionSeq: number | null): Promise<void> {
  await exec(c, `UPDATE documents d SET snapshot_bytes = $3, snapshot_items = $4, snapshot_retired_items = $5, snapshot_nesting = $6, updates_since_snapshot = r.n, bytes_since_snapshot = r.bytes, items_since_snapshot = r.items, nesting_since_snapshot = r.nesting
                 ${versionSeq === null ? '' : ', version_seq = $7, version_at = now()'}
                 FROM (SELECT count(*)::int AS n, coalesce(sum(bytes), 0) AS bytes, coalesce(sum(items), 0) AS items, coalesce(sum(nesting), 0)::int AS nesting FROM document_updates WHERE owner_id = $1 AND document_id = $2) r
                 WHERE d.owner_id = $1 AND d.document_id = $2`, [p.owner.ownerId, documentId, shape.bytes, shape.items, shape.retired, shape.nesting, ...(versionSeq === null ? [] : [versionSeq])]);
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
export interface Tending { through: number; keep: Keep | undefined; full: boolean }
/**
 * After an update lands: a version of what was there before it, if ten minutes of editing have gone by; a compaction, if the
 * log has grown, or the document is full and this took something out of it. Both stop just short of the update itself,
 * which streams are reading at this moment. None of this is worth an update, which is safe by now, and a document that won't
 * open stops nobody else: a failure is logged, and it's tried again a little later.
 */
export function tendingAfter(p: Place, row: DocRow, seq: number, bytes: number, callId: string | null): Tending | null {
  const version = seq - 1 > row.version_seq && Date.now() - (row.version_at ?? row.created_at).getTime() >= VERSION_EVERY_MS;
  const full = byLimits(p, sizeOf(row), pageOf(row)) || nestingOf(row) > MAX_NESTING / 2;
  const compact = row.updates_since_snapshot + 1 >= COMPACT_UPDATES || row.bytes_since_snapshot + bytes >= COMPACT_BYTES || full;
  if (!version && !compact) return null;
  return { through: seq - 1, keep: version ? { reason: 'edits', callId } : undefined, full };
}
/** Whether anything was folded. */
export async function tend(p: Place, documentId: string, t: Tending): Promise<boolean> {
  const { busy, notBefore } = foldingOn(p.owner.hub);
  const key = roomKey(p.workspaceId, documentId);
  if (busy.has(key) || Date.now() < (notBefore.get(key) ?? 0)) return false;
  busy.add(key);
  if (notBefore.size > 1000) notBefore.clear();
  try {
    const { wrote } = await fold(p, documentId, t.through, t.keep);
    if (t.full) notBefore.set(key, Date.now() + FOLD_SOON_MS);
    return wrote;
  } catch (e) {
    notBefore.set(key, Date.now() + FOLD_AGAIN_MS);
    dlog.warn('document not folded', { workspaceId: p.workspaceId, documentId, err: e });
    return false;
  } finally {
    busy.delete(key);
  }
}

/** Puts an update at the end of the log, under the row's lock, and tells every instance when the transaction commits. `deletes`: its tag, if it deletes anything. */
export async function append(c: pg.PoolClient, p: Place, documentId: string, row: DocRow, update: Uint8Array, by: Editor | null, seen: Inspected, people: (client: number) => Uint8Array, deletes: Uint8Array | null = null): Promise<number> {
  const seq = row.next_seq;
  const at = atOf(p, documentId);
  const key = contentKey(p.owner, documentId);
  const sealed = update.length <= INLINE_BYTES ? sealUpdate(at, key, seq, by, update) : (await runDoc(p.owner.docs, 'seal', { at, key, seq, by, update }, { big: update.length > BIG_UPDATE_BYTES, bytes: update.length, who: p.owner.ownerId, first: true })).sealed;
  await exec(c, 'INSERT INTO document_updates (owner_id, document_id, seq, update_ciphertext, bytes, items, nesting, deletes_tag) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [p.owner.ownerId, documentId, seq, sealed, update.length, seen.items, seen.nesting, deletes ? Buffer.from(deletes) : null]);
  await exec(c, `UPDATE documents SET next_seq = $3, updates_since_snapshot = updates_since_snapshot + 1, bytes_since_snapshot = bytes_since_snapshot + $4, items_since_snapshot = items_since_snapshot + $5,
                 nesting_since_snapshot = nesting_since_snapshot + $6 WHERE owner_id = $1 AND document_id = $2`, [p.owner.ownerId, documentId, seq + 1, update.length, seen.items, seen.nesting]);
  await noteClients(c, p, documentId, seen.blocks, people);
  await publish(c, p.workspaceId, `${documentId}:${seq}`);
  return seq;
}

/* ---------- reading and writing a document on the server ---------- */

type Reads = typeof docReads;
type Edits = typeof docEdits;
const reads: OpTable<Reads> = docReads;
const edits: OpTable<Edits> = docEdits;

/**
 * How far each of these documents has got, in one small query, for knowing whether what was read of one still holds: `at`
 * moves on with every update, and when one's put back to a version. `closed` as `working` reads it.
 */
export async function documentsAt(db: Db, ownerId: string, documentIds: string[]): Promise<Map<string, { at: string; closed: boolean }>> {
  const found = await rows(db, z.object({ document_id: z.string(), next_seq: bigintText, version_at: timestamp.nullable(), closed: z.boolean() }),
    'SELECT document_id, next_seq, version_at, coalesce(closed_until > now(), false) AS closed FROM documents WHERE owner_id = $1 AND document_id = ANY($2::text[])', [ownerId, documentIds]);
  return new Map(found.map((r) => [r.document_id, { at: `${r.next_seq}:${r.version_at?.getTime() ?? 0}`, closed: r.closed }]));
}
/**
 * Asks a document something, for code that has decided the reader may have it (`requireDocument`). What can be asked is in
 * documentOps.ts. `who`: whose turn it's on, for someone who asked (`limitKey`); the workspace's when it's the server's own.
 */
export async function readDocument<N extends keyof Reads>(w: Held, documentId: string, op: N, args: ArgsOf<Reads[N]>, who?: string | undefined): Promise<ResultOf<Reads[N]>> {
  requireContent(w, documentId);
  requireKind(w, documentId, args);
  const row = await documentRow(w, documentId);
  const done = await working(w, documentId, row, async () => runDoc(w.owner.docs, 'read', { ...(await sealedLog(w, documentId)), op, args }, jobFor(w, documentId, row, who)));
  report(w, documentId, done.found);
  return reads[op].result.parse(done.value);
}

/**
 * Changes a document on the server, for code that has decided it may be: what can be done is in documentOps.ts, and it's done
 * to the document as it stands, as a browser would, and the update is appended and reaches everyone like any other. Anyone
 * typing meanwhile merges with it. A change that changes nothing writes nothing. `by` is who it's for, if anyone. `holding`
 * runs in the transaction that writes it, for what must still hold by then. Refused in Trash, like an edit, and refused for
 * something it isn't for: what kind of thing it's working on is the tree's to say (`requireKind`).
 *
 * It's written only as Yjs clients the log hasn't had (`requireNewClients`). One that finds a client taken by then is worked out
 * again on the document as it now stands, `holding`'s part taken back with it, in three tries at most: so an operation written as
 * a fixed client, a board's template, lands once however many ask for it at the same moment, and asking again changes nothing.
 */
export async function writeDocument<N extends keyof Edits>(
  w: Held, documentId: string, op: N, args: ArgsOf<Edits[N]>, opts: { by?: Editor | null | undefined; callId?: string | null | undefined; holding?: ((c: Db) => Promise<void>) | undefined } = {}
): Promise<{ seq: number; result: ResultOf<Edits[N]> }> {
  requireContent(w, documentId);
  requireKind(w, documentId, args);
  if (trashOf(w.state, documentId)) throw new ConflictError('This is in Trash. Restore it to change it.', { context: { workspaceId: w.workspaceId, documentId } });
  for (let tries = 1; ; tries++) {
    const row = await documentRow(w, documentId);
    let read = row.next_seq;
    const done = await working(w, documentId, row, async () => {
      const log = await sealedLog(w, documentId);
      read = markOf(log);
      return runDoc(w.owner.docs, 'edit', { ...log, op, args }, jobFor(w, documentId, row));
    });
    report(w, documentId, done.found);
    const result = edits[op].result.parse(done.value);
    const { update, seen } = done;
    if (!update || !seen) return { seq: row.next_seq - 1, result };
    try {
      const { seq, tending } = await tx(w.owner.pool, async (c) => {
        await opts.holding?.(c);
        const locked = await lockDocument(c, w, documentId);
        if (locked.held) throw restoring(w, documentId);
        await requireNewClients(c, w, documentId, locked, { read, clients: seen.blocks.map((b) => b.client), what: op });
        requireRoom(w, documentId, locked, update.length, seen, done.weighed);
        const landed = await append(c, w, documentId, locked, update, opts.by ?? null, seen, nobody);
        return { seq: landed, tending: tendingAfter(w, locked, landed, update.length, opts.callId ?? null) };
      });
      if (tending) await tend(w, documentId, tending);
      return { seq, result };
    } catch (e) {
      if (!(e instanceof ClientTakenError) || tries >= WRITE_TRIES) throw e;
      workedOutAgain(w.workspaceId, documentId, op, tries);
    }
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
export async function started(p: Place, documentId: string, row: DocRow): Promise<void> {
  if (row.snapshot_bytes > 0 || row.next_seq > 1) return;
  await tx(p.owner.pool, async (c) => {
    const locked = await lockDocument(c, p, documentId);
    if (locked.snapshot_bytes === 0 && locked.next_seq === 1) await startContent(p, c, [documentId]);
  });
}
/** How often a copy waits for its turn when the workers are full, and how long at first: about 15 seconds in all. */
const COPY_TRIES = 6;
const COPY_WAIT_MS = 500;
/**
 * A copy holds what `from` holds now, as its first update, and a document's title says what the tree calls the copy. It's
 * done after the copy is in the tree, outside any lock, one at a time: a folder of big documents mustn't hold up everyone
 * typing in the workspace, and anyone who opens a copy meanwhile merges with it. One whose records won't open leaves its
 * copy as it started, and the rest are made all the same. Workers being busy says nothing about the document: that waits,
 * and if it goes on, this throws, for nobody to be left with a blank copy that looks like the real thing.
 */
export async function copyContent(p: Place, from: string, to: string, kind: ContentKind, name: string, who: string): Promise<void> {
  for (let tries = 1; ; tries++) {
    try {
      const row = await documentRow(p, from);
      const made = await runDoc(p.owner.docs, 'copy', { ...(await sealedLog(p, from)), name: kind === 'document' && name ? name : null }, jobFor(p, from, row, who));
      report(p, from, made.found);
      if (!made.seen.blocks.length) return;
      await tx(p.owner.pool, async (c) => { await append(c, p, to, await lockDocument(c, p, to), made.state, null, made.seen, nobody); });
      return;
    } catch (e) {
      const busy = e instanceof UnavailableError && !(e instanceof DocFailure);
      if (busy && tries >= COPY_TRIES) throw e;
      if (!busy) { dlog.warn('document not copied', { workspaceId: p.workspaceId, documentId: from, err: e }); return; }
      await new Promise((resolve) => setTimeout(resolve, COPY_WAIT_MS * 2 ** (tries - 1)));
    }
  }
}

/**
 * A job on a document, as the server does for itself: one that's closed costs no worker, and one that proves too much, out of
 * a worker's time or memory, closes, so a poll asking again can't keep a worker on it, however many people are polling. A
 * worker that only says the job failed closes nothing: a compaction that won't pass a row it can't read is one, and the
 * document opens fine without that row.
 */
export async function working<T>(p: Place, documentId: string, row: DocRow, job: () => Promise<T>): Promise<T> {
  if (row.closed) throw new UnavailableError('This document can’t be opened right now.', { context: { workspaceId: p.workspaceId, documentId } });
  try {
    return await job();
  } catch (e) {
    if (e instanceof DocFailure && e.reason !== 'failed') await closeFor(p, documentId, e);
    throw e;
  }
}
/** A document that took more than a worker has stays closed for a while, on every instance and after a restart, so nobody's tab trying again costs anyone anything. */
export async function closeFor(p: Place, documentId: string, e: DocFailure): Promise<void> {
  dlog.warn('document unavailable', { workspaceId: p.workspaceId, documentId, reason: e.reason, err: e });
  await exec(p.owner.pool, 'UPDATE documents SET closed_until = now() + make_interval(secs => $3) WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId, CLOSED_SECONDS]);
}
