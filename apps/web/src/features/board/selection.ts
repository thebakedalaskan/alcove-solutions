/*
 * What's selected and what follows from it: what a press picks, what travels with it, the ring round it and what a move
 * lines up with. Plain arithmetic on a `BoardView` in board units, with the canvas's numbers.
 */
import { bounds, contains, hasBox, inside, isAttached, type BoardObject, type BoardView, type Box, type Camera, type LineEnd, type LineObject, type Move, type PlacedObject } from '@alcove/board';

/** A line something has been lined up with, in board units. `axis` is the axis it marks a place on. */
export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

export const NO_GUIDES: readonly Guide[] = [];

/** Past this many objects, only those near the view are mounted. */
export const MOUNT_ALL = 500;
/** What floats over the sheet. It has its own controls, so the board leaves a press on it alone. */
export const OVER_THE_SHEET = '.bi, .bx, .bx-sw, .bfly, .bp, .bd-head, .bd-pill, .bd-heard, .bd-tray, .bo-edit';
/** How far a press can wander, in screen pixels, and still be a click. */
export const CLICK_SLOP = 3;

export const sameIds = (a: readonly string[], b: readonly string[]): boolean => a === b || (a.length === b.length && a.every((id, i) => id === b[i]));

/** What a press on an object leaves selected. Shift adds it or takes it away; pressing something already picked keeps the group, to move it. */
export function pressed(sel: readonly string[], id: string, shift: boolean): readonly string[] {
  if (shift) return sel.includes(id) ? sel.filter((other) => other !== id) : [...sel, id];
  return sel.includes(id) ? sel : [id];
}

/** The box dragged out between two points. */
export const boxBetween = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/** What a marquee or Select all picks. */
export const picks = (view: BoardView, box: Box): string[] => inside(view, box).map((o) => o.id);
export const everything = (view: BoardView): string[] => view.objects.flatMap((o) => (hasBox(o) && o.k !== 'frame' ? [o.id] : []));

/** What's selected that has a place of its own. */
export const placed = (view: BoardView, ids: readonly string[]): PlacedObject[] => ids.flatMap((id) => {
  const o = view.byId.get(id);
  return o && hasBox(o) ? [o] : [];
});

/** The free ends of a line, as boxes with no size. */
const freeEnds = (o: LineObject): Box[] => [o.from, o.to].flatMap((end) => (isAttached(end) ? [] : [{ x: end.x, y: end.y, w: 0, h: 0 }]));

/** The space everything on the board takes up, as boxes. A line takes up only what its free ends do: the rest of it runs between objects. */
export const drawn = (view: BoardView, ids?: Iterable<string>): Box[] => {
  const list = ids ? [...ids].flatMap((id) => view.byId.get(id) ?? []) : view.objects;
  return list.flatMap((o) => (hasBox(o) ? [o] : freeEnds(o)));
};

/** Where each thing selected would be moved from: an object's corner, or a line's first free end. A line attached at both ends goes where they go. */
export const movable = (view: BoardView, ids: readonly string[]): Move[] => ids.flatMap((id) => {
  const o = view.byId.get(id);
  if (!o) return [];
  if (hasBox(o)) return [{ id, x: o.x, y: o.y }];
  return freeEnds(o).slice(0, 1).map(({ x, y }) => ({ id, x, y }));
});

/** What travels with a selection: the selection, and everything inside any frames in it. */
export function carried(view: BoardView, ids: readonly string[]): Set<string> {
  const held = new Map<string, string[]>();
  for (const o of view.objects) {
    if (!o.f) continue;
    const list = held.get(o.f);
    if (list) list.push(o.id);
    else held.set(o.f, [o.id]);
  }
  const found = new Set(ids);
  const waiting = [...ids];
  for (let id = waiting.pop(); id !== undefined; id = waiting.pop()) {
    for (const inner of held.get(id) ?? []) {
      if (found.has(inner)) continue;
      found.add(inner);
      waiting.push(inner);
    }
  }
  return found;
}

/** The ring round what's selected, in screen pixels: its bounds, a little larger so the ring sits clear of the edge. */
export function selectionRing(boxes: readonly Box[], { x, y, z }: Camera): Box {
  const b = bounds(boxes);
  return { x: b.x * z + x - 3, y: b.y * z + y - 3, w: b.w * z + 6, h: b.h * z + 6 };
}

