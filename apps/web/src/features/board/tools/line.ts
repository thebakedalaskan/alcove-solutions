/*
 * Lines. One starts from a dot, the Line tool or the selection bar, follows the pointer as a draft, and is written once, when
 * it's let go. Where it runs is never stored: `lineRoute` works that out from its two ends each time it's drawn, so a line
 * finds a clean route when either end moves and nobody has to write it.
 *
 * A dot is the quick way to the next thing: let go in empty space and a sticky is there to type in. The Line tool draws a line,
 * so it can start and stop anywhere, and an end let go in empty space stays free.
 */
import { addObject, contains, freeRoute, hasBox, isAttached, route, sides, type BoardObject, type BoardView, type Box, type Camera, type LineEnd, type LineObject, type LineStyle, type PlacedObject, type Route } from '@alcove/board';
import type { BoardDot } from '@alcove/ui';
import type { SheetPoint } from '../camera';
import { STICKY } from '../editing';
import type { Gesture, ToolPress } from '../gestures';
import { CLICK_SLOP, OVER_THE_SHEET, endBox } from '../selection';
import type { Board } from '../useBoard';

/** How far off an edge a dot sits, in screen pixels, so it's easy to grab. */
const DOT_OFF = 18;
/** How near an object the pointer has to get, in screen pixels, for its dots to show. */
const HOVER_REACH = 30;
/** How far from what it left a line has to end, in board units, for a new sticky to be what's meant. */
const STICKY_REACH = 60;
/** How far a new sticky overlaps the end of the line it's made from, in board units. */
const STICKY_TUCK = 10;

/** A line's route. Its first end leads, as a line being drawn does. */
export function lineRoute(view: BoardView, o: LineObject): Route | null {
  const a = endBox(view, o.from), b = endBox(view, o.to);
  if (!a || !b) return null;
  return isAttached(o.from) && !isAttached(o.to) ? freeRoute(a, [o.to.x, o.to.y], o.style) : route(a, b, o.style);
}

/** The route of a line still being drawn, from its first end to the pointer. */
export function draftRoute(view: BoardView, from: LineEnd, [x, y]: [number, number], style: LineStyle): Route | null {
  const a = endBox(view, from);
  if (!a) return null;
  return isAttached(from) ? freeRoute(a, [x, y], style) : route(a, { x, y, w: 0, h: 0 }, style);
}

/** The dots round something, in screen pixels. */
export function dotsOn(b: Box, { x, y, z }: Camera): BoardDot[] {
  const left = b.x * z + x, top = b.y * z + y, w = b.w * z, h = b.h * z;
  return [
    { x: left + w + DOT_OFF, y: top + h / 2, dir: 'r' },
    { x: left - DOT_OFF, y: top + h / 2, dir: 'l' },
    { x: left + w / 2, y: top - DOT_OFF, dir: 't' },
    { x: left + w / 2, y: top + h + DOT_OFF, dir: 'b' }
  ];
}

/** What a line can join, and so what shows dots: a frame is space to work in, a stroke is a mark, and a heading is a label. */
const joinable = (o: BoardObject): o is PlacedObject => hasBox(o) && o.k !== 'frame' && o.k !== 'ink' && !(o.k === 'text' && o.size === 'heading');

/** The pointer has moved with nothing pressed: a line waiting for its end follows it, and whatever it's near shows its dots. */
export function hoverAt(board: Board, at: SheetPoint, target: EventTarget | null): void {
  const { tool, sel, view, lineFrom } = board.getSnapshot();
  if (lineFrom) {
    board.set({ draft: { kind: 'line', from: { on: lineFrom, side: 'r' }, to: [at.x, at.y] } });
    return;
  }
  if (!board.canEdit || tool !== 'select' || sel.length || (target instanceof Element && target.closest(OVER_THE_SHEET))) {
    board.hoverOn(null);
    return;
  }
  const pad = HOVER_REACH / board.camera.getSnapshot().z;
  const near = view.objects.findLast((o) => joinable(o) && at.x > o.x - pad && at.x < o.x + o.w + pad && at.y > o.y - pad && at.y < o.y + o.h + pad);
  board.hoverOn(near?.id ?? null);
}

/** Writes a line, and it's done: back to Select with nothing picked. */
function addLine(board: Board, from: LineEnd, to: LineEnd): void {
  const style = board.getSnapshot().line;
  const id = board.write(() => addObject(board.doc, { k: 'line', style, from, to }, board.origin));
  if (id) board.set({ tool: 'select', sel: [] });
  else board.refuse();
}

