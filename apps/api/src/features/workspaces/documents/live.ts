/*
 * A document live (docs: Data and storage › Live traffic): one room for each document people have open on this instance,
 * which reads each change once for its streams, where everyone's caret is, never stored, and each browser's stream of it.
 */
import { MAX_DOC_AWARENESS_BYTES, type DocClosed, type DocLiveEvent } from '@alcove/api';
import type { StreamingApi } from 'hono/utils/stream';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { z } from 'zod';
import type { Deps } from '../../../platform/context';
import { b64u, fromUtf8, openRecord, sealRecord, utf8, type RecordHeader } from '../../../keys/crypto';
import { bigintText, maybeOne, rows } from '../../../platform/db';
import { ForbiddenError, ValidationError, notFound } from '../../../platform/errors';
import { DocFailure } from '../../../live/doc-pool';
import { runDoc } from './pool';
import { publish, type Hub, type HubEvent, type StreamPlace } from '../../../live/hub';
import { roomFor, type Room, type Snapshot } from '../live/room';
import { LiveStream, type Line, type Step } from '../live/stream';
import { log } from '../../../platform/log';
import { findOwner } from '../../../keys/owners';
import { limitKey, personIn, requireDocument, roleOf, standingIn, trashOf, workspaceFor, workspaceKey, type Credentials, type Reader, type Who } from '../access';
import type { Calls } from '../calls';
import { linesOf } from './work';
import { type Place, LogRow, atOf, contentKey, INLINE_BYTES, BIG_UPDATE_BYTES, SnapshotAt, DocRow, sizeOf, sealedLog, jobFor, report, documentRow, started, closeFor, roomKey } from './documents';
import { type Sending, takeSending, asAscii } from './traffic';

const dlog = log.child({ component: 'documents' });
/** The most carets one update speaks for: a browser has one, and each must fit in a notice with who it is. */
const MAX_AWARENESS_CLIENTS = 4;
/** Yjs's update that says nothing, as it goes on a line. */
const NOTHING = Buffer.from(b64u(new Uint8Array([0, 0])), 'latin1');
const awarenessHeader = (p: Place, documentId: string): RecordHeader => ({ v: 1, ownerId: p.owner.ownerId, workspaceId: p.workspaceId, documentId, kind: 'document-awareness' });

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
  const sealed = sealRecord(workspaceKey(owner), awarenessHeader(p, documentId), stamped(carets, { id, name, callIdentity: reader.seat?.identity ?? null }));
  await publish(d.pool, workspaceId, `${documentId}:${AWARENESS}${fromUtf8(sealed)}`);
}

/* ---------- live ---------- */

/** After a document's ID, a notice is the seq of an update, this and a sealed caret, or that it was replaced. */
const AWARENESS = 'a:';
export const REPLACED = 'replaced';
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
  const { lines } = bytes <= INLINE_BYTES ? linesOf({ at, key, rows: sealed }) : await runDoc(p.owner.docs, 'lines', { at, key, rows: sealed }, { big: bytes > BIG_UPDATE_BYTES, bytes, who: p.owner.ownerId, first: true });
  const snapshot = await maybeOne(p.owner.pool, SnapshotAt, 'SELECT through_seq FROM document_snapshots WHERE owner_id = $1 AND document_id = $2', [p.owner.ownerId, documentId]);
  return { lines, reached: found.at(-1)?.seq ?? after, through: snapshot?.through_seq ?? 0 };
}

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

/** What a stream starts with, once: it's let go of as soon as it's written. `ascii`: the update, as base64url, ready to go on a line. `sent`: all of it has gone, or the reader has. */
interface First { seq: number; ascii: Uint8Array; sent(): void }

/** Whether two readers are one person: by who they are, never by a call they're both in, which everyone in it carries. */
const samePerson = (a: Who, b: Who): boolean => a.principals.some((p) => b.principals.some((q) => Buffer.compare(p, q) === 0));

/** One browser's stream of a document: who it's for, and how far they've been told. Nothing of the document stays here. */
class DocStream extends LiveStream<DocLiveEvent> {
  private first: First | null = null;
  /** How far this browser has been told. Until it starts, as far as the room had got when it joined: whatever comes after that is kept for it. */
  private at: number;
  private caretsTold: number;
  private why: DocClosed = 'access';
  private shut = false;

