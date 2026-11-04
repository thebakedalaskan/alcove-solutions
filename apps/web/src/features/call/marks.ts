/*
 * Pointing at shared screens (docs: Calls and recordings › Pointing at shared screens): the pointers and marks people show
 * each other on what's shared, kept in this browser's memory and nowhere else. They travel as data packets through the
 * call's room (CallRoom.send and receive, on CALL_MARKS_TOPIC), each encrypted with its sender's own media key from the
 * call's MLS group, so LiveKit forwards ciphertext and the API never sees them. Nothing lasts: a mark fades after a few
 * seconds, a pointer goes when its sender stops or goes idle, and everything goes when its share stops, its sender leaves
 * your part of the call, your part of the call changes, or the organizer turns pointing off.
 *
 * Who may point where is the call's (CallState.pointing, each presenter's `othersPoint`) and it's checked on both sides:
 * this browser sends only what it may, and takes only what its sender may, so marks from someone the presenter doesn't let
 * point never show here, whatever their browser sends. Each sender counts its messages inside the encryption, so a packet
 * LiveKit replays, or one overtaken by a newer one, changes nothing. Places are fractions of the shared picture (0 to 1):
 * every screen draws them on the same spot of the picture, whatever its size or zoom.
 */
import {
  CALL_MARKS_TOPIC, SHARE_MARKS_EACH, SHARE_MARK_BYTES, SHARE_MARK_FADE_MS, SHARE_MARK_MS, SHARE_MARK_POINTS, SHARE_POINTER_GONE_MS, SHARE_POINTER_IDLE_MS,
  SHARE_POINTER_KEEP_MS, SHARE_POINT_EVERY_MS, ShareMarkMessageSchema, type LiveStore, type ShareMarkMessage, type SharePlace
} from '@alcove/api';
import { log } from '~/lib/log';
import type { CallRoom } from './livekit';

const mlog = log.child({ component: 'call-marks' });

/** A spot on a shared picture: 0 to 1 across its width (x) and down its height (y). */
export interface SharePoint { x: number; y: number }
export interface Pointer { from: string; at: SharePoint }
/** A mark as drawn: a ring at one place or a line through several, whose it is, and whether it's fading out now. */
export interface Mark { key: string; from: string; mine: boolean; kind: 'ring' | 'line'; points: SharePoint[]; done: boolean; fading: boolean }
/** What's on one share now: everyone else's pointers, and every mark (yours too), oldest first. */
export interface ShareMarksView { pointers: Pointer[]; marks: Mark[] }
export const NO_MARKS: ShareMarksView = { pointers: [], marks: [] };
export interface MarksSnapshot { shares: ReadonlyMap<string, ShareMarksView> }

/** What the call says about pointing, and what this browser shows: the store follows it (`use`). */
export interface MarksContext {
  /** Pointing is on for the call (the organizer's switch), and the room is connected. */
  on: boolean;
  /** The shares this browser shows now, by their picture's track sid: whose each is, and whether they let others point at it. */
  shares: ReadonlyMap<string, { owner: string; others: boolean }>;
  /** Who's in this browser's part of the call now (by participant ID): anyone else's pointers and marks go. */
  people: ReadonlySet<string>;
  /** This browser's part of the call: the main room or a breakout room. Moving to another clears everything. */
  part: string;
}

/** How often a line being drawn goes out, at most. */
const LINE_EVERY_MS = 80;
/** A line's next place is kept once it's this far from the last (in parts of the picture), so a still hand adds nothing. */
const LINE_STEP = 0.004;
/** How far behind a sender's newest message one can be and still count: further back is a replay, or long dead. */
const REPLAY_WINDOW = 512;
/** Marks each sender has had, kept after they go so a late or replayed copy can't bring one back. */
const GONE_KEPT = 1024;
/** How many messages a sender may send in a burst, and how many a second after that: a pointer and a line together are about 35. */
const BURST = 100;
const PER_SECOND = 50;
/** How often lifetimes are checked while anything is showing. */
const TICK_MS = 200;

