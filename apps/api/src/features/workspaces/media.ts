/*
 * Files in a workspace: pictures, video, audio and anything else someone puts in a document or on a board (docs: Data and
 * storage › Media). A file is a row, its sealed info, and sealed pieces of 4 MiB in the object store under random names,
 * all under a key of its own from the workspace's root. It belongs to the workspace and is reached only through a document
 * that has it (`workspace_media_uses`): whoever can open that document can read it, because what someone in a call is given
 * can be one document, and features/workspaces/access.ts says who that is, on every request, each `Range` included.
 *
 * A use goes with its document, when that's deleted for good, so a version or something in Trash keeps its pictures, or
 * with the file, when someone deletes it. A file nothing uses any more goes in the same transaction, its objects queued in
 * object_gc there too, so a process that stops straight after the commit strands nothing. Changing who has a file happens
 * under the workspace's row lock: adding holds it shared, taking away holds it alone, so a file can't be given out as it goes.
 *
 * Files are big and every call runs in this same process, so nobody gets to hold much of its memory: see MEDIA_LIMITS.
 * What can be kept is limited too, by limits that change without a deploy (limits.ts): a file, a workspace, and what
 * each person uploads in a day. A lower limit refuses what comes next, and never deletes what's there.
 */
import { FILE_TYPE, MAX_MEDIA_PREVIEW_BYTES, MEDIA_PIECE_BYTES, MEDIA_PREVIEW_PIXELS, MediaInputSchema, type WorkspaceMedia } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, blindIndex, concat, equalBytes, id128, openBinary, openJson, sealBinary, sealJson, sha, stateKey, toJson, type RecordHeader } from '../../crypto';
import { bigintText, bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { ConflictError, ForbiddenError, IntegrityError, InternalError, NotFoundError, UnavailableError, invalid, notFound, toAppError } from '../../errors';
import { limitsNow, shown } from '../../limits';
import { currentLogContext, log, withLogContext } from '../../log';
import { masterKey } from '../../owners';
import { issueMediaToken, readMediaToken, type MediaToken } from '../../mediaToken';
import { deleteQueued, queueDelete } from '../recordings/audio';
import { jpegSize } from '../recordings/screens';
import { ID128, limitKey, requireDocument, roleOf, whoNamed, workspaceFor, type Reader, type Who, type Workspace } from './access';
import { fileBytesFor, requireRoom, storageLimitOf } from '../billing/held';
import { payerOf, usedBytes } from '../billing/storage';

const mlog = log.child({ component: 'media' });

/** An upload nobody finished goes after this long: its browser has gone, and at any speed it could have finished by now. */
const UPLOAD_MS = 24 * 60 * 60_000;
/**
 * The most pieces one answer to a range sends. A browser asks again for the rest, so who's asking is asked about again as
 * it plays, and no answer that says its length passes 32 MiB, which Cloud Run refuses over HTTP/1. A file read without a
 * range, past this size, is streamed without a length instead, and asked about again every so many pieces.
 */
const PIECES_PER_ANSWER = 4;
const MOST_SENT_WITH_A_LENGTH = PIECES_PER_ANSWER * MEDIA_PIECE_BYTES;
/** A piece goes out in slices, so a reader who stops is holding the piece it's on and no more: the next is opened only when this one has gone. */
const SLICE_BYTES = 256 * 1024;
/**
 * What this process takes on at once. It's one instance, shared with every live call, so this is what stands between a
 * few people and all of its memory and its only core. A piece is 4 MiB, and takes tens of megabytes for a moment while it's
 * sealed or opened. Change these and measure again: docs/engineering/deployment-and-acceptance.md says what they came to.
 */
export const MEDIA_LIMITS = {
  /** Pieces this process has in hand: being fetched, sealed or opened, stored. The rest take turns. */
  working: 4,
  /**
   * How much of the core goes on sealing, opening and hashing pieces, whoever's asking: however many people read, each
   * within their limit, a call keeps the rest. That work is about a third of what a piece costs, so this is under half of
   * the core with the store and the socket, and a piece's cost is timed, so it holds on a slower core too.
   */
  coreShare: 1 / 8,
  /** Pieces coming in, from before their bodies are read, in all and for one person. Past this they're refused, and the client tries again. */
  arriving: 16,
  arrivingEach: 4,
  /** How long a piece has to bring another slice. One that doesn't, stopped or only trickling, holds a place nobody else can have, so it's cut and the client tries again. */
  arrivalMs: 10_000,
  /** Reads with a response open, in all and for one person, which each hold a piece at most, until the response has gone. */
  reading: 32,
  readingEach: 8,
  /** A read past that waits, holding nothing, because an `<img>` can't try again: this many, for one person this many, this long. Then it's refused. */
  waiting: 48,
  waitingEach: 24,
  waitMs: 10_000,
  /** How long a read can take nothing before it gives way to someone waiting: under `waitMs`, so they get its place. A paused video that's cut asks again when it plays. */
  stalledMs: 5_000,
  /**
   * What someone can ask for in a minute: each URL and each piece opened, because a byte costs a whole piece. That's 16 MiB
   * a second, more than any video, and a page of 100 pictures. What everyone asks for together is held to `coreShare`.
   */
  readsAMinute: 240
};

let working = 0;
const turns: (() => void)[] = [];
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (working < MEDIA_LIMITS.working) working++;
  else await new Promise<void>((go) => { turns.push(go); });
  try {
    return await work();
  } finally {
    // Whoever's next takes this turn over, so nobody can slip in ahead of them.
    const next = turns.shift();
    if (next) next();
    else working--;
  }
}

let coreFree = 0;
let core: Promise<unknown> = Promise.resolve();
/**
 * What keeps the core busy, one at a time, in order, each after a pause in proportion to what the last one took. Between
 * them the core is free for everything else, so a call's request waits for one piece at most, not for a queue of them.
 */
function onCore<T>(work: () => T): Promise<T> {
  const turn = core.then(async () => {
    const wait = coreFree - performance.now();
    if (wait > 0) await new Promise((go) => { setTimeout(go, wait); });
    const began = performance.now();
    try {
      return work();
    } finally {
      const now = performance.now();
      coreFree = now + (now - began) * (1 / MEDIA_LIMITS.coreShare - 1);
    }
  });
  core = turn.catch(() => undefined);
  return turn;
}

/** A place someone holds, until `leave`, which gives it back once however often it's called. */
interface Held {
  who: string;
  /** Whether it had to wait, so anything asked before it did is out of date. */
  waited: boolean;
  /** Since when it's been waiting on the browser; `null` while it's this process that's working. */
  still: number | null;
  /** Ends it from this side, for someone else to have the place. */
  cut(): void;
  leave(): void;
}
interface Line { most: number; each: number; ms: number; stalledMs: number }
/** Nobody's listening for this: it's what ends a read whose browser left, in line or just out of it. */
const browserLeft = () => new UnavailableError('That browser has gone.', { level: 'info' });
/** How often someone in line looks for a read that has stopped. */
const LOOK_MS = 250;

