/*
 * Your view of a call: Auto, speaker or grid, who you pinned, the order you dragged people into, who
 * you made bigger, and how wide a shared screen is. All of it changes your screen only, and it's
 * remembered in this browser for the account that set it (never sent anywhere). The layout engine
 * below turns it into rectangles on the stage.
 */
import { CallViewPrefsSchema, type CallViewMode, type CallViewPrefs } from '@alcove/api';
import { useCallback, useState } from 'react';
import { log } from '~/lib/log';

const vlog = log.child({ component: 'call-view' });

export const DEFAULT_VIEW: CallViewPrefs = { mode: 'auto', order: [], big: [], ratio: 0.66, pinned: null };
const keyFor = (ownerId: string) => `alcove.callView.${ownerId}`;

function read(ownerId: string): CallViewPrefs {
  try {
    const raw = localStorage.getItem(keyFor(ownerId));
    if (!raw) return DEFAULT_VIEW;
    const r = CallViewPrefsSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}
function write(ownerId: string, v: CallViewPrefs) {
  try { localStorage.setItem(keyFor(ownerId), JSON.stringify(v)); } catch (e) { vlog.debug('view not remembered', { err: e }); }
}

/** Changed from Auto, or arranged by hand: the top bar offers a way back. */
export const isCustom = (v: CallViewPrefs) => v.mode !== 'auto' || v.order.length > 0 || v.big.length > 0 || Math.abs(v.ratio - DEFAULT_VIEW.ratio) > 0.001;

export function useCallView(ownerId: string) {
  const [view, setView] = useState<CallViewPrefs>(() => read(ownerId));
  const update = useCallback((fn: (v: CallViewPrefs) => CallViewPrefs) => {
    setView((v) => { const next = fn(v); write(ownerId, next); return next; });
  }, [ownerId]);
  return {
    view,
    setMode: (mode: CallViewMode) => update((v) => ({ ...v, mode })),
    setPinned: (pinned: string | null) => update((v) => ({ ...v, pinned })),
    setOrder: (order: string[]) => update((v) => ({ ...v, order })),
    setBig: (id: string, big: boolean) => update((v) => ({ ...v, big: big ? [...new Set([...v.big, id])] : v.big.filter((x) => x !== id) })),
    setRatio: (ratio: number) => update((v) => ({ ...v, ratio: Math.max(0.42, Math.min(0.8, ratio)) })),
    /** Back to Auto, the call's own order and sizes. A pin stays: it's undone from the tile. */
    reset: () => update((v) => ({ ...DEFAULT_VIEW, pinned: v.pinned }))
  };
}
export type CallView = ReturnType<typeof useCallView>;

/* ---------- the layout engine: where everything goes, in stage pixels ---------- */

export type Rect = [x: number, y: number, w: number, h: number];
/** What you actually see. Auto: a shared screen with people beside it; speaker when someone leads; grid otherwise. */
export type Shape = 'grid' | 'speaker' | 'side';

export interface LayoutInput {
  /** Everyone on the stage, leaders first (spotlight, then your pin), then your order. */
  ids: string[];
  big: Set<string>;
  mode: CallViewMode;
  /** Who is on the main stage in speaker view. */
  lead: string | null;
  screen: boolean;
  ratio: number;
  width: number;
  height: number;
  /** Space kept at the top (the status bar) and the bottom (captions). */
  top: number;
  bottom: number;
}
export interface Layout { shape: Shape; slots: Map<string, Rect>; screen: Rect | null; divider: { x: number; y: number; vertical: boolean } | null; lead: string | null }

/** The biggest tiles of `asp` that fit `n` in the box, rows centred. */
export function fitGrid(n: number, x: number, y: number, w: number, h: number, asp: number, gap = 12): Rect[] {
  let best: { c: number; r: number; tw: number; th: number; a: number } | null = null;
  for (let c = 1; c <= Math.max(1, n); c++) {
    const r = Math.ceil(n / c);
    const cw = (w - (c - 1) * gap) / c;
    const ch = (h - (r - 1) * gap) / r;
    if (cw <= 0 || ch <= 0) continue;
    const tw0 = Math.min(cw, ch * asp);
    const th = Math.min(ch, (tw0 / asp) * 1.18);
    const tw = Math.min(cw, tw0 * 1.06);
    if (!best || tw * th > best.a + 1) best = { c, r, tw, th, a: tw * th };
  }
  if (!best) return Array.from({ length: n }, (): Rect => [x, y, Math.max(0, w), Math.max(0, h)]);
  const b = best;
  const out: Rect[] = [];
  const gh = b.r * b.th + (b.r - 1) * gap;
  const oy = y + (h - gh) / 2;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / b.c);
    const inRow = row < b.r - 1 ? b.c : n - (b.r - 1) * b.c;
    const rw = inRow * b.tw + (inRow - 1) * gap;
    const ox = x + (w - rw) / 2;
    out.push([ox + (i % b.c) * (b.tw + gap), oy + row * (b.th + gap), b.tw, b.th]);
  }
  return out;
}

