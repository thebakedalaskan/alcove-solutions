/*
 * Everything done to a document's Yjs state, away from the event loop (live/docPool.ts runs these in a worker). What's in a
 * document came from browsers, and opening one can take any amount of time or memory, so nothing here touches the database,
 * the hub or a request: sealed bytes come in with the key to open them, and sealed bytes and plain data go out.
 *
 * Opening survives what's wrong with one row, because a row is someone's update and the document is everyone's: a row that
 * won't apply is left out and named in the result, for the caller to log. A compaction goes further, and proves what it made
 * opens again before anything is deleted.
 *
 * The small things here run on the event loop too, for what's too small to be worth a trip to a worker.
 */
import { DOC_FRAGMENT, ItemKindSchema, PortraitStyleSchema, SearchDocSchema } from '@alcove/api';
import { settleUndone, undoMayDelete } from '@alcove/api/retire';
import * as Y from 'yjs';
import { z } from 'zod';
import { b64u, concat, fromUtf8, jcs, openJson, openRecord, sealJson, sealRecord, toJson, utf8, type RecordHeader } from '../crypto';
import { SERVER_CAPS, inspect, type Inspected } from './documentFirewall';
import { docEdits, docReads } from './documentOps';
import { documentText, type ContentKind } from './documentText';

/* ---------- records ---------- */

/** Someone who changed a document, as a version names them. Never an address. */
export const EditorSchema = z.object({ id: z.string(), name: z.string(), portrait: PortraitStyleSchema.optional().catch(undefined) });
export type Editor = z.infer<typeof EditorSchema>;
const StoredEditors = z.array(EditorSchema);

/** Where a document's records are bound to. */
export const AtSchema = z.object({ ownerId: z.string(), workspaceId: z.string(), documentId: z.string() });
export type At = z.infer<typeof AtSchema>;
const at = (p: At) => ({ v: 1 as const, ownerId: p.ownerId, workspaceId: p.workspaceId, documentId: p.documentId });
export const updateHeader = (p: At, seq: number): RecordHeader => ({ ...at(p), kind: 'document-update', seq });
export const snapshotHeader = (p: At, throughSeq: number): RecordHeader => ({ ...at(p), kind: 'document-snapshot', throughSeq });
export const editorsHeader = (p: At, throughSeq: number): RecordHeader => ({ ...at(p), kind: 'document-editors', throughSeq });
export const versionInfoHeader = (p: At, versionId: string): RecordHeader => ({ ...at(p), kind: 'document-version', versionId, part: 'info' });
/** A part knows how many there are, so a version can't be cut short or have its parts swapped. */
const versionPartHeader = (p: At, versionId: string, index: number, of: number): RecordHeader => ({ ...at(p), kind: 'document-version', versionId, part: 'state', index, of });

/** How much of a version is sealed at a time: what a reader holds while it's on its way, and no more. */
const VERSION_PART_BYTES = 256 * 1024;
export const StoredVersionInfo = z.object({ by: z.array(EditorSchema).default([]), callId: z.string().nullable().default(null), reason: z.enum(['edits', 'call', 'restore']).default('edits') });

/** One update as it's kept: who sent it, for the next version to say, and the bytes, which can be megabytes and aren't worth encoding. */
function packUpdate(by: Editor | null, update: Uint8Array): Uint8Array {
  const who = utf8(jcs(toJson(by)));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, who.length);
  return concat(length, who, update);
}
function unpackUpdate(packed: Uint8Array): { by: Editor | null; update: Uint8Array } {
  const length = new DataView(packed.buffer, packed.byteOffset, 4).getUint32(0);
  return { by: EditorSchema.nullable().parse(JSON.parse(fromUtf8(packed.subarray(4, 4 + length)))), update: packed.subarray(4 + length) };
}
export const sealUpdate = (p: At, key: Uint8Array, seq: number, by: Editor | null, update: Uint8Array): Uint8Array => sealRecord(key, updateHeader(p, seq), packUpdate(by, update));

/** A line of a document's stream, ready to write: a room makes it once for everyone it's for. */
export const updateLine = (seq: number, update: Uint8Array): string => `{"type":"update","seq":${seq},"update":"${b64u(update)}"}\n`;