/** How many of something run at once, in all and for one person. Past that it's refused, or with `line`, waits a moment first. */
class Places {
  private readonly held = new Set<Held>();
  private readonly queue: { who: string; go: () => void }[] = [];
  private looking = false;
  constructor(private readonly what: string, private readonly most: number, private readonly each: number, private readonly line?: Line | undefined) {}

  private holding(who: string): number { return [...this.held].filter((h) => h.who === who).length; }
  private free(who: string): boolean { return this.held.size < this.most && this.holding(who) < this.each; }
  private full(): UnavailableError { return new UnavailableError('Too many files are on the move right now. Try again in a moment.', { context: { limit: this.what, taken: this.held.size, waiting: this.queue.length } }); }
  private hold(who: string, waited: boolean, cut: () => void): Held {
    const held: Held = {
      who, waited, cut, still: null,
      // Given back to the first in line who can take it, so nobody can slip in ahead of them.
      leave: () => {
        if (!this.held.delete(held)) return;
        const next = this.queue.findIndex((w) => this.free(w.who));
        const [first] = next < 0 ? [] : this.queue.splice(next, 1);
        first?.go();
      }
    };
    this.held.add(held);
    return held;
  }
  /**
   * While anyone's in line, what has stopped gives way, the longest stopped first. Someone at their own limit needs one of
   * their own back; anyone else, any place. Nothing that's moving is touched, and nothing is cut with nobody waiting.
   */
  private makeRoom(stalledMs: number): void {
    this.looking = this.queue.length > 0;
    if (!this.looking) return;
    const by = Date.now() - stalledMs;
    const stopped = [...this.held].filter((h) => h.still !== null && h.still <= by).sort((a, b) => (a.still ?? 0) - (b.still ?? 0));
    for (const w of this.queue) {
      const own = this.holding(w.who) >= this.each;
      const at = stopped.findIndex((h) => !own || h.who === w.who);
      const [h] = at < 0 ? [] : stopped.splice(at, 1);
      if (h) { h.still = null; h.cut(); }
    }
    setTimeout(() => { this.makeRoom(stalledMs); }, LOOK_MS).unref();
  }
  private wait(who: string, cut: () => void, closed: AbortSignal | undefined): Promise<Held> {
    const line = this.line;
    if (!line || this.queue.length >= line.most || this.queue.filter((w) => w.who === who).length >= line.each) return Promise.reject(this.full());
    if (closed?.aborted) return Promise.reject(browserLeft());
    return new Promise<Held>((resolve, refuse) => {
      const out = (why: UnavailableError) => {
        clearTimeout(timer);
        closed?.removeEventListener('abort', left);
        this.queue.splice(this.queue.indexOf(waiter), 1);
        refuse(why);
      };
      const left = () => { out(browserLeft()); };
      const waiter = { who, go: () => { clearTimeout(timer); closed?.removeEventListener('abort', left); resolve(this.hold(who, true, cut)); } };
      const timer = setTimeout(() => { out(this.full()); }, line.ms);
      closed?.addEventListener('abort', left, { once: true });
      this.queue.push(waiter);
      if (!this.looking) this.makeRoom(line.stalledMs);
    });
  }
  /** Takes a place, or refuses with `unavailable`. `cut` is how it can be ended from this side, and `closed` says the browser has gone, which ends a wait. */
  enter(who: string, cut: () => void = () => undefined, closed?: AbortSignal | undefined): Promise<Held> {
    return this.free(who) ? Promise.resolve(this.hold(who, false, cut)) : this.wait(who, cut, closed);
  }
}
const arriving = new Places('pieces arriving', MEDIA_LIMITS.arriving, MEDIA_LIMITS.arrivingEach);
const reading = new Places('files being read', MEDIA_LIMITS.reading, MEDIA_LIMITS.readingEach, { most: MEDIA_LIMITS.waiting, each: MEDIA_LIMITS.waitingEach, ms: MEDIA_LIMITS.waitMs, stalledMs: MEDIA_LIMITS.stalledMs });

/** Where a file's records are bound to: its workspace, as the owner whose key seals them, and its public handle. */
type Place = Pick<Workspace, 'owner' | 'workspaceId'>;
const mediaKey = (o: Owner, mediaId: string): Uint8Array => stateKey(o.root, o.ownerId, `media:${mediaId}`);
const infoHeader = (w: Place, mediaId: string): RecordHeader => ({ v: 1, kind: 'workspace-media', ownerId: w.owner.ownerId, workspaceId: w.workspaceId, mediaId });
const pieceHeader = (w: Place, mediaId: string, seq: number, objectId: string): RecordHeader => ({ v: 1, kind: 'media-piece', ownerId: w.owner.ownerId, workspaceId: w.workspaceId, mediaId, seq, objectId });
const previewHeader = (w: Place, mediaId: string, objectId: string): RecordHeader => ({ v: 1, kind: 'media-preview', ownerId: w.owner.ownerId, workspaceId: w.workspaceId, mediaId, objectId });
/** What's said about a file, sealed: never read from a request once it's stored, so what it's served as can't be asked for. */
const Info = z.object({ name: z.string(), type: z.string(), size: z.number(), width: z.number().nullable(), height: z.number().nullable() });
type Info = z.infer<typeof Info>;
const openInfo = (w: Place, mediaId: string, sealed: Uint8Array): Info => openJson(mediaKey(w.owner, mediaId), infoHeader(w, mediaId), sealed, Info);

/** The same refusal for a file that isn't there, isn't finished, or isn't in this document. */
const noFile = (w: { workspaceId: string }, documentId: string, mediaId: string) => notFound('That file', { workspaceId: w.workspaceId, documentId, mediaId });
const FileRow = z.object({ state: z.enum(['uploading', 'ready']), pieces: z.number(), info_ciphertext: bytea, created_at: timestamp });
type FileRow = z.infer<typeof FileRow>;
/** A file as one document has it. `locked`, in a transaction, holds its row, so pieces land one at a time and never after it's finished. */
function fileIn(w: Place, db: Db, documentId: string, mediaId: string, locked = false): Promise<FileRow | undefined> {
  if (!ID128.test(mediaId)) return Promise.resolve(undefined);
  return maybeOne(db, FileRow, `SELECT m.state, m.pieces, m.info_ciphertext, m.created_at FROM workspace_media m
    JOIN workspace_media_uses u ON u.owner_id = m.owner_id AND u.media_id = m.media_id
    WHERE m.owner_id = $1 AND m.media_id = $2 AND u.document_id = $3${locked ? ' FOR NO KEY UPDATE OF m' : ''}`, [w.owner.ownerId, mediaId, documentId]);
}
const opens = (who: Who, w: Workspace, documentId: string): boolean => {
  const item = w.state.items[documentId];
  return item !== undefined && roleOf(who, w, documentId, item) !== undefined;
};
/** Every document that has a file, whoever can open it. */
async function documentsWith(w: Workspace, db: Db, mediaId: string): Promise<string[]> {
  if (!ID128.test(mediaId)) return [];
  return (await rows(db, z.object({ document_id: z.string() }), 'SELECT document_id FROM workspace_media_uses WHERE owner_id = $1 AND media_id = $2 ORDER BY document_id', [w.owner.ownerId, mediaId])).map((u) => u.document_id);
}
/** The documents this reader can reach a file through: they say whether it exists for them at all. */
const reachedThrough = async (who: Who, w: Workspace, db: Db, mediaId: string): Promise<string[]> => (await documentsWith(w, db, mediaId)).filter((id) => opens(who, w, id));
const wire = (id: string, info: Info, createdAt: Date, documents: string[]): WorkspaceMedia => ({ id, name: info.name, type: info.type, size: info.size, width: info.width, height: info.height, createdAt: createdAt.toISOString(), documents });

