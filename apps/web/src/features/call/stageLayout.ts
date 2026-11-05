/*
 * The layout engine: where everything on the stage goes, in stage pixels. `arrange` turns the call (who's here, what's
 * shared, who's talking) and your own view (view.ts) into a plan: what leads, in what order, and where you see
 * yourself. `place` turns a plan into rectangles for the stage's size. Both are pure, so the same call and the same
 * choices always look the same, and nothing moves unless one of them changed.
 */
import type { CallLayout, CallViewPrefs, StageCorner } from '@alcove/api';

export type Rect = [x: number, y: number, w: number, h: number];
export interface Box { x: number; y: number; w: number; h: number }
/**
 * What you see. Grid: everyone in tiles, whoever leads first and bigger. Focus: whoever leads (a spotlight, your pins,
 * the speaker) on the main stage, everyone else in a strip under it. Side: shared screens big, the people beside them.
 */
export type Shape = 'grid' | 'focus' | 'side';

/** At most this many shares side by side (one on a narrow stage); any more are tiles among the people. */
export const MAX_FEATURED = 2;
/** A share's tile is keyed apart from people's (participant IDs), by its sharer's participant ID. */
export const shareKey = (id: string) => `share:${id}`;
export const isShareKey = (key: string) => key.startsWith('share:');
/** Someone rung who isn't here yet takes a tile too, keyed apart from people. */
export const waitKey = (id: string) => `ring:${id}`;
export const isWaitKey = (key: string) => key.startsWith('ring:');

/** Someone on the stage, or (`waiting`) someone rung who isn't in the call: a tile, and nobody to follow or lead with. */
export interface StagePerson { id: string; seat: string; isMe: boolean; waiting?: boolean | undefined }
export interface ArrangeInput {
  /** Everyone on the stage, in the call's order. */
  people: StagePerson[];
  /** What's shared now, by sharer's participant ID, in the order they started. */
  shares: string[];
  /** Your own share while you share: it starts as a tile, since you see what you share on your own screen already. */
  own: string | null;
  /** Shares you opened in their own window: tiles here, whatever else you chose, and the next share takes their place. */
  away: string[];
  /** How many shares fit big side by side: MAX_FEATURED, or one on a narrow stage. */
  fit: number;
  /** The organizer's spotlight, for everyone: a participant ID. */
  spotlight: string | null;
  /** Who's been talking (settled, never you), and who has done most of the talking lately. */
  speaker: string | null;
  dominant: string | null;
  prefs: CallViewPrefs;
  layout: CallLayout;
}
export interface Plan {
  shape: Shape;
  /** Shares big on the stage, side by side in the order they started, by share ID. */
  featured: string[];
  /** People on the main stage in focus; first and bigger in grid and side. By participant ID. */
  leads: string[];
  /** Everything else, in your order: shares shown as tiles first, then people. */
  rest: string[];
  /** Tiles shown at twice the size (grid and side). */
  big: Set<string>;
  /** Whoever leads was picked by Alcove (the speaker), not by you or the organizer. */
  auto: boolean;
  /** Your own picture when it isn't in the grid: in a corner, or folded into a small chip there. */
  self: { id: string; corner: StageCorner; folded: boolean } | null;
  /** You, while nobody else is here and people rung are on their way: you're big, with their arches beside you. */
  awaiting: string | null;
  /** Every seat in your order, whether they're here now or not: what a move rearranges. */
  order: string[];
}