function sealVersion(p: At, key: Uint8Array, versionId: string, state: Uint8Array): Uint8Array[] {
  const of = Math.max(Math.ceil(state.length / VERSION_PART_BYTES), 1);
  return Array.from({ length: of }, (_, index) => sealRecord(key, versionPartHeader(p, versionId, index, of), state.subarray(index * VERSION_PART_BYTES, (index + 1) * VERSION_PART_BYTES)));
}
export const openVersionPart = (p: At, key: Uint8Array, versionId: string, index: number, of: number, sealed: Uint8Array): Uint8Array => openRecord(key, versionPartHeader(p, versionId, index, of), sealed);

/* ---------- opening a log ---------- */

const Bytes = z.custom<Uint8Array>((v) => v instanceof Uint8Array);
const SealedBase = z.object({ throughSeq: z.number(), snapshot: Bytes, editors: Bytes });
const SealedRow = z.object({ seq: z.number(), sealed: Bytes });
/** A document's log as it's stored, with the key to open it. */
const SealedLog = z.object({ at: AtSchema, key: Bytes, base: SealedBase.nullable(), rows: z.array(SealedRow) });
export type SealedLog = z.infer<typeof SealedLog>;

/** What opening found wrong: rows left out, for the caller to log. `pending`: something waited for what never came, and is dropped. */
const Found = z.object({ skipped: z.array(z.number()), unreadable: z.array(z.number()), pending: z.boolean() });
type Found = z.infer<typeof Found>;
interface OpenRow { seq: number; update: Uint8Array; by: Editor | null }
interface OpenLog { base: Uint8Array | null; editors: Editor[]; rows: OpenRow[]; unreadable: number[] }

/** Opens what's sealed. A row that won't open is one row; a snapshot that won't open is the document. */
function openLog(l: SealedLog): OpenLog {
  const base = l.base ? openRecord(l.key, snapshotHeader(l.at, l.base.throughSeq), l.base.snapshot) : null;
  const editors = l.base ? openJson(l.key, editorsHeader(l.at, l.base.throughSeq), l.base.editors, StoredEditors) : [];
  const rows: OpenRow[] = [];
  const unreadable: number[] = [];
  for (const r of l.rows) {
    try {
      rows.push({ seq: r.seq, ...unpackUpdate(openRecord(l.key, updateHeader(l.at, r.seq), r.sealed)) });
    } catch {
      unreadable.push(r.seq);
    }
  }
  return { base, editors, rows, unreadable };
}

interface Built { doc: Y.Doc; marked: Uint8Array | null; skipped: number[]; pending: boolean }
/**
 * The state a log comes to. Going through a Y.Doc rather than `Y.mergeUpdates` lets go of what was deleted: only that it's
 * gone is kept, so a word someone took out isn't sent to the next person who opens it. A client that was offline still
 * merges, because a deleted thing keeps its place in the sequence.
 *
 * A row that isn't an update an honest client could send, or that Yjs can't apply, is left out, and the document starts over
 * without it, so nothing half-applied is ever served. `mark`: the state vector as of that `seq`, for what a browser there lacks.
 */
function build(l: OpenLog, mark: number | null = null): Built {
  const skipped = new Set<number>();
  for (;;) {
    const doc = new Y.Doc();
    let marked: Uint8Array | null = null;
    let bad: number | null = null;
    if (l.base) Y.applyUpdate(doc, l.base);
    for (const r of l.rows) {
      if (mark !== null && marked === null && r.seq > mark) marked = Y.encodeStateVector(doc);
      if (skipped.has(r.seq)) continue;
      if (inspect(r.update, SERVER_CAPS).why) { skipped.add(r.seq); continue; }
      try {
        Y.applyUpdate(doc, r.update);
      } catch {
        bad = r.seq;
        break;
      }
    }
    if (bad !== null) {
      doc.destroy();
      skipped.add(bad);
      continue;
    }
    // Whatever's still waiting will wait for ever: Yjs would carry it into every snapshot.
    const pending = doc.store.pendingStructs !== null || doc.store.pendingDs !== null;
    doc.store.pendingStructs = null;
    doc.store.pendingDs = null;
    return { doc, marked: mark === null ? null : marked ?? Y.encodeStateVector(doc), skipped: [...skipped], pending };
  }
}