/* ---------- what can be kept ---------- */

/** Who an upload counts against: an account, or a guest, by a blind index of the person their pass names. */
type Uploader = { account: string } | { guest: Uint8Array; callId: string | undefined };
const uploaderOf = (d: Deps, r: Reader): Uploader =>
  (r.account ? { account: r.account.owner.ownerId } : { guest: blindIndex(masterKey(d), 'upload-guest', limitKey(r)), callId: r.seat?.callId });
/**
 * What a workspace takes (docs: Plans and usage › Storage): files as big as the plan of whoever it counts against has,
 * while their storage has room, and what one person uploads in a day, the same for everyone. A workspace nobody pays for
 * (none of its admins has an account, or its payer just deleted theirs) takes no files: they'd count against no storage at
 * all. Upkeep settles who pays within minutes of an admin signing in (billing/storage.ts `settlePayers`).
 */
interface Allowed { file: number; day: number; payer: string; storage: number | null }
async function allowedIn(d: Deps, db: Db, w: Place): Promise<Allowed> {
  const limits = await limitsNow(d, db);
  const payer = await payerOf(db, w.owner.ownerId);
  if (!payer) throw new ConflictError('Files can’t be added until one of this workspace’s admins signs in to Alcove.', { context: { workspaceId: w.workspaceId, why: 'no payer' } });
  return { file: await fileBytesFor(d, db, payer), day: limits.get('media.account_day_bytes'), payer, storage: await storageLimitOf(d, db, payer) };
}

/** Today, as uploads are counted: in UTC. */
const today = (): string => new Date().toISOString().slice(0, 10);
async function uploadedToday(db: Db, u: Uploader): Promise<number> {
  const Day = z.object({ bytes: bigintText });
  if ('guest' in u) return (await maybeOne(db, Day, 'SELECT bytes FROM media_guest_upload_days WHERE guest_index = $1 AND day = $2', [u.guest, today()]))?.bytes ?? 0;
  return (await maybeOne(db, Day, 'SELECT bytes FROM media_upload_days WHERE owner_id = $1 AND day = $2', [u.account, today()]))?.bytes ?? 0;
}
/** Counts a kept piece towards its uploader's day, in the piece's own transaction, and says where the day stands now. */
async function countDay(c: Db, u: Uploader, bytes: number): Promise<number> {
  const Day = z.object({ bytes: bigintText });
  const day = 'guest' in u
    ? await maybeOne(c, Day, `INSERT INTO media_guest_upload_days (guest_index, day, bytes) VALUES ($1, $2, $3)
        ON CONFLICT (guest_index, day) DO UPDATE SET bytes = media_guest_upload_days.bytes + excluded.bytes RETURNING bytes`, [u.guest, today(), bytes])
    : await maybeOne(c, Day, `INSERT INTO media_upload_days (owner_id, day, bytes) VALUES ($1, $2, $3)
        ON CONFLICT (owner_id, day) DO UPDATE SET bytes = media_upload_days.bytes + excluded.bytes RETURNING bytes`, [u.account, today(), bytes]);
  return day?.bytes ?? bytes;
}
/** What any limit set to zero refuses with: nothing can be uploaded, whatever anyone has done. */
const NO_UPLOADS = 'Files can’t be uploaded right now.';
/**
 * Refuses what would take a file past its plan's size, its payer's storage past their plan's, or someone's day past what's
 * allowed, and anything at all in a workspace that's read-only, before anything of it is read: at the start, with the whole
 * file, and with each piece, so uploads going at once pass a limit by the pieces on their way and no more. Each says which,
 * and a file says how big one can be, because only the server knows.
 */
async function withinLimits(d: Deps, db: Db, w: Place, u: Uploader, allowed: Allowed, size: number, adding: number): Promise<void> {
  const context = { workspaceId: w.workspaceId, sizeBytes: size, addingBytes: adding };
  if (size > allowed.file) {
    throw invalid(allowed.file ? `This file is bigger than ${shown('plan.free.file_bytes', allowed.file)}, the most a file can be here.` : NO_UPLOADS, { ...context, limit: 'file', limitBytes: allowed.file });
  }
  await requireRoom(d, db, allowed.payer, adding, context);
  const day = await uploadedToday(db, u);
  if (day + adding > allowed.day) {
    throw new ConflictError(allowed.day ? 'That’s all you can upload today. You can upload more tomorrow.' : NO_UPLOADS, { context: { ...context, limit: 'media.account_day_bytes', uploadedBytes: day, limitBytes: allowed.day } });
  }
}
/**
 * Says so, once, when a piece takes the storage of whoever the workspace counts against, or someone's day, past 80% of
 * what it's allowed: IDs and sizes, nothing else.
 */
const passes80 = (before: number, after: number, limit: number): boolean => before < 0.8 * limit && after >= 0.8 * limit;
function nearTheLimits(w: Place, u: Uploader, allowed: Allowed, stored: { before: number; after: number }, day: { before: number; after: number }): void {
  if (allowed.storage !== null && passes80(stored.before, stored.after, allowed.storage)) {
    mlog.warn('an account is past 80% of its storage', { workspaceId: w.workspaceId, ownerId: allowed.payer, storedBytes: stored.after, limitBytes: allowed.storage });
  }
  if (passes80(day.before, day.after, allowed.day)) {
    mlog.warn('someone is past 80% of what they can upload today', { ...('guest' in u ? { callId: u.callId ?? null } : { ownerId: u.account }), uploadedBytes: day.after, limitBytes: allowed.day });
  }
}
/** Forgets what accounts and guests uploaded before yesterday. Returns how many rows went. */
export async function pruneUploadDays(d: Pick<Deps, 'pool'>): Promise<number> {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return await exec(d.pool, 'DELETE FROM media_upload_days WHERE day < $1', [yesterday]) + await exec(d.pool, 'DELETE FROM media_guest_upload_days WHERE day < $1', [yesterday]);
}

/* ---------- putting a file in a document ---------- */

/** Whether someone may add to a document, asked before anything they sent is read. */
export async function mayAdd(d: Deps, who: Who, workspaceId: string, documentId: string): Promise<void> {
  requireDocument(who, await workspaceFor(d, who, workspaceId), documentId, 'edit');
}

