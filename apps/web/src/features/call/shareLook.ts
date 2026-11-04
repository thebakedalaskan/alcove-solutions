/*
 * How you look at each share someone else shows, in this browser only: how you've framed it (shareFrame.ts), whether
 * you see it live or a picture held still, and the earlier pictures kept to step back through. `ShareLooks` holds one
 * `ShareLook` per share for the call screen, and the share open in its own window (popOut.ts).
 *
 * Earlier pictures are a bounded buffer in this page's memory: at most HISTORY.pictures for each share, and
 * HISTORY.bytes, the oldest going first. Each is a moment the picture changed, taken at most once a second from the
 * video this browser already decodes to show the share, and only while you see that share big or in its own window. They're kept as
 * compressed bytes in memory, never as files or in any storage, shown only here, and never sent or logged. They exist only
 * from when this browser could decrypt the share, after you were let in and while you're in the same part of the call
 * as its sharer, so nothing predates you. They go the moment the share stops (a stop, its sharer leaving or being
 * removed, the sharer leaving the call's group), the moment your part of the call changes (breakout rooms), when you
 * show the share as a tile, and when you leave. While the organizer has paused notes nothing new is kept and what was kept
 * goes: pausing stops every kind of capture. Zoom, pan and freezing work either way, as they do where a browser can't
 * keep pictures or the device has little memory.
 */
import type { LiveStore } from '@alcove/api';
import { log } from '~/lib/log';
import { openPop, popKind, type PopKind } from './popOut';
import { WHOLE, isZoomed, panBy, settle, stepZoom, zoomTo, type Framing, type Size } from './shareFrame';

const slog = log.child({ component: 'share-look' });

/** Earlier pictures kept for each share: at most this many and this many bytes. One is looked at, at most, every `everyMs`. */
export const HISTORY = { pictures: 30, bytes: 16 * 1024 * 1024, everyMs: 1000 } as const;
/** Bigger pictures are kept at 4K. */
const MAX_SIDE = 3840;
/** The tiny copy a picture is compared by: enough to see a slide change or a scroll, not a cursor moving. */
const SIG = { w: 48, h: 27 } as const;

/** Why earlier pictures aren't being kept: the organizer paused notes, the device is low on memory, or this browser can't. */
export type HistoryOff = 'paused' | 'memory' | 'unsupported';

export interface HeldPicture {
  /** Its number, counting up for this share. */
  n: number;
  /** When it was last on the share (Date.now()): "0:42 behind live" counts from here. */
  seen: number;
  w: number;
  h: number;
  /** Where it is among the earlier pictures (0 is the oldest), or null when it's held on its own. */
  index: number | null;
  /** Ready to draw. */
  ready: boolean;
}
export interface ShareLookState {
  framing: Framing;
  /** The picture held still (frozen, or an earlier one), or null while you watch live. */
  held: HeldPicture | null;
  /** How many earlier pictures are kept. */
  count: number;
  /** There's an earlier picture than the one you see. */
  canEarlier: boolean;
  /** Why earlier pictures aren't kept now, or null while they are. */
  off: HistoryOff | null;
  /** Your view of it and the live picture's size, as last measured. */
  view: Size;
  pic: Size;
}

/** A kept picture: `at` is when it was taken, and it was on the share until the next one's `at` (the newest: `lastSeen`). */
interface Kept { n: number; at: number; w: number; h: number; bytes: ArrayBuffer; type: string }
interface Hold { n: number; seen: number; w: number; h: number; bitmap: ImageBitmap | null }
interface Encoded { bytes: ArrayBuffer; type: string; w: number; h: number }