export function arrange(i: ArrangeInput): Plan {
  const { prefs, layout } = i;
  const bySeat = new Map(i.people.map((p) => [p.seat, p]));
  const me = i.people.find((p) => p.isMe) ?? null;
  const awaited = i.people.filter((p) => p.waiting).length;
  const alone = i.people.length - awaited <= 1 && i.shares.length === 0;
  // You leave the grid for a corner once there's someone or something else to see; folded away, always.
  const self = me && prefs.self !== 'grid' && !(alone && prefs.self === 'corner') ? { id: me.id, corner: prefs.corner, folded: prefs.self === 'hidden' } : null;
  // Your order: as you arranged it, then as people first came in, then anyone not counted yet.
  const order = [...new Set([...layout.order, ...layout.arrived, ...i.people.map((p) => p.seat)])];
  const people = order.flatMap((seat) => { const p = bySeat.get(seat); return p && p.id !== self?.id ? [p] : []; });
  const here = new Set(people.map((p) => p.id));
  const idOf = (seat: string) => { const p = bySeat.get(seat); return p && here.has(p.id) ? [p.id] : []; };
  // Who leads: the organizer's spotlight, then your pins in the order you pinned them.
  let leads = [...new Set([...(i.spotlight && here.has(i.spotlight) ? [i.spotlight] : []), ...layout.pins.flatMap(idOf)])];
  // Shares: once you've chosen how to see any of them, the ones you last made big (as many as fit, maybe none). Until
  // then, everyone else's, the first to start, except in Grid. A share that starts later never takes the place of what
  // you see, and never undoes what you chose.
  const live = new Set(i.shares);
  const chose = layout.shares.filter((s) => live.has(s.id));
  const pick = chose.length ? chose.filter((s) => s.show === 'big' && !i.away.includes(s.id)).map((s) => s.id).slice(-i.fit)
    : prefs.mode === 'grid' ? [] : i.shares.filter((s) => s !== i.own && !i.away.includes(s)).slice(0, i.fit);
  const featured = i.shares.filter((s) => pick.includes(s));
  const tiles = i.shares.filter((s) => !featured.includes(s)).map(shareKey);
  // Nobody chosen and nothing shared: Speaker follows whoever talks; Auto follows someone doing most of the talking,
  // but only while you haven't arranged anything, so what you arranged stays put.
  let auto = false;
  if (!leads.length && !featured.length) {
    const others = people.filter((p) => !p.isMe && !p.waiting).map((p) => p.id);
    const arranged = layout.order.length > 0 || layout.big.length > 0;
    const pick = prefs.mode === 'speaker' ? (i.speaker && here.has(i.speaker) ? i.speaker : others[0] ?? null)
      : prefs.mode === 'auto' && !arranged && i.dominant && here.has(i.dominant) ? i.dominant : null;
    if (pick) { leads = [pick]; auto = true; }
  }
  const count = people.length + tiles.length;
  const shape: Shape = featured.length ? 'side' : prefs.mode !== 'grid' && leads.length && count > 1 ? 'focus' : 'grid';
  const rest = [...tiles, ...people.map((p) => p.id).filter((id) => !leads.includes(id))];
  const big = new Set(shape === 'focus' ? [] : [...leads, ...layout.big.flatMap(idOf)]);
  const awaiting = me && !self && alone && awaited > 0 ? me.id : null;
  return { shape, featured, leads, rest, big, auto, self, awaiting, order: order.filter((seat) => !bySeat.get(seat)?.waiting) };
}

/** `full` with the members of a group (`before`, in their old order) put back in their new order, in the same places. */
export function reslot(full: string[], before: string[], after: string[]): string[] {
  const out = [...full];
  before.forEach((s, k) => { const at = full.indexOf(s); const next = after[k]; if (at >= 0 && next !== undefined) out[at] = next; });
  return out;
}

/**
 * Keeps tiles where they were when only who leads changed by itself: whoever stepped down takes the place of whoever
 * stepped up, instead of everyone between them shifting along. Newcomers go at the end.
 */
export function steady(prev: string[], next: string[]): string[] {
  const want = new Set(next);
  const fresh = next.filter((k) => !prev.includes(k));
  const out: string[] = [];
  for (const k of prev) {
    if (want.has(k)) out.push(k);
    else { const n = fresh.shift(); if (n !== undefined) out.push(n); }
  }
  return [...out, ...fresh];
}

/* ---------- rectangles ---------- */

/**
 * No more columns can beat a tile of `area`: with `c + 1` columns or more, a tile is at most a column wide and at most
 * 1.18 times that over `asp` high, and columns only get narrower. Stops the search a column or two past the best.
 */
const beaten = (w: number, c: number, gap: number, asp: number, area: number) => {
  const next = (w - c * gap) / (c + 1);
  return (next * next * 1.18) / asp < area;
};

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
    if (best && beaten(w, c, gap, asp, best.a)) break;
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

/**
 * Tiles that fill the box: as many columns as make each cell closest to `asp`, the last row centred. For whoever leads
 * on the main stage, where empty bands above and below would waste the room they were given.
 */
