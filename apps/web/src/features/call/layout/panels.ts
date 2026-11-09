/*
 * How the call's main area, left of your side (side.ts), is shared. With nothing open on your stage, the stage is the
 * people's, and stageLayout.ts places them as it always has. With something open (a screen, a board or the workspace, each in
 * its frame: frame.tsx), the frame takes the room and the people sit beside it, as View says:
 *
 * - Tiles: a column on the right, about 300, 248, 216 or 176 px wide as the stage narrows.
 * - Arches: a row over the frame, which is also what happens when the stage is under 760 px, and on a phone.
 * - Hidden: on the horizon by the dock, as ⇧P does.
 *
 * A second thing presented can sit beside the first (Show beside), as two screens do; when there isn't room for both they take
 * turns, and the top bar says which is showing. Focus fills your window with what's in the frame, the people on the horizon.
 *
 * While breakout rooms are open, the organizer's stage shows the rooms (Stage.tsx), and what's open stands beside them, the
 * rooms in place of the people. Where there isn't room for both, on a phone and on a narrow stage, what's open goes over the
 * rooms until it's closed, with whoever's in your part of the call beside it as anyone else's are.
 *
 * Everything here is pure: the room and what's open in, rectangles out.
 */
import type { CallPeopleMode } from '@alcove/api';
import type { Box } from './stageLayout';

export type PeopleMode = CallPeopleMode;
export interface Size { w: number; h: number }

/** Under this wide, a window is a phone: what's open fills the screen under a row of arches, and your side is a sheet over the call. */
export const PHONE_W = 600;
/** The gap between the frame and the people, and between them and your side. */
export const GAP = 12;
/** Under this wide, the stage has no room for a column of people beside what's open: they're a row of arches over it. */
const ARCHES_UNDER = 760;
/** The row of arches over the frame: its height, and the room under it. */
const ARCH_ROW = 64;
/** Focus: how far it stands from the window's edges, and how much is left at the bottom for the dock and the arches. */
const FOCUS_EDGE = 16;
const FOCUS_DOCK = 92;
/** Two frames side by side need this much across, or they're one over the other; with room for neither, they take turns. */
const BESIDE_W = 900;
const STACKED_H = 620;
/** The rooms stand beside what's open only on a stage this wide: under it, what's open goes over them. */
const ROOMS_BESIDE = 880;

/** The people's column beside what's open, by how wide the stage is. */
export const columnWidth = (w: number) => (w >= 1500 ? 300 : w >= 1300 ? 248 : w >= 980 ? 216 : 176);
/** The rooms beside what's open: a little over a third of the stage, enough for every room to say who's in it. */
const roomsWidth = (w: number) => Math.round(Math.min(560, Math.max(340, w * 0.38)));

export interface MainFacts {
  /** How many things are on your stage: none, one, or two (Show beside). */
  frames: number;
  /** View's Beside what's shared. */
  people: PeopleMode;
  phone: boolean;
  /** Focus: the frame fills your window, past the bars that tuck away. */
  focus: Box | null;
  /** The organizer's stage shows every breakout room: what's open stands beside them, where there's room. */
  rooms: boolean;
  /** Room kept at the top for the status bar while it says anything, and at the bottom for captions. */
  top: number;
  bottom: number;
}
export interface MainPlaced {
  /** Where each thing on your stage goes, in order: none with nothing open. */
  frames: Box[];
  /** Where the people go beside it: a column of tiles or a row of arches; null on the horizon, or with nothing open (the stage is theirs). */
  people: Box | null;
  /** How the people sit beside what's open. */
  mode: PeopleMode;
  /** Two things are open and there isn't room for both: they take turns, one frame at a time. */
  turns: boolean;
  /**
   * Where the organizer's rooms go: the whole stage with nothing open, or beside what's open. Null with no rooms to show, and
   * where what's open goes over them.
   */
  rooms: Box | null;
}

const NOTHING: MainPlaced = { frames: [], people: null, mode: 'tiles', turns: false, rooms: null };

/** Two frames in a box: side by side, one over the other, or (no room for either) one at a time. */
function two(r: Box): { frames: Box[]; turns: boolean } {
  if (r.w >= BESIDE_W) {
    const w = Math.round((r.w - GAP) / 2);
    return { frames: [{ ...r, w }, { ...r, x: r.x + w + GAP, w: r.w - w - GAP }], turns: false };
  }
  if (r.h >= STACKED_H) {
    const h = Math.round((r.h - GAP) / 2);
    return { frames: [{ ...r, h }, { ...r, y: r.y + h + GAP, h: r.h - h - GAP }], turns: false };
  }
  return { frames: [r, r], turns: true };
}

