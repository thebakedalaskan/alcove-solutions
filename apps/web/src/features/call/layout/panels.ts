/*
 * How the call's area is shared once something is open on your stage: a screen, a board or the workspace, each in its frame
 * (frame.tsx). With nothing open, the stage is the people's, left of your side (side.ts), and stageLayout.ts places them as it
 * always has. With something open, the frame takes the room and the people stand beside it, as the room left allows:
 *
 * - A column of tiles at the window's right edge, about 300, 248, 216 or 176 px wide as the window narrows. Your side (Notes,
 *   Chat, People) opens between what's open and the people: what's open makes room for it, and the people never move for it.
 * - Made smaller (⇧P, or the seam beside them), a rail of arches one arch wide in the same place.
 * - A row of arches over the frame, where the stage is under 760 px, and on a phone: already as small as they get.
 * - In focus, what's open fills your window and the people keep a rail at its right.
 *
 * The column and the rail stand level with what's open, in the middle of their edge. Left of them is the seam (PeopleSeam.tsx):
 * the gap beside them, with a faint grip in its middle, which you click or drag to make the people smaller or bigger again.
 *
 * A second thing presented can sit beside the first (Show beside), as two screens do; when there isn't room for both they take
 * turns, and the top bar says which is showing.
 *
 * While breakout rooms are open, the organizer's stage shows the rooms (Stage.tsx), and what's open stands beside them, the
 * rooms in place of the people. Where there isn't room for both, on a phone and on a narrow stage, what's open goes over the
 * rooms until it's closed, with whoever's in your part of the call beside it as anyone else's are.
 *
 * Everything here is pure: the room and what's open in, rectangles out.
 */
import type { CallPeopleMode } from '@alcove/api';
import type { Box } from './stageLayout';

/** How the people stand beside what's open: a column of tiles, or arches (a rail at the window's edge, or a row over it). */
export type PeopleMode = 'tiles' | 'arches';
export interface Size { w: number; h: number }

/** Under this wide, a window is a phone: what's open fills the screen under a row of arches, and your side is a sheet over the call. */
export const PHONE_W = 600;
/** The gap between the frame and your side, and between them and the people. */
export const GAP = 12;
/** Under this wide, the stage has no room for a column of people beside what's open: they're a row of arches over it. */
const ARCHES_UNDER = 760;
/** The row of arches over the frame: its height, and the room under it. */
const ARCH_ROW = 64;
/** Focus: how far it stands from the window's edges, and how much is left at the bottom for the dock. */
const FOCUS_EDGE = 16;
const FOCUS_DOCK = 92;
/** Two frames side by side need this much across, or they're one over the other; with room for neither, they take turns. */
const BESIDE_W = 900;
const STACKED_H = 620;
/** The rooms stand beside what's open only on a stage this wide: under it, what's open goes over them. */
const ROOMS_BESIDE = 880;
/** The people made smaller, and in focus: a rail of arches, one arch wide. */
export const RAIL = 74;
/** The seam takes in this much either side of the gap, so it's easy to point at. */
const SEAM_REACH = 3;

/** The people's column beside what's open, by how wide the stage is. */
export const columnWidth = (w: number) => (w >= 1500 ? 300 : w >= 1300 ? 248 : w >= 980 ? 216 : 176);
/** The rooms beside what's open: a little over a third of the stage, enough for every room to say who's in it. */
const roomsWidth = (w: number) => Math.round(Math.min(560, Math.max(340, w * 0.38)));

/** The people's strip at the window's right edge: where it starts, and how wide it is. */
export interface Edge { x: number; w: number }

/**
 * Where the people stand beside what's open: their strip at the window's right edge, past your side, a column or, made smaller,
 * a rail. `area` is the call's whole width and `side` what your side takes beside the stage, its gap included (nothing while
 * it's closed, or over the stage). Null where they stand anywhere else: with nothing open, on a phone, in focus, on a narrow
 * stage, and beside the organizer's rooms.
 */
export function peopleEdge(area: number, f: { frames: number; phone: boolean; focus: boolean; rooms: boolean; small: boolean; side: number }): Edge | null {
  const beside = area - f.side;
  if (f.frames === 0 || f.phone || f.focus || beside < ARCHES_UNDER || (f.rooms && beside >= ROOMS_BESIDE)) return null;
  const w = f.small ? RAIL : columnWidth(beside);
  return { x: area - w, w };
}