const ARROW_PAN: Record<string, [number, number]> = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const ready = (v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
const sameSize = (a: Size, b: Size) => a.w === b.w && a.h === b.h;

/* ---------- comparing and keeping pictures ---------- */

let sigCanvas: HTMLCanvasElement | null = null;
/** A picture's tiny greyscale copy. The browser shrinks it first (on the GPU where it can), so only 48 × 27 pixels are read back. */
async function signature(src: ImageBitmap): Promise<Uint8Array | null> {
  if (!sigCanvas) { sigCanvas = document.createElement('canvas'); sigCanvas.width = SIG.w; sigCanvas.height = SIG.h; }
  const ctx = sigCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const small = await createImageBitmap(src, { resizeWidth: SIG.w, resizeHeight: SIG.h, resizeQuality: 'low' });
  try { ctx.drawImage(small, 0, 0, SIG.w, SIG.h); } finally { small.close(); }
  const d = ctx.getImageData(0, 0, SIG.w, SIG.h).data;
  const out = new Uint8Array(SIG.w * SIG.h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round((d[i * 4] ?? 0) * 0.299 + (d[i * 4 + 1] ?? 0) * 0.587 + (d[i * 4 + 2] ?? 0) * 0.114);
  return out;
}
/** Whether two tiny copies show a real change: a new slide, a scroll, a window moved. */
function differs(a: Uint8Array, b: Uint8Array): boolean {
  let sum = 0;
  let big = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    sum += d;
    if (d > 24) big++;
  }
  return sum / a.length > 1.5 || big / a.length > 0.006;
}

/** What this browser writes pictures as: WebP where it can, else JPEG. */
let encoding: 'image/webp' | 'image/jpeg' = 'image/webp';
/** A picture compressed into memory, at most 4K. The canvas is let go as soon as it's done. */
async function encode(src: CanvasImageSource, w: number, h: number): Promise<Encoded | null> {
  const s = Math.min(1, MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * s));
  const ch = Math.max(1, Math.round(h * s));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  try {
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, cw, ch);
    const type = encoding;
    const blob = await new Promise<Blob | null>((done) => c.toBlob(done, type, type === 'image/webp' ? 0.82 : 0.86));
    if (!blob) return null;
    if (type === 'image/webp' && blob.type !== 'image/webp') encoding = 'image/jpeg';
    return { bytes: await blob.arrayBuffer(), type: blob.type, w: cw, h: ch };
  } finally {
    c.width = 0;
    c.height = 0;
  }
}

/** The device can't keep pictures: too little memory (Chrome says how much), or no way to draw and compress them. */
function deviceOff(): HistoryOff | null {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function' || typeof HTMLCanvasElement.prototype.toBlob !== 'function') return 'unsupported';
  const memory: unknown = Reflect.get(navigator, 'deviceMemory');
  return typeof memory === 'number' && memory < 2 ? 'memory' : null;
}

/* ---------- one share ---------- */

export class ShareLook implements LiveStore<ShareLookState> {
  private listeners = new Set<() => void>();
  private framing: Framing = WHOLE;
  private size: { view: Size; pic: Size } = { view: { w: 0, h: 0 }, pic: { w: 0, h: 0 } };
  private kept: Kept[] = [];
  private bytes = 0;
  private n = 0;
  /** Counts every drop: work started before one (a picture being compressed or opened) is thrown away. */
  private gen = 0;
  private video: HTMLVideoElement | null = null;
  /** The tiny copy of the newest kept picture, and when it was last seen on the share unchanged. */
  private sig: Uint8Array | null = null;
  private lastSeen = 0;
  /** Pictures being taken now (a look, or a freeze): no new look starts meanwhile. */
  private busy = 0;
  private failures = 0;
  private hold: Hold | null = null;
  private gone = false;
  private state: ShareLookState;

  constructor(private off: HistoryOff | null) { this.state = this.build(); }

  getSnapshot = (): ShareLookState => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private build(): ShareLookState {
    const at = this.hold ? this.indexOf(this.hold.n) : -1;
    const h = this.hold;
    return {
      framing: this.framing,
      held: h ? { n: h.n, seen: h.seen, w: h.w, h: h.h, index: at >= 0 ? at : null, ready: h.bitmap !== null } : null,
      count: this.kept.length,
      canEarlier: h ? at > 0 || (at < 0 && this.kept.some((k) => k.n < h.n)) : this.kept.length > 1,
      off: this.off,
      view: this.size.view,
      pic: this.size.pic
    };
  }
  private emit() { this.state = this.build(); this.listeners.forEach((l) => l()); }
  private indexOf(n: number) { return this.kept.findIndex((k) => k.n === n); }
  /** When the kept picture at `i` was last on the share: until the next one was taken, or, for the newest, when last seen. */
  private untilOf(i: number): number { return this.kept[i + 1]?.at ?? this.lastSeen; }
  /** The picture the framing applies to: the one held still, or the live one. */
  private picNow(): Size { return this.hold ? { w: this.hold.w, h: this.hold.h } : this.size.pic; }

  /** The bitmap of the picture held still, once it's ready to draw. */
  heldBitmap(): ImageBitmap | null { return this.hold?.bitmap ?? null; }

  /** Your view's size and the live picture's, as the surface measures them. */
  measure(view: Size, pic: Size) {
    if (sameSize(view, this.size.view) && sameSize(pic, this.size.pic)) return;
    this.size = { view, pic };
    this.framing = settle(this.framing, view, this.picNow());
    this.emit();
  }