  constructor(
    d: Deps, room: Room, private readonly doc: DocRoom, credentials: Credentials, calls: Calls, who: Who, version: number, place: StreamPlace, private role: 'edit' | 'read', private trashed: boolean,
    /** Whose budget what's sent here comes out of, and from where. */
    private readonly sender: string, private readonly address: string
  ) {
    super(d, room, credentials, calls, who, version, place, { workspaceId: doc.workspaceId, documentId: doc.documentId });
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
      first.sent();
    }
  }
  protected async step(line: Line<DocLiveEvent>): Promise<Step> {
    if (this.shut) return 'lost';
    const s = this.nextSnapshot();
    if (s !== undefined && !(await this.show(s, line))) return 'lost';
    const { behind, line: update } = this.doc.updateAfter(this.at);
    if (behind) { this.end(); return 'idle'; }
    if (update) {
      // A line is counted until it's gone, like anything else on its way. One there isn't room for now lets this stream go, and its browser opens it again from where it got to.
      let room: Sending;
      try {
        room = takeSending(this.d, this.sender, this.address, update.text.length);
      } catch (e) {
        dlog.info('stream let go: too much on its way', { workspaceId: this.doc.workspaceId, documentId: this.doc.documentId, seq: update.seq, bytes: update.text.length, err: e });
        this.end();
        return 'idle';
      }
      try {
        await line.raw(update.text);
      } finally {
        room.release();
      }
      this.at = update.seq;
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
    this.first?.sent();
    this.first = null;
    super.leave();
    this.doc.leave(this);
  }
}

/** What a browser at `after` doesn't have yet, and the seq that brings it to. There's a limit to what can be on its way to browsers, and it's taken before anything's opened. */
async function syncFrom(d: Deps, p: Place, documentId: string, row: DocRow, after: number, who: string, address: string): Promise<First> {
  if (after > 0 && row.next_seq === after + 1) return { seq: after, ascii: NOTHING, sent: () => undefined };
  const room = takeSending(d, who, address, asAscii(sizeOf(row)));
  try {
    const made = await runDoc(p.owner.docs, 'sync', { ...(await sealedLog(p, documentId)), after }, jobFor(p, documentId, row, who));
    report(p, documentId, made.found);
    room.settle(made.ascii.length);
    return { seq: made.seq, ascii: made.ascii, sent: room.release };
  } catch (e) {
    room.release();
    throw e;
  }
}
const saysUnavailable = async (out: StreamingApi) => { await out.write(`${JSON.stringify({ type: 'closed', why: 'unavailable' } satisfies DocLiveEvent)}\n`); };

/**
 * Opens a document's stream: it hears of changes first and reads second, so nothing falls between them, and anyone who
 * can't open it is refused here, before a line is written. Runs until the reader loses it, the browser goes, can't keep up
 * or says it closed it (`name`, as it calls it), its place is needed, this instance shuts down, or it's time to let go. A
 * document that won't open says so, as its stream's only line.
 */
export async function open(d: Deps, credentials: Credentials, calls: Calls, reader: Reader, workspaceId: string, documentId: string, after: number, address: string, name: string | null): Promise<(out: StreamingApi) => Promise<void>> {
  const place = d.hub.admit('document', limitKey(reader), address, name);
  const release = place.release;
  try {
    const w = await workspaceFor(d, reader, workspaceId);
    const { role, item } = requireDocument(reader, w, documentId, 'read');
    const row = await documentRow(w, documentId);
    if (row.closed) { release(); return saysUnavailable; }
    if (item.kind === 'document') await started(w, documentId, row);
    const tree = roomFor(d, workspaceId);
    const room = docRoomFor(d, w, documentId, tree);
    const stream = new DocStream(d, tree, room, credentials, calls, { email: reader.email, principals: reader.principals, calls: reader.calls }, w.version, place, role, trashOf(w.state, documentId) !== null, limitKey(reader), address);
    tree.join(stream);
    room.join(stream);
    try {
      await Promise.all([tree.ready, room.ready]);
      // Whatever changed before the room was listening: nothing did, usually, and that costs one small query.
      void tree.read();
      stream.start(await syncFrom(d, w, documentId, await documentRow(w, documentId), after, limitKey(reader), address));
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

/** A browser says it closed its stream of a document, by what it called it: it ends now, and its place is free. Only the asker's own. */
export function endStream(d: Deps, reader: Reader, name: string): void {
  d.hub.end('document', limitKey(reader), name);
}
