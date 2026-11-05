/*
 * A document being worked on (docs: Data and storage › Documents): a Y.Doc kept in step with everyone else's through the
 * API, in a browser or in Node. What changes here goes up in batches, one at a time, until the API says it has it; what
 * anyone else does comes down the document's stream, which picks up from the last `seq` it heard however it ended. Yjs
 * updates can arrive twice and in any order, so a retry never does harm and there's nothing to reconcile.
 *
 * Nothing typed is let go of until the API has it. With a `keep` store, that survives a reload too.
 *
 * A refused update can't hold up what's behind it. A client's clocks have to reach the API in order, so anything written as
 * the same client is stuck behind it: this document moves to a new client, and what's written from then on goes as usual,
 * unless it builds on what's stuck. What's stuck is worked out afresh from time to time. Yjs lets go of what's been deleted, so
 * once a paste is undone or cut down, what's left of it is small.
 *
 * This module holds Yjs, and loads with the first document someone opens.
 */
import {
  AlcoveApiError, MAX_DOC_UPDATE_BYTES, errorCode, fromBase64Url, toBase64Url, type DocClosed, type DocLiveEvent, type DocRefusal, type DocSession, type DocStatus, type KeptUpdates
} from '@alcove/api';
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
/** How many updates go in one request: each can be a client of its own, and the API takes so many at once. */
const REQUEST_UPDATES = 64;
/** How soon after something changes what's stuck is tried again, and how often if nothing does: room may have been made by someone else. */
const STUCK_SOON_MS = 1_000;
const STUCK_WAIT_MS = 30_000;

/** Whatever Yjs applies with this came from Alcove or from `keep`, and isn't new here. */
const HEARD = Symbol('heard');

export interface DocTransport {
  open(after: number, signal: AbortSignal): AsyncIterable<DocLiveEvent>;
  /** Sends one update. Resolves once the API has it safe. */
  update(update: Uint8Array): Promise<unknown>;
  awareness(update: string, keepalive: boolean): Promise<unknown>;
}

/** An edit Alcove doesn't have yet, and its place in `keep`, if it has one. `stuck`: it's waiting on something other than the connection. */
interface Unsent { update: Uint8Array; kept: Promise<number | null> | null; stuck: boolean }
type Ending = { over: DocClosed } | 'ended' | 'failed';

export class HttpDocSession implements DocSession {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  readonly ready: Promise<void>;
  private settle: { resolve: () => void; reject: (e: unknown) => void } | null = null;
  private view: DocStatus = { status: 'saved', refused: null, role: null, trashed: false, closed: null };
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
  /** Alcove will never take what was stuck here. */
  private rejected = false;
  /** What's stuck is too much, for one request or for the document. Otherwise it may only need working out afresh. */
  private tooMuch = false;
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

  private get refused(): DocRefusal | null {
    return this.shut ?? (this.rejected ? 'rejected' : this.tooMuch && this.unsent.some((u) => u.stuck) ? 'too-large' : null);
  }
  private publish(): void {
    const waiting = this.fresh.length > 0 || this.unsent.length > 0;
    const { refused } = this;
    const status: DocStatus['status'] = refused ? 'failed' : this.streamDown || this.sendDown ? 'offline' : waiting ? 'saving' : 'saved';
    const v = this.view;
    if (v.status === status && v.refused === refused) return;
    this.view = { ...v, status, refused };
    this.listeners.forEach((l) => l());
  }
  private set(p: Partial<DocStatus>): void {
    this.view = { ...this.view, ...p };
    this.listeners.forEach((l) => l());
  }

  /* ---------- up ---------- */