/** How many structs a document holds: what its memory follows, whatever its size in bytes. */
const itemsIn = (doc: Y.Doc): number => [...doc.store.clients.values()].reduce((n, structs) => n + structs.length, 0);
/** How deep its types nest, walked with a list, because a walk that recursed would be what this is here to stop. */
function nestingIn(doc: Y.Doc): number {
  let deepest = 1;
  const waiting = [...doc.share.values()].map((type) => ({ type, depth: 0 }));
  const look = (item: Y.Item, depth: number) => {
    if (item.deleted || !(item.content instanceof Y.ContentType)) return;
    deepest = Math.max(deepest, depth + 1);
    waiting.push({ type: item.content.type, depth: depth + 1 });
  };
  for (let next = waiting.pop(); next; next = waiting.pop()) {
    for (let item = next.type._start; item; item = item.right) look(item, next.depth);
    for (const item of next.type._map.values()) look(item, next.depth);
  }
  return deepest;
}
const Shape = z.object({ bytes: z.number(), items: z.number(), nesting: z.number() });
const shapeOf = (doc: Y.Doc, state: Uint8Array) => ({ bytes: state.length, items: itemsIn(doc), nesting: nestingIn(doc) });

/** A state someone is about to rely on opens again, reaching everything it should. Thrown otherwise, before anything is deleted. */
function proveOpens(state: Uint8Array, vector: Uint8Array): void {
  const again = new Y.Doc();
  try {
    Y.applyUpdate(again, state);
    if (again.store.pendingStructs !== null || again.store.pendingDs !== null) throw new Error('something in it waits for ever');
    if (Buffer.compare(Y.encodeStateVector(again), vector) !== 0) throw new Error('it reaches somewhere else');
  } finally {
    again.destroy();
  }
}

/* ---------- what's asked of a worker ---------- */

/** What's done with what's found, once it's back: nobody in a worker logs. */
const found = (b: Built, l: OpenLog): Found => ({ skipped: b.skipped, unreadable: l.unreadable, pending: b.pending });

const SeenSchema: z.ZodType<Inspected> = z.object({
  blocks: z.array(z.object({ client: z.number(), from: z.number(), to: z.number() })),
  needs: z.array(z.tuple([z.number(), z.number()])), deletes: z.array(z.tuple([z.number(), z.number()])),
  items: z.number(), nesting: z.number(), content: z.number(), deleted: z.number()
});

const Keep = z.object({ versionId: z.string(), reason: z.enum(['edits', 'call', 'restore']), callId: z.string().nullable() });
const VersionParts = z.object({ versionId: z.string(), parts: z.array(Bytes) });
const Kind: z.ZodType<ContentKind> = z.enum(['document', 'board']);

/** What a browser at `after` doesn't have yet, as base64url, and the seq that brings it to. Only a state: what was deleted since isn't sent. */
function sync(i: SealedLog & { after: number }) {
  const l = openLog(i);
  const head = Math.max(l.rows.at(-1)?.seq ?? 0, i.rows.at(-1)?.seq ?? 0, i.base?.throughSeq ?? 0);
  // From the start, past the log (it can't know more than the log does), or from before a compaction, which leaves no way to tell what's missing.
  const whole = i.after <= 0 || i.after > head || i.after < (i.base?.throughSeq ?? 0);
  const b = build(l, whole ? null : i.after);
  const update = b.marked ? Y.encodeStateAsUpdate(b.doc, b.marked) : Y.encodeStateAsUpdate(b.doc);
  b.doc.destroy();
  return { seq: head, ascii: Buffer.from(b64u(update), 'latin1'), found: found(b, l) };
}

function fold(i: SealedLog & { through: number; keep: z.infer<typeof Keep> | null }) {
  const l = openLog(i);
  // A row that won't open may be a key that's wrong, not a row that's bad: folding past it could lose it for good.
  if (l.unreadable.length) throw new Error('a row in the log won’t open');
  const b = build(l);
  const state = Y.encodeStateAsUpdate(b.doc);
  const vector = Y.encodeStateVector(b.doc);
  const shape = shapeOf(b.doc, state);
  b.doc.destroy();
  proveOpens(state, vector);
  const editors = [...new Map([...l.editors, ...l.rows.flatMap((r) => (r.by ? [r.by] : []))].map((e) => [e.id, e])).values()];
  return {
    snapshot: sealRecord(i.key, snapshotHeader(i.at, i.through), state), editors: sealJson(i.key, editorsHeader(i.at, i.through), toJson(i.keep ? [] : editors)), shape, found: found(b, l),
    version: i.keep ? {
      info: sealJson(i.key, versionInfoHeader(i.at, i.keep.versionId), toJson({ by: editors, callId: i.keep.callId, reason: i.keep.reason })),
      parts: sealVersion(i.at, i.key, i.keep.versionId, state), bytes: state.length
    } : null
  };
}

