/*
 * Where things are on a board, in board units. The numbers are the design canvas's, so a board frames the
 * way the canvas does.
 */
import { STICKY_COLOURS, hasBox, type BoardObject, type BoardView, type Box, type FrameObject, type InkObject, type PlacedObject, type StickyColour } from './shape';

export interface Camera {
  x: number;
  y: number;
  z: number;
}

/** Room to leave round what a camera shows: left, right, top and bottom. */
export interface Pad {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** How near a stroke counts as on it. */
const STROKE_REACH = 8;
/** The closest a camera gets to zero: `fit` rounds to this step, and nothing can zoom back from zero. */
const LEAST_ZOOM = 0.001;

export const contains = (b: Box, x: number, y: number): boolean => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
export const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const holds = (outer: Box, inner: Box): boolean => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** The box round all of these. Nothing at all has an empty box at the origin. */
export function bounds(boxes: readonly Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Top to bottom, then left to right, with ids settling a tie so that every browser agrees. */
export function reading<T extends PlacedObject>(objects: readonly T[]): T[] {
  return [...objects].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Objects by the frame they're in, each group in reading order. Those in no frame are under `''`. */
export function byFrame<T extends PlacedObject>(objects: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const o of reading(objects)) {
    const group = groups.get(o.f);
    if (group) group.push(o);
    else groups.set(o.f, [o]);
  }
  return groups;
}

/** The frame on top at a point. */
export function frameAt(view: BoardView, x: number, y: number): FrameObject | null {
  return view.frames.findLast((f) => contains(f, x, y)) ?? null;
}

/**
 * The colour a new sticky takes: the frame's, or for a frame with none its first sticky's. With neither, it's
 * `fallback`, the colour picked on the tool.
 */
export function colourIn(view: BoardView, frame: FrameObject | null, fallback: StickyColour = STICKY_COLOURS[0]): StickyColour {
  if (!frame) return fallback;
  if (frame.c) return frame.c;
  for (const o of view.objects) if (o.k === 'note' && o.f === frame.id) return o.c;
  return fallback;
}

/** The camera that shows a box inside a sheet of W by H, clear of the bar, the rail and the dock. */
export function fit(b: Box, W: number, H: number, pad?: Pad): Camera {
  const p = pad ?? { l: 36, r: 36, t: 94, b: 30 };
  const zoom = Math.round(Math.min((W - p.l - p.r) / b.w, (H - p.t - p.b) / b.h, 1.15) * 1000) / 1000;
  const z = zoom > LEAST_ZOOM ? zoom : LEAST_ZOOM;
  return { x: p.l + (W - p.l - p.r - b.w * z) / 2 - b.x * z, y: p.t + (H - p.t - p.b - b.h * z) / 2 - b.y * z, z };
}

/** Whether a point is near the stroke itself: a circle drawn round a sticky mustn't cover it. */
function onStroke(ink: InkObject, x: number, y: number): boolean {
  const px = x - ink.x, py = y - ink.y;
  let ax = ink.pts[0] ?? 0, ay = ink.pts[1] ?? 0;
  for (let i = 0; i < ink.pts.length; i += 2) {
    const bx = ink.pts[i] ?? ax, by = ink.pts[i + 1] ?? ay;
    const dx = bx - ax, dy = by - ay, long = dx * dx + dy * dy;
    const along = long ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / long)) : 0;
    if (Math.hypot(px - ax - along * dx, py - ay - along * dy) <= STROKE_REACH) return true;
    ax = bx;
    ay = by;
  }
  return false;
}

/**
 * What's on top at a point, as the canvas finds a line's target: neither frames, which `frameAt` finds and
 * which are only picked by their title, nor lines, which are picked by their own path.
 */
export function hit(view: BoardView, x: number, y: number): BoardObject | null {
  return view.objects.findLast((o) => hasBox(o) && o.k !== 'frame' && (o.k === 'ink' ? onStroke(o, x, y) : contains(o, x, y))) ?? null;
}

/** What a marquee picks: anything it touches, leaving out frames and lines as the canvas does. */
export function inside(view: BoardView, box: Box): BoardObject[] {
  return view.objects.filter((o) => hasBox(o) && o.k !== 'frame' && o.x < box.x + box.w && o.x + o.w > box.x && o.y < box.y + box.h && o.y + o.h > box.y);
}