  private edited(update: Uint8Array): void {
    this.fresh.push(update);
    this.publish();
    if (this.unsent.some((u) => u.stuck)) this.tryStuck(STUCK_SOON_MS);
    if (this.batch !== undefined || this.stopped) return;
    this.batch = setTimeout(() => { this.batch = undefined; this.cut(); void this.send(); }, BATCH_MS);
    unref(this.batch);
  }
  private add(update: Uint8Array, stuck: boolean): Unsent {
    return { update, kept: this.keep ? this.keep.add(update, Date.now()).catch(() => null) : null, stuck };
  }
  /** Ends a batch: it's kept here until Alcove has it, whatever happens to this tab. */
  private cut(): void {
    clearTimeout(this.batch);
    this.batch = undefined;
    if (!this.fresh.length) return;
    const update = this.fresh.length === 1 && this.fresh[0] ? this.fresh[0] : Y.mergeUpdates(this.fresh);
    this.fresh = [];
    this.unsent.push(this.add(update, false));
  }
  /** As much as fits in one request, the oldest first, and always at least one. */
  private nextBatch(): Unsent[] {
    let bytes = 0;
    const batch: Unsent[] = [];
    for (const u of this.unsent) {
      if (u.stuck) continue;
      if (batch.length && (bytes + u.update.length > REQUEST_BYTES || batch.length >= REQUEST_UPDATES)) break;
      batch.push(u);
      bytes += u.update.length;
    }
    return batch;
  }
  /**
   * What's in this batch can't go, nor can anything else its clients wrote, as their clocks have to arrive in order. Whatever
   * comes next is written as someone new, so it isn't behind any of it.
   */
  private stick(batch: Unsent[]): void {
    this.cut();
    const clients = new Set(batch.flatMap((u) => [...Y.parseUpdateMeta(u.update).to.keys()]));
    for (const u of this.unsent) if (batch.includes(u) || [...Y.parseUpdateMeta(u.update).to.keys()].some((c) => clients.has(c))) u.stuck = true;
    if (clients.has(this.doc.clientID)) this.becomeNew();
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
    if (this.sending || this.barred || this.shut || this.rejected) return;
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
    if (this.stopped || this.rejected) return;
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
  /** Takes the place of everything waiting, if it's something Alcove can take. Tried again until it is, or until Alcove says it never will be. */
  private async sendStuck(): Promise<void> {
    if (this.stopped || this.barred || this.shut || this.rejected) return;
    if (this.sending || !this.unsent.some((u) => u.stuck)) { if (this.unsent.some((u) => u.stuck)) this.tryStuck(STUCK_SOON_MS); return; }
    this.sending = true;
    let again: number | null = STUCK_WAIT_MS;
    try {
      this.cut();
      const update = this.composed();
      const waiting = [...this.unsent];
      if (update.length > MAX_DOC_UPDATE_BYTES) { this.tooMuch = true; return; }
      try {
        // Nothing new, and nothing gone: what was stuck isn't anywhere in this document any more.
        if (Y.parseUpdateMeta(update).to.size || Y.decodeUpdate(update).ds.clients.size) await this.net.update(update);
        this.delivered(waiting);
        this.tooMuch = false;
        again = null;
      } catch (e) {
        const code = errorCode(e);
        if (code === 'too-large') this.tooMuch = true;
        else if (code === 'invalid') {
          // There's nothing more this browser can do with it. What's on screen stays, for someone to copy; a reload starts from what Alcove has.
          this.rejected = true;
          again = null;
          void this.forget(this.unsent.splice(0));
        } else if (code === 'forbidden') this.shut = 'read-only';
        else if (code === 'conflict') this.shut = 'trashed';
        else if (code === 'not-found' || code === 'unauthenticated') this.barred = true;
      }
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
          this.unsent.push({ update: k.update, kept: Promise.resolve(k.key), stuck: false });
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

  /** It ended for good: nothing more goes up or comes down. What's unsent stays kept, unless there's nothing left for it to go to. */
  private over(why: DocClosed): void {
    this.stopped = true;
    this.barred = true;
    clearTimeout(this.batch);
    clearTimeout(this.retry);
    clearTimeout(this.caret);
    clearTimeout(this.stuckTry);
    this.awareness.destroy();
    this.settle?.reject(this.settleFailure ?? new AlcoveApiError('unavailable', 'This document can’t be opened right now.'));
    if (why === 'deleted') { this.cut(); void this.forget(this.unsent.splice(0)); }
    this.set({ closed: why });
  }
}