/** Starts a file in a document, if it fits what's allowed: it has a row and a use from here on, and can't be read until it's finished. */
export async function begin(d: Deps, who: Reader, workspaceId: string, documentId: string, input: z.output<typeof MediaInputSchema>): Promise<{ id: string }> {
  const id = id128();
  const pieces = Math.ceil(input.size / MEDIA_PIECE_BYTES);
  const u = uploaderOf(d, who);
  await tx(d.pool, async (c) => {
    const w = await workspaceFor(d, who, workspaceId, c, 'hold');
    requireDocument(who, w, documentId, 'edit');
    await withinLimits(d, c, w, u, await allowedIn(d, c, w), input.size, input.size);
    const info: Info = { name: input.name, type: input.type, size: input.size, width: input.width, height: input.height };
    await exec(c, "INSERT INTO workspace_media (owner_id, media_id, state, pieces, info_ciphertext) VALUES ($1,$2,'uploading',$3,$4)", [w.owner.ownerId, id, pieces, sealJson(mediaKey(w.owner, id), infoHeader(w, id), toJson(info))]);
    await exec(c, 'INSERT INTO workspace_media_uses (owner_id, media_id, document_id) VALUES ($1,$2,$3)', [w.owner.ownerId, id, documentId]);
  });
  mlog.info('upload started', { workspaceId, documentId, mediaId: id, pieces });
  return { id };
}

/** One piece from a browser: what it says its length is, and its body, which isn't touched until it's known to be wanted. */
export interface PieceUpload { declared: number; body(): ReadableStream<Uint8Array> | null }
const pieceLength = (info: Info, seq: number): number => Math.min(MEDIA_PIECE_BYTES, info.size - seq * MEDIA_PIECE_BYTES);
const pieceThere = (w: Place, db: Db, mediaId: string, seq: number) => maybeOne(db, z.object({ seq: z.number() }), 'SELECT seq FROM workspace_media_pieces WHERE owner_id = $1 AND media_id = $2 AND seq = $3', [w.owner.ownerId, mediaId, seq]);

/**
 * Seals and stores one piece, by its place in the file, so a retry is safe: a piece stored already is a no-op, whatever
 * state the file has reached. It goes to the object store first, is read back and checked, and is recorded only then,
 * under the workspace's lock with access asked again: someone who lost the document while it was on its way keeps nothing.
 */
export async function storePiece(d: Deps, who: Reader, workspaceId: string, documentId: string, mediaId: string, place: string, body: PieceUpload): Promise<void> {
  const w = await workspaceFor(d, who, workspaceId);
  requireDocument(who, w, documentId, 'edit');
  const m = await fileIn(w, d.pool, documentId, mediaId);
  if (!m) throw noFile(w, documentId, mediaId);
  const seq = /^\d{1,6}$/.test(place) ? Number(place) : -1;
  if (seq < 0 || seq >= m.pieces) throw invalid('That isn’t a piece of this file.', { workspaceId, mediaId, pieces: m.pieces });
  const where = { workspaceId, documentId, mediaId, seq };
  if (await pieceThere(w, d.pool, mediaId, seq)) { mlog.debug('piece already stored', where); return; }

  const info = openInfo(w, mediaId, m.info_ciphertext);
  const length = pieceLength(info, seq);
  if (body.declared > length) throw invalid('That piece is the wrong size.', { ...where, bytes: body.declared, length });
  const u = uploaderOf(d, who);
  const allowed = await allowedIn(d, d.pool, w);
  await withinLimits(d, d.pool, w, u, allowed, info.size, length);

  // Counted from here: a body is 4 MiB the moment it's read, whether or not anything has got to it yet.
  const arrival = await arriving.enter(askerOf(who));
  try {
    const bytes = await arrived(body, where);
    if (bytes.length !== length) throw invalid('That piece is the wrong size.', { ...where, bytes: bytes.length, length });
    const { objectId, digest, sealed } = await inTurn(() => sealedObject(w, mediaId, seq, bytes));
    let kept: { stored: number; day: number } | undefined;
    try {
      kept = await tx(d.pool, async (c) => {
        // The account's row before the workspace's, the order deleting an account takes them in, so the two can't wait on
        // each other: counting the piece towards its day below takes a lock on that row too.
        if ('account' in u) await exec(c, 'SELECT 1 FROM owners WHERE owner_id = $1 FOR KEY SHARE', [u.account]);
        const held = await workspaceFor(d, who, workspaceId, c, 'hold');
        requireDocument(who, held, documentId, 'edit');
        if (!(await fileIn(held, c, documentId, mediaId, true))) throw noFile(held, documentId, mediaId);
        const n = await exec(c, 'INSERT INTO workspace_media_pieces (owner_id, media_id, seq, object_id, sha256, length) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', [held.owner.ownerId, mediaId, seq, objectId, digest, sealed]);
        if (n !== 1) return undefined;
        await exec(c, 'UPDATE workspace_media SET bytes = bytes + $3 WHERE owner_id = $1 AND media_id = $2', [held.owner.ownerId, mediaId, sealed]);
        const owner = await maybeOne(c, z.object({ stored_bytes: bigintText }), 'UPDATE owners SET stored_bytes = stored_bytes + $2, version = version + 1 WHERE owner_id = $1 RETURNING stored_bytes', [held.owner.ownerId, sealed]);
        // What they sent counts towards their day, with the piece, so a piece that isn't kept isn't counted.
        return { stored: owner?.stored_bytes ?? sealed, day: await countDay(c, u, bytes.length) };
      });
    } catch (e) {
      mlog.at(toAppError(e).status < 500 ? 'info' : 'warn', 'piece not recorded; deleting its object', { ...where, objectId, err: e });
      await queueDelete(w.owner, [objectId]);
      throw e;
    }
    if (kept) {
      mlog.debug('piece stored', { ...where, bytes: sealed });
      const stored = await usedBytes(d.pool, allowed.payer);
      nearTheLimits(w, u, allowed, { before: stored - sealed, after: stored }, { before: kept.day - bytes.length, after: kept.day });
      return;
    }
    mlog.info('piece raced a retry; dropping the duplicate', where);
    await queueDelete(w.owner, [objectId]);
  } finally {
    arrival.leave();
  }
}
/** A piece's body as it comes, for as long as it keeps coming: a slice every `arrivalMs`, or it's cut, whether it stopped or is only trickling. */
async function arrived(up: PieceUpload, where: Record<string, string | number>): Promise<Uint8Array> {
  const reader = up.body()?.getReader();
  if (!reader) return new Uint8Array(0);
  let stopped = false;
  const stop = () => { stopped = true; void reader.cancel().catch(() => undefined); };
  const notHere = (cause?: unknown) => new UnavailableError('That piece stopped arriving. Try again.', { level: 'info', cause, context: where });
  let clock = setTimeout(stop, MEDIA_LIMITS.arrivalMs);
  const parts: Uint8Array[] = [];
  let moved = 0;
  try {
    for (;;) {
      // A browser that goes while it's sending ends the read this way: nothing went wrong here.
      const { done, value } = await reader.read().catch((e: unknown) => { throw notHere(e); });
      if (stopped) throw notHere();
      if (done) return concat(...parts);
      parts.push(value);
      moved += value.length;
      if (moved >= SLICE_BYTES) {
        moved = 0;
        clearTimeout(clock);
        clock = setTimeout(stop, MEDIA_LIMITS.arrivalMs);
      }
    }
  } finally {
    clearTimeout(clock);
  }
}
/** Seals a piece into a new object, read back and checked. */
async function sealedObject(w: Place, mediaId: string, seq: number, bytes: Uint8Array): Promise<{ objectId: string; digest: Uint8Array; sealed: number }> {
  const objectId = id128();
  const key = mediaKey(w.owner, mediaId);
  const { ct, digest } = await onCore(() => {
    const sealed = sealBinary(key, pieceHeader(w, mediaId, seq, objectId), bytes);
    key.fill(0);
    return { ct: sealed, digest: sha(sealed) };
  });
  await w.owner.objects.put(objectId, ct);
  const back = await w.owner.objects.get(objectId);
  if (!(await onCore(() => back.length === ct.length && equalBytes(sha(back), digest)))) {
    await queueDelete(w.owner, [objectId]);
    throw new InternalError('This file didn’t store correctly. It will be retried.', { context: { workspaceId: w.workspaceId, mediaId, seq, objectId, wrote: ct.length, readBack: back.length } });
  }
  return { objectId, digest, sealed: ct.length };
}

