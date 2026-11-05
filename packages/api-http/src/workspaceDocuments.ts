/*
 * A document being worked on (docs: Data and storage › Documents): a Y.Doc kept in step with everyone else's through the
 * API, in a browser or in Node. What changes here goes up in batches, one at a time, until the API says it has it; what
 * anyone else does comes down the document's stream, which picks up from the last `seq` it heard however it ended. Yjs
 * updates can arrive twice and in any order, so a retry never does harm and there's nothing to reconcile.
 *
 * Nothing typed is let go of until the API has it, or until someone chooses to. A refusal never does: what's refused stays
 * here and in `keep`, through reloads, until it goes or someone takes it out with `localCopy`.
 *
 * A refused update can't hold up what's behind it. A client's clocks have to reach the API in order, so anything written as
 * the same client is stuck behind it: this document moves to a new client, and what's written from then on goes as usual,
 * unless it builds on what's stuck. It only moves so many times, as a client costs the API a row: after that what's written
 * waits with the rest. What's stuck is worked out afresh from time to time. Yjs lets go of what's been deleted, so once a
 * paste is undone or cut down, what's left of it is small. Whatever's been deleted of what the API has goes on its own
 * meanwhile, as that's how a full document gets room.
 *
 * This module holds Yjs, and loads with the first document someone opens.
 */
import {
  AlcoveApiError, DOC_FRAGMENT, MAX_DOC_ITEMS, MAX_DOC_UPDATE_BYTES, errorCode, fromBase64Url, toBase64Url, type DocClosed, type DocLiveEvent, type DocLocalCopy, type DocRefusal, type DocSession, type DocSize, type DocStatus, type KeptUpdates
} from '@alcove/api';
import { TAGS, isGone, itemsOnPage, newBlockId } from '@alcove/api/retire';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { unref } from './workspaces';

/** How long edits gather before they're sent, and carets. */
const BATCH_MS = 150;
const CARET_MS = 100;
const FIRST_WAIT_MS = 500;
const LONGEST_WAIT_MS = 10_000;
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

/** An edit Alcove doesn't have yet, and its place in `keep`, if it has one. `stuck`: it's waiting on something other than the connection. */
interface Unsent { update: Uint8Array; kept: Promise<number | null> | null; stuck: boolean; clients: Set<number>; items: number }
type Ending = { over: DocClosed } | 'ended' | 'failed';

/** What's in an update, as a request counts it. */
function shapeOf(update: Uint8Array): Pick<Unsent, 'clients' | 'items'> {
  const { structs } = Y.decodeUpdate(update);
  return { clients: new Set(structs.map((s) => s.id.client)), items: structs.length };
}

/** The words in a line, or anything else that holds them. */
function wordsIn(type: Y.XmlFragment): string {
  return type.toArray().map((child) => {
    if (child instanceof Y.XmlText) {
      let words = '';
      for (let item = child._start; item; item = item.right) if (!item.deleted && item.content instanceof Y.ContentString) words += item.content.str;
      return words;
    }
    if (!(child instanceof Y.XmlElement)) return '';
    if (child.nodeName === 'hardBreak') return '\n';
    if (TAGS.has(child.nodeName)) return String(child.getAttribute('name') ?? child.getAttribute('date') ?? '');
    return `${wordsIn(child)}\n`;
  }).join('');
}
/** What's on a page as plain text, a line to a block, for someone to take with them. */
const pageText = (doc: Y.Doc): string => doc.getXmlFragment(DOC_FRAGMENT).toArray().flatMap((block) => {
  const words = block instanceof Y.XmlElement && !isGone(block) ? wordsIn(block).trim() : '';
  return words ? [words] : [];
}).join('\n');
/** Words Yjs is holding that it has nowhere to put, because what they were built on isn't here. */
function wordsWaiting(doc: Y.Doc): string {
  const pending = doc.store.pendingStructs;
  if (!pending) return '';
  return Y.decodeUpdateV2(pending.update).structs.flatMap((s) => (s instanceof Y.Item && s.content instanceof Y.ContentString ? [s.content.str] : [])).join('');
}

export class HttpDocSession implements DocSession {
  readonly doc = new Y.Doc();
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
  /** What was last said of what's been deleted, so it isn't said again. */
  private deletesSent: Uint8Array | null = null;
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
  private stuckTry: ReturnType<typeof setTimeout> | undefined;

  private caret: ReturnType<typeof setTimeout> | undefined;
  private announcing = false;
  private announceAgain = false;

