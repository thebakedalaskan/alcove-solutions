/*
 * A document being worked on (docs: Data and storage › Documents): a Y.Doc kept in step with everyone else's through the
 * API, in a browser or in Node. What changes here goes up in batches, one at a time, until the API says it has it; what
 * anyone else does comes down the document's stream, which picks up from the last `seq` it heard however it ended. Yjs
 * updates can arrive twice and in any order, so a retry never does harm and there's nothing to reconcile.
 *
 * Nothing typed is let go of until the API has it, or until someone chooses to. A refusal never does: what's refused stays
 * here and in `keep`, through reloads, until it goes or someone takes it out with `unsentCopy`.
 *
 * It never writes as one of the server's own clients (`SERVER_CLIENT`), which the API turns away: whatever puts it on one, it
 * moves to a client of its own before anything is written, so nothing it writes is ever refused for that.
 *
 * A refused update can't hold up what's behind it. A client's clocks have to reach the API in order, so anything written as
 * the same client is stuck behind it: this document moves to a new client, and what's written from then on goes as usual,
 * unless it builds on what's stuck. It only moves so many times, as a client costs the API a row: after that what's written
 * waits with the rest. What's stuck is worked out afresh from time to time, and always goes whole: a change is never split,
 * so a move can't arrive as a delete. Yjs lets go of what's been deleted, so once a paste is undone or cut down, what's left
 * of it is small, and at the limit anything that doesn't add to the page goes.
 *
 * This module holds Yjs, and loads with the first document someone opens.
 */
import {
  AlcoveApiError, DOC_FRAGMENT, MAX_DOC_ITEMS, MAX_DOC_UPDATE_BYTES, errorCode, fromBase64Url, isServerClient, randomClient, toBase64Url, type DocClosed, type DocCopyToken, type DocLiveEvent, type DocRefusal, type DocSession,
  type DocSize, type DocStatus, type DocUnsentCopy, type KeptUpdates
} from '@alcove/api';
import { TAGS, itemsOnPage } from '@alcove/api/retire';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { unref } from './workspaces';

/** How long edits gather before they're sent, and carets. */
const BATCH_MS = 150;
const CARET_MS = 100;
const FIRST_WAIT_MS = 500;
const LONGEST_WAIT_MS = 10_000;
/**
 * How long Alcove can be turning edits away with `unavailable` before that's the connection's fault as far as anyone typing
 * is concerned. A restore holds a document for a moment, and it's only ever longer if the instance doing it went.
 */
const BUSY_MS = 30_000;
/** A stream that lasted at least this long was fine, so opening it again waits for nothing. */
const STEADY_MS = 1_000;
/** What one request carries, leaving room for what merging adds. */
const REQUEST_BYTES = MAX_DOC_UPDATE_BYTES - 64 * 1024;
/** How many updates go in one request, however small: merging them isn't free. */
const REQUEST_UPDATES = 64;
/** How soon after something changes here what's stuck is tried again, then how soon after that, doubling up to how often if nothing does: room may have been made by someone else. */
const STUCK_SOON_MS = 1_000;
const STUCK_AGAIN_MS = 3_000;
const STUCK_WAIT_MS = 30_000;
/** How many new clients one stretch of being stuck gets, however long it lasts: each is a client the API has for good. */
const MOST_MOVES = 4;

/** Whatever Yjs applies with this came from Alcove or from `keep`, and isn't new here. */
const HEARD = Symbol('heard');

export interface DocTransport {
  open(after: number, signal: AbortSignal): AsyncIterable<DocLiveEvent>;
  /** Sends one update. Resolves once the API has it safe. */
  update(update: Uint8Array): Promise<unknown>;
  awareness(update: string, keepalive: boolean): Promise<unknown>;
}

/** An edit Alcove doesn't have yet, and its place in `keep`, if it has one, once that's known. `stuck`: it's waiting on something other than the connection. */
interface Unsent { update: Uint8Array; kept: Promise<number | null> | null; key: number | null; stuck: boolean; clients: Set<number>; items: number }
type Ending = { over: DocClosed } | 'ended' | 'failed';
type Struct = ReturnType<typeof Y.decodeUpdate>['structs'][number];
type Deletes = ReturnType<typeof Y.createDeleteSet>;