interface MarkState { share: string; id: string; kind: 'ring' | 'line'; points: SharePoint[]; done: boolean; seq: number; order: number; updated: number; madeAt: number }
interface Sender {
  pointer: { share: string; at: SharePoint; seen: number } | null;
  pointerSeq: number;
  maxSeq: number;
  marks: Map<string, MarkState>;
  gone: Map<string, number>;
  tokens: number;
  filled: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const now = () => performance.now();
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Four decimal places: a tenth of a pixel across a 4K screen, and short messages. */
const r4 = (v: number) => Math.round(clamp01(v) * 10_000) / 10_000;
const place = (p: SharePoint): SharePlace => [r4(p.x), r4(p.y)];
const point = (p: SharePlace): SharePoint => ({ x: p[0], y: p[1] });
const newId = () => {
  let s = '';
  for (const b of crypto.getRandomValues(new Uint8Array(9))) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export class ShareMarks implements LiveStore<MarksSnapshot> {
  private ctx: MarksContext = { on: false, shares: new Map(), people: new Set(), part: '' };
  private senders = new Map<string, Sender>();
  private snapshot: MarksSnapshot = { shares: new Map() };
  private listeners = new Set<() => void>();
  private dirty = new Set<string>();
  private order = 0;
  private seq = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private stopReceiving: () => void;
  /* What this browser points at: the latest place, when it last went out and last moved, and the timers that send it. */
  private aim: { share: string; at: SharePoint; sentAt: number; movedAt: number } | null = null;
  private aimTimer: ReturnType<typeof setTimeout> | null = null;
  private keepTimer: ReturnType<typeof setInterval> | null = null;
  /* A line this browser is drawing: when it last went out, and the timer for its next send. */
  private lineSent = new Map<string, number>();
  private lineTimer = new Map<string, ReturnType<typeof setTimeout>>();
  private drops: Record<string, number> = {};

  constructor(private readonly room: Pick<CallRoom, 'send' | 'receive'>, private readonly self: string) {
    this.stopReceiving = room.receive(CALL_MARKS_TOPIC, (payload, from) => this.take(payload, from));
  }

  getSnapshot = (): MarksSnapshot => this.snapshot;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };

  /** Whether `who` may point at and mark `share` now: pointing is on, the share is shown here, and it's theirs or its presenter lets others. */
  may(share: string, who: string = this.self): boolean {
    const s = this.ctx.shares.get(share);
    return this.ctx.on && !!s && (s.owner === who || s.others) && (who === this.self || this.ctx.people.has(who));
  }

  /** Follows the call: anything that no longer may show (its share stopped, its sender left or may not point there, pointing off, another part of the call) goes. */
  use(ctx: MarksContext): void {
    const moved = ctx.part !== this.ctx.part;
    this.ctx = ctx;
    if (moved || !ctx.on) this.dropAll();
    if (this.aim && !this.may(this.aim.share)) this.stopAiming(true);
    for (const [from, s] of this.senders) {
      if (s.pointer && !this.may(s.pointer.share, from)) { this.dirty.add(s.pointer.share); s.pointer = null; }
      for (const [id, m] of s.marks) if (!this.may(m.share, from)) this.forget(s, id, m);
      if (from !== this.self && !ctx.people.has(from) && !s.marks.size && !s.pointer) this.senders.delete(from);
    }
    this.publish();
  }

  /* ---------- this browser's own pointer and marks ---------- */

  /**
   * Points at a spot on a share, or stops pointing (null). The newest spot goes out at most every SHARE_POINT_EVERY_MS, and
   * again every SHARE_POINTER_KEEP_MS while it stays still, until it's been still for SHARE_POINTER_IDLE_MS.
   */
  point(share: string, at: SharePoint | null): void {
    if (!at || !this.may(share)) { if (this.aim?.share === share) this.stopAiming(true); return; }
    const t = now();
    const was = this.aim;
    this.aim = { share, at: { x: clamp01(at.x), y: clamp01(at.y) }, sentAt: was?.share === share ? was.sentAt : 0, movedAt: t };
    if (!this.keepTimer) this.keepTimer = setInterval(() => this.keepAiming(), SHARE_POINTER_KEEP_MS);
    if (this.aimTimer) return;
    const wait = Math.max(0, this.aim.sentAt + SHARE_POINT_EVERY_MS - t);
    if (wait === 0) this.sendAim();
    else this.aimTimer = setTimeout(() => { this.aimTimer = null; this.sendAim(); }, wait);
  }
  private sendAim() {
    const a = this.aim;
    if (!a || !this.may(a.share)) return;
    a.sentAt = now();
    this.send({ t: 'point', share: a.share, seq: ++this.seq, at: place(a.at) }, false);
  }
  /** Still pointing, without moving: said again so the pointer stays, until it's idle. */
  private keepAiming() {
    const a = this.aim;
    if (!a) return;
    if (now() - a.movedAt >= SHARE_POINTER_IDLE_MS) { this.stopAiming(true); return; }
    if (now() - a.sentAt >= SHARE_POINTER_KEEP_MS - 50) this.sendAim();
  }
  private stopAiming(say: boolean) {
    const a = this.aim;
    this.aim = null;
    if (this.aimTimer) clearTimeout(this.aimTimer);
    if (this.keepTimer) clearInterval(this.keepTimer);
    this.aimTimer = null;
    this.keepTimer = null;
    if (a && say) this.send({ t: 'away', share: a.share, seq: ++this.seq }, true);
  }

  /** A ring at a spot on a share, which everyone sees for a few seconds. */
  ring(share: string, at: SharePoint): void {
    if (!this.may(share)) return;
    const m = this.makeMine(share, 'ring', [{ x: clamp01(at.x), y: clamp01(at.y) }], true);
    this.sendMark(m);
  }
  /** Starts a line at a spot on a share; `draw` adds to it and `end` finishes it. Null if this browser may not mark the share. */
  startLine(share: string, at: SharePoint): string | null {
    if (!this.may(share)) return null;
    const m = this.makeMine(share, 'line', [{ x: clamp01(at.x), y: clamp01(at.y) }], false);
    this.sendMark(m);
    this.lineSent.set(m.id, now());
    return m.id;
  }
  draw(id: string, at: SharePoint): void {
    const m = this.mine().marks.get(id);
    if (!m || m.done || !this.may(m.share)) return;
    const p = { x: clamp01(at.x), y: clamp01(at.y) };
    const last = m.points.at(-1);
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < LINE_STEP) return;
    // A long line keeps its shape with half as many places, so it never outgrows a message.
    const points = m.points.length >= SHARE_MARK_POINTS ? m.points.filter((_, i) => i % 2 === 0) : m.points;
    this.putMine({ ...m, points: [...points, p], seq: m.seq, updated: now() });
    if (this.lineTimer.has(id)) return;
    const wait = Math.max(0, (this.lineSent.get(id) ?? 0) + LINE_EVERY_MS - now());
    this.lineTimer.set(id, setTimeout(() => {
      this.lineTimer.delete(id);
      const cur = this.mine().marks.get(id);
      if (cur && !cur.done) { this.lineSent.set(id, now()); this.sendMark(cur); }
    }, wait));
  }
  end(id: string): void {
    const m = this.mine().marks.get(id);
    const timer = this.lineTimer.get(id);
    if (timer) clearTimeout(timer);
    this.lineTimer.delete(id);
    this.lineSent.delete(id);
    if (!m || m.done) return;
    const done = this.putMine({ ...m, done: true, madeAt: now(), updated: now() });
    this.sendMark(done);
  }
  /** Takes back your latest mark on a share. */
  undo(share: string): void {
    const latest = [...this.mine().marks.values()].filter((m) => m.share === share).sort((a, b) => b.order - a.order)[0];
    if (latest) this.takeBack(share, [latest.id]);
  }
  /** The presenter: clears every mark on their own share, whoever made it. */
  clear(share: string): void {
    if (this.ctx.shares.get(share)?.owner !== this.self) return;
    this.clearShare(share);
    this.send({ t: 'clear', share, seq: ++this.seq }, true);
    this.publish();
  }

