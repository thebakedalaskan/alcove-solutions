/*
 * The layout engine: where everyone on the stage goes. `arrange` turns the call (who's here, what's presented, the
 * organizer's spotlight) and your own view (view.ts) into a plan: who leads, in what order, and where you see yourself. There
 * are no modes to choose: the stage lays itself out, and what you dragged, sized and pinned is kept. Talking moves nothing:
 * only a pin or the spotlight puts someone on the main stage. `place` turns a plan into rectangles for the stage's size, and
 * `placeFrame` puts them where the stage is, or, once something is open on your stage (panels.ts), beside it. All are pure,
 * so the same call and the same choices always look the same, and nothing moves unless one of them changed.
 */
import type { CallLayout, CallViewPrefs, StageCorner } from '@alcove/api';
import { placePeople, type PeopleMode, type TileMode } from '../layout/panels';

export type Rect = [x: number, y: number, w: number, h: number];
export interface Box { x: number; y: number; w: number; h: number }
/**
 * What you see. Grid: everyone in tiles, whoever leads first and bigger. Focus: whoever leads (the organizer's spotlight,
 * your pins) on the main stage, everyone else in a strip under it. Side: something is open on your stage, and the people
 * sit beside it.
 */
export type Shape = 'grid' | 'focus' | 'side';

/** Something presented that isn't on your stage takes a tile among the people, keyed apart from them (participant IDs). */
export const thingKey = (id: string) => `thing:${id}`;
export const isThingKey = (key: string) => key.startsWith('thing:');
/** Someone rung who isn't here yet takes a tile too, keyed apart from people. */
export const waitKey = (id: string) => `ring:${id}`;
export const isWaitKey = (key: string) => key.startsWith('ring:');

/** Someone on the stage, or (`waiting`) someone rung who isn't in the call: a tile, and nobody to follow or lead with. */
export interface StagePerson { id: string; seat: string; isMe: boolean; waiting?: boolean | undefined }
export interface ArrangeInput {
  /** Everyone on the stage, in the call's order. */
  people: StagePerson[];
  /** What's presented and isn't on your stage, as tiles first among the people (`thingKey`), in the order it started. */
  tiles: string[];
  /** The organizer's spotlight, for everyone: a participant ID. */
  spotlight: string | null;
  prefs: CallViewPrefs;
  layout: CallLayout;
  /** Something is open on your stage: the people sit beside it. */
  hold: boolean;
}
export interface Plan {
  shape: Shape;
  /** People on the main stage in focus; first and bigger in grid. By participant ID. */
  leads: string[];
  /** Everything else, in your order: what's presented first, then people. */
  rest: string[];
  /** Tiles shown at twice the size (grid). */
  big: Set<string>;
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
  const alone = i.people.length - awaited <= 1 && i.tiles.length === 0;
  // You leave the grid for a corner once there's someone or something else to see; folded away, always. Beside what's open
  // the people have no stage to have a corner of: there, your own picture is one of them.
  const self = me && prefs.self !== 'grid' && !(prefs.self === 'corner' && (alone || i.hold)) ? { id: me.id, corner: prefs.corner, folded: prefs.self === 'hidden' } : null;
  // Your order: as you arranged it, then as people first came in, then anyone not counted yet.
  const order = [...new Set([...layout.order, ...layout.arrived, ...i.people.map((p) => p.seat)])];
  const people = order.flatMap((seat) => { const p = bySeat.get(seat); return p && p.id !== self?.id ? [p] : []; });
  const here = new Set(people.map((p) => p.id));
  const idOf = (seat: string) => { const p = bySeat.get(seat); return p && here.has(p.id) ? [p.id] : []; };
  // Who leads: the organizer's spotlight, then your pins in the order you pinned them. Nobody leads for talking: the speak
  // ring says who's talking, and the stage stays as it is.
  const leads = [...new Set([...(i.spotlight && here.has(i.spotlight) ? [i.spotlight] : []), ...layout.pins.flatMap(idOf)])];
  const count = people.length + i.tiles.length;
  const shape: Shape = i.hold ? 'side' : leads.length && count > 1 ? 'focus' : 'grid';
  const rest = [...i.tiles, ...people.map((p) => p.id).filter((id) => !leads.includes(id))];
  const big = new Set(shape === 'grid' ? [...leads, ...layout.big.flatMap(idOf)] : []);
  const awaiting = me && !self && alone && awaited > 0 ? me.id : null;
  return { shape, leads, rest, big, self, awaiting, order: order.filter((seat) => !bySeat.get(seat)?.waiting) };
}