  constructor(private readonly net: DocTransport, private readonly keep: KeptUpdates | undefined, private readonly quietMs: number) {
    this.ready = new Promise((resolve, reject) => { this.settle = { resolve, reject }; });
    // Nobody may be waiting on it: a refusal also shows in the status.
    this.ready.catch(() => undefined);
    this.doc.on('update', (update: Uint8Array, origin: unknown) => { if (origin !== HEARD) this.edited(update); });
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

  /** Everything in this document as it stands here, unsent or not, and whatever's here that has nowhere to go. A scratch document, so nothing it does touches this one. */
  localCopy = (): DocLocalCopy => {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this.doc));
    const waiting = wordsWaiting(scratch);
    scratch.store.pendingStructs = null;
    scratch.store.pendingDs = null;
    if (waiting) {
      const block = new Y.XmlElement('line');
      block.setAttribute('id', newBlockId());
      const page = scratch.getXmlFragment(DOC_FRAGMENT);
      page.insert(page.length, [block]);
      block.insert(0, [new Y.XmlText(waiting)]);
    }
    const copy = { text: pageText(scratch), state: Y.encodeStateAsUpdate(scratch) };
    scratch.destroy();
    return copy;
  };
  size = (): DocSize => ({ bytes: Y.encodeStateAsUpdate(this.doc).length, items: itemsOnPage(this.doc) });
  /** The one thing that forgets what Alcove doesn't have, for someone who chose to. */
  discardUnsaved = async (): Promise<void> => {
    this.cut();
    clearTimeout(this.stuckTry);
    const letGo = this.unsent.splice(0);
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
    this.unsent.push({ update, kept: this.keep ? this.keep.add(update, Date.now()).catch(() => null) : null, stuck: [...shape.clients].some((c) => this.stuckClients.has(c)), ...shape });
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
    const scratch = new Y.Doc();
    this.doc.clientID = scratch.clientID;
    scratch.destroy();
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
    else this.tryAgain();
    return false;
  }
  private tryAgain(): void {
    this.sendDown = true;
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
   * was deleted for undo there, so whatever's been taken out is sent as the small thing it now is.
   */
  private composed(): Uint8Array {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(this.doc));
    scratch.store.pendingStructs = null;
    scratch.store.pendingDs = null;
    const update = Y.encodeStateAsUpdate(scratch, this.knownToAlcove());
    scratch.destroy();
    return update;
  }
  /** Which of what's waiting is in this document: anything else Yjs has nowhere to put, and nothing worked out from here holds it. */
  private placed(waiting: Unsent[]): Unsent[] {
    const here = Y.decodeStateVector(Y.encodeStateVector(this.doc));
    return waiting.filter((u) => [...Y.parseUpdateMeta(u.update).to].every(([client, clock]) => (here.get(client) ?? 0) >= clock));
  }
  /** Everything deleted here of what Alcove has, as an update with nothing else in it. Null if that's nothing, or nothing new. */
  private deletesKnown(): Uint8Array | null {
    const known = Y.decodeStateVector(this.knownToAlcove());
    const clients = [...Y.createDeleteSetFromStructStore(this.doc.store).clients].flatMap(([client, deleted]) => {
      const reach = known.get(client) ?? 0;
      const ranges = deleted.flatMap(({ clock, len }) => (clock < reach ? [{ clock, len: Math.min(len, reach - clock) }] : []));
      return ranges.length ? [{ client, ranges }] : [];
    });
    if (!clients.length) return null;
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, 0);
    encoding.writeVarUint(e, clients.length);
    for (const { client, ranges } of clients) {
      encoding.writeVarUint(e, client);
      encoding.writeVarUint(e, ranges.length);
      for (const { clock, len } of ranges) { encoding.writeVarUint(e, clock); encoding.writeVarUint(e, len); }
    }
    const update = encoding.toUint8Array(e);
    const sent = this.deletesSent;
    return sent && sent.length === update.length && sent.every((b, i) => b === update[i]) ? null : update;
  }
  /** What's refused is too much, so what's been deleted goes without it: that's how there comes to be room, and it can't go any other way while it's behind what's stuck. */
  private async sendDeletes(): Promise<void> {
    const deletes = this.deletesKnown();
    if (!deletes) return;
    try {
      await this.net.update(deletes);
      this.deletesSent = deletes;
    } catch {
      /* It's said again next time. */
    }
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
      await this.sendDeletes();
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
      await this.sendDeletes();
      return this.laterStuck();
    }
    try {
      // Nothing new, and nothing gone: what was stuck isn't anywhere in this document any more.
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
          this.unsent.push({ update: k.update, kept: Promise.resolve(k.key), stuck: false, ...shapeOf(k.update) });
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