/** Where a sticky goes so that a line let go at `at` runs into its near edge. */
function stickyAt(a: Box, at: SheetPoint): { x: number; y: number } {
  const side = sides(a, { x: at.x, y: at.y, w: 0, h: 0 })[0];
  if (side === 'r') return { x: at.x - STICKY_TUCK, y: at.y - STICKY / 2 };
  if (side === 'l') return { x: at.x + STICKY_TUCK - STICKY, y: at.y - STICKY / 2 };
  return { x: at.x - STICKY / 2, y: side === 'b' ? at.y - STICKY_TUCK : at.y + STICKY_TUCK - STICKY };
}

/** A new sticky with a line running to it, as one undo with what's typed on it. Left blank, the sticky and the line both go. */
function newStickyFrom(board: Board, on: string, a: Box, at: SheetPoint): void {
  const o = board.getSnapshot().view.byId.get(on);
  const colour = o?.k === 'note' ? o.c : o?.k === 'shape' && o.c ? o.c : undefined;
  const { x, y } = stickyAt(a, at);
  const id = board.newSticky(x, y, colour);
  if (!id) return;
  const [from, to] = sides(a, { x, y, w: STICKY, h: STICKY });
  addObject(board.doc, { k: 'line', style: board.getSnapshot().line, from: { on, side: from }, to: { on: id, side: to } }, board.origin);
  board.read();
}

/** Ends a line where it was let go: on something it joins, or else as a dot's line or the Line tool's does. */
function finishLine(board: Board, from: LineEnd, start: SheetPoint, at: SheetPoint, fromDot: boolean): void {
  const { view } = board.getSnapshot();
  const a = endBox(view, from);
  if (!a) return;
  const on = isAttached(from) ? from.on : null;
  const target = view.objects.findLast((o): o is PlacedObject => joinable(o) && o.id !== on && contains(o, at.x, at.y));
  const fromEnd = (b: Box, i: 0 | 1): LineEnd => (on ? { on, side: sides(a, b)[i] } : from);
  if (target) {
    addLine(board, fromEnd(target, 0), { on: target.id, side: sides(a, target)[1] });
    return;
  }
  const away = { x: at.x, y: at.y, w: 0, h: 0 };
  if (on && contains(a, at.x, at.y)) return;
  if (!on && Math.hypot(at.x - start.x, at.y - start.y) < CLICK_SLOP / board.camera.getSnapshot().z) return;
  if (!fromDot) {
    addLine(board, fromEnd(away, 0), { x: at.x, y: at.y });
    return;
  }
  const dx = Math.max(a.x - at.x, 0, at.x - a.x - a.w), dy = Math.max(a.y - at.y, 0, at.y - a.y - a.h);
  if (on && Math.hypot(dx, dy) > STICKY_REACH) newStickyFrom(board, on, a, at);
}

function lineGesture(board: Board, from: LineEnd, start: SheetPoint, fromDot: boolean): Gesture {
  const show = ({ x, y }: SheetPoint): void => board.set({ draft: { kind: 'line', from, to: [x, y] } });
  const stop = (): void => board.set({ draft: null });
  show(start);
  return {
    move: show,
    up(at) {
      stop();
      finishLine(board, from, start, at, fromDot);
    },
    cancel: stop
  };
}

/** A press on a dot starts a line from what the dots are round. */
export const dotPress = (board: Board, at: SheetPoint, on: string): Gesture => lineGesture(board, { on, side: 'r' }, at, true);

/** With the Line tool, a press starts a line, or ends the one waiting for it. */
export const linePress: ToolPress = (board, { at, id }) => {
  const { view, lineFrom } = board.getSnapshot();
  if (lineFrom) {
    board.set({ lineFrom: null, draft: null });
    finishLine(board, { on: lineFrom, side: 'r' }, at, at, false);
    return null;
  }
  const o = id ? view.byId.get(id) : undefined;
  return lineGesture(board, o && joinable(o) ? { on: o.id, side: 'r' } : { x: at.x, y: at.y }, at, false);
};

/** Draw a line from this: the Line tool, with its first end already chosen. The next press ends it. */
export function lineFromHere(board: Board, id: string): void {
  board.pickTool('line');
  board.set({ lineFrom: id });
}