/** What of a delete set reaches past what Alcove has: deletes of what's new. */
function deletesPast(ds: Deletes, known: Map<number, number>): Deletes {
  const out = Y.createDeleteSet();
  for (const [client, ranges] of ds.clients) {
    const reach = known.get(client) ?? 0;
    const past = ranges.flatMap(({ clock, len }) => (clock + len > reach ? [{ clock: Math.max(clock, reach), len: clock + len - Math.max(clock, reach) }] : []));
    if (past.length) out.clients.set(client, past);
  }
  return out;
}
/** An update of these structs, one client at a time in clock order as `decodeUpdate` gives them, and these deletes. */
function encodeUpdate(structs: Struct[], ds: Deletes): Uint8Array {
  const encoder = new Y.UpdateEncoderV1();
  const byClient = new Map<number, Struct[]>();
  for (const s of structs) {
    const list = byClient.get(s.id.client);
    if (list) list.push(s);
    else byClient.set(s.id.client, [s]);
  }
  encoding.writeVarUint(encoder.restEncoder, byClient.size);
  for (const [client, list] of byClient) {
    encoding.writeVarUint(encoder.restEncoder, list.length);
    encoder.writeClient(client);
    encoding.writeVarUint(encoder.restEncoder, list[0]?.id.clock ?? 0);
    for (const s of list) s.write(encoder, 0);
  }
  encoding.writeVarUint(encoder.restEncoder, ds.clients.size);
  for (const [client, ranges] of ds.clients) {
    encoder.resetDsCurVal();
    encoding.writeVarUint(encoder.restEncoder, client);
    encoding.writeVarUint(encoder.restEncoder, ranges.length);
    for (const { clock, len } of ranges) { encoder.writeDsClock(clock); encoder.writeDsLen(len); }
  }
  return encoder.toUint8Array();
}

/** What's in an update, as a request counts it. */
function shapeOf(update: Uint8Array): Pick<Unsent, 'clients' | 'items'> {
  const { structs } = Y.decodeUpdate(update);
  return { clients: new Set(structs.map((s) => s.id.client)), items: structs.length };
}

/** The clocks of what's unsent, by writer: `[from, to)`. */
type Ranges = Map<number, [number, number][]>;
/** What of a run of clocks, starting at `clock`, is unsent: as offsets into it. */
function unsentIn(mine: Ranges, client: number, clock: number, length: number): [number, number][] {
  return (mine.get(client) ?? []).flatMap(([from, to]) => {
    const start = Math.max(from, clock);
    const end = Math.min(to, clock + length);
    return start < end ? [[start - clock, end - clock] satisfies [number, number]] : [];
  });
}
/** The unsent words of one string item, which Yjs may have merged with words that went. */
function unsentWords(item: Y.Item, mine: Ranges): string {
  if (item.deleted || !(item.content instanceof Y.ContentString)) return '';
  const { str } = item.content;
  return unsentIn(mine, item.id.client, item.id.clock, item.length).map(([a, b]) => str.slice(a, b)).join('');
}
const isUnsent = (item: Y.Item | null, mine: Ranges): boolean => item !== null && !item.deleted && unsentIn(mine, item.id.client, item.id.clock, 1).length > 0;
/** Unsent words in what's given, a paragraph to each line, in the order they're on the page. Mentions and dates go as what they say. */
function paragraphsOf<E>(type: Y.AbstractType<E>, mine: Ranges, out: string[]): void {
  let line = '';
  const flush = () => { if (line.trim()) out.push(line.trim()); line = ''; };
  if (type instanceof Y.XmlFragment) {
    for (const child of type.toArray()) {
      if (child instanceof Y.XmlText) {
        for (let item = child._start; item; item = item.right) line += unsentWords(item, mine);
      } else if (child instanceof Y.XmlElement && child.nodeName === 'hardBreak') {
        if (isUnsent(child._item, mine)) line += '\n';
      } else if (child instanceof Y.XmlElement && TAGS.has(child.nodeName)) {
        if (isUnsent(child._item, mine)) line += String(child.getAttribute('name') ?? child.getAttribute('date') ?? '');
      } else if (child instanceof Y.XmlElement) {
        flush();
        paragraphsOf(child, mine, out);
      }
    }
    flush();
    return;
  }
  for (let item = type._start; item; item = item.right) {
    if (item.deleted) continue;
    line += unsentWords(item, mine);
    if (item.content instanceof Y.ContentType) { flush(); paragraphsOf(item.content.type, mine, out); }
  }
  flush();
  for (const item of type._map.values()) if (!item.deleted && item.content instanceof Y.ContentType) paragraphsOf(item.content.type, mine, out);
}
/** Unsent words Yjs is holding with nowhere to put them, because what they were built on isn't here: a paragraph to each run of them. */
function wordsWaiting(doc: Y.Doc, mine: Ranges): string[] {
  const pending = doc.store.pendingStructs;
  if (!pending) return [];
  const out: string[] = [];
  let run = '';
  let next: { client: number; clock: number } | null = null;
  for (const s of Y.decodeUpdateV2(pending.update).structs) {
    if (!(s instanceof Y.Item)) continue;
    const words = unsentWords(s, mine);
    if (!words) continue;
    if (next && (next.client !== s.id.client || next.clock !== s.id.clock) && run.trim()) { out.push(run.trim()); run = ''; }
    run += words;
    next = { client: s.id.client, clock: s.id.clock + s.length };
  }
  if (run.trim()) out.push(run.trim());
  return out;
}