  /* ---------- framing ---------- */

  setFraming(f: Framing) {
    const next = settle(f, this.size.view, this.picNow());
    const was = this.framing;
    if (Math.abs(next.zoom - was.zoom) < 1e-4 && Math.abs(next.at.x - was.at.x) < 1e-5 && Math.abs(next.at.y - was.at.y) < 1e-5) return;
    this.framing = next;
    this.emit();
  }
  zoomStep(dir: 1 | -1) { this.setFraming(zoomTo(this.framing, stepZoom(this.framing.zoom, dir), this.size.view, this.picNow())); }
  whole() { this.setFraming(WHOLE); }

  /**
   * A key pressed on the focused share: + and − zoom, 0 shows the whole picture, arrows move around while zoomed in, F
   * freezes the picture or goes back to live, comma and full stop step through earlier pictures. True when it was one of these.
   */
  key(k: string): boolean {
    switch (k) {
      case '+': case '=': this.zoomStep(1); return true;
      case '-': case '_': case '−': this.zoomStep(-1); return true;
      case '0': this.whole(); return true;
      case 'f': case 'F': if (this.hold) this.live(); else void this.freeze(); return true;
      case ',': case '<': void this.earlier(); return true;
      case '.': case '>': this.later(); return true;
    }
    const by = ARROW_PAN[k];
    if (!by || !isZoomed(this.framing)) return false;
    const { view } = this.size;
    this.setFraming(panBy(this.framing, by[0] * view.w * 0.15, by[1] * view.h * 0.15, view, this.picNow()));
    return true;
  }

  /* ---------- live, frozen and earlier pictures ---------- */

  /**
   * Keeps earlier pictures from this element's video while it's on screen. Its own window's timers, so a share in its
   * own window keeps going while the call's tab is in the background.
   */
  watch(video: HTMLVideoElement): () => void {
    this.video = video;
    const win = video.ownerDocument.defaultView ?? window;
    const t = win.setInterval(() => { void this.tick(); }, HISTORY.everyMs);
    return () => {
      try { win.clearInterval(t); } catch { /* its window has closed, and its timers with it */ }
      if (this.video === video) this.video = null;
    };
  }

  /** Looks at the picture now, and keeps it if it changed since the last one kept. */
  private async tick() {
    const v = this.video;
    if (!v || this.off || this.busy > 0 || this.gone || !ready(v) || v.ownerDocument.visibilityState === 'hidden') return;
    this.busy++;
    const gen = this.gen;
    const at = Date.now();
    let frame: ImageBitmap | null = null;
    try {
      // One frame, compared and kept as it is.
      frame = await createImageBitmap(v);
      const sig = await signature(frame);
      if (!sig || gen !== this.gen || this.off || this.gone) return;
      if (this.kept.length && this.sig && !differs(sig, this.sig)) { this.lastSeen = at; return; }
      const pic = await encode(frame, frame.width, frame.height);
      if (!pic || gen !== this.gen || this.off || this.gone) return;
      this.push(pic, sig, at, ++this.n);
      this.failures = 0;
    } catch (e) {
      this.failures++;
      slog.debug('a picture of a share couldn’t be kept', { err: e, failures: this.failures });
      // A browser that can't draw or compress the share's picture keeps none, and says so.
      if (this.failures >= 3) this.setOff('unsupported');
    } finally {
      frame?.close();
      this.busy--;
    }
  }

  /** Keeps a picture, in the order pictures were taken: a look already under way when you froze can finish after the freeze. */
  private push(p: Encoded, sig: Uint8Array, at: number, n: number) {
    let i = this.kept.length;
    while (i > 0 && (this.kept[i - 1]?.at ?? 0) > at) i--;
    this.kept.splice(i, 0, { n, at, w: p.w, h: p.h, bytes: p.bytes, type: p.type });
    this.bytes += p.bytes.byteLength;
    if (i === this.kept.length - 1) { this.sig = sig; this.lastSeen = Math.max(this.lastSeen, at); }
    // The oldest go first, never the one you're looking at.
    while (this.kept.length > 1 && (this.kept.length > HISTORY.pictures || this.bytes > HISTORY.bytes)) {
      const i = this.kept.findIndex((k) => k.n !== this.hold?.n);
      const [gone] = i < 0 ? [] : this.kept.splice(i, 1);
      if (!gone) break;
      this.bytes -= gone.bytes.byteLength;
    }
    this.emit();
  }