  private mine(): Sender { return this.sender(this.self); }
  private makeMine(share: string, kind: 'ring' | 'line', points: SharePoint[], done: boolean): MarkState {
    const me = this.mine();
    const of = [...me.marks.values()].filter((m) => m.share === share).sort((a, b) => a.order - b.order);
    // A full hand gives up its oldest mark, for everyone.
    const oldest = of.length >= SHARE_MARKS_EACH ? of[0] : undefined;
    if (oldest) this.takeBack(share, [oldest.id]);
    const t = now();
    return this.putMine({ share, id: newId(), kind, points, done, seq: 0, order: ++this.order, updated: t, madeAt: t });
  }
  private putMine(m: MarkState): MarkState {
    this.mine().marks.set(m.id, m);
    this.dirty.add(m.share);
    this.publish();
    return m;
  }
  private sendMark(m: MarkState) {
    const seq = ++this.seq;
    this.mine().marks.set(m.id, { ...m, seq });
    this.send({ t: 'mark', share: m.share, seq, id: m.id, kind: m.kind, points: m.points.map(place), done: m.done }, true);
  }
  private takeBack(share: string, ids: string[]) {
    if (!ids.length) return;
    const me = this.mine();
    for (const id of ids) { const m = me.marks.get(id); if (m) this.forget(me, id, m); const t = this.lineTimer.get(id); if (t) clearTimeout(t); this.lineTimer.delete(id); this.lineSent.delete(id); }
    this.send({ t: 'unmark', share, seq: ++this.seq, ids: ids.slice(0, SHARE_MARKS_EACH) }, true);
    this.publish();
  }
  private send(m: ShareMarkMessage, reliable: boolean) {
    this.room.send(CALL_MARKS_TOPIC, enc.encode(JSON.stringify(m)), { reliable });
  }