/** Finishes a file once every piece is there, and it can be read from then on. Saying so again changes nothing. */
export async function finish(d: Deps, who: Who, workspaceId: string, documentId: string, mediaId: string): Promise<WorkspaceMedia> {
  return tx(d.pool, async (c) => {
    const w = await workspaceFor(d, who, workspaceId, c, 'hold');
    requireDocument(who, w, documentId, 'edit');
    const m = await fileIn(w, c, documentId, mediaId, true);
    if (!m) throw noFile(w, documentId, mediaId);
    if (m.state === 'uploading') {
      const there = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM workspace_media_pieces WHERE owner_id = $1 AND media_id = $2', [w.owner.ownerId, mediaId]);
      if (there?.n !== m.pieces) throw new ConflictError('Some of this file hasn’t arrived yet.', { context: { workspaceId, mediaId, pieces: m.pieces, there: there?.n ?? 0 } });
      await exec(c, "UPDATE workspace_media SET state = 'ready' WHERE owner_id = $1 AND media_id = $2", [w.owner.ownerId, mediaId]);
      mlog.info('upload finished', { workspaceId, documentId, mediaId, pieces: m.pieces });
    }
    return wire(mediaId, openInfo(w, mediaId, m.info_ciphertext), m.created_at, await reachedThrough(who, w, c, mediaId));
  });
}