/** `full` with the members of a group (`before`, in their old order) put back in their new order, in the same places. */
export function reslot(full: string[], before: string[], after: string[]): string[] {
  const out = [...full];
  before.forEach((s, k) => { const at = full.indexOf(s); const next = after[k]; if (at >= 0 && next !== undefined) out[at] = next; });
  return out;
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

export interface Placed {
  shape: Shape;
  /** Every tile, by key (people by participant ID, what's presented by `thingKey`). */
  slots: Map<string, Rect>;
  /** Your own picture in its corner, or the chip it folds into. */
  self: Rect | null;
  /** Where the people are while something is open on your stage, if they're anywhere. */
  people: Box | null;
  /** Tiles that aren't tiles: arches, in a rail or a row. */
  modes: Map<string, TileMode>;
  /** Tiles with no room: kept in place, out of sight. */
  off: Set<string>;
  /** What stands in for them: how many they are, and where it goes. */
  more: { rect: Rect; mode: TileMode; n: number } | null;
}
export interface PlaceInput { width: number; height: number; top: number; bottom: number }

const GAP = 12;

type Shapes = Pick<Placed, 'shape' | 'slots'>;
/** The plan in a box: the shapes without your corner picture. */
function inBox(plan: Plan, b: Box): Shapes {
  const slots = new Map<string, Rect>();
  const portrait = b.w < b.h * 1.05;
  const tiles = [...plan.leads, ...plan.rest];
  const set = (keys: string[], rects: Rect[]) => keys.forEach((k, n) => { const r = rects[n]; if (r) slots.set(k, r); });
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
    return { shape: 'focus', slots };
  }
  const you = plan.awaiting;
  if (you !== null) {
    const arches = tiles.filter((k) => k !== you);
    const part = Math.round(((portrait ? b.h : b.w) - GAP) * (portrait ? 0.42 : 0.4));
    slots.set(you, portrait ? [b.x, b.y, b.w, b.h - part - GAP] : [b.x, b.y, b.w - part - GAP, b.h]);
    set(arches, portrait ? fillGrid(arches.length, b.x, b.y + b.h - part, b.w, part, 1.1, 8) : fillGrid(arches.length, b.x + b.w - part, b.y, part, b.h, 1.1, GAP));
    return { shape: 'grid', slots };
  }
  set(tiles, packGrid(tiles.map((k) => (portrait ? 1 : plan.big.has(k) ? 2 : 1)), b.x, b.y, b.w, b.h, portrait ? 1 : 1.45, portrait ? 8 : GAP));
  return { shape: plan.shape, slots };
}

const overlaps = (a: Rect, b: Rect) => a[0] < b[0] + b[2] - 1 && b[0] < a[0] + a[2] - 1 && a[1] < b[1] + b[3] - 1 && b[1] < a[1] + a[3] - 1;
const areaOf = (p: Shapes) => [...p.slots.values()].reduce((n, r) => n + r[2] * r[3], 0);

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
  const tilesOnly = { people: null, modes: new Map<string, TileMode>(), off: new Set<string>(), more: null };
  if (!self) return { ...inBox(plan, b), self: null, ...tilesOnly };
  const [sw, sh] = selfSize(b, self.folded);
  const left = self.corner.endsWith('left');
  const top = self.corner.startsWith('top');
  const r: Rect = [left ? b.x : b.x + b.w - sw, top ? b.y : b.y + b.h - sh, sw, sh];
  const beside: Box = { x: left ? b.x + sw + GAP : b.x, y: b.y, w: b.w - sw - GAP, h: b.h };
  const above: Box = { x: b.x, y: top ? b.y + sh + GAP : b.y, w: b.w, h: b.h - sh - GAP };
  const whole = inBox(plan, b);
  // Nothing under your picture as it is: that's the most room anything can have.
  if (![...whole.slots.values()].some((t) => overlaps(t, r))) return { ...whole, self: r, ...tilesOnly };
  const side = inBox(plan, beside);
  const band = inBox(plan, above);
  return { ...(areaOf(band) > areaOf(side) + 1 ? band : side), self: r, ...tilesOnly };
}

/** What the stage is given by the main area around it. */
export interface StageFrame {
  /** The stage, in the call's area. Once something is open on your stage, the main area the people share with it. */
  box: Box;
  /** The room to keep for the status bar and captions on a stage that holds everyone. */
  top: number;
  bottom: number;
  /** The people beside what's open on your stage, in the call's area (at its right edge, past your side), or null while the stage is theirs. */
  panels: {
    people: Box | null;
    mode: PeopleMode;
    /** Who's talking or has a hand up: there's always a place for them. */
    loud: ReadonlySet<string>;
    /** The row of arches on a phone. */
    small: boolean;
  } | null;
}
const rectOf = (b: Box): Rect => [b.x, b.y, b.w, b.h];
const moved = (b: Box, x: number, y: number): Box => ({ ...b, x: b.x + x, y: b.y + y });

/** How high the chip you fold into is, under the people when they're a column. */
const CHIP_H = 36;

/** Everything on the stage, placed in the call's area. */
export function placeFrame(plan: Plan, f: StageFrame): Placed {
  const p = f.panels;
  if (!p) {
    const { x, y } = f.box;
    const L = place(plan, { width: f.box.w, height: f.box.h, top: f.top, bottom: f.bottom });
    const at = (r: Rect): Rect => [r[0] + x, r[1] + y, r[2], r[3]];
    return { ...L, slots: new Map([...L.slots].map(([k, r]) => [k, at(r)])), self: L.self && at(L.self), people: L.people && moved(L.people, x, y) };
  }
  const folded = plan.self?.folded && p.people && p.mode === 'tiles';
  const people = folded && p.people ? { ...p.people, h: Math.max(0, p.people.h - CHIP_H - GAP) } : p.people;
  // Someone rung waits in a tile: among arches they're in People, with what they said.
  const who = [...plan.leads, ...plan.rest].filter((id) => p.mode === 'tiles' || !isWaitKey(id));
  const placed = placePeople(people, who.map((id) => ({ id, thing: isThingKey(id) })), p.mode, p.loud, p.small);
  const modes = new Map<string, TileMode>();
  const slots = new Map<string, Rect>();
  for (const [k, s] of placed.spots) { slots.set(k, rectOf(s.box)); if (s.mode !== 'tile') modes.set(k, s.mode); }
  return {
    shape: plan.shape, slots,
    self: folded && p.people ? [p.people.x + p.people.w - 112, p.people.y + p.people.h - CHIP_H, 112, CHIP_H] : null,
    people: p.people, modes, off: placed.off, more: placed.more && { rect: rectOf(placed.more.box), mode: placed.more.mode, n: placed.more.n }
  };
}
