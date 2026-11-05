/*
 * What a pointer does on the sheet. One set of listeners serves the whole board: objects take no handlers, and `data-id`
 * and `data-h` say what was pressed. A press becomes a `Gesture`, which lasts until the pointer lets go. Its moves are
 * batched to one a frame, so a drag writes to the doc at most once a frame, and everyone else sees it happen.
 *
 * The wheel: a pinch on a trackpad arrives as ctrl and a wheel, and ⌘ with a mouse wheel means the same, so both zoom.
 * Everything else, which is two fingers on a trackpad and a mouse wheel alone, moves the board. Safari reports a pinch as
 * gesture events of its own instead, and touch screens as two pointers.
 */
import { BOARD_LIMITS, bounds, hasBox, moveObjects, resizeObject, type PlacedObject } from '@alcove/board';
import type { BoardTool } from '@alcove/ui';
import type { SheetPoint } from './camera';
import { STICKY } from './editing';
import { keyDown, keyUp } from './keys';
import { CLICK_SLOP, NO_GUIDES, OVER_THE_SHEET, boxBetween, carried, drawn, movable, picks, pressed, snapTargets, snapTo } from './selection';
import { framePress, settleFrame } from './tools/frame';
import { dotPress, hoverAt, linePress } from './tools/line';
import { penPress } from './tools/pen';
import { shapePress } from './tools/shape';
import { textPress } from './tools/text';
import type { Board } from './useBoard';

/** What a press has started, until the pointer lets go. */
export interface Gesture {
  /** At most once a frame, with where the pointer is now. */
  move(at: SheetPoint, e: PointerEvent): void;
  /** Every move as it arrives, for what can't afford to miss one: a pen. */
  trace?(e: PointerEvent): void;
  up(at: SheetPoint, e: PointerEvent): void;
  /** The pointer was taken away: a second finger arrived, or the browser took over. What's done stays done. */
  cancel(): void;
}

export interface BoardPress {
  at: SheetPoint;
  /** What's under the pointer, if anything. A frame counts only by its title. */
  id: string | null;
  target: Element;
  e: PointerEvent;
}

/** What a press means with a tool picked, for any tool but Select. Null if it's over at once. */
export type ToolPress = (board: Board, press: BoardPress) => Gesture | null;

export const TOOL_PRESSES = new Map<BoardTool, ToolPress>([
  ['note', (board, { at }) => {
    board.newSticky(at.x - STICKY / 2, at.y - STICKY / 2);
    return null;
  }],
  ['text', textPress],
  ['shape', shapePress],
  ['line', linePress],
  ['pen', penPress],
  ['frame', framePress]
]);

/** The smallest a person can size something by hand. */
const LEAST_SIDE = 60;
/** How near an edge has to get, in screen pixels, for a move to line up with it. */
const SNAP_REACH = 6;
const WHEEL_ZOOM = 0.004;
const LINE_HEIGHT = 16;

/** The id under a press. A frame's body is for drawing a marquee in and catching stickies, so only its title picks it. */
function pressedId(board: Board, target: Element): string | null {
  const id = target.closest('[data-id]')?.getAttribute('data-id') ?? null;
  const o = id ? board.getSnapshot().view.byId.get(id) : undefined;
  return o?.k === 'frame' && !target.closest('.bf-h') ? null : id;
}

function panGesture(board: Board, start: SheetPoint): Gesture {
  const from = board.camera.getSnapshot();
  board.stopFollow();
  board.stopGlide();
  board.set({ panning: true });
  const stop = (): void => board.set({ panning: false });
  return {
    move: (at) => board.camera.set({ x: from.x + at.sx - start.sx, y: from.y + at.sy - start.sy, z: from.z }),
    up: stop,
    cancel: stop
  };
}

function marqueeGesture(board: Board, start: SheetPoint): Gesture {
  board.select([]);
  board.set({ marquee: boxBetween(start, start) });
  const stop = (): void => board.set({ marquee: null });
  return {
    move(at) {
      const marquee = boxBetween(start, at);
      board.select(picks(board.getSnapshot().view, marquee));
      board.set({ marquee });
    },
    up: stop,
    cancel: stop
  };
}

