/*
 * The pen and the highlighter, and the eraser that takes away whole strokes. A stroke shows locally while it's drawn, smoothed as
 * it goes, and becomes one object when the pointer lifts. Most of what a pointer reports says nothing a line wouldn't, so the
 * points are simplified first: never more than a stroke can hold, and never so few that smoothing would pull it off the pen's
 * path. Points are kept close enough for that, and the path runs through their middles, as the canvas's does.
 */
import { BOARD_LIMITS, addObject, removeObjects, type InkColour, type InkObject } from '@alcove/board';
import type { SheetPoint } from '../camera';
import type { Gesture, ToolPress } from '../gestures';
import type { Board } from '../useBoard';

type Point = readonly [number, number];

/** How far apart points have to be, in screen pixels, to say anything. */
const FINEST = 1.5;
/** How far a stroke can stray from what was drawn, in screen pixels. */
const STRAY = 0.5;
/** How far apart kept points can get, in screen pixels. Smoothing rounds a corner by half this along each side of it. */
const LONGEST = 16;
/** How near a stroke the eraser touches it, in screen pixels. */
const ERASER_REACH = 10;
/** What each pen draws in, as `Tools.html` has them. */
const INK: Record<InkObject['tool'], InkColour> = { pen: 'horizon', marker: 'sun' };

/**
 * A stroke's points as a path, smoothed through the middle of each pair. It ends on the last point, so two points draw a line.
 * A stroke on the board keeps its points as fractions of its box, so they're scaled by `w` and `h`; one being drawn keeps them on
 * the board, at 1.
 */
export function inkPath(pts: readonly number[], x: number, y: number, w = 1, h = 1): string {
  const at = (i: number): number => (i % 2 ? y + (pts[i] ?? 0) * h : x + (pts[i] ?? 0) * w);
  const last = pts.length - 2;
  let d = `M${at(0)} ${at(1)}`;
  for (let i = 2; i < last; i += 2) d += `Q${at(i)} ${at(i + 1)} ${(at(i) + at(i + 2)) / 2} ${(at(i + 1) + at(i + 3)) / 2}`;
  return last > 0 ? `${d}L${at(last)} ${at(last + 1)}` : d;
}

const paths = new WeakMap<InkObject, string>();

/** A stroke as a path. Worked out once for each version of the stroke, which can hold 2000 points. */
export function strokePath(o: InkObject): string {
  const known = paths.get(o);
  if (known !== undefined) return known;
  const d = inkPath(o.pts, o.x, o.y, o.w, o.h);
  paths.set(o, d);
  return d;
}

/** How far a point is from the segment between two others. */
function away([px, py]: Point, [ax, ay]: Point, [bx, by]: Point): number {
  const dx = bx - ax, dy = by - ay, long = dx * dx + dy * dy;
  const along = long ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / long)) : 0;
  return Math.hypot(px - ax - along * dx, py - ay - along * dy);
}

/** Drops whatever doesn't change the stroke by more than `stray`, keeping points no more than `longest` apart. */
function simplified(points: readonly Point[], stray: number, longest: number): Point[] {
  const kept = new Set([0, points.length - 1]);
  const spans: [number, number][] = [[0, points.length - 1]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [a, b] = span, from = points[a], to = points[b];
    if (!from || !to || b - a < 2) continue;
    let far = 0, split = 0;
    points.slice(a + 1, b).forEach((p, i) => {
      const d = away(p, from, to);
      if (d > far) [far, split] = [d, a + 1 + i];
    });
    if (far <= stray) split = Math.hypot(to[0] - from[0], to[1] - from[1]) > longest ? Math.floor((a + b) / 2) : 0;
    if (!split) continue;
    kept.add(split);
    spans.push([a, split], [split, b]);
  }
  return points.filter((_, i) => kept.has(i));
}

/** The stroke at no more than `most` points, giving up detail only as far as that takes. */
function within(points: readonly Point[], most: number, z: number): Point[] {
  let stray = STRAY / z, longest = LONGEST / z, kept = simplified(points, stray, longest);
  while (kept.length > most) {
    stray *= 2;
    longest *= 2;
    kept = simplified(kept, stray, longest);
  }
  return kept;
}

const tenth = (n: number): number => Math.round(n * 10) / 10;
/** A point's place across its box, to a hundred-thousandth: less than a tenth of a unit across the widest box there is. */
const across = (n: number): number => Math.min(1, Math.max(0, Math.round(n * 100_000) / 100_000));

/**
 * Writes a stroke as one object. Its box holds it, and a straight stroke's sits round it, since no box is thinner than the board
 * allows. Its points are fractions of the box, so resizing it changes only its place.
 */