  /* ---------- what others send ---------- */

  private take(payload: Uint8Array, from: string) {
    if (payload.byteLength > SHARE_MARK_BYTES) { this.drop('size'); return; }
    const s = this.sender(from);
    // Each sender gets a bucket of messages that fills again over time: a flood from one browser is dropped, not drawn.
    const t = now();
    s.tokens = Math.min(BURST, s.tokens + ((t - s.filled) / 1000) * PER_SECOND);
    s.filled = t;
    if (s.tokens < 1) { this.drop('rate'); return; }
    s.tokens -= 1;
    let raw: unknown = null;
    try { raw = JSON.parse(dec.decode(payload)); } catch { this.drop('unreadable'); return; }
    const m = ShareMarkMessageSchema.safeParse(raw);
    if (!m.success) { this.drop('unreadable'); return; }
    this.apply(from, s, m.data);
  }

  private apply(from: string, s: Sender, m: ShareMarkMessage) {
    if (m.seq + REPLAY_WINDOW < s.maxSeq) { this.drop('old'); return; }
    s.maxSeq = Math.max(s.maxSeq, m.seq);
    if (m.t === 'away') {
      if (m.seq <= s.pointerSeq) return;
      s.pointerSeq = m.seq;
      if (s.pointer) { this.dirty.add(s.pointer.share); s.pointer = null; }
    } else if (m.t === 'clear') {
      // Only the presenter clears their own share.
      if (this.ctx.shares.get(m.share)?.owner !== from) { this.drop('not allowed'); return; }
      this.clearShare(m.share);
    } else if (m.t === 'unmark') {
      for (const id of m.ids) {
        const had = s.marks.get(id);
        if (had && had.share === m.share) this.forget(s, id, had);
        else this.remember(s, id, m.seq);
      }
    } else {
      // A spot on a share this browser doesn't show (it stopped, or it's in another part of the call), or one its sender
      // may not point at, lands nowhere.
      if (!this.may(m.share, from)) { this.drop('not allowed'); return; }
      const t = now();
      if (m.t === 'point') {
        if (m.seq <= s.pointerSeq) return;
        s.pointerSeq = m.seq;
        if (s.pointer && s.pointer.share !== m.share) this.dirty.add(s.pointer.share);
        s.pointer = { share: m.share, at: point(m.at), seen: t };
      } else {
        const gone = s.gone.get(m.id);
        if (gone !== undefined) return;
        const had = s.marks.get(m.id);
        if (had && (had.seq >= m.seq || had.share !== m.share || had.kind !== m.kind)) return;
        if (!had) {
          // A full hand gives up its oldest mark here too.
          const of = [...s.marks.values()].filter((x) => x.share === m.share).sort((a, b) => a.order - b.order);
          const oldest = of.length >= SHARE_MARKS_EACH ? of[0] : undefined;
          if (oldest) this.forget(s, oldest.id, oldest);
        }
        s.marks.set(m.id, {
          share: m.share, id: m.id, kind: m.kind, points: m.points.map(point), done: m.done, seq: m.seq, order: had?.order ?? ++this.order, updated: t,
          madeAt: had?.done ? had.madeAt : t
        });
      }
    }
    this.dirty.add(m.share);
    this.publish();
  }

