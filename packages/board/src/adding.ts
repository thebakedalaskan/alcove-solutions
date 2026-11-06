/*
 * Stickies from outside the board, such as ideas from the call, and keeping apart what two people put on a board at the same
 * moment.
 *
 * A sticky from outside lands in the frame it fits, in the first free spot there, row by row as a frame's stickies are laid
 * out, and in the colour the frame gives its stickies. A full frame takes it in its middle, a little further along than
 * anything already there, and with no frame for it, it lands in a row in the middle of what the person sees. One made from
 * something else, such as an idea from the call, has an ID made from that (`stickyFrom`), the same in every browser: two
 * people adding it at once make one sticky, and one that's on the board already is left as it is.
 *
 * Each browser works out where things go from what it has heard, so two people adding at the same moment can pick the same
 * spot, and Tab on one idea in two browsers puts both branches in one place. Once they've heard each other, `apart` says what
 * to move: of two things exactly on one another, in the same frame with the same box, the one drawn on top (the later `at`,
 * then the later ID, as every browser draws them) goes to the next free spot. Each browser moves only what it put there
 * itself, so only one of the two moves. And something put in a frame just as someone's drag of that frame lands, the drag not
 * knowing of it, is left where the frame was: it goes into the frame as the frame is now.
 */
import type * as Y from 'yjs';
import { colourIn, freeNear, holds } from './geometry';
import { branchSpot } from './mindmap';
import { BOARD_LIMITS, hasBox, idFrom, newId, type BoardView, type Box, type FrameObject, type PlacedObject, type StickyColour } from './shape';
import { frameFor, insert, stack, viewOf, writing, type Move } from './write';

/** A sticky's side, as the board makes one, and the room round stickies in a frame, as the templates lay them out. */
const STICKY = 150;
const GAP = 20;
/** How far each sticky that finds a frame full sits from the one before, in its middle. */
const PILE = 14;

/** A sticky to put on the board: what it says, the frame it fits by its ID, if any, and what it's made from, if anything, by that thing's ID. */
export interface Landing { text: string; frame: string | null; from?: string | undefined }

/** The ID of the sticky made from something, such as an idea from the call, by that thing's ID: the same in every browser. */
export const stickyFrom = (from: string): string => idFrom('sticky', from);

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const sameBox = (a: Box, b: Box): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
const boxOf = (b: Box): Box => ({ x: b.x, y: b.y, w: b.w, h: b.h });

/** The first free spot for a sticky in a frame, row by row, or null when there's none. */
function freeIn(frame: Box, taken: readonly Box[]): Box | null {
  const cols = Math.max(1, Math.floor((frame.w - GAP) / (STICKY + GAP)));
  const rows = Math.max(1, Math.floor((frame.h - GAP) / (STICKY + GAP)));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const box = { x: frame.x + GAP + c * (STICKY + GAP), y: frame.y + GAP + r * (STICKY + GAP), w: STICKY, h: STICKY };
      if (!taken.some((t) => overlaps(t, box))) return box;
    }
  }
  return null;
}

/** Where a sticky goes in a full frame: its middle, each a little further along than the one before, exactly on nothing. */
function piled(frame: Box, taken: readonly Box[]): Box {
  const at = (n: number): Box => ({ x: Math.round(frame.x + frame.w / 2 - STICKY / 2 + n * PILE), y: Math.round(frame.y + frame.h / 2 - STICKY / 2 + n * PILE), w: STICKY, h: STICKY });
  // Each box taken is exactly on one of these at most, so one of the first `taken.length + 1` is free.
  for (let n = 0; n < taken.length; n++) if (!taken.some((t) => sameBox(t, at(n)))) return at(n);
  return at(taken.length);
}

/** The frame with this ID, if it's on the board. */
function frameOf(view: BoardView, id: string | null): FrameObject | null {
  const o = id ? view.byId.get(id) : undefined;
  return o?.k === 'frame' ? o : null;
}

/** Where a sticky lands, its colour, and the frame it's in, by its ID, or '' for none. */
export interface Spot { x: number; y: number; c: StickyColour; f: string }

/**
 * Where each sticky lands, in order. `middle` is the middle of what this person sees, for those with no frame to go in (one
 * that has gone since counts as none), and `colour` the one picked on the tool, for a sticky that isn't in a frame with its own.
 */
export function landings(view: BoardView, stickies: readonly Landing[], middle: { x: number; y: number }, colour: StickyColour): Spot[] {
  const taken = view.objects.filter(hasBox).filter((o) => o.k !== 'frame').map(boxOf);
  const loose = stickies.filter((s) => !frameOf(view, s.frame)).length;
  const row = loose * STICKY + Math.max(0, loose - 1) * GAP;
  let across = 0;
  return stickies.map((s) => {
    const frame = frameOf(view, s.frame);
    if (!frame) {
      const box = { x: Math.round(middle.x - row / 2 + across * (STICKY + GAP)), y: Math.round(middle.y - STICKY / 2), w: STICKY, h: STICKY };
      across += 1;
      taken.push(box);
      return { x: box.x, y: box.y, c: colour, f: frameFor({ k: 'note', ...box, c: colour, size: 'm', t: s.text }, view.frames) };
    }
    const box = freeIn(frame, taken) ?? piled(frame, taken);
    taken.push(box);
    return { x: box.x, y: box.y, c: colourIn(view, frame, colour), f: frame.id };
  });
}