function moveGesture(board: Board, start: SheetPoint, id: string, shift: boolean): Gesture {
  board.select(pressed(board.getSnapshot().sel, id, shift));
  const { view, near, sel } = board.getSnapshot();
  const objects = movable(view, sel);
  const travelling = carried(view, sel);
  const box = bounds(drawn(view, travelling));
  const targets = snapTargets(view, near, travelling);
  let moved = false;
  const stop = (): void => {
    board.set({ guides: NO_GUIDES });
    if (moved) board.endStep();
  };
  return {
    move(at) {
      const { z } = board.camera.getSnapshot();
      const mx = at.x - start.x, my = at.y - start.y;
      if (!objects.length || (!moved && Math.abs(mx) + Math.abs(my) < CLICK_SLOP / z)) return;
      if (!moved) board.beginStep();
      moved = true;
      const { dx, dy, guides } = snapTo({ ...box, x: box.x + mx, y: box.y + my }, targets, SNAP_REACH / z);
      moveObjects(board.doc, objects.map((o) => ({ id: o.id, x: o.x + mx + dx, y: o.y + my + dy })), board.origin);
      board.read();
      if (guides !== board.getSnapshot().guides) board.set({ guides });
    },
    up(_at, e) {
      stop();
      // A press on one of several, without a drag, narrows the selection to it.
      if (!moved && !e.shiftKey && board.getSnapshot().sel.length > 1) board.select([id]);
    },
    cancel: stop
  };
}

function sizeGesture(board: Board, start: SheetPoint, o: PlacedObject, corner: string): Gesture {
  const side = (n: number): number => Math.min(BOARD_LIMITS.maxSide, Math.max(LEAST_SIDE, n));
  board.beginStep();
  const stop = (): void => {
    if (o.k === 'frame') settleFrame(board, o.id);
    board.endStep();
  };
  return {
    move(at) {
      const dx = at.x - start.x, dy = at.y - start.y;
      const w = corner.includes('e') ? side(o.w + dx) : corner.includes('w') ? side(o.w - dx) : o.w;
      const h = corner.includes('s') ? side(o.h + dy) : corner.includes('n') ? side(o.h - dy) : o.h;
      resizeObject(board.doc, o.id, { x: corner.includes('w') ? o.x + o.w - w : o.x, y: corner.includes('n') ? o.y + o.h - h : o.y, w, h }, board.origin);
      board.read();
    },
    up: stop,
    cancel: stop
  };
}

/** Works out what a press means, in the order the canvas does. */
function press(board: Board, at: SheetPoint, e: PointerEvent, target: Element): Gesture | null {
  const { sel, tool, space, view, hover } = board.getSnapshot();
  if (e.button === 1 || space || !board.canEdit) return panGesture(board, at);
  const dot = target.closest('[data-p]')?.getAttribute('data-p');
  const from = sel.length === 1 ? sel[0] : hover;
  if (dot && from) return dotPress(board, at, from);
  board.hoverOn(null);
  const corner = target.closest('[data-h]')?.getAttribute('data-h');
  const only = sel.length === 1 ? view.byId.get(sel[0] ?? '') : undefined;
  if (corner && only && hasBox(only)) return sizeGesture(board, at, only, corner);
  const id = pressedId(board, target);
  const toolPress = TOOL_PRESSES.get(tool);
  if (toolPress) return toolPress(board, { at, id, target, e });
  return id ? moveGesture(board, at, id, e.shiftKey) : marqueeGesture(board, at);
}

/** Double-click: type in what's there, or put a sticky here. It asks what's at the point, because a captured pointer makes the sheet the event's target. */
function doubleClick(board: Board, e: MouseEvent): void {
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (!board.canEdit || board.getSnapshot().tool !== 'select' || !target || target.closest(`${OVER_THE_SHEET}, [data-p], [data-h]`)) return;
  const id = pressedId(board, target);
  if (id) {
    board.startEdit(id);
    return;
  }
  const at = board.camera.point(e);
  board.newSticky(at.x - STICKY / 2, at.y - STICKY / 2);
}

interface ClientPoint {
  clientX: number;
  clientY: number;
}

/** Two fingers on a touch screen: they move the board and zoom it, keeping what's under them under them. */
function pinchGesture(board: Board, a: ClientPoint, b: ClientPoint): (a: ClientPoint, b: ClientPoint) => void {
  const { camera } = board;
  const middle = (p: ClientPoint, q: ClientPoint): SheetPoint => camera.point({ clientX: (p.clientX + q.clientX) / 2, clientY: (p.clientY + q.clientY) / 2 });
  const apart = (p: ClientPoint, q: ClientPoint): number => Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY) || 1;
  const { z } = camera.getSnapshot(), wide = apart(a, b), start = middle(a, b);
  board.stopFollow();
  board.stopGlide();
  return (p, q) => {
    const now = middle(p, q);
    camera.set(camera.holding(start, now.sx, now.sy, z * apart(p, q) / wide));
  };
}