/** Puts a finished file this reader can reach into another document of the workspace, which they can edit. */
export async function attach(d: Deps, who: Who, workspaceId: string, documentId: string, mediaId: string): Promise<void> {
  await tx(d.pool, async (c) => {
    const w = await workspaceFor(d, who, workspaceId, c, 'hold');
    requireDocument(who, w, documentId, 'edit');
    // Editing one document mustn't open another: an ID someone remembers, or was told, reaches nothing they can't already.
    const ready = ID128.test(mediaId) && await maybeOne(c, z.object({ n: z.number() }), "SELECT 1 AS n FROM workspace_media WHERE owner_id = $1 AND media_id = $2 AND state = 'ready'", [w.owner.ownerId, mediaId]);
    if (!ready || !(await reachedThrough(who, w, c, mediaId)).length) throw noFile(w, documentId, mediaId);
    await exec(c, 'INSERT INTO workspace_media_uses (owner_id, media_id, document_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [w.owner.ownerId, mediaId, documentId]);
  });
  mlog.info('file attached', { workspaceId, documentId, mediaId });
}

/* ---------- a picture's preview ---------- */

const PreviewRow = z.object({ object_id: z.string(), sha256: bytea });
const previewOf = (w: Place, db: Db, mediaId: string) => maybeOne(db, PreviewRow, 'SELECT object_id, sha256 FROM workspace_media_previews WHERE owner_id = $1 AND media_id = $2', [w.owner.ownerId, mediaId]);

/**
 * Keeps a picture's preview beside it: a small JPEG its browser made (MEDIA_PREVIEW_PIXELS), sealed under the file's key
 * with a header of its own, in one object. For anyone who can edit a document that has the file, once it's finished, and
 * once: the first one kept stays, so a preview sent again, or by someone else, changes nothing. It counts towards what the
 * workspace stores, with the file, and goes with it.
 */
export async function storePreview(d: Deps, who: Reader, workspaceId: string, documentId: string, mediaId: string, jpeg: Uint8Array): Promise<void> {
  const w = await workspaceFor(d, who, workspaceId);
  requireDocument(who, w, documentId, 'edit');
  const m = await fileIn(w, d.pool, documentId, mediaId);
  if (m?.state !== 'ready') throw noFile(w, documentId, mediaId);
  const where = { workspaceId, documentId, mediaId };
  if (!openInfo(w, mediaId, m.info_ciphertext).type.startsWith('image/')) throw invalid('Only a picture has a preview.', where);
  const size = jpeg.length <= MAX_MEDIA_PREVIEW_BYTES ? jpegSize(jpeg) : null;
  if (!size) throw invalid('A preview must be a small JPEG.', { ...where, bytes: jpeg.length });
  if (Math.max(size.width, size.height) > MEDIA_PREVIEW_PIXELS) throw invalid('That preview is too large.', { ...where, width: size.width, height: size.height });
  if (await previewOf(w, d.pool, mediaId)) { mlog.debug('preview already kept', where); return; }
  const objectId = id128();
  const key = mediaKey(w.owner, mediaId);
  const sealed = sealBinary(key, previewHeader(w, mediaId, objectId), jpeg);
  key.fill(0);
  const digest = sha(sealed);
  await w.owner.objects.put(objectId, sealed);
  const back = await w.owner.objects.get(objectId);
  if (back.length !== sealed.length || !equalBytes(sha(back), digest)) {
    await queueDelete(w.owner, [objectId]);
    throw new InternalError('This preview didn’t store correctly.', { context: { ...where, objectId } });
  }
  try {
    const kept = await tx(d.pool, async (c) => {
      const held = await workspaceFor(d, who, workspaceId, c, 'hold');
      requireDocument(who, held, documentId, 'edit');
      if (!(await fileIn(held, c, documentId, mediaId, true))) throw noFile(held, documentId, mediaId);
      const n = await exec(c, 'INSERT INTO workspace_media_previews (owner_id, media_id, object_id, sha256, length) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [held.owner.ownerId, mediaId, objectId, digest, sealed.length]);
      if (n !== 1) return false;
      await exec(c, 'UPDATE workspace_media SET bytes = bytes + $3 WHERE owner_id = $1 AND media_id = $2', [held.owner.ownerId, mediaId, sealed.length]);
      await exec(c, 'UPDATE owners SET stored_bytes = stored_bytes + $2, version = version + 1 WHERE owner_id = $1', [held.owner.ownerId, sealed.length]);
      return true;
    });
    if (!kept) { mlog.info('preview raced another; dropping this one', where); await queueDelete(w.owner, [objectId]); return; }
  } catch (e) {
    mlog.at(toAppError(e).status < 500 ? 'info' : 'warn', 'preview not recorded; deleting its object', { ...where, objectId, err: e });
    await queueDelete(w.owner, [objectId]);
    throw e;
  }
  mlog.info('preview kept', { ...where, bytes: sealed.length, width: size.width, height: size.height });
}

/** A picture's preview, opened, for anyone who can read a document that has it: null when it has none, as a picture from before previews hasn't. */
export async function preview(d: Deps, who: Reader, workspaceId: string, documentId: string, mediaId: string): Promise<Uint8Array | null> {
  const w = await workspaceFor(d, who, workspaceId);
  requireDocument(who, w, documentId, 'read');
  const m = await fileIn(w, d.pool, documentId, mediaId);
  if (m?.state !== 'ready') throw noFile(w, documentId, mediaId);
  const p = await previewOf(w, d.pool, mediaId);
  if (!p) return null;
  const ct = await w.owner.objects.get(p.object_id);
  if (!equalBytes(sha(ct), p.sha256)) throw new IntegrityError('A preview failed its integrity check.', { context: { workspaceId, mediaId, objectId: p.object_id } });
  const key = mediaKey(w.owner, mediaId);
  try {
    return openBinary(key, previewHeader(w, mediaId, p.object_id), ct);
  } finally {
    key.fill(0);
  }
}

/* ---------- reading one ---------- */

/** Every finished file this reader can reach, the newest first. Nothing is opened of a file they can't. */
export async function list(d: Deps, who: Who, workspaceId: string): Promise<WorkspaceMedia[]> {
  const w = await workspaceFor(d, who, workspaceId);
  const found = await rows(d.pool, z.object({ media_id: z.string(), info_ciphertext: bytea, created_at: timestamp, documents: z.array(z.string()) }),
    `SELECT m.media_id, m.info_ciphertext, m.created_at, array_agg(u.document_id::text ORDER BY u.document_id) AS documents
     FROM workspace_media m JOIN workspace_media_uses u ON u.owner_id = m.owner_id AND u.media_id = m.media_id
     WHERE m.owner_id = $1 AND m.state = 'ready' GROUP BY m.media_id, m.info_ciphertext, m.created_at ORDER BY m.created_at DESC, m.media_id`, [w.owner.ownerId]);
  return found.flatMap((m) => {
    const documents = m.documents.filter((id) => opens(who, w, id));
    return documents.length ? [wire(m.media_id, openInfo(w, m.media_id, m.info_ciphertext), m.created_at, documents)] : [];
  });
}

/** What's in a file's URL, for a reader who can open a document that has it. Access is asked again every time it's used. */
export async function tokenFor(d: Deps, reader: Reader, workspaceId: string, documentId: string, mediaId: string): Promise<string> {
  const w = await workspaceFor(d, reader, workspaceId);
  requireDocument(reader, w, documentId, 'read');
  const m = await fileIn(w, d.pool, documentId, mediaId);
  if (m?.state !== 'ready') throw noFile(w, documentId, mediaId);
  return issueMediaToken(d.cfg, {
    account: reader.account?.owner.ownerId ?? null, seat: reader.seat ? { callId: reader.seat.callId, organizer: reader.seat.viewer.pass.ownerId, seat: reader.seat.seat } : null,
    workspaceId, documentId, mediaId
  });
}

/** What a URL says, or the same refusal as for any other way of getting nothing from one: that file, nothing else named. */
export function tokenIn(d: Deps, token: string): MediaToken {
  const t = readMediaToken(d.cfg, token);
  if (!t) throw notFound('That file');
  return t;
}
/** Who a file's limits count: the account, or the seat, whether they're asking for a URL or reading from one. */
export const askerOf = (r: Reader): string => r.account?.owner.ownerId ?? r.seat?.seat ?? 'nobody';

/** The one range a `Range` header asks for in a file of `size` bytes. Anything else isn't a range: all of it is sent. */
function rangeIn(header: string | undefined, size: number): { start: number; end: number } | 'past-the-end' | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  const from = m?.[1];
  const to = m?.[2];
  if (!m || (!from && !to)) return undefined;
  if (!from) return Number(to) === 0 ? 'past-the-end' : { start: Math.max(0, size - Number(to)), end: size - 1 };
  const start = Number(from);
  if (to && Number(to) < start) return undefined;
  return start >= size ? 'past-the-end' : { start, end: to ? Math.min(Number(to), size - 1) : size - 1 };
}

/** A name for a header, whatever it's made of: everything but plain characters is a UTF-8 byte, percent-encoded (RFC 8187). */
const headerName = (name: string): string => [...Buffer.from(name)].map((b) => { const ch = String.fromCharCode(b); return /[A-Za-z0-9._~-]/.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`; }).join('');

const PieceRow = z.object({ seq: z.number(), object_id: z.string(), sha256: bytea });
type PieceRow = z.infer<typeof PieceRow>;
/** Opens one piece, checked against its row and its place in the file. */
async function readPiece(w: Place, mediaId: string, key: Uint8Array, p: PieceRow): Promise<Uint8Array> {
  const ct = await w.owner.objects.get(p.object_id);
  return onCore(() => {
    if (!equalBytes(sha(ct), p.sha256)) throw new IntegrityError('A piece of this file failed its integrity check.', { context: { workspaceId: w.workspaceId, mediaId, seq: p.seq, objectId: p.object_id } });
    return openBinary(key, pieceHeader(w, mediaId, p.seq, p.object_id), ct);
  });
}

/**
 * The bytes of a range, a slice at a time as the browser takes them: the next piece is opened only once this one has gone,
 * so someone who stops reading holds one piece. `before` runs ahead of each piece after the first. The first is read before
 * anything is sent, so its failure is an ordinary answer; a later one breaks the response short of what it promised, so a
 * file that couldn't be read is never taken for whole.
 */
async function bytesOf(w: Place, mediaId: string, start: number, end: number, place: Held, before: (opened: number) => void | Promise<void>): Promise<ReadableStream<Uint8Array>> {
  const first = Math.floor(start / MEDIA_PIECE_BYTES);
  const last = Math.floor(end / MEDIA_PIECE_BYTES);
  const left = await rows(w.owner.pool, PieceRow, 'SELECT seq, object_id, sha256 FROM workspace_media_pieces WHERE owner_id = $1 AND media_id = $2 AND seq BETWEEN $3 AND $4 ORDER BY seq', [w.owner.ownerId, mediaId, first, last]);
  if (left.length !== last - first + 1) throw new IntegrityError('A piece of this file is missing.', { context: { workspaceId: w.workspaceId, mediaId, first, last, found: left.length } });
  const key = mediaKey(w.owner, mediaId);
  const read = async (p: PieceRow) => {
    const plain = await inTurn(() => readPiece(w, mediaId, key, p));
    return plain.subarray(p.seq === first ? start - first * MEDIA_PIECE_BYTES : 0, p.seq === last ? end - last * MEDIA_PIECE_BYTES + 1 : plain.length);
  };
  const head = left.shift();
  if (!head) throw new IntegrityError('A piece of this file is missing.', { context: { workspaceId: w.workspaceId, mediaId, first, last } });
  let piece = await read(head).catch((e: unknown) => { key.fill(0); throw e; });
  let opened = 1;
  const slice = () => { const part = piece.subarray(0, SLICE_BYTES); piece = piece.subarray(SLICE_BYTES); return part; };
  // What's sent carries on after the request's own work: its lines still carry its ID.
  const context = currentLogContext();
  let gone = false;
  const done = () => { gone = true; key.fill(0); };
  const sentAll = () => !piece.length && !left.length;
  return new ReadableStream<Uint8Array>({
    start(out) {
      out.enqueue(slice());
      // The server reads two chunks before it writes anything, to see if a body is short enough to give a length, and takes
      // a failure it meets there for the end of the body: a file cut short would look whole. With two here, it's already sending.
      out.enqueue(slice());
      place.still = Date.now();
      if (sentAll()) { done(); out.close(); }
    },
    pull: (out) => withLogContext(context, async () => {
      // It took the last slice. Until the next one is out, it's this process that's working, however long that takes.
      place.still = null;
      if (!piece.length) {
        const p = left.shift();
        if (!p) return;
        try {
          await before(opened++);
          const bytes = await read(p);
          if (gone) return;
          piece = bytes;
        } catch (e) {
          if (gone) return;
          done();
          mlog.at(toAppError(e).level, 'a file couldn’t be read to the end', { workspaceId: w.workspaceId, mediaId, seq: p.seq, err: e });
          out.error(new InternalError('This file couldn’t be read to the end.'));
          return;
        }
      }
      out.enqueue(slice());
      place.still = Date.now();
      if (sentAll()) { done(); out.close(); }
    }),
    cancel: done
  }, { highWaterMark: 0 });
}

/** Whether someone can read what a URL is for, now: everything a URL is ever good for, asked again each time. */
async function stillOpens(d: Deps, who: Who, t: MediaToken): Promise<{ w: Workspace; m: FileRow }> {
  const w = await workspaceFor(d, who, t.workspaceId);
  requireDocument(who, w, t.documentId, 'read');
  const m = await fileIn(w, d.pool, t.documentId, t.mediaId);
  if (m?.state !== 'ready') throw noFile(t, t.documentId, t.mediaId);
  return { w, m };
}

/** A read of a file's URL, as a request brings it. */
export interface FileRead {
  session: string | undefined;
  range: string | undefined;
  /** What a download that stopped says it has part of (`If-Range`): its range counts only while that's still this file's `ETag`. */
  ifRange: string | undefined;
  head: boolean;
  /** Asked for as a download: it comes as one under its own name, whatever it is. */
  download: boolean;
  /** Spends one of someone's reads. Refuses when they have none left. */
  count(who: string): void;
  /** Aborts once the response has gone, however it went, which is when what it held is let go. */
  closed: AbortSignal;
  /** Breaks the connection: nothing else reaches a response that's waiting on a browser that stopped. */
  cut(): void;
}

/**
 * Answers a read of a file's URL. The URL says who's asking and what for and is no reason to let them: every request asks
 * features/workspaces/access.ts again, so someone who lost the document, or a seat that ended, gets the same `not-found` as a
 * URL nobody made, and a read that goes on for long asks again as it goes. Nothing is counted against anyone until they've
 * shown they're who it names, so a leaked URL can't spend their reads; after that each piece opened counts, because one
 * byte costs a whole piece. A read lasts `MEDIA_READ_MS` at most, and gives way before that if it has stopped and someone's
 * waiting: being cut costs a player nothing, because it asks again from where it got to, and a browser's download asks for
 * the rest with the file's `ETag`. What it's served as comes from its sealed info, never the request, and anything off the
 * list only ever downloads.
 */
export async function serve(d: Deps, t: MediaToken, r: FileRead): Promise<Response> {
  const { documentId, mediaId } = t;
  try {
    const who = await whoNamed(d, t, r.session);
    if (!who) throw noFile(t, documentId, mediaId);
    const asker = (who.email === undefined ? t.seat?.seat : t.account) ?? 'nobody';
    r.count(asker);
    // A place outlives the request's own work: its lines still carry its ID.
    const context = currentLogContext();
    const cut = (why: string) => { withLogContext(context, () => { mlog.info('a read was cut', { workspaceId: t.workspaceId, documentId, mediaId, why }); r.cut(); }); };
    const place = await reading.enter(asker, () => { cut('it stopped, and someone is waiting'); }, r.closed);
    mlog.debug('a read has its place', { workspaceId: t.workspaceId, documentId, mediaId, waited: place.waited });
    const ends = setTimeout(() => { cut('its time ran out'); }, d.cfg.MEDIA_READ_MS).unref();
    const letGo = () => { clearTimeout(ends); place.leave(); };
    if (r.closed.aborted) { letGo(); throw browserLeft(); }
    r.closed.addEventListener('abort', letGo, { once: true });
    // A wait can be long enough for anything to have changed.
    const now = place.waited ? await whoNamed(d, t, r.session) : who;
    if (!now) throw noFile(t, documentId, mediaId);
    const { w, m } = await stillOpens(d, now, t);
    const info = openInfo(w, mediaId, m.info_ciphertext);
    // A file's bytes never change once it's there, and nor does its sealed info, so a digest of that names them and says
    // nothing about them: a download that stopped asks for the rest with it (`If-Range`), and picks up where it was.
    const etag = `"${b64u(sha(m.info_ciphertext)).slice(0, 22)}"`;
    const headers: Record<string, string> = {
      'content-type': info.type, 'accept-ranges': 'bytes', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', etag,
      // Nothing in a file runs: opened by itself, it's shown or played and that's all.
      'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'",
      // What can't be shown is only ever a download; anything else is, when that's what was asked for.
      'content-disposition': `${info.type === FILE_TYPE || r.download ? 'attachment' : 'inline'}; filename*=UTF-8''${headerName(info.name)}`
    };
    // Only a GET has a range, and only for the file it was asked against: anything else is answered as if it hadn't asked
    // for one, so what doesn't match gets the whole file.
    const at = r.head || (r.ifRange !== undefined && r.ifRange !== etag) ? undefined : rangeIn(r.range, info.size);
    if (at === 'past-the-end') return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${info.size}` } });
    const start = at?.start ?? 0;
    // An answer to a player's range stops where a piece does, so the next one starts on a piece and opens none of them twice.
    // A download's goes as far as it asked: one that stopped asks for the rest once, and takes what comes for all of it.
    const end = !at ? info.size - 1 : r.download ? at.end : Math.min(at.end, (Math.floor(start / MEDIA_PIECE_BYTES) + PIECES_PER_ANSWER) * MEDIA_PIECE_BYTES - 1);
    const length = end - start + 1;
    const sent = { ...headers, ...(length <= MOST_SENT_WITH_A_LENGTH ? { 'content-length': String(length) } : {}), ...(at ? { 'content-range': `bytes ${start}-${end}/${info.size}` } : {}) };
    // Reading on: each piece counts, and a long read asks again as often as a player's next range would.
    const before = async (opened: number) => {
      r.count(asker);
      if (opened % PIECES_PER_ANSWER) return;
      const still = await whoNamed(d, t, r.session);
      if (!still) throw noFile(t, documentId, mediaId);
      await stillOpens(d, still, t);
    };
    return new Response(r.head ? null : await bytesOf(w, mediaId, start, end, place, before), { status: at ? 206 : 200, headers: sent });
  } catch (e) {
    // A workspace or a document that isn't there has its own words: here, all of it is one refusal.
    if (e instanceof NotFoundError) throw noFile(t, documentId, mediaId);
    throw e;
  }
}