/** Where the frames and the people go in the main area. */
export function placeMain(size: Size, f: MainFacts): MainPlaced {
  if (size.w <= 0) return NOTHING;
  if (f.frames === 0) return f.rooms ? { ...NOTHING, rooms: { x: 0, y: 0, w: size.w, h: size.h } } : NOTHING;
  const many = (r: Box): Pick<MainPlaced, 'frames' | 'turns'> => (f.frames > 1 ? two(r) : { frames: [r], turns: false });
  if (f.focus) return { ...many(f.focus), people: null, mode: 'hidden', rooms: null };
  const room: Box = { x: 0, y: f.top, w: size.w, h: Math.max(0, size.h - f.top - f.bottom) };
  if (f.phone) {
    // A phone: the faces in a row of arches over one thing at a time.
    const body: Box = { x: 0, y: room.y + ARCH_ROW + 10, w: size.w, h: Math.max(0, room.h - ARCH_ROW - 10) };
    return { frames: [body, ...(f.frames > 1 ? [body] : [])], turns: f.frames > 1, people: { x: 8, y: room.y + 2, w: size.w - 16, h: ARCH_ROW }, mode: 'arches', rooms: null };
  }
  if (f.rooms && room.w >= ROOMS_BESIDE) {
    // The rooms keep the stage, at its right where the people would be, and what's open stands beside them.
    const w = roomsWidth(room.w);
    const body: Box = { x: room.x, y: room.y, w: room.w - w - GAP, h: room.h };
    return { ...many(body), people: null, mode: 'hidden', rooms: { x: room.x + body.w + GAP, y: room.y, w, h: room.h } };
  }
  if (f.people === 'hidden') return { ...many(room), people: null, mode: 'hidden', rooms: null };
  if (f.people === 'arches' || room.w < ARCHES_UNDER) {
    const body: Box = { x: room.x, y: room.y + ARCH_ROW + 10, w: room.w, h: Math.max(0, room.h - ARCH_ROW - 10) };
    return { ...many(body), people: { x: room.x, y: room.y, w: room.w, h: ARCH_ROW }, mode: 'arches', rooms: null };
  }
  const col = columnWidth(room.w);
  const body: Box = { x: room.x, y: room.y, w: room.w - col - GAP, h: room.h };
  return { ...many(body), people: { x: room.x + body.w + GAP, y: room.y, w: col, h: room.h }, mode: 'tiles', rooms: null };
}

/** Focus: the room it has in the call's area. The bars have tucked away, so it reaches past it. */
export const focusRoom = (size: Size, h: Horizon): Box => ({
  x: FOCUS_EDGE - h.left, y: FOCUS_EDGE - h.top, w: size.w + 2 * (h.left - FOCUS_EDGE), h: h.base + 10 - FOCUS_DOCK + h.top - FOCUS_EDGE
});

/* ---------- the people ---------- */

export interface TileItem { id: string; thing: boolean }
export type TileMode = 'tile' | 'arch' | 'horizon';
export interface TileSpot { box: Box; mode: TileMode }
export interface PeoplePlaced {
  spots: Map<string, TileSpot>;
  /** Who there's no room for: kept in place, out of sight, so nothing remounts. */
  off: Set<string>;
  /** Stands in for them: how many there are, and where it goes. */
  more: (TileSpot & { n: number }) | null;
}
export interface Horizon {
  /** Where the dock starts and ends, in the call's area: the horizon stops short of it. */
  dock: number;
  dockEnd: number;
  /** The ground they stand on. */
  base: number;
  /** How far the call's area is from the top and the left of the window. */
  top: number;
  left: number;
}
const TILE_GAP = 10;
/** The smallest a tile gets before the rest wait behind a count. */
const TILE_MIN = { w: 88, h: 48 };
const sum = (v: number[]) => v.reduce((s, x) => s + x, 0);

/** The first `n`, with anyone in `loud` (talking, or with a hand up) taking the place of the last who isn't. */
function keepLoud(items: TileItem[], n: number, loud: ReadonlySet<string>): TileItem[] {
  const kept = items.slice(0, n);
  for (const it of items.slice(n)) {
    if (!loud.has(it.id)) continue;
    const at = kept.findLastIndex((k) => !loud.has(k.id));
    if (at < 0) break;
    kept[at] = it;
  }
  return kept;
}
function result(items: TileItem[], kept: TileItem[], at: (it: TileItem, i: number) => TileSpot, chip: TileSpot | null, nowhere?: TileSpot): PeoplePlaced {
  const spots = new Map(kept.map((it, i) => [it.id, at(it, i)]));
  const off = new Set(items.filter((it) => !spots.has(it.id)).map((it) => it.id));
  const [first] = kept;
  const under = chip ?? (first ? at(first, 0) : nowhere);
  if (under) for (const id of off) spots.set(id, under);
  return { spots, off, more: chip && off.size ? { ...chip, n: off.size } : null };
}