const openParts = (i: { at: At; key: Uint8Array }, v: z.infer<typeof VersionParts>): Uint8Array => concat(...v.parts.map((sealed, index) => openVersionPart(i.at, i.key, v.versionId, index, v.parts.length, sealed)));

const RESTORING = Symbol('restoring');
/**
 * The update that makes `current` say what `version` says, whatever's in it. Yjs only moves forward, so going back is
 * something new: replaying what happened since onto the version and undoing it writes what was deleted again, and deletes
 * what was added. A version holds a whole state, so it doesn't matter what garbage collection has let go of since. The undo
 * covers the whole document, because nothing here knows what type each root is, and a root nobody has typed reports nothing.
 *
 * A document's blocks are never deleted, this included: someone offline may be writing in one that's new since the version.
 * Undoing a block's arrival empties it and leaves the element, and the undo's own transaction says which those are, having
 * taken their `id` with everything else. They're settled the way any block is that an undo took back.
 */
function backTo(current: Y.Doc, version: Uint8Array, kind: ContentKind): Uint8Array {
  const past = new Y.Doc({ gc: false });
  Y.applyUpdate(past, version);
  const fragment = kind === 'document' ? past.getXmlFragment(DOC_FRAGMENT) : null;
  const undo = new Y.UndoManager(past, { trackedOrigins: new Set([RESTORING]), captureTimeout: 0, ...(fragment ? { deleteFilter: (item: Y.Item) => undoMayDelete(item, fragment) } : {}) });
  Y.applyUpdate(past, Y.encodeStateAsUpdate(current, Y.encodeStateVector(past)), RESTORING);
  const unnamed: Y.XmlElement[] = [];
  const nameless = (tr: Y.Transaction) => {
    for (const [type, keys] of tr.changed) if (type instanceof Y.XmlElement && type._item?.parent === fragment && keys.has('id') && type.getAttribute('id') === undefined) unnamed.push(type);
  };
  past.on('afterTransaction', nameless);
  undo.undo();
  past.off('afterTransaction', nameless);
  past.transact(() => { for (const element of unnamed) settleUndone(element); });
  const update = Y.encodeStateAsUpdate(past, Y.encodeStateVector(current));
  undo.destroy();
  past.destroy();
  return update;
}
function restore(i: SealedLog & { version: z.infer<typeof VersionParts>; kind: ContentKind }) {
  const l = openLog(i);
  const b = build(l);
  const update = backTo(b.doc, openParts(i, i.version), i.kind);
  Y.applyUpdate(b.doc, update);
  const shape = shapeOf(b.doc, Y.encodeStateAsUpdate(b.doc));
  const { title } = documentText(b.doc, i.kind);
  b.doc.destroy();
  return { update, title, shape, seen: seenOf(update), found: found(b, l) };
}
/** A version made into a document's whole state, for when what's there won't open: there's nothing to merge with. */
function reset(i: { at: At; key: Uint8Array; through: number; version: z.infer<typeof VersionParts> }) {
  const state = openParts(i, i.version);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const shape = shapeOf(doc, state);
  doc.destroy();
  return { snapshot: sealRecord(i.key, snapshotHeader(i.at, i.through), state), editors: sealJson(i.key, editorsHeader(i.at, i.through), []), shape, seen: seenOf(state) };
}

/** The shape of something the server made, which is here to be known, not judged. */
function seenOf(update: Uint8Array): Inspected {
  const { seen, why } = inspect(update, SERVER_CAPS);
  if (!seen) throw new Error(`the server made something that won’t read: ${why}`);
  return seen;
}