/* ---------- taking files away ---------- */

/**
 * Takes files out for good, in the caller's transaction, which holds the workspace's lock: their rows go with what hangs
 * off them, stored bytes fall to match, and their objects wait in object_gc for `deleteQueued` once it commits.
 */
async function forget(o: Pick<Owner, 'ownerId'>, db: Db, mediaIds: string[]): Promise<void> {
  if (!mediaIds.length) return;
  await exec(db, `INSERT INTO object_gc (object_id, owner_id) SELECT object_id, owner_id FROM workspace_media_pieces WHERE owner_id = $1 AND media_id = ANY($2::text[])
                  UNION ALL SELECT object_id, owner_id FROM workspace_media_previews WHERE owner_id = $1 AND media_id = ANY($2::text[]) ON CONFLICT DO NOTHING`, [o.ownerId, mediaIds]);
  await exec(db, `WITH gone AS (DELETE FROM workspace_media WHERE owner_id = $1 AND media_id = ANY($2::text[]) RETURNING bytes)
                  UPDATE owners SET stored_bytes = greatest(0, stored_bytes - (SELECT coalesce(sum(bytes), 0) FROM gone)), version = version + 1 WHERE owner_id = $1`, [o.ownerId, mediaIds]);
}

/**
 * Deletes a file for good, for everyone, or takes back an upload that hasn't finished: for anyone who can edit a document
 * that has it, because deleting is physical and a photo put in by mistake mustn't wait for its document to go. Every use
 * goes with it, so a version or another document that showed it now gets `not-found`, which the app shows as removed.
 * They have to be able to edit every document that has it, beyond a seat in a call, whether they can open it or not:
 * reusing a picture doesn't make it theirs to delete, and nobody's file goes from a document they were never shown. A
 * document they can't open refuses in the same words as one they can't edit, naming neither. Someone who can edit this
 * one only through a seat is refused before anything else: a seat is for working on it in the call, which taking the
 * file's block out of it is, and deleting the file for everyone isn't.
 */