export function fillGrid(n: number, x: number, y: number, w: number, h: number, asp: number, gap = 12): Rect[] {
  let best: { c: number; r: number; cw: number; ch: number; d: number } | null = null;
  for (let c = 1; c <= Math.max(1, n); c++) {
    const r = Math.ceil(n / c);
    const cw = (w - (c - 1) * gap) / c;
    const ch = (h - (r - 1) * gap) / r;
    if (cw <= 0 || ch <= 0) continue;
    const d = Math.abs(Math.log(cw / ch / asp));
    if (!best || d < best.d - 0.01) best = { c, r, cw, ch, d };
  }
  if (!best) return fitGrid(n, x, y, w, h, asp, gap);
  const b = best;
  return Array.from({ length: n }, (_, i): Rect => {
    const row = Math.floor(i / b.c);
    const inRow = row < b.r - 1 ? b.c : n - (b.r - 1) * b.c;
    const ox = x + (w - (inRow * b.cw + (inRow - 1) * gap)) / 2;
    return [ox + (i % b.c) * (b.cw + gap), y + row * (b.ch + gap), b.cw, b.ch];
  });
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
    if (best && beaten(w, C, gap, asp, best.a)) break;
  }
  if (!best) return fitGrid(spans.length, x, y, w, h, asp, gap);
  const b = best;
  const ox = x + (w - (b.C * b.tw + (b.C - 1) * gap)) / 2;
  const oy = y + (h - (b.R * b.th + (b.R - 1) * gap)) / 2;
  return b.pos.map(([r, c, s]): Rect => [ox + c * (b.tw + gap), oy + r * (b.th + gap), s * b.tw + (s - 1) * gap, s * b.th + (s - 1) * gap]);
}

/** A line you can drag: between the shares and the people, or between two shares. `along` is the way it moves. */
export interface Handle { x: number; y: number; along: 'x' | 'y'; area: Box }
export interface Placed {
  shape: Shape;
  /** Every tile, by key (people by participant ID, shares shown as tiles by shareKey). */
  slots: Map<string, Rect>;
  /** Shares shown big, by share ID. */
  shares: Map<string, Rect>;
  divider: Handle | null;
  split: Handle | null;
  /** Your own picture in its corner, or the chip it folds into. */
  self: Rect | null;
}
export interface PlaceInput { width: number; height: number; top: number; bottom: number; ratio: number; split: number }

const GAP = 12;
/** Most shared screens are about this wide for their height (16:10). */
const SHARE_ASPECT = 1.6;
/** How much of a w × h box a shared screen's picture fills, kept whole. */
const shown = (w: number, h: number) => (w / Math.max(1, h) > SHARE_ASPECT ? h * h * SHARE_ASPECT : (w * w) / SHARE_ASPECT);