/** Like fitGrid, but some tiles take two by two cells. */
export function packGrid(spans: number[], x: number, y: number, w: number, h: number, asp: number, gap = 12): Rect[] {
  if (!spans.some((s) => s > 1)) return fitGrid(spans.length, x, y, w, h, asp, gap);
  let best: { C: number; R: number; tw: number; th: number; pos: [number, number, number][]; a: number } | null = null;
  for (let C = 1; C <= spans.length + 1; C++) {
    const occ: boolean[][] = [];
    const taken = (r: number, c: number) => occ[r]?.[c] === true;
    const free = (r: number, c: number, s: number) => {
      if (c + s > C) return false;
      for (let i = r; i < r + s; i++) for (let j = c; j < c + s; j++) if (taken(i, j)) return false;
      return true;
    };
    const pos: [number, number, number][] = [];
    for (const s0 of spans) {
      const s = Math.min(s0, C);
      let r = 0;
      let c = 0;
      for (let found = false; !found; r++) {
        for (c = 0; c < C; c++) if (free(r, c, s)) { found = true; break; }
        if (found) break;
      }
      for (let i = r; i < r + s; i++) { const row = occ[i] ?? []; for (let j = c; j < c + s; j++) row[j] = true; occ[i] = row; }
      pos.push([r, c, s]);
    }
    const R = occ.length;
    const cw = (w - (C - 1) * gap) / C;
    const ch = (h - (R - 1) * gap) / R;
    if (cw <= 0 || ch <= 0) continue;
    let tw = Math.min(cw, ch * asp);
    const th = Math.min(ch, (tw / asp) * 1.18);
    tw = Math.min(cw, tw * 1.06);
    if (!best || tw * th > best.a + 1) best = { C, R, tw, th, pos, a: tw * th };
  }
  if (!best) return fitGrid(spans.length, x, y, w, h, asp, gap);
  const b = best;
  const ox = x + (w - (b.C * b.tw + (b.C - 1) * gap)) / 2;
  const oy = y + (h - (b.R * b.th + (b.R - 1) * gap)) / 2;
  return b.pos.map(([r, c, s]): Rect => [ox + c * (b.tw + gap), oy + r * (b.th + gap), s * b.tw + (s - 1) * gap, s * b.th + (s - 1) * gap]);
}

export function shapeOf(i: Pick<LayoutInput, 'mode' | 'screen' | 'lead'>): Shape {
  if (i.mode === 'grid') return 'grid';
  if (i.mode === 'speaker') return 'speaker';
  if (i.screen) return 'side';
  return i.lead ? 'speaker' : 'grid';
}

export function layout(i: LayoutInput): Layout {
  const shape = i.ids.length < 2 && !i.screen ? 'grid' : shapeOf(i);
  const slots = new Map<string, Rect>();
  const w = Math.max(0, i.width);
  const h = Math.max(0, i.height - i.top - i.bottom);
  const top = i.top;
  const portrait = w < h * 1.05;
  const span = (id: string) => (i.big.has(id) ? 2 : 1);
  if (shape === 'side') {
    let screen: Rect;
    let divider: Layout['divider'];
    let rects: Rect[];
    if (!portrait) {
      const sw = Math.round((w - 12) * i.ratio);
      screen = [0, top, sw, h];
      divider = { x: sw + 6, y: top + h / 2, vertical: false };
      rects = packGrid(i.ids.map(span), sw + 12, top, w - sw - 12, h, 1.2);
    } else {
      const sh = Math.min(Math.round((h - 12) * i.ratio), Math.round(w / 1.5));
      screen = [0, top, w, sh];
      divider = { x: w / 2, y: top + sh + 6, vertical: true };
      rects = fitGrid(i.ids.length, 0, top + sh + 12, w, h - sh - 12, 1.2, 8);
    }
    i.ids.forEach((id, k) => { const r = rects[k]; if (r) slots.set(id, r); });
    return { shape, slots, screen, divider, lead: null };
  }
  if (shape === 'speaker') {
    const lead = i.lead && i.ids.includes(i.lead) ? i.lead : i.ids[0] ?? null;
    const rest = i.ids.filter((x) => x !== lead);
    const m = rest.length + (i.screen ? 1 : 0);
    const fh = m === 0 ? 0 : portrait ? Math.max(76, Math.min(h * 0.16, 110)) : Math.max(96, Math.min(h * 0.2, 150));
    const gq = portrait ? 8 : 12;
    const fw = m === 0 ? 0 : Math.min(fh * 1.45, (w - (m - 1) * gq) / m);
    const x0 = (w - (m * fw + (m - 1) * gq)) / 2;
    const yy = top + h - fh;
    let k = 0;
    let screen: Rect | null = null;
    if (i.screen) { screen = [x0, yy, fw, fh]; k = 1; }
    if (lead) slots.set(lead, [0, top, w, m === 0 ? h : h - fh - gq]);
    rest.forEach((id, n) => slots.set(id, [x0 + (n + k) * (fw + gq), yy, fw, fh]));
    return { shape, slots, screen, divider: null, lead };
  }
  const spans = [...(i.screen ? [1] : []), ...i.ids.map((id) => (portrait ? 1 : span(id)))];
  const rects = packGrid(spans, 0, top, w, h, portrait ? 1 : 1.45, portrait ? 8 : 12);
  const screen = i.screen ? rects[0] ?? null : null;
  i.ids.forEach((id, k) => { const r = rects[k + (i.screen ? 1 : 0)]; if (r) slots.set(id, r); });
  return { shape: 'grid', slots, screen, divider: null, lead: null };
}

/** Everyone in your order: the spotlit first, then your pin, then the order you dragged, then the rest as they came. */
export function ordered(ids: string[], v: Pick<CallViewPrefs, 'order' | 'pinned'>, spotlight: string | null): string[] {
  const lead = [spotlight, v.pinned].filter((x, k, all): x is string => !!x && ids.includes(x) && all.indexOf(x) === k);
  const known = v.order.filter((x) => ids.includes(x) && !lead.includes(x));
  const rest = ids.filter((x) => !lead.includes(x) && !known.includes(x));
  return [...lead, ...known, ...rest];
}