export async function remove(d: Deps, who: Who, workspaceId: string, documentId: string, mediaId: string): Promise<void> {
  const ownerId = await tx(d.pool, async (c) => {
    const w = await workspaceFor(d, who, workspaceId, c, 'change');
    const doc = requireDocument(who, w, documentId, 'edit');
    if (roleOf(who, { role: w.role, grants: w.lasting }, documentId, doc.item) !== 'edit') {
      throw new ForbiddenError('You can work on this in the call, but you can’t delete its files for good.', { level: 'info', context: { workspaceId, documentId, mediaId, why: 'only a seat' } });
    }
    if (!(await fileIn(w, c, documentId, mediaId))) throw noFile(w, documentId, mediaId);
    const lasting = { role: w.role, grants: w.lasting };
    const stays = (await documentsWith(w, c, mediaId)).find((id) => { const item = w.state.items[id]; return item !== undefined && roleOf(who, lasting, id, item) !== 'edit'; });
    if (stays) throw new ForbiddenError('This file is also in a document you can’t edit.', { context: { workspaceId, documentId: stays, mediaId } });
    await forget(w.owner, c, [mediaId]);
    return w.owner.ownerId;
  });
  mlog.info('file deleted', { workspaceId, documentId, mediaId });
  await collect(d, [ownerId]);
}

/**
 * Documents are going for good, in the caller's transaction, which holds the workspace's lock and deletes them next: a
 * file nothing else uses goes with them. Their use rows go with their `documents` rows.
 */
export async function releaseDocuments(o: Pick<Owner, 'ownerId'>, db: Db, documentIds: string[]): Promise<void> {
  const unused = await rows(db, z.object({ media_id: z.string() }), `SELECT DISTINCT u.media_id FROM workspace_media_uses u WHERE u.owner_id = $1 AND u.document_id = ANY($2::text[])
    AND NOT EXISTS (SELECT 1 FROM workspace_media_uses x WHERE x.owner_id = u.owner_id AND x.media_id = u.media_id AND NOT x.document_id = ANY($2::text[]))`, [o.ownerId, documentIds]);
  await forget(o, db, unused.map((m) => m.media_id));
}
/** A whole workspace is going, in the caller's transaction: its rows go with it, and every object it has waits in object_gc. */
export async function releaseWorkspace(db: Db, ownerId: string): Promise<void> {
  await exec(db, `INSERT INTO object_gc (object_id, owner_id) SELECT object_id, owner_id FROM workspace_media_pieces WHERE owner_id = $1
                  UNION ALL SELECT object_id, owner_id FROM workspace_media_previews WHERE owner_id = $1 ON CONFLICT DO NOTHING`, [ownerId]);
}
/** A copy holds what its original does, in the caller's transaction, which has just made the copies' rows. */
export async function copyUses(o: Pick<Owner, 'ownerId'>, db: Db, copies: { from: string; to: string }[]): Promise<void> {
  if (!copies.length) return;
  await exec(db, `INSERT INTO workspace_media_uses (owner_id, media_id, document_id)
                  SELECT u.owner_id, u.media_id, t.made FROM workspace_media_uses u JOIN unnest($2::text[], $3::text[]) AS t(source, made) ON u.document_id = t.source WHERE u.owner_id = $1`,
    [o.ownerId, copies.map((x) => x.from), copies.map((x) => x.to)]);
}
/** Deletes what's just been queued for these workspaces. It's only sooner than upkeep would, so no failure here undoes what committed. */
export async function collect(d: Pick<Owner, 'pool' | 'objects'>, ownerIds: string[]): Promise<void> {
  if (!ownerIds.length) return;
  await deleteQueued(d, ownerIds).catch((e: unknown) => mlog.warn('objects left for upkeep to delete', { workspaces: ownerIds.length, err: e }));
}

/**
 * Takes away what an upload left when its browser went: its rows, and its objects. Each workspace goes in a transaction of
 * its own, and one that fails is logged and left for next time, so nothing in one can stop the others. Returns how many went.
 */
export async function sweepUploads(d: Deps, ageMs: number = UPLOAD_MS, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - ageMs);
  const due = await rows(d.pool, z.object({ owner_id: z.string(), workspace_id: z.string() }), `SELECT DISTINCT m.owner_id, w.workspace_id FROM workspace_media m JOIN workspaces w ON w.owner_id = m.owner_id
    WHERE m.state = 'uploading' AND m.created_at < $1`, [cutoff]);
  let swept = 0;
  for (const { owner_id: ownerId, workspace_id: workspaceId } of due) {
    try {
      swept += await tx(d.pool, async (c) => {
        await exec(c, 'SELECT 1 FROM workspaces WHERE owner_id = $1 FOR NO KEY UPDATE', [ownerId]);
        const stale = await rows(c, z.object({ media_id: z.string() }), "SELECT media_id FROM workspace_media WHERE owner_id = $1 AND state = 'uploading' AND created_at < $2", [ownerId, cutoff]);
        await forget({ ownerId }, c, stale.map((m) => m.media_id));
        return stale.length;
      });
      await collect(d, [ownerId]);
    } catch (e) {
      mlog.warn('unfinished uploads not swept', { workspaceId, err: e });
    }
  }
  if (swept) mlog.info('unfinished uploads swept', { uploads: swept });
  return swept;
}