export interface MainFacts {
  /** How many things are on your stage: none, one, or two (Show beside). */
  frames: number;
  /** Whether you made the people beside what's open smaller (⇧P): a rail is stored as `hidden`. */
  people: CallPeopleMode;
  phone: boolean;
  /** Focus: the frame fills your window, past the bars that tuck away. */
  focus: Box | null;
  /** The organizer's stage shows every breakout room: what's open stands beside them, where there's room. */
  rooms: boolean;
  /** Room kept at the top for the status bar while it says anything, and at the bottom for captions. */
  top: number;
  bottom: number;
  /** Where the people stand at the window's right edge (`peopleEdge`), or null where they don't. */
  edge: Edge | null;
}
export interface MainPlaced {
  /** Where each thing on your stage goes, in order: none with nothing open. */
  frames: Box[];
  /** Where the people go beside it: a column, a rail or a row. Null with nothing open (the stage is theirs), and beside the organizer's rooms. */
  people: Box | null;
  /** How the people stand beside what's open. */
  mode: PeopleMode;
  /** Two things are open and there isn't room for both: they take turns, one frame at a time. */
  turns: boolean;
  /**
   * Where the organizer's rooms go: the whole stage with nothing open, or beside what's open. Null with no rooms to show, and
   * where what's open goes over them.
   */
  rooms: Box | null;
  /** The seam left of the people at the window's edge, their one control (PeopleSeam.tsx). Null wherever they stand otherwise. */
  seam: Box | null;
}

const NOTHING: MainPlaced = { frames: [], people: null, mode: 'tiles', turns: false, rooms: null, seam: null };

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

/** Where the frames and the people go. `size` is the main area, left of your side and of the people at the window's edge. */
export function placeMain(size: Size, f: MainFacts): MainPlaced {
  if (size.w <= 0) return NOTHING;
  if (f.frames === 0) return f.rooms ? { ...NOTHING, rooms: { x: 0, y: 0, w: size.w, h: size.h } } : NOTHING;
  const many = (r: Box): Pick<MainPlaced, 'frames' | 'turns'> => (f.frames > 1 ? two(r) : { frames: [r], turns: false });
  if (f.focus) {
    // Focus: what's open fills your window, and the people keep a rail of arches at its right.
    const body: Box = { ...f.focus, w: Math.max(0, f.focus.w - RAIL - GAP) };
    return { ...many(body), people: { x: body.x + body.w + GAP, y: f.focus.y, w: RAIL, h: f.focus.h }, mode: 'arches', rooms: null, seam: null };
  }
  const room: Box = { x: 0, y: f.top, w: size.w, h: Math.max(0, size.h - f.top - f.bottom) };
  if (f.phone) {
    // A phone: the faces in a row of arches over one thing at a time.
    const body: Box = { x: 0, y: room.y + ARCH_ROW + 10, w: size.w, h: Math.max(0, room.h - ARCH_ROW - 10) };
    return { frames: [body, ...(f.frames > 1 ? [body] : [])], turns: f.frames > 1, people: { x: 8, y: room.y + 2, w: size.w - 16, h: ARCH_ROW }, mode: 'arches', rooms: null, seam: null };
  }
  if (f.rooms && room.w >= ROOMS_BESIDE) {
    // The rooms keep the stage, at its right where the people would be, and what's open stands beside them.
    const w = roomsWidth(room.w);
    const body: Box = { x: room.x, y: room.y, w: room.w - w - GAP, h: room.h };
    return { ...many(body), people: null, mode: 'tiles', rooms: { x: room.x + body.w + GAP, y: room.y, w, h: room.h }, seam: null };
  }
  if (f.edge) {
    // At the window's right edge, past your side, level with what's open: a column of tiles, or made smaller a rail of
    // arches in the same place. The seam is the gap left of them.
    const e = f.edge;
    const seam: Box = { x: e.x - GAP - SEAM_REACH, y: room.y, w: GAP + 2 * SEAM_REACH, h: room.h };
    return { ...many(room), people: { x: e.x, y: room.y, w: e.w, h: room.h }, mode: f.people === 'hidden' ? 'arches' : 'tiles', rooms: null, seam };
  }
  // A narrow stage: a row of arches over what's open, already as small as the people get.
  const body: Box = { x: room.x, y: room.y + ARCH_ROW + 10, w: room.w, h: Math.max(0, room.h - ARCH_ROW - 10) };
  return { ...many(body), people: { x: room.x, y: room.y, w: room.w, h: ARCH_ROW }, mode: 'arches', rooms: null, seam: null };
}

/** Where the call's area sits in the window, and the line just under the dock: what focus reaches past the bars to. */
export interface FocusBounds { top: number; left: number; base: number }