/** Listens on the sheet for everything a pointer and the keys do. Returns how to stop. */
export function watchSheet(board: Board, sheet: HTMLElement): () => void {
  const { camera } = board;
  const listening = new AbortController();
  const { signal } = listening;
  let gesture: Gesture | null = null;
  let held: number | null = null;
  let latest: PointerEvent | null = null;
  let frame = 0;
  const touches = new Map<number, ClientPoint>();
  let pinch: ((a: ClientPoint, b: ClientPoint) => void) | null = null;
  let safariPinch: { z: number; at: SheetPoint } | null = null;

  const flush = (): void => {
    frame = 0;
    const e = latest;
    latest = null;
    if (!e) return;
    const at = camera.point(e);
    board.pointerAt(at);
    const [p, q] = touches.values();
    if (pinch && p && q) pinch(p, q);
    else if (e.pointerId === held) gesture?.move(at, e);
    else if (!gesture && e.pointerType !== 'touch') hoverAt(board, at, e.target);
  };

  /** Takes the gesture off the pointer that's ending, so that nothing can end it twice. */
  const release = (e: PointerEvent): Gesture | null => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (e.pointerId !== held) return null;
    const ending = gesture;
    gesture = null;
    held = null;
    board.set({ pressing: false });
    return ending;
  };

  sheet.addEventListener('pointerdown', (e) => {
    const { target } = e;
    if (e.button > 1 || !(target instanceof Element) || target.closest(OVER_THE_SHEET)) return;
    sheet.focus({ preventScroll: true });
    board.finishEdit();
    board.closeOver();
    if (e.pointerType === 'touch') touches.set(e.pointerId, e);
    const [p, q] = touches.values();
    if (p && q) {
      gesture?.cancel();
      gesture = null;
      held = null;
      board.set({ pressing: false });
      pinch = pinchGesture(board, p, q);
      return;
    }
    if (gesture) return;
    gesture = press(board, camera.point(e), e, target);
    if (!gesture) return;
    held = e.pointerId;
    board.set({ pressing: true });
    try { sheet.setPointerCapture(e.pointerId); } catch { /* It lifted before the capture, so its up has already been seen. */ }
  }, { signal });

  // The press that opened a sticky mustn't then focus the sheet, which would close it again. Anything over the sheet keeps its own focus, and with it the field's closing.
  sheet.addEventListener('mousedown', (e) => {
    if (board.getSnapshot().edit && !(e.target instanceof Element && e.target.closest(OVER_THE_SHEET))) e.preventDefault();
  }, { signal });

  sheet.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, e);
    if (e.pointerId === held) gesture?.trace?.(e);
    latest = e;
    frame ||= requestAnimationFrame(flush);
  }, { signal });

  sheet.addEventListener('pointerup', (e) => {
    flush();
    release(e)?.up(camera.point(e), e);
  }, { signal });

  const lost = (e: PointerEvent): void => release(e)?.cancel();
  sheet.addEventListener('pointercancel', lost, { signal });
  sheet.addEventListener('lostpointercapture', lost, { signal });
  sheet.addEventListener('pointerleave', () => {
    board.pointerAt(null);
    board.hoverOn(null);
  }, { signal });

  sheet.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (safariPinch) return;
    board.stopFollow();
    board.stopGlide();
    const unit = e.deltaMode === 1 ? LINE_HEIGHT : e.deltaMode === 2 ? camera.height : 1;
    if (e.ctrlKey || e.metaKey) {
      const at = camera.point(e);
      camera.set(camera.zoomed(Math.exp(-e.deltaY * unit * WHEEL_ZOOM), at.sx, at.sy));
    } else {
      camera.panBy(-e.deltaX * unit, -e.deltaY * unit);
    }
  }, { passive: false, signal });

  sheet.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    const clientX: unknown = Reflect.get(e, 'clientX'), clientY: unknown = Reflect.get(e, 'clientY');
    if (typeof clientX === 'number' && typeof clientY === 'number') safariPinch = { z: camera.getSnapshot().z, at: camera.point({ clientX, clientY }) };
  }, { signal });
  sheet.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const scale: unknown = Reflect.get(e, 'scale');
    if (!safariPinch || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
    board.stopFollow();
    board.stopGlide();
    camera.set(camera.holding(safariPinch.at, safariPinch.at.sx, safariPinch.at.sy, safariPinch.z * scale));
  }, { signal });
  sheet.addEventListener('gestureend', (e) => {
    e.preventDefault();
    safariPinch = null;
  }, { signal });

  sheet.addEventListener('dblclick', (e) => doubleClick(board, e), { signal });
  sheet.addEventListener('keydown', (e) => keyDown(board, e), { signal });
  sheet.addEventListener('keyup', (e) => keyUp(board, e), { signal });
  sheet.addEventListener('blur', () => { if (board.getSnapshot().space) board.set({ space: false }); }, { signal });

  return () => {
    listening.abort();
    if (frame) cancelAnimationFrame(frame);
  };
}