  /** Holds the picture on screen now still. The share goes on, and earlier pictures keep being kept. */
  async freeze(): Promise<void> {
    const v = this.video;
    if (this.hold || !v || !ready(v)) return;
    const gen = this.gen;
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(v);
    } catch (e) {
      slog.warn('couldn’t hold a share’s picture still', { err: e });
      return;
    }
    if (gen !== this.gen || this.hold || this.gone) { bitmap.close(); return; }
    const now = Date.now();
    const sig = this.off ? null : await signature(bitmap).catch(() => null);
    if (gen !== this.gen || this.hold || this.gone) { bitmap.close(); return; }
    const last = this.kept.at(-1);
    // Nothing changed since the newest kept picture: that's the one held. Otherwise this one is kept too.
    if (sig && last && this.sig && !differs(sig, this.sig)) {
      this.lastSeen = now;
      this.hold = { n: last.n, seen: now, w: last.w, h: last.h, bitmap };
      this.emit();
      return;
    }
    const n = ++this.n;
    this.hold = { n, seen: now, w: bitmap.width, h: bitmap.height, bitmap };
    this.emit();
    if (!sig || this.off) return;
    this.busy++;
    try {
      const pic = await encode(bitmap, bitmap.width, bitmap.height);
      if (pic && gen === this.gen && !this.off && !this.gone) this.push(pic, sig, now, n);
    } catch (e) {
      slog.debug('a frozen picture couldn’t be kept', { err: e });
    } finally {
      this.busy--;
    }
  }

  /** The picture before the one you see. From live, freezes first. */
  async earlier(): Promise<void> {
    if (!this.hold) await this.freeze();
    const h = this.hold;
    if (!h) return;
    const i = this.indexOf(h.n);
    const target = i > 0 ? this.kept[i - 1] : i < 0 ? [...this.kept].reverse().find((k) => k.n < h.n) : undefined;
    if (target) await this.show(target);
  }
  /** The picture after the one you see; after the newest, live again. */
  later() {
    const h = this.hold;
    if (!h) return;
    const i = this.indexOf(h.n);
    const next = i >= 0 ? this.kept[i + 1] : undefined;
    if (next) void this.show(next);
    else this.live();
  }
  /** Back to the live picture. */
  live() {
    if (!this.hold) return;
    this.hold.bitmap?.close();
    this.hold = null;
    this.emit();
  }

  /** Holds a kept picture: said at once, drawn once it's opened. */
  private async show(k: Kept) {
    this.hold?.bitmap?.close();
    this.hold = { n: k.n, seen: this.untilOf(this.indexOf(k.n)), w: k.w, h: k.h, bitmap: null };
    this.emit();
    const gen = this.gen;
    try {
      const bitmap = await createImageBitmap(new Blob([k.bytes], { type: k.type }));
      if (gen !== this.gen || this.hold?.n !== k.n || this.hold.bitmap) { bitmap.close(); return; }
      this.hold = { ...this.hold, bitmap };
      this.emit();
    } catch (e) {
      slog.warn('an earlier picture of a share couldn’t be opened', { err: e });
      if (gen === this.gen && this.hold?.n === k.n && !this.hold.bitmap) this.live();
    }
  }

  /* ---------- letting go ---------- */

  /** Whether earlier pictures may be kept now, or why not. Not any more: what was kept goes now. */
  setOff(off: HistoryOff | null) {
    if (off === this.off) return;
    this.off = off;
    if (off) this.dropKept();
    this.emit();
    slog.info(off ? 'earlier pictures of a share aren’t kept now' : 'earlier pictures of a share are kept again', { reason: off ?? 'none' });
  }
  /** The kept pictures go. A picture held still stays on screen while you look at it, kept as that one picture alone. */
  private dropKept() {
    this.gen++;
    this.kept = [];
    this.bytes = 0;
    this.sig = null;
    this.lastSeen = 0;
    if (this.hold && !this.hold.bitmap) this.live();
  }
  /** Shown as a tile now: back to live, and everything kept goes. The framing stays for when it's big again. */
  rest() {
    if (!this.hold && !this.kept.length) return;
    this.dropKept();
    if (this.hold) { this.hold.bitmap?.close(); this.hold = null; }
    this.emit();
  }
  /** The share stopped, or this screen is done with it: everything goes, and nothing more is kept. */
  dispose() {
    this.gone = true;
    this.dropKept();
    this.hold?.bitmap?.close();
    this.hold = null;
    this.video = null;
    this.emit();
    this.listeners.clear();
  }
}

/* ---------- every share on the call screen ---------- */