  private sender(from: string): Sender {
    let s = this.senders.get(from);
    if (!s) {
      s = { pointer: null, pointerSeq: -1, maxSeq: 0, marks: new Map(), gone: new Map(), tokens: BURST, filled: now() };
      this.senders.set(from, s);
    }
    return s;
  }
  private forget(s: Sender, id: string, m: MarkState) {
    s.marks.delete(id);
    this.remember(s, id, m.seq);
    this.dirty.add(m.share);
  }
  private remember(s: Sender, id: string, seq: number) {
    s.gone.set(id, seq);
    if (s.gone.size > GONE_KEPT) { const first = s.gone.keys().next(); if (!first.done) s.gone.delete(first.value); }
  }
  private clearShare(share: string) {
    for (const s of this.senders.values()) for (const [id, m] of s.marks) if (m.share === share) this.forget(s, id, m);
  }
  private dropAll() {
    this.stopAiming(false);
    for (const t of this.lineTimer.values()) clearTimeout(t);
    this.lineTimer.clear();
    this.lineSent.clear();
    for (const s of this.senders.values()) {
      if (s.pointer) this.dirty.add(s.pointer.share);
      s.pointer = null;
      for (const [id, m] of s.marks) this.forget(s, id, m);
    }
    for (const share of this.snapshot.shares.keys()) this.dirty.add(share);
  }
  private drop(why: string) {
    const n = (this.drops[why] ?? 0) + 1;
    this.drops[why] = n;
    if (n === 1 || n % 100 === 0) mlog.debug('a pointer or mark wasn’t taken', { why, times: n });
  }

  /* ---------- lifetimes, and what screens read ---------- */

  private tick() {
    const t = now();
    for (const s of this.senders.values()) {
      if (s.pointer && t - s.pointer.seen > SHARE_POINTER_GONE_MS) { this.dirty.add(s.pointer.share); s.pointer = null; }
      for (const [id, m] of s.marks) {
        const age = t - (m.done ? m.madeAt : m.updated);
        if (age > SHARE_MARK_MS) this.forget(s, id, m);
        else if (m.done && age > SHARE_MARK_MS - SHARE_MARK_FADE_MS) this.dirty.add(m.share);
      }
    }
    this.publish();
  }

  /**
   * A new snapshot when a share's pointers or marks changed. Every other share keeps its view, so nothing drawing it
   * draws again; and while nothing changes, nobody is told.
   */
  private publish() {
    if (!this.dirty.size) return;
    const t = now();
    let shares: Map<string, ShareMarksView> | null = null;
    for (const share of this.dirty) {
      const pointers: Pointer[] = [];
      const ordered: { order: number; mark: Mark }[] = [];
      for (const [from, s] of this.senders) {
        if (s.pointer?.share === share && from !== this.self) pointers.push({ from, at: s.pointer.at });
        for (const m of s.marks.values()) {
          if (m.share !== share) continue;
          const fading = m.done && t - m.madeAt > SHARE_MARK_MS - SHARE_MARK_FADE_MS;
          ordered.push({ order: m.order, mark: { key: `${from}:${m.id}`, from, mine: from === this.self, kind: m.kind, points: m.points, done: m.done, fading } });
        }
      }
      const view: ShareMarksView = { pointers, marks: ordered.sort((a, b) => a.order - b.order).map((x) => x.mark) };
      const was = this.snapshot.shares.get(share);
      const empty = !pointers.length && !ordered.length;
      if (empty ? !was : was !== undefined && sameView(was, view)) continue;
      shares ??= new Map(this.snapshot.shares);
      if (empty) shares.delete(share);
      else shares.set(share, view);
    }
    this.dirty.clear();
    if (shares) {
      this.snapshot = { shares };
      this.listeners.forEach((l) => l());
    }
    const live = this.snapshot.shares.size > 0;
    if (live && !this.ticker) this.ticker = setInterval(() => this.tick(), TICK_MS);
    if (!live && this.ticker) { clearInterval(this.ticker); this.ticker = null; }
  }

  /** Stops: nothing more is sent or taken, and a pointer still showing elsewhere is said to be gone. */
  dispose(): void {
    this.stopAiming(true);
    this.stopReceiving();
    for (const t of this.lineTimer.values()) clearTimeout(t);
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.listeners.clear();
  }
}

function sameView(a: ShareMarksView, b: ShareMarksView): boolean {
  if (a.pointers.length !== b.pointers.length || a.marks.length !== b.marks.length) return false;
  for (let i = 0; i < a.pointers.length; i++) {
    const p = a.pointers[i];
    const q = b.pointers[i];
    if (!p || !q || p.from !== q.from || p.at.x !== q.at.x || p.at.y !== q.at.y) return false;
  }
  for (let i = 0; i < a.marks.length; i++) {
    const m = a.marks[i];
    const n = b.marks[i];
    if (!m || !n || m.key !== n.key || m.fading !== n.fading || m.done !== n.done || m.points !== n.points) return false;
  }
  return true;
}