/** What a move can line up with: objects first and then frames, as the canvas looks, and nothing that's travelling. Past 500, only what's near. */
export function snapTargets(view: BoardView, near: Box | null, travelling: ReadonlySet<string>): PlacedObject[] {
  const reach = view.objects.length > MOUNT_ALL ? near : null;
  const targets = view.objects.filter(hasBox).filter((o) => !travelling.has(o.id) && o.k !== 'ink' && !(o.k === 'text' && o.size === 'heading') && (!reach || touches(o, reach)));
  return [...targets.filter((o) => o.k !== 'frame'), ...targets.filter((o) => o.k === 'frame')];
}

/** Where a move would like to be: how far to nudge it so an edge or a middle lines up, and the guides that show it. */
export function snapTo(b: Box, targets: readonly PlacedObject[], reach: number): { dx: number; dy: number; guides: readonly Guide[] } {
  const near = (at: number, was: number): { at: number; d: number } | null => (Math.abs(at - was) < reach ? { at, d: at - was } : null);
  let gx: { at: number; d: number } | null = null, gy: { at: number; d: number } | null = null;
  for (const o of targets) {
    gx ??= near(o.x, b.x) ?? near(o.x + o.w / 2, b.x + b.w / 2) ?? near(o.x + o.w, b.x + b.w) ?? near(o.x + o.w, b.x) ?? near(o.x, b.x + b.w);
    gy ??= near(o.y, b.y) ?? near(o.y + o.h / 2, b.y + b.h / 2) ?? near(o.y + o.h, b.y + b.h) ?? near(o.y + o.h, b.y) ?? near(o.y, b.y + b.h);
    if (gx && gy) break;
  }
  if (!gx && !gy) return { dx: 0, dy: 0, guides: NO_GUIDES };
  return {
    dx: gx?.d ?? 0, dy: gy?.d ?? 0,
    guides: [...(gx ? [{ axis: 'x' as const, at: gx.at }] : []), ...(gy ? [{ axis: 'y' as const, at: gy.at }] : [])]
  };
}

export const touches = (a: Box, b: Box): boolean => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The sheet and as much again on every side, in board units: enough that a fast pan finds what it reaches already mounted. */
export function reachOf(seen: Box): Box {
  const m = Math.max(seen.w, seen.h);
  return { x: seen.x - m, y: seen.y - m, w: seen.w + 2 * m, h: seen.h + 2 * m };
}

/** Whether what's mounted still does for this view: the view hasn't got near its edge, or zoomed in so far that much of it could go. */
export function reachHolds(near: Box, seen: Box): boolean {
  const m = Math.max(seen.w, seen.h) / 4;
  return contains(near, seen.x - m, seen.y - m) && contains(near, seen.x + seen.w + m, seen.y + seen.h + m) && near.w < reachOf(seen).w * 1.5;
}

/** Where a line's end is, or nothing if what it's attached to isn't on the board. */
export function endBox(view: BoardView, end: LineEnd): Box | null {
  if (!isAttached(end)) return { x: end.x, y: end.y, w: 0, h: 0 };
  const o = view.byId.get(end.on);
  return o && hasBox(o) ? o : null;
}

/** The space a line takes up, near enough to know whether it's in view. */
function lineBox(view: BoardView, o: LineObject): Box {
  return bounds([endBox(view, o.from), endBox(view, o.to)].flatMap((b) => (b ? [b] : [])));
}

/**
 * What to mount: everything, until a board passes 500 objects, and after that what's near and what's being typed in. What's
 * selected needn't be: moving it goes through the doc, and its ring comes from the view. Until the sheet has been measured
 * nothing is near, so a big board doesn't mount all of itself first.
 */
export function mounted(view: BoardView, near: Box | null, typing: string | null): readonly BoardObject[] {
  if (view.objects.length <= MOUNT_ALL) return view.objects;
  return view.objects.filter((o) => o.id === typing || (near !== null && touches(o.k === 'line' ? lineBox(view, o) : o, near)));
}