/** Focus: the room it has in the call's area. The bars have tucked away, so it reaches past it. */
export const focusRoom = (size: Size, b: FocusBounds): Box => ({
  x: FOCUS_EDGE - b.left, y: FOCUS_EDGE - b.top, w: size.w + 2 * (b.left - FOCUS_EDGE), h: b.base + 10 - FOCUS_DOCK + b.top - FOCUS_EDGE
});

/* ---------- the people ---------- */

export interface TileItem { id: string; thing: boolean }
export type TileMode = 'tile' | 'arch';
export interface TileSpot { box: Box; mode: TileMode }
export interface PeoplePlaced {
  spots: Map<string, TileSpot>;
  /** Who there's no room for: kept in place, out of sight, so nothing remounts. */
  off: Set<string>;
  /** Stands in for them: how many there are, and where it goes. */
  more: (TileSpot & { n: number }) | null;
}
const TILE_GAP = 10;
/** The smallest a tile gets before the rest wait behind a count. */
const TILE_MIN = { w: 88, h: 48 };

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
function result(items: TileItem[], kept: TileItem[], at: (it: TileItem, i: number) => TileSpot, chip: TileSpot | null): PeoplePlaced {
  const spots = new Map(kept.map((it, i) => [it.id, at(it, i)]));
  const off = new Set(items.filter((it) => !spots.has(it.id)).map((it) => it.id));
  const [first] = kept;
  const under = chip ?? (first ? at(first, 0) : null);
  if (under) for (const id of off) spots.set(id, under);
  return { spots, off, more: chip && off.size ? { ...chip, n: off.size } : null };
}

/** Arches: a rail standing in the middle of its edge, beside the seam's grip, or a row over what's open from its left. */
function inArches(r: Box, items: TileItem[], loud: ReadonlySet<string>, small: boolean): PeoplePlaced {
  const [aw, ah] = small ? [58, 64] : [74, 82];
  const tall = r.h >= r.w;
  const space = tall ? r.h : r.w;
  const size = tall ? ah : aw;
  const pitch = small ? 70 : tall ? 92 : 84;
  // Arches never overlap: as many as fit, then the count. With room for one, it's whoever's talking.
  const fit = Math.max(1, Math.floor((space + pitch - size) / pitch));
  const n = items.length > fit ? Math.max(1, fit - 1) : items.length;
  const chip = n < items.length && fit > 1;
  const lift = tall ? Math.max(0, (r.h - ((n + (chip ? 1 : 0) - 1) * pitch + ah)) / 2) : 0;
  const at = (i: number): Box => ({ x: tall ? r.x + (r.w - aw) / 2 : r.x + i * pitch, y: tall ? r.y + lift + i * pitch : r.y + (r.h - ah) / 2, w: aw, h: ah });
  return result(items, keepLoud(items, n, loud), (_, i) => ({ box: at(i), mode: 'arch' }), chip ? { box: at(n), mode: 'arch' } : null);
}

/** A column of tiles in the middle of its edge: one under another, as tall as a tile that wide can be, as many as fit. */
function inColumn(r: Box, items: TileItem[], loud: ReadonlySet<string>): PeoplePlaced {
  const most = Math.max(1, Math.floor((r.h + TILE_GAP) / (TILE_MIN.h + TILE_GAP)));
  const over = items.length > most;
  const kept = keepLoud(items, over ? Math.max(1, most - 1) : items.length, loud);
  const chip = over && most > 1;
  const n = kept.length + (chip ? 1 : 0);
  const th = Math.min(r.w * 0.74, (r.h - TILE_GAP * (n - 1)) / Math.max(1, n));
  const lift = Math.max(0, (r.h - (n * th + (n - 1) * TILE_GAP)) / 2);
  const at = (i: number): Box => ({ x: r.x, y: r.y + lift + i * (th + TILE_GAP), w: r.w, h: th });
  return result(items, kept, (_, i) => ({ box: at(i), mode: 'tile' }), chip ? { box: at(kept.length), mode: 'tile' } : null);
}

/**
 * Where the people go beside what's open: a column of tiles, or arches, in a rail or a row (`small` on a phone). What's
 * presented and isn't on your stage sits first among them. Whoever's talking or has a hand up (`loud`) always has a place,
 * however many are here. With nowhere to stand, which never happens beside what's open, nobody is placed.
 */
export function placePeople(r: Box | null, items: TileItem[], mode: PeopleMode, loud: ReadonlySet<string>, small = false): PeoplePlaced {
  if (!items.length || !r) return { spots: new Map(), off: new Set(), more: null };
  return mode === 'arches' || r.w <= 112 || r.h <= 100 ? inArches(r, items, loud, small) : inColumn(r, items, loud);
}