/** What became of a sticky asked for: made now, on the board already as one made from the same thing, or left out of a full board. */
export type Added = 'made' | 'there' | 'full';
export interface AddedSticky { added: Added; id: string | null }

/**
 * Puts stickies from outside the board on it, in one transaction under `origin`, each where `landings` says: what became of
 * each, in order, with its ID while it's on the board.
 */
export function addStickies(doc: Y.Doc, stickies: readonly Landing[], middle: { x: number; y: number }, colour: StickyColour, origin: unknown): AddedSticky[] {
  return writing(doc, origin, stickies.map((): AddedSticky => ({ added: 'full', id: null })), (board) => {
    const view = viewOf(doc);
    const idOf = (s: Landing): string | null => (s.from === undefined ? null : stickyFrom(s.from));
    const there = stickies.map((s) => { const id = idOf(s); return id !== null && board.objects.has(id); });
    const spots = landings(view, stickies.filter((_, n) => !there[n]), middle, colour);
    const at = stack(view);
    let next = 0;
    return stickies.map((s, n): AddedSticky => {
      const id = idOf(s) ?? newId();
      if (there[n]) return { added: 'there', id };
      const spot = spots[next];
      next += 1;
      // Asked for twice in one go, the second is the first.
      if (board.objects.has(id)) return { added: 'there', id };
      if (!spot || board.objects.size >= BOARD_LIMITS.objects) return { added: 'full', id: null };
      const made = insert(board, { k: 'note', x: spot.x, y: spot.y, w: STICKY, h: STICKY, c: spot.c, size: 'm', t: s.text, id, at: at('note'), f: spot.f });
      return made ? { added: 'made', id: made.id } : { added: 'full', id: null };
    });
  });
}

/** Something a browser has just put on the board, as it put it there: its box and frame, and that frame's box then. */
export interface Put { id: string; box: Box; f: string; frame: Box | null }

/** Something on the board as it is now, to keep apart from what someone else puts there at the same moment; null if it isn't there or has no box. */
export function putOf(view: BoardView, id: string): Put | null {
  const o = view.byId.get(id);
  if (!o || !hasBox(o)) return null;
  const frame = frameOf(view, o.f);
  return { id, box: boxOf(o), f: o.f, frame: frame ? boxOf(frame) : null };
}

/** Whether something just put on the board is where it was put, in the same frame: nobody has moved it, or taken it away, since. */
export function stillPut(view: BoardView, put: Put): boolean {
  const o = view.byId.get(put.id);
  return o !== undefined && hasBox(o) && o.f === put.f && sameBox(o, put.box);
}

/** The next free spot for something moved off another, or into its frame as the frame is now. */
function spotFor(view: BoardView, o: PlacedObject, frame: FrameObject | null, taken: readonly Box[]): { x: number; y: number } {
  const from = o.k === 'node' && o.parent ? view.byId.get(o.parent) : undefined;
  if (o.k === 'node' && from?.k === 'node') return branchSpot(view, from, o.id);
  if (o.k === 'note' && frame) return freeIn(frame, taken) ?? piled(frame, taken);
  return freeNear({ ...view, objects: view.objects.filter((x) => x.id !== o.id) }, { x: o.x, y: o.y }, o.w, o.h);
}

/**
 * What to move of what this browser has just put on the board, and where, now that it has heard what everyone else did: each
 * that's still where it was put, and either has something else exactly on it (the same frame and box) that it's drawn over,
 * or has had its frame moved from under it. A branch goes under the other branches of the idea it comes from, a sticky into
 * the next free spot in its frame as the frame is now, and anything else to the nearest clear place.
 */
export function apart(view: BoardView, puts: readonly Put[]): Move[] {
  const order = new Map(view.objects.map((o, n) => [o.id, n]));
  const taken = new Map(view.objects.filter(hasBox).filter((o) => o.k !== 'frame').map((o) => [o.id, boxOf(o)]));
  const moves: Move[] = [];
  for (const put of puts) {
    const o = view.byId.get(put.id);
    if (!o || !hasBox(o) || !stillPut(view, put)) continue;
    const frame = frameOf(view, o.f);
    const left = frame !== null && put.frame !== null && !sameBox(frame, put.frame) && !holds(frame, o);
    const drawn = order.get(o.id) ?? 0;
    const over = view.objects.some((x) => x.id !== o.id && hasBox(x) && x.k !== 'frame' && x.f === o.f && sameBox(x, o) && (order.get(x.id) ?? 0) < drawn);
    if (!left && !over) continue;
    taken.delete(o.id);
    const to = spotFor(view, o, frame, [...taken.values()]);
    taken.set(o.id, { x: to.x, y: to.y, w: o.w, h: o.h });
    moves.push({ id: o.id, x: to.x, y: to.y });
  }
  return moves;
}