const isRead = (name: unknown): name is keyof typeof docReads => typeof name === 'string' && name in docReads;
const isEdit = (name: unknown): name is keyof typeof docEdits => typeof name === 'string' && name in docEdits;
const ReadName = z.custom<keyof typeof docReads>(isRead);
const EditName = z.custom<keyof typeof docEdits>(isEdit);
function read(i: SealedLog & { op: z.infer<typeof ReadName>; args: unknown }) {
  const l = openLog(i);
  const b = build(l);
  const value = docReads[i.op].call(b.doc, i.args);
  b.doc.destroy();
  return { value, found: found(b, l) };
}
/** Makes a change on the document as it stands. Nothing changed, nothing to write. */
function edit(i: SealedLog & { op: z.infer<typeof EditName>; args: unknown }) {
  const l = openLog(i);
  const b = build(l);
  const updates: Uint8Array[] = [];
  b.doc.on('update', (u: Uint8Array) => { updates.push(u); });
  let value: unknown;
  b.doc.transact(() => { value = docEdits[i.op].call(b.doc, i.args); });
  b.doc.destroy();
  const update = updates.length ? Y.mergeUpdates(updates) : null;
  return { value, update, seen: update && seenOf(update), found: found(b, l) };
}
/** What a document says, ready to go on a line of a search: a big document's words are no more worth handling on the way past than its update. */
function searchLine(i: SealedLog & { id: string; itemKind: z.infer<typeof ItemKindSchema>; name: string; kind: ContentKind }) {
  const l = openLog(i);
  const b = build(l);
  const line = `${JSON.stringify(SearchDocSchema.parse({ id: i.id, kind: i.itemKind, name: i.name, ...documentText(b.doc, i.kind) }))}\n`;
  b.doc.destroy();
  return { line: utf8(line), found: found(b, l) };
}
/** Everything a document holds, for a copy of it, with its title saying what the tree calls the copy. */
function copy(i: SealedLog & { name: string | null }) {
  const l = openLog(i);
  const b = build(l);
  if (i.name) b.doc.transact(() => { docEdits.retitle.call(b.doc, { name: i.name }); });
  const state = Y.encodeStateAsUpdate(b.doc);
  const shape = shapeOf(b.doc, state);
  b.doc.destroy();
  return { state, shape, seen: seenOf(state), found: found(b, l) };
}
/** Rows as lines of a stream, read once for everyone in a room. */
export function linesOf(i: Pick<SealedLog, 'at' | 'key' | 'rows'>) {
  return { lines: i.rows.map((r) => ({ seq: r.seq, bytes: r.sealed.length, text: updateLine(r.seq, unpackUpdate(openRecord(i.key, updateHeader(i.at, r.seq), r.sealed)).update) })) };
}

const task = <I, O>(input: z.ZodType<I>, output: z.ZodType<O>, run: (i: I) => O) => ({ input, output, call: (raw: unknown): unknown => run(input.parse(raw)) });
const Empty = z.object({});

/** Everything a worker can be asked. */
export const DOC_TASKS = {
  sync: task(SealedLog.extend({ after: z.number() }), z.object({ seq: z.number(), ascii: Bytes, found: Found }), sync),
  fold: task(SealedLog.extend({ through: z.number(), keep: Keep.nullable() }), z.object({
    snapshot: Bytes, editors: Bytes, shape: Shape, found: Found, version: z.object({ info: Bytes, parts: z.array(Bytes), bytes: z.number() }).nullable()
  }), fold),
  restore: task(SealedLog.extend({ version: VersionParts, kind: Kind }), z.object({ update: Bytes, title: z.string(), shape: Shape, seen: SeenSchema, found: Found }), restore),
  reset: task(z.object({ at: AtSchema, key: Bytes, through: z.number(), version: VersionParts }), z.object({ snapshot: Bytes, editors: Bytes, shape: Shape, seen: SeenSchema }), reset),
  read: task(SealedLog.extend({ op: ReadName, args: z.unknown() }), z.object({ value: z.unknown(), found: Found }), read),
  searchLine: task(SealedLog.extend({ id: z.string(), itemKind: ItemKindSchema, name: z.string(), kind: Kind }), z.object({ line: Bytes, found: Found }), searchLine),
  edit: task(SealedLog.extend({ op: EditName, args: z.unknown() }), z.object({ value: z.unknown(), update: Bytes.nullable(), seen: SeenSchema.nullable(), found: Found }), edit),
  copy: task(SealedLog.extend({ name: z.string().nullable() }), z.object({ state: Bytes, shape: Shape, seen: SeenSchema, found: Found }), copy),
  inspect: task(z.object({ update: Bytes }), z.object({ seen: SeenSchema.optional(), why: z.string().optional() }), (i) => inspect(i.update)),
  seal: task(z.object({ at: AtSchema, key: Bytes, seq: z.number(), by: EditorSchema.nullable(), update: Bytes }), z.object({ sealed: Bytes }), (i) => ({ sealed: sealUpdate(i.at, i.key, i.seq, i.by, i.update) })),
  lines: task(z.object({ at: AtSchema, key: Bytes, rows: z.array(SealedRow) }), z.object({ lines: z.array(z.object({ seq: z.number(), bytes: z.number(), text: z.string() })) }), linesOf),
  /** For a worker that's just been started: nothing to do but be there. */
  ping: task(Empty, Empty, () => ({}))
};
export type DocTasks = typeof DOC_TASKS;
export const isDocTask = (name: string): name is keyof DocTasks => name in DOC_TASKS;