export interface ShareLooksState {
  /** The share open in its own window, and the window. */
  popped: { id: string; win: Window; kind: PopKind } | null;
  /** Counts up whenever a share's look is dropped, so the stage takes the fresh one. */
  version: number;
}

export class ShareLooks implements LiveStore<ShareLooksState> {
  private looks = new Map<string, ShareLook>();
  private listeners = new Set<() => void>();
  private state: ShareLooksState = { popped: null, version: 0 };
  private readonly device = deviceOff();
  private paused = false;
  /** Your part of the call (breakout rooms) when last told. */
  private place: string | null = null;
  private watching: (() => void) | null = null;

  getSnapshot = (): ShareLooksState => this.state;
  subscribe = (l: () => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private set(p: Partial<ShareLooksState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }
  private offNow(): HistoryOff | null { return this.device ?? (this.paused ? 'paused' : null); }

  /** The look of a share, made the first time it's asked for. */
  look(id: string): ShareLook {
    let l = this.looks.get(id);
    if (!l) { l = new ShareLook(this.offNow()); this.looks.set(id, l); }
    return l;
  }

  /**
   * The shares on the stage now (`live`, everyone else's) and the ones you see big or in their own window (`kept`).
   * Everything about a share that's gone goes, its window too; a share shown as a tile goes back to live and its earlier
   * pictures go.
   */
  sync(live: string[], kept: string[]) {
    let dropped = false;
    for (const [id, l] of this.looks) {
      if (!live.includes(id)) { l.dispose(); this.looks.delete(id); dropped = true; }
      else if (!kept.includes(id)) l.rest();
    }
    const p = this.state.popped;
    if (p && !live.includes(p.id)) this.popIn();
    if (dropped) this.set({ version: this.state.version + 1 });
  }

  /**
   * Your part of the call, and whether the organizer has paused notes. A new part of the call (breakout rooms opening,
   * closing or moving you) lets go of everything about every share; a pause drops every share's earlier pictures and
   * keeps none until notes resume.
   */
  policy(place: string, paused: boolean) {
    if (this.place !== null && place !== this.place) {
      slog.info('your part of the call changed: what was kept of every share goes');
      this.clear();
    }
    this.place = place;
    if (paused === this.paused) return;
    this.paused = paused;
    for (const l of this.looks.values()) l.setOff(this.offNow());
  }

  /** Leaving the call, or this screen going: every share's look, and any window, goes. */
  clear() {
    const had = this.looks.size > 0;
    for (const l of this.looks.values()) l.dispose();
    this.looks.clear();
    this.popIn();
    if (had) this.set({ version: this.state.version + 1 });
  }

  /**
   * Opens a share in its own window: Document Picture-in-Picture where the browser has it, else a popup window. Call it
   * from the click itself: browsers open neither without one. One share at a time: opening another closes the first.
   */
  async popOut(id: string, title: string, aspect: number): Promise<'open' | 'blocked' | 'unsupported'> {
    const kind = popKind();
    if (!kind) return 'unsupported';
    const look = this.look(id);
    let win: Window | null = null;
    try {
      win = await openPop(kind, title, aspect);
    } catch (e) {
      slog.info('the browser didn’t open a share’s own window', { kind, err: e });
    }
    if (!win) return 'blocked';
    // The share stopped, or everything was let go, while the window opened.
    if (this.looks.get(id) !== look) { win.close(); return 'blocked'; }
    const prev = this.state.popped;
    if (prev && prev.win !== win) prev.win.close();
    this.set({ popped: { id, win, kind } });
    this.follow(win);
    slog.info('a share opened in its own window', { kind });
    return 'open';
  }
  /** Closes the share's own window: it's back on the stage. */
  popIn() {
    const p = this.state.popped;
    if (!p) return;
    this.watching?.();
    this.watching = null;
    this.set({ popped: null });
    try { p.win.close(); } catch { /* already closed */ }
    slog.info('a share’s own window closed', { kind: p.kind });
  }
  /** Notices the window closing by itself (its close button, or the browser), and closes it with this page. */
  private follow(win: Window) {
    this.watching?.();
    const closed = () => { if (this.state.popped?.win === win) this.popIn(); };
    const poll = setInterval(() => { if (win.closed) closed(); }, 1000);
    win.addEventListener('pagehide', closed);
    addEventListener('pagehide', closed);
    this.watching = () => { clearInterval(poll); removeEventListener('pagehide', closed); try { win.removeEventListener('pagehide', closed); } catch { /* closed */ } };
  }
}