/** A Y.Doc on a client of its own from the start, so its caret's is too. */
function ownDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.clientID = randomClient();
  return doc;
}

export class HttpDocSession implements DocSession {
  readonly doc = ownDoc();
  readonly awareness = new Awareness(this.doc);
  readonly ready: Promise<void>;
  private settle: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  private view: DocStatus = { status: 'saved', refused: null, role: null, trashed: false, closed: null, unsent: false };
  private readonly listeners = new Set<() => void>();
  /** `close()` was called, or the stream ended for good: nothing more is heard. */
  private stopped = false;
  private closed = false;
  /** Nothing more is sent: the API said this can't be opened any more, and the stream will say why. */
  private barred = false;
  private connection: AbortController | null = null;
  private stopWaiting: (() => void) | null = null;
  /** How far the stream has told this browser, which is where it picks up. Never moved by what this browser sent. */
  private seq = 0;
  private live = false;
  private streamDown = false;
  private sendDown = false;
  /** Why nothing can go at all, until an `access` line says otherwise. */
  private shut: 'read-only' | 'trashed' | null = null;
  /** Alcove won't take what's stuck here as it stands. */
  private rejected = false;
  /** What's stuck is too much, for one request or for the document. Otherwise it may only need working out afresh. */
  private tooMuch = false;
  /** Whose clocks can't reach Alcove until what's stuck does, and how many times this has moved on from one. */
  private readonly stuckClients = new Set<number>();
  private moves = 0;
  /** How long until what's stuck is tried again, after this try. */
  private stuckWait = STUCK_AGAIN_MS;
  /** What each copy held, so letting go of it lets go of that and nothing else. */
  private readonly copies = new WeakMap<DocCopyToken, ReadonlySet<Unsent>>();
  /** Why the stream last failed, for `ready`. */
  private settleFailure: unknown;

  /** What's gathering for the next batch. */
  private fresh: Uint8Array[] = [];
  private batch: ReturnType<typeof setTimeout> | undefined;
  /** Everything Alcove doesn't have yet, the oldest first. */
  private unsent: Unsent[] = [];
  private sending = false;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryWait = FIRST_WAIT_MS;
  /** When Alcove started saying it can't take this yet, though there's a connection. */
  private busySince: number | null = null;
  private stuckTry: ReturnType<typeof setTimeout> | undefined;

  private caret: ReturnType<typeof setTimeout> | undefined;
  private announcing = false;
  private announceAgain = false;