function addStroke(board: Board, points: readonly Point[], tool: InkObject['tool']): void {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys), wide = Math.max(...xs) - left, tall = Math.max(...ys) - top;
  const w = Math.max(wide, BOARD_LIMITS.minSide), h = Math.max(tall, BOARD_LIMITS.minSide);
  const x = tenth(left - (w - wide) / 2), y = tenth(top - (h - tall) / 2);
  const pts = points.flatMap(([px, py]) => [across((px - x) / w), across((py - y) / h)]);
  const id = board.write(() => addObject(board.doc, { k: 'ink', x, y, w, h, tool, c: INK[tool], pts }, board.origin));
  if (!id) board.refuse();
}

/** Every position an event stands for: browsers report a frame's worth of a fast pen as one event. */
function positions(board: Board, e: PointerEvent): SheetPoint[] {
  const all = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  return (all.length ? all : [e]).map((c) => board.camera.point(c));
}

function strokeGesture(board: Board, start: SheetPoint, tool: InkObject['tool']): Gesture {
  const { z } = board.camera.getSnapshot();
  let points: Point[] = [[start.x, start.y]];
  let left = start.x, right = start.x, top = start.y, bottom = start.y, ended = false;
  const add = ({ x, y }: SheetPoint): void => {
    const last = points.at(-1);
    if (ended || (last && Math.hypot(x - last[0], y - last[1]) < FINEST / z)) return;
    // Nothing on a board is bigger than this, so a stroke that gets there ends there.
    ended = Math.max(right, x) - Math.min(left, x) > BOARD_LIMITS.maxSide || Math.max(bottom, y) - Math.min(top, y) > BOARD_LIMITS.maxSide;
    if (ended) return;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
    points.push([x, y]);
    // Half, so a stroke that never ends isn't simplified on every point from here on.
    if (points.length >= BOARD_LIMITS.points) points = within(points, BOARD_LIMITS.points / 2, z);
  };
  const stop = (): void => board.set({ draft: null });
  return {
    trace(e) {
      for (const at of positions(board, e)) add(at);
    },
    move() {
      if (points.length > 1) board.set({ draft: { kind: 'ink', d: inkPath(points.flat(), 0, 0), colour: INK[tool], marker: tool === 'marker' } });
    },
    up(at) {
      add(at);
      if (points.length > 1) addStroke(board, within(points, BOARD_LIMITS.points, z), tool);
      stop();
    },
    cancel: stop
  };
}

/** Whether a point is within `reach` of a stroke. */
function touches(o: InkObject, p: Point, reach: number): boolean {
  if (p[0] < o.x - reach || p[0] > o.x + o.w + reach || p[1] < o.y - reach || p[1] > o.y + o.h + reach) return false;
  const point = (i: number): Point => [o.x + (o.pts[i] ?? 0) * o.w, o.y + (o.pts[i + 1] ?? 0) * o.h];
  if (o.pts.length < 4) return away(p, point(0), point(0)) <= reach;
  for (let i = 0; i + 3 < o.pts.length; i += 2) if (away(p, point(i), point(i + 2)) <= reach) return true;
  return false;
}

/** Takes away every stroke the pointer passes over, one undo for the whole sweep. It looks along the way, so a fast sweep misses nothing. */
function eraseGesture(board: Board, start: SheetPoint): Gesture {
  const reach = ERASER_REACH / board.camera.getSnapshot().z;
  let last: Point = [start.x, start.y], erased = false;
  const sweep = (to: Point): void => {
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - last[0], to[1] - last[1]) / reach));
    const passed = Array.from({ length: steps + 1 }, (_, i): Point => [last[0] + (to[0] - last[0]) * i / steps, last[1] + (to[1] - last[1]) * i / steps]);
    last = to;
    const gone = board.getSnapshot().view.objects.flatMap((o) => (o.k === 'ink' && passed.some((p) => touches(o, p, reach)) ? [o.id] : []));
    if (!gone.length) return;
    if (!erased) board.beginStep();
    erased = true;
    removeObjects(board.doc, gone, board.origin);
    board.read();
  };
  const stop = (): void => { if (erased) board.endStep(); };
  sweep(last);
  return {
    trace(e) {
      for (const { x, y } of positions(board, e)) sweep([x, y]);
    },
    move: () => undefined,
    up({ x, y }) {
      sweep([x, y]);
      stop();
    },
    cancel: stop
  };
}

export const penPress: ToolPress = (board, { at }) => {
  const { pen } = board.getSnapshot();
  return pen === 'eraser' ? eraseGesture(board, at) : strokeGesture(board, at, pen);
};