/** The plan in a box: the shapes without your corner picture. */
function inBox(plan: Plan, b: Box, ratio: number, split: number): Omit<Placed, 'self'> {
  const slots = new Map<string, Rect>();
  const shares = new Map<string, Rect>();
  const portrait = b.w < b.h * 1.05;
  const tiles = [...plan.leads, ...plan.rest];
  const set = (keys: string[], rects: Rect[]) => keys.forEach((k, n) => { const r = rects[n]; if (r) slots.set(k, r); });
  if (plan.shape === 'side') {
    let area: Box = b;
    let divider: Handle | null = null;
    if (tiles.length) {
      if (!portrait) {
        const sw = Math.round((b.w - GAP) * ratio);
        area = { x: b.x, y: b.y, w: sw, h: b.h };
        const people: Box = { x: b.x + sw + GAP, y: b.y, w: b.w - sw - GAP, h: b.h };
        divider = { x: b.x + sw + GAP / 2, y: b.y + b.h / 2, along: 'x', area: b };
        set(tiles, packGrid(tiles.map((k) => (plan.big.has(k) ? 2 : 1)), people.x, people.y, people.w, people.h, 1.2));
      } else {
        const sh = Math.min(Math.round((b.h - GAP) * ratio), Math.round(b.w / 1.5));
        area = { x: b.x, y: b.y, w: b.w, h: sh };
        divider = { x: b.x + b.w / 2, y: b.y + sh + GAP / 2, along: 'y', area: b };
        set(tiles, fitGrid(tiles.length, b.x, b.y + sh + GAP, b.w, b.h - sh - GAP, 1.2, 8));
      }
    }
    // Two shares side by side, or one above the other where that shows both pictures bigger (shared screens are wide),
    // split where you put the line. Which way depends on the space alone, so moving the line never turns them.
    let splitHandle: Handle | null = null;
    const [a, c] = plan.featured;
    if (a !== undefined && c === undefined) shares.set(a, [area.x, area.y, area.w, area.h]);
    else if (a !== undefined && c !== undefined) {
      if (shown((area.w - GAP) / 2, area.h) >= shown(area.w, (area.h - GAP) / 2)) {
        const aw = Math.round((area.w - GAP) * split);
        shares.set(a, [area.x, area.y, aw, area.h]);
        shares.set(c, [area.x + aw + GAP, area.y, area.w - aw - GAP, area.h]);
        splitHandle = { x: area.x + aw + GAP / 2, y: area.y + area.h / 2, along: 'x', area };
      } else {
        const ah = Math.round((area.h - GAP) * split);
        shares.set(a, [area.x, area.y, area.w, ah]);
        shares.set(c, [area.x, area.y + ah + GAP, area.w, area.h - ah - GAP]);
        splitHandle = { x: area.x + area.w / 2, y: area.y + ah + GAP / 2, along: 'y', area };
      }
    }
    return { shape: 'side', slots, shares, divider, split: splitHandle };
  }
  if (plan.shape === 'focus') {
    const m = plan.rest.length;
    const fh = m === 0 ? 0 : portrait ? Math.max(76, Math.min(b.h * 0.16, 110)) : Math.max(96, Math.min(b.h * 0.2, 150));
    const gq = portrait ? 8 : GAP;
    const fw = m === 0 ? 0 : Math.min(fh * 1.45, (b.w - (m - 1) * gq) / m);
    const x0 = b.x + (b.w - (m * fw + (m - 1) * gq)) / 2;
    const yy = b.y + b.h - fh;
    const mh = m === 0 ? b.h : b.h - fh - gq;
    // One lead fills the main stage; several share all of it.
    set(plan.leads, fillGrid(plan.leads.length, b.x, b.y, b.w, mh, portrait ? 0.8 : 1.3, gq));
    plan.rest.forEach((k, n) => slots.set(k, [x0 + n * (fw + gq), yy, fw, fh]));
    return { shape: 'focus', slots, shares, divider: null, split: null };
  }
  const you = plan.awaiting;
  if (you !== null) {
    const arches = tiles.filter((k) => k !== you);
    const part = Math.round(((portrait ? b.h : b.w) - GAP) * (portrait ? 0.42 : 0.4));
    slots.set(you, portrait ? [b.x, b.y, b.w, b.h - part - GAP] : [b.x, b.y, b.w - part - GAP, b.h]);
    set(arches, portrait ? fillGrid(arches.length, b.x, b.y + b.h - part, b.w, part, 1.1, 8) : fillGrid(arches.length, b.x + b.w - part, b.y, part, b.h, 1.1, GAP));
    return { shape: 'grid', slots, shares, divider: null, split: null };
  }
  set(tiles, packGrid(tiles.map((k) => (portrait ? 1 : plan.big.has(k) ? 2 : 1)), b.x, b.y, b.w, b.h, portrait ? 1 : 1.45, portrait ? 8 : GAP));
  return { shape: 'grid', slots, shares, divider: null, split: null };
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[0] + b[2] - 1 && b[0] < a[0] + a[2] - 1 && a[1] < b[1] + b[3] - 1 && b[1] < a[1] + a[3] - 1;
const areaOf = (p: Omit<Placed, 'self'>) => [...p.slots.values(), ...p.shares.values()].reduce((n, r) => n + r[2] * r[3], 0);

/** How big your own picture is in a corner (landscape on a wide stage, portrait on a phone), or the chip it folds into. */
function selfSize(b: Box, folded: boolean): [number, number] {
  if (folded) return [112, 36];
  if (b.w >= b.h * 1.05) { const w = Math.round(Math.max(150, Math.min(280, b.w * 0.2))); return [w, Math.round((w * 10) / 16)]; }
  const w = Math.round(Math.max(96, Math.min(150, b.w * 0.3)));
  return [w, Math.round((w * 4) / 3)];
}

/**
 * Where everything goes. Your corner picture never covers a tile: if the layout would put one under it, the stage
 * makes room beside or above it, whichever leaves the most to see.
 */
export function place(plan: Plan, i: PlaceInput): Placed {
  const b: Box = { x: 0, y: i.top, w: Math.max(0, i.width), h: Math.max(0, i.height - i.top - i.bottom) };
  const self = plan.self;
  if (!self) return { ...inBox(plan, b, i.ratio, i.split), self: null };
  const [sw, sh] = selfSize(b, self.folded);
  const left = self.corner.endsWith('left');
  const top = self.corner.startsWith('top');
  const r: Rect = [left ? b.x : b.x + b.w - sw, top ? b.y : b.y + b.h - sh, sw, sh];
  const beside: Box = { x: left ? b.x + sw + GAP : b.x, y: b.y, w: b.w - sw - GAP, h: b.h };
  const above: Box = { x: b.x, y: top ? b.y + sh + GAP : b.y, w: b.w, h: b.h - sh - GAP };
  const whole = inBox(plan, b, i.ratio, i.split);
  // Nothing under your picture as it is: that's the most room anything can have.
  if (![...whole.slots.values(), ...whole.shares.values()].some((t) => overlaps(t, r))) return { ...whole, self: r };
  const side = inBox(plan, beside, i.ratio, i.split);
  const band = inBox(plan, above, i.ratio, i.split);
  return { ...(areaOf(band) > areaOf(side) + 1 ? band : side), self: r };
}