  constructor(private readonly net: DocTransport, private readonly keep: KeptUpdates | undefined, private readonly quietMs: number) {
    this.ready = new Promise((resolve, reject) => { this.settle = { resolve, reject }; });
    // Nobody may be waiting on it: a refusal also shows in the status.
    this.ready.catch(() => undefined);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== HEARD) this.edited(update); });
    // Anything that put it on one of the server's clients is moved off it before a word is written: what's written as one is refused for good.
    // A move costs the API nothing until it's written as, so it isn't one of the moves a stretch of being stuck gets.
    this.doc.on('beforeTransaction', () => { if (isServerClient(this.doc.clientID)) this.becomeNew(); });
    this.awareness.on('update', (changes: { added: number[] }, origin: unknown) => {
      // Someone new doesn't know where this caret is: nothing keeps it for them.
      if (origin === 'local' || (origin === HEARD && changes.added.length)) this.announceSoon();
    });
    void this.start();
  }

  getSnapshot = (): DocStatus => this.view;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  close = () => {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.stuckTry);
    if (!this.stopped) {
      this.stopped = true;
      this.connection?.abort();
      this.stopWaiting?.();
      clearTimeout(this.caret);
      if (this.live) {
        removeAwarenessStates(this.awareness, [this.awareness.clientID], 'closing');
        this.net.awareness(toBase64Url(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])), true).catch(() => undefined);
      }
      this.awareness.destroy();
      this.settle?.reject(new AlcoveApiError('unknown', 'This document was closed.'));
    }
    // What's waiting goes while it can: whatever doesn't is in `keep` for next time.
    this.cut();
    void this.send().finally(() => this.doc.destroy());
  };

  /**
   * The words this browser wrote that Alcove hasn't taken, and nothing else: the clocks every waiting update brings, read off
   * the page in order, then off what Yjs is holding with nowhere to put it. Its token remembers what was waiting, all of which
   * the copy holds the words of.
   */
  unsentCopy = (): DocUnsentCopy => {
    this.cut();
    const mine: Ranges = new Map();
    for (const u of this.unsent) {
      const { from, to } = Y.parseUpdateMeta(u.update);
      for (const [client, end] of to) {
        const range: [number, number] = [from.get(client) ?? 0, end];
        mine.set(client, [...(mine.get(client) ?? []), range]);
      }
    }
    const paragraphs: string[] = [];
    paragraphsOf(this.doc.getXmlFragment(DOC_FRAGMENT), mine, paragraphs);
    for (const [name, type] of this.doc.share) if (name !== DOC_FRAGMENT) paragraphsOf(type, mine, paragraphs);
    const text = [...paragraphs, ...wordsWaiting(this.doc, mine)].join('\n');
    const token: DocCopyToken = { vector: Y.encodeStateVector(this.doc), keys: this.unsent.flatMap((u) => (u.key === null ? [] : [u.key])) };
    this.copies.set(token, new Set(this.unsent));
    return { text, token };
  };
  size = (): DocSize => ({ bytes: Y.encodeStateAsUpdate(this.doc).length, items: itemsOnPage(this.doc) });
  /**
   * The one thing that forgets what Alcove doesn't have, for someone who chose to: what a copy holds that can't reach this
   * document. This one still holds it, so it closes, for it to be opened again from what Alcove has, with what's still kept.
   */
  discardUnsaved = async (token: DocCopyToken): Promise<void> => {
    const held = this.copies.get(token);
    // Nothing here goes any more: the session's over, or this person can only read now, which an edit never changes back.
    const nowhere = this.view.closed !== null || this.shut === 'read-only';
    const letGo = held ? this.unsent.filter((u) => held.has(u) && (u.stuck || nowhere)) : [];
    this.unsent = this.unsent.filter((u) => !letGo.includes(u));
    await this.forget(letGo);
    this.publish();
    this.close();
  };

  private get stuck(): boolean { return this.unsent.some((u) => u.stuck); }
  private get refused(): DocRefusal | null {
    return this.shut ?? (!this.stuck ? null : this.rejected ? 'rejected' : this.tooMuch ? 'too-large' : null);
  }
  private publish(): void {
    const unsent = this.fresh.length > 0 || this.unsent.length > 0;
    const { refused } = this;
    const status: DocStatus['status'] = refused ? 'failed' : this.streamDown || this.sendDown ? 'offline' : unsent ? 'saving' : 'saved';
    const v = this.view;
    if (v.status === status && v.refused === refused && v.unsent === unsent) return;
    this.view = { ...v, status, refused, unsent };
    this.listeners.forEach((l) => l());
  }
  private set(p: Partial<DocStatus>): void {
    this.view = { ...this.view, ...p };
    this.listeners.forEach((l) => l());
  }

  /* ---------- up ---------- */

  private edited(update: Uint8Array): void {
    this.fresh.push(update);
    // Nothing goes from here, but it's kept like anything else.
    if (this.stopped) { this.cut(); this.publish(); return; }
    this.publish();
    if (this.stuck) { this.stuckWait = STUCK_AGAIN_MS; this.tryStuck(STUCK_SOON_MS); }
    if (this.batch !== undefined) return;
    this.batch = setTimeout(() => { this.batch = undefined; this.cut(); void this.send(); }, BATCH_MS);
    unref(this.batch);
  }
  /** Ends a batch: it's kept here until Alcove has it, whatever happens to this tab. Written as a client that's stuck, it can't go ahead of what's stuck. */
  private cut(): void {
    clearTimeout(this.batch);
    this.batch = undefined;
    if (!this.fresh.length) return;
    const update = this.fresh.length === 1 && this.fresh[0] ? this.fresh[0] : Y.mergeUpdates(this.fresh);
    this.fresh = [];
    const shape = shapeOf(update);
    const entry: Unsent = { update, kept: null, key: null, stuck: [...shape.clients].some((c) => this.stuckClients.has(c)), ...shape };
    entry.kept = this.keep ? this.keep.add(update, Date.now()).then((key) => { entry.key = key; return key; }, () => null) : null;
    this.unsent.push(entry);
  }
  /** As much as fits in one request, the oldest first, and always at least one. */
  private nextBatch(): Unsent[] {
    let bytes = 0;
    let items = 0;
    const batch: Unsent[] = [];
    for (const u of this.unsent) {
      if (u.stuck) continue;
      if (batch.length && (bytes + u.update.length > REQUEST_BYTES || items + u.items > MAX_DOC_ITEMS || batch.length >= REQUEST_UPDATES)) break;
      batch.push(u);
      bytes += u.update.length;
      items += u.items;
    }
    return batch;
  }
  /**
   * What's in this batch can't go, nor can anything else its clients wrote, as their clocks have to arrive in order. Whatever
   * comes next is written as someone new, so it isn't behind any of it, until that's happened so many times that it waits too.
   */
  private stick(batch: Unsent[]): void {
    this.cut();
    for (const u of batch) for (const client of u.clients) this.stuckClients.add(client);
    for (const u of this.unsent) if (batch.includes(u) || [...u.clients].some((c) => this.stuckClients.has(c))) u.stuck = true;
    if (this.stuckClients.has(this.doc.clientID) && this.moves < MOST_MOVES) {
      this.moves += 1;
      this.becomeNew();
    }
    this.tryStuck(STUCK_SOON_MS);
  }
  /** A new client, for Yjs and for the caret that goes with it: an editor tells its own caret from others' by the two matching. */
  private becomeNew(): void {
    this.doc.clientID = randomClient();
    const was = this.awareness.clientID;
    const state = this.awareness.getLocalState();
    removeAwarenessStates(this.awareness, [was], 'moved');
    if (this.live) this.net.awareness(toBase64Url(encodeAwarenessUpdate(this.awareness, [was])), false).catch(() => undefined);
    this.awareness.clientID = this.doc.clientID;
    // Twice, because Awareness ignores a client's first state.
    this.awareness.setLocalState(state);
    this.awareness.setLocalState(state);
  }
  /** One request at a time, oldest first, so a retry only ever repeats what the API may not have. */
  private async send(): Promise<void> {
    if (this.sending || this.barred || this.shut) return;
    this.sending = true;
    try {
      for (;;) {
        const batch = this.nextBatch();
        const first = batch[0];
        if (!first) break;
        const update = batch.length === 1 ? first.update : Y.mergeUpdates(batch.map((b) => b.update));
        if (update.length > MAX_DOC_UPDATE_BYTES) { this.tooMuch = true; this.stick(batch); continue; }
        try {
          await this.net.update(update);
        } catch (e) {
          if (this.sendFailed(e, batch)) continue;
          break;
        }
        this.delivered(batch);
      }
    } finally {
      this.sending = false;
      this.publish();
    }
  }
  private delivered(batch: Unsent[]): void {
    this.sendDown = false;
    this.busySince = null;
    this.retryWait = FIRST_WAIT_MS;
    this.unsent = this.unsent.filter((u) => !batch.includes(u));
    void this.forget(batch);
    if (!this.stuck) {
      this.stuckClients.clear();
      this.moves = 0;
      this.tooMuch = false;
      this.rejected = false;
      this.stuckWait = STUCK_AGAIN_MS;
    }
    this.publish();
  }
  /** Whether what's behind this can go now. Otherwise what's waiting stays until what stopped it changes: an `access` line, the stream saying it's over, or the connection coming back. */
  private sendFailed(e: unknown, batch: Unsent[]): boolean {
    const code = errorCode(e);
    if (code === 'too-large') { this.tooMuch = true; this.stick(batch); return true; }
    // Something it builds on is stuck, or it's something this browser made that needs working out afresh.
    if (code === 'invalid') { this.stick(batch); return true; }
    if (code === 'forbidden') this.shut = 'read-only';
    else if (code === 'conflict') this.shut = 'trashed';
    else if (code === 'not-found' || code === 'unauthenticated') this.barred = true;
    else if (code === 'unavailable') this.tryAgain(this.stillBusy());
    else this.tryAgain(true);
    return false;
  }
  /** Whether Alcove has been saying "not yet" for longer than it should: someone typing through a restore is saving, not offline. */
  private stillBusy(): boolean {
    this.busySince ??= Date.now();
    return Date.now() - this.busySince >= BUSY_MS;
  }
  private tryAgain(down: boolean): void {
    this.sendDown = down;
    if (this.retry !== undefined || this.stopped) return;
    this.retry = setTimeout(() => { this.retry = undefined; void this.send(); }, this.retryWait * (0.8 + Math.random() * 0.4));
    unref(this.retry);
    this.retryWait = Math.min(this.retryWait * 2, LONGEST_WAIT_MS);
  }
  private tryStuck(ms: number): void {
    clearTimeout(this.stuckTry);
    if (this.stopped) return;
    this.stuckTry = setTimeout(() => { void this.sendStuck(); }, ms);
    unref(this.stuckTry);
  }
  /** Where Alcove has got to: what's here, less everything still to reach it. */
  private knownToAlcove(): Uint8Array {
    const known = Y.decodeStateVector(Y.encodeStateVector(this.doc));
    for (const u of this.unsent) {
      for (const [client, clock] of Y.parseUpdateMeta(u.update).from) known.set(client, Math.min(known.get(client) ?? 0, clock));
    }
    return Y.encodeStateVector(known);
  }
  /**
   * Everything Alcove doesn't have, worked out from what's here now, in a document of its own: nothing here is keeping what
   * was deleted for undo there, so whatever's been taken out is sent as the small thing it now is. Of what's deleted, only
   * what Alcove may not have: what's waiting deleted, and what's new and gone already. All that's ever been deleted is what
   * Yjs would send, which says nothing new, and would cost a row every time.
   */
  private composed(): Uint8Array {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this.doc));
    scratch.store.pendingStructs = null;
    scratch.store.pendingDs = null;
    const known = this.knownToAlcove();
    const { structs, ds } = Y.decodeUpdate(Y.encodeStateAsUpdate(scratch, known));
    scratch.destroy();
    const waiting = this.placed(this.unsent).map((u) => Y.decodeUpdate(u.update).ds);
    return encodeUpdate(structs, Y.mergeDeleteSets([deletesPast(ds, Y.decodeStateVector(known)), ...waiting]));
  }
  /** Which of what's waiting is in this document: anything else Yjs has nowhere to put, and nothing worked out from here holds it. */
  private placed(waiting: Unsent[]): Unsent[] {
    const here = Y.decodeStateVector(Y.encodeStateVector(this.doc));
    return waiting.filter((u) => [...Y.parseUpdateMeta(u.update).to].every(([client, clock]) => (here.get(client) ?? 0) >= clock));
  }
  private laterStuck(): number {
    const ms = this.stuckWait;
    this.stuckWait = Math.min(ms * 2, STUCK_WAIT_MS);
    return ms;
  }
  /** What stopped what's stuck, and how long until it's tried again. Null: it's for an `access` line to start it again. */
  private async stuckFailed(e: unknown): Promise<number | null> {
    const code = errorCode(e);
    if (code === 'too-large') {
      this.tooMuch = true;
      this.rejected = false;
      return this.laterStuck();
    }
    if (code === 'invalid') {
      // There's nothing more this browser can do with it, but what's refused may change, and everything else carries on. It stays here for someone to take out.
      this.rejected = true;
      return this.laterStuck();
    }
    if (code === 'forbidden') this.shut = 'read-only';
    else if (code === 'conflict') this.shut = 'trashed';
    else if (code === 'not-found' || code === 'unauthenticated') this.barred = true;
    else return STUCK_WAIT_MS;
    return null;
  }
  /** Tries everything waiting, worked out afresh. Only what's in it is let go of, once Alcove has it. */
  private async sendComposed(): Promise<number | null> {
    const update = this.composed();
    const waiting = this.placed(this.unsent);
    if (update.length > MAX_DOC_UPDATE_BYTES) {
      this.tooMuch = true;
      return this.laterStuck();
    }
    try {
      // Nothing new, and nothing gone: what was stuck isn't anywhere in this document any more, or is somewhere Yjs can't place it, which nothing sent from here would change.
      if (Y.parseUpdateMeta(update).to.size || Y.decodeUpdate(update).ds.clients.size) await this.net.update(update);
    } catch (e) {
      return this.stuckFailed(e);
    }
    this.delivered(waiting);
    if (!this.stuck) return null;
    this.rejected = true;
    return this.laterStuck();
  }
  /** Takes the place of everything waiting, if it's something Alcove can take. Tried again from time to time, as what's refused can change. */
  private async sendStuck(): Promise<void> {
    if (this.stopped || this.barred || this.shut || !this.stuck) return;
    if (this.sending) { this.tryStuck(STUCK_SOON_MS); return; }
    this.sending = true;
    let again: number | null = null;
    try {
      this.cut();
      again = await this.sendComposed();
    } finally {
      this.sending = false;
      this.publish();
      if (again !== null) this.tryStuck(again);
    }
    void this.send();
  }
  private async forget(sent: Unsent[]): Promise<void> {
    if (!this.keep) return;
    const keys = (await Promise.all(sent.map((u) => u.kept))).flatMap((k) => (k === null ? [] : [k]));
    if (keys.length) await this.keep.remove(keys).catch(() => undefined);
  }

  /* ---------- carets ---------- */

  private announceSoon(): void {
    if (this.caret !== undefined || this.stopped) return;
    this.caret = setTimeout(() => { this.caret = undefined; void this.announce(); }, CARET_MS);
    unref(this.caret);
  }
  /** Best effort, and one at a time: the next move says it again, and Awareness renews itself every 15 seconds. */
  private async announce(): Promise<void> {
    if (this.stopped || !this.live) return;
    if (this.announcing) { this.announceAgain = true; return; }
    this.announcing = true;
    try {
      await this.net.awareness(toBase64Url(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID])), false);
    } catch {
      /* Where someone's caret was a moment ago isn't worth a retry. */
    } finally {
      this.announcing = false;
      if (this.announceAgain) { this.announceAgain = false; this.announceSoon(); }
    }
  }

  /* ---------- down ---------- */

  private apply(update: string): void { Y.applyUpdate(this.doc, fromBase64Url(update), HEARD); }
  private access(role: DocStatus['role'], trashed: boolean): void {
    this.set({ role, trashed });
    // Whatever was waiting on this may go now. If it's still refused, it says so again.
    if (role === 'edit' && !trashed) {
      this.shut = null;
      this.barred = false;
      if (this.stuck) this.tryStuck(0);
    }
    void this.send();
    this.publish();
  }
  private take(e: DocLiveEvent): void {
    switch (e.type) {
      case 'sync':
        this.apply(e.update);
        this.seq = e.seq;
        this.live = true;
        this.streamDown = false;
        this.access(e.role, e.trashed);
        this.settle?.resolve();
        // Here again: said afresh, because Awareness ignores a client's first state, and people may have forgotten this one.
        this.awareness.setLocalState(this.awareness.getLocalState());
        return;
      case 'update':
        this.apply(e.update);
        this.seq = e.seq;
        return;
      case 'awareness':
        applyAwarenessUpdate(this.awareness, fromBase64Url(e.update), HEARD);
        return;
      case 'access':
        this.access(e.role, e.trashed);
        return;
      case 'ping':
      case 'closed':
        return;
    }
  }

  /** One connection, until it ends. Silence past `quietMs` cuts it. */
  private async follow(): Promise<Ending> {
    const connection = new AbortController();
    this.connection = connection;
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const heard = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => connection.abort(), this.quietMs);
      unref(quiet);
    };
    heard();
    try {
      for await (const e of this.net.open(this.seq, connection.signal)) {
        heard();
        if (e.type === 'closed') return { over: e.why };
        this.take(e);
      }
      return 'ended';
    } catch (e) {
      const code = errorCode(e);
      this.settleFailure = e;
      // A record that won't open won't open next time either.
      if (code === 'not-found' || code === 'forbidden' || code === 'key-unavailable') return { over: 'access' };
      if (code === 'unauthenticated') return { over: 'session' };
      return 'failed';
    } finally {
      clearTimeout(quiet);
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.stopWaiting = null; resolve(); }, ms);
      unref(timer);
      this.stopWaiting = () => { clearTimeout(timer); this.stopWaiting = null; resolve(); };
    });
  }

  /** What was kept here comes first, so it goes as soon as there's a connection. */
  private async start(): Promise<void> {
    if (this.keep) {
      try {
        for (const k of await this.keep.load()) {
          Y.applyUpdate(this.doc, k.update, HEARD);
          this.unsent.push({ update: k.update, kept: Promise.resolve(k.key), key: k.key, stuck: false, ...shapeOf(k.update) });
        }
      } catch {
        /* What's kept can't be read here: this session has nothing of it to send, and it's kept all the same. */
      }
      this.publish();
    }
    await this.run();
  }

  private async run(): Promise<void> {
    let wait = FIRST_WAIT_MS;
    while (!this.stopped) {
      const opened = Date.now();
      const ending = await this.follow();
      this.live = false;
      if (this.stopped) return;
      if (typeof ending === 'object') { this.over(ending.over); return; }
      if (ending === 'failed') { this.streamDown = true; this.publish(); }
      const steady = Date.now() - opened >= STEADY_MS;
      if (ending === 'ended' && steady) { wait = FIRST_WAIT_MS; continue; }
      if (steady) wait = FIRST_WAIT_MS;
      // A little apart, so everyone a restart cut off doesn't come back in the same moment.
      await this.wait(ending === 'ended' ? Math.min(wait, 100) : wait * (0.8 + Math.random() * 0.4));
      wait = Math.min(wait * 2, LONGEST_WAIT_MS);
    }
  }

  /** It ended for good: nothing more goes up or comes down. What's unsent stays kept, even if there's nothing left for it to go to, for someone to take out. */
  private over(why: DocClosed): void {
    this.stopped = true;
    this.barred = true;
    this.cut();
    clearTimeout(this.retry);
    clearTimeout(this.caret);
    clearTimeout(this.stuckTry);
    this.awareness.destroy();
    this.settle?.reject(this.settleFailure ?? new AlcoveApiError('unavailable', 'This document can’t be opened right now.'));
    this.set({ closed: why });
    this.publish();
  }
}