/** On the horizon: small arches stand in the empty space beside the dock, and whoever's talking rises (Stage.tsx). */
function onHorizon(items: TileItem[], h: Horizon, loud: ReadonlySet<string>): PeoplePlaced {
  const size = (it: TileItem) => (it.thing ? { w: 54, h: 34 } : { w: 34, h: 38 });
  const room = h.dock - 8;
  /** Where a row of them ends. */
  const end = (list: TileItem[]) => 2 + sum(list.map((it) => size(it).w + 6)) - 6;
  let n = items.length;
  while (n > 1 && end(items.slice(0, n)) + (n < items.length ? 40 : 0) > room) n--;
  const kept = keepLoud(items, n, loud);
  // With room for one, it's whoever's talking, with nothing else beside them. With none, nobody: the dock comes first.
  while (kept.length && end(kept) > room) kept.pop();
  let x = 2;
  const xs = kept.map((it) => { const at = x; x += size(it).w + 6; return at; });
  const chip: TileSpot | null = kept.length < items.length && x + 34 <= room ? { box: { x, y: h.base - 38, w: 34, h: 38 }, mode: 'horizon' } : null;
  return result(items, kept, (it, i) => { const s = size(it); return { box: { x: xs[i] ?? 0, y: h.base - s.h, w: s.w, h: s.h }, mode: 'horizon' }; }, chip, { box: { x: 2, y: h.base - 38, w: 34, h: 38 }, mode: 'horizon' });
}

function inArches(r: Box, items: TileItem[], loud: ReadonlySet<string>, small: boolean): PeoplePlaced {
  const [aw, ah] = small ? [58, 64] : [74, 82];
  const tall = r.h >= r.w;
  const space = tall ? r.h : r.w;
  const size = tall ? ah : aw;
  const pitch = small ? 70 : tall ? 92 : 84;
  // Arches never overlap: as many as fit, then the count. With room for one, it's whoever's talking.
  const fit = Math.max(1, Math.floor((space + pitch - size) / pitch));
  const n = items.length > fit ? Math.max(1, fit - 1) : items.length;
  const at = (i: number): Box => ({ x: tall ? r.x + (r.w - aw) / 2 : r.x + i * pitch, y: tall ? r.y + i * pitch : r.y + (r.h - ah) / 2, w: aw, h: ah });
  return result(items, keepLoud(items, n, loud), (_, i) => ({ box: at(i), mode: 'arch' }), n < items.length && fit > 1 ? { box: at(n), mode: 'arch' } : null);
}

/** A column of tiles beside what's open: one under another, as tall as a tile that wide can be, as many as fit. */
function inColumn(r: Box, items: TileItem[], loud: ReadonlySet<string>): PeoplePlaced {
  const most = Math.max(1, Math.floor((r.h + TILE_GAP) / (TILE_MIN.h + TILE_GAP)));
  const over = items.length > most;
  const kept = keepLoud(items, over ? Math.max(1, most - 1) : items.length, loud);
  const chip = over && most > 1;
  const n = kept.length + (chip ? 1 : 0);
  const th = Math.min(r.w * 0.74, (r.h - TILE_GAP * (n - 1)) / Math.max(1, n));
  const at = (i: number): Box => ({ x: r.x, y: r.y + i * (th + TILE_GAP), w: r.w, h: th });
  return result(items, kept, (_, i) => ({ box: at(i), mode: 'tile' }), chip ? { box: at(kept.length), mode: 'tile' } : null);
}

/**
 * Where the people go beside what's open: a column of tiles, arches in a row (`small` on a phone), or on the horizon when they
 * have no place. What's presented and isn't on your stage sits first among them. Whoever's talking or has a hand up (`loud`)
 * always has a place, however many are here.
 */
export function placePeople(r: Box | null, items: TileItem[], mode: PeopleMode, h: Horizon, loud: ReadonlySet<string>, small = false): PeoplePlaced {
  if (!items.length) return { spots: new Map(), off: new Set(), more: null };
  if (mode === 'hidden' || !r) return onHorizon(items, h, loud);
  return mode === 'arches' || r.w <= 112 || r.h <= 100 ? inArches(r, items, loud, small) : inColumn(r, items, loud);
}
