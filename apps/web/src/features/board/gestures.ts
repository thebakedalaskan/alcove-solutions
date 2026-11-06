/*
 * What a pointer does on the sheet. One set of listeners serves the whole board: objects take no handlers, and `data-id`,
 * `data-h` and `data-p` say what was pressed. A press becomes a `Gesture`, which lasts until the pointer lets go. Its moves are
 * batched to one a frame, so a drag writes to the doc at most once a frame, and everyone else sees it happen. What a press
 * means with a tool picked is that tool's, in `tools/`.
 *
 * The wheel: a pinch on a trackpad arrives as ctrl and a wheel, and ⌘ with a mouse wheel means the same, so both zoom.
 * Everything else, which is two fingers on a trackpad and a mouse wheel alone, moves the board. Safari reports a pinch as
 * gesture events of its own instead, and touch screens as two pointers.
 */
import { BOARD_LIMITS, bounds, hasBox, type PlacedObject } from '@alcove/board';
import type { BoardTool } from '@alcove/ui';
import { log as rootLog } from '~/lib/log';
import type { SheetPoint } from './camera';
import { STICKY } from './editing';
import { keyDown, keyUp } from './keys';
import { dragTo, stretchTo } from './overlay';
import { CLICK_SLOP, NO_GUIDES, OVER_THE_SHEET, TAP_SLOP, boxBetween, carried, drawn, movable, picks, pressed, slopOf, snapTargets, snapTo } from './selection';
import { framePress, settleFrame } from './tools/frame';
import { dotPress, hoverAt, linePress } from './tools/line';
import { penPress } from './tools/pen';
import { shapePress } from './tools/shape';
import { textPress } from './tools/text';
import type { Board } from './useBoard';

const log = rootLog.child({ component: 'board' });

/** What a press has started, until the pointer lets go. */
export interface Gesture {
  /** At most once a frame, with where the pointer is now. */
  move(at: SheetPoint, e: PointerEvent): void;
  /** Every move as it arrives, for what can't afford to miss one: a pen. */
  trace?(e: PointerEvent): void;
  up(at: SheetPoint, e: PointerEvent): void;
  /** The pointer was taken away: a second finger arrived, the browser took over, or Esc let go. What's done stays done, and what isn't done is dropped. */
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
/** How far Safari's pinch scales before it's a pinch, and not two fingers resting. */
const PINCH_SLOP = 0.03;

/** The id under a press. A frame's body is for drawing a marquee in and catching stickies, so only its title picks it. */
function pressedId(board: Board, target: Element): string | null {
  const id = target.closest('[data-id]')?.getAttribute('data-id') ?? null;
  const o = id ? board.getSnapshot().view.byId.get(id) : undefined;
  return o?.k === 'frame' && !target.closest('.bf-h') ? null : id;
}

function panGesture(board: Board, press: SheetPoint, slop: number = CLICK_SLOP): Gesture {
  let last = press;
  let taken = false;
  board.set({ panning: true });
  const stop = (): void => board.set({ panning: false });
  return {
    move(at) {
      if (!taken) {
        // A tap isn't looking around, and on a board that can't be edited every press lands here. So the camera is taken by the drag, not the press.
        if (Math.abs(at.sx - last.sx) + Math.abs(at.sy - last.sy) < slop) return;
        // Whoever is being followed has gone on moving it since the press, so the drag starts from here. Otherwise what was pressed stays under the pointer.
        if (board.getSnapshot().following) last = at;
        board.takeCamera();
        taken = true;
      }
      board.camera.panBy(at.sx - last.sx, at.sy - last.sy);
      last = at;
    },
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

function moveGesture(board: Board, start: SheetPoint, id: string, shift: boolean, slop: number = CLICK_SLOP): Gesture {
  board.select(pressed(board.getSnapshot().sel, id, shift));
  const { view, near, sel } = board.getSnapshot();
  const objects = movable(view, sel);
  const travelling = carried(view, sel);
  const box = bounds(drawn(view, travelling));
  const targets = snapTargets(view, near, travelling);
  let moved = false;
  const stop = (): void => {
    board.set({ guides: NO_GUIDES });
    if (!moved) return;
    board.land();
    board.endStep();
  };
  return {
    move(at) {
      const { z } = board.camera.getSnapshot();
      const mx = at.x - start.x, my = at.y - start.y;
      if (!objects.length || (!moved && Math.abs(mx) + Math.abs(my) < slop / z)) return;
      if (!moved) board.beginStep();
      moved = true;
      const { dx, dy, guides } = snapTo({ ...box, x: box.x + mx, y: box.y + my }, targets, SNAP_REACH / z);
      dragTo(board, objects.map((o) => ({ id: o.id, x: o.x + mx + dx, y: o.y + my + dy })));
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
  // A line of text or a flat stroke starts smaller than that, and mustn't jump to it.
  const side = (n: number, was: number): number => Math.min(BOARD_LIMITS.maxSide, Math.max(Math.min(LEAST_SIDE, was), n));
  board.beginStep();
  const stop = (): void => {
    board.land();
    if (o.k === 'frame') settleFrame(board, o.id);
    board.endStep();
  };
  return {
    move(at) {
      const dx = at.x - start.x, dy = at.y - start.y;
      const w = corner.includes('e') ? side(o.w + dx, o.w) : corner.includes('w') ? side(o.w - dx, o.w) : o.w;
      const h = corner.includes('s') ? side(o.h + dy, o.h) : corner.includes('n') ? side(o.h - dy, o.h) : o.h;
      stretchTo(board, o.id, { x: corner.includes('w') ? o.x + o.w - w : o.x, y: corner.includes('n') ? o.y + o.h - h : o.y, w, h });
    },
    up: stop,
    cancel: stop
  };
}

/** On a phone, a tap on a sticky in a vote is a vote, or takes one back; a drag from it looks round the board, as from anywhere. */
function tapToVote(board: Board, start: SheetPoint, id: string): Gesture {
  const pan = panGesture(board, start);
  let moved = false;
  return {
    move(at, e) {
      if (Math.hypot(at.sx - start.sx, at.sy - start.sy) > TAP_SLOP) moved = true;
      pan.move(at, e);
    },
    up(at, e) {
      pan.up(at, e);
      if (!moved) board.ballot?.press(id);
    },
    cancel: () => pan.cancel()
  };
}

/** Works out what a press means, in the order the canvas does. */
function press(board: Board, at: SheetPoint, e: PointerEvent, target: Element): Gesture | null {
  const { sel, tool, space, view, hover } = board.getSnapshot();
  if (!board.canEdit && board.look.phone) {
    const id = pressedId(board, target);
    if (id && board.ballot?.takes(id)) return tapToVote(board, at, id);
  }
  // A camera that's the board's to put, as a presenter's own frame is, doesn't move by hand.
  if (e.button === 1 || space || !board.canEdit) return board.still ? null : panGesture(board, at, slopOf(e));
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
  // While a vote is on, a press on a sticky it takes is a vote, or takes one back, and the sticky stays where it is.
  if (id && board.ballot?.takes(id)) {
    board.ballot.press(id);
    return null;
  }
  return id ? moveGesture(board, at, id, e.shiftKey, slopOf(e)) : marqueeGesture(board, at);
}

/** Double-click: type in what's there, or put a sticky here. It asks what's at the point, because a captured pointer makes the sheet the event's target. */
function doubleClick(board: Board, e: MouseEvent): void {
  const target = document.elementFromPoint(e.clientX, e.clientY);
  const { tool, view } = board.getSnapshot();
  if (!board.canEdit || tool !== 'select' || !target || target.closest(`${OVER_THE_SHEET}, [data-p], [data-h]`)) return;
  const o = view.byId.get(pressedId(board, target) ?? '');
  // Two presses on a sticky in a vote are a vote and its taking back, not a way into typing.
  if (o && board.ballot?.takes(o.id)) return;
  // A table is typed in a cell at a time, the one pressed.
  if (o?.k === 'table') {
    const [row, col] = (target.closest('[data-cell]')?.getAttribute('data-cell') ?? '').split(':');
    if (row && col) board.startCell(o.id, row, col);
    return;
  }
  // A line and a stroke have nothing to type in, and "anywhere" includes on them; nor has a picture or something from the workspace.
  if (o && (o.k === 'image' || o.k === 'shot' || o.k === 'link')) return;
  if (o && o.k !== 'line' && o.k !== 'ink') {
    board.startEdit(o.id);
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
  let { z } = camera.getSnapshot(), wide = apart(a, b), start = middle(a, b), taken = false;
  return (p, q) => {
    const now = middle(p, q);
    if (!taken) {
      // As with a drag: two fingers landing aren't a pinch until they move, and a followed camera goes on moving until then.
      if (Math.abs(apart(p, q) - wide) + Math.hypot(now.sx - start.sx, now.sy - start.sy) < TAP_SLOP) return;
      if (board.getSnapshot().following) {
        ({ z } = camera.getSnapshot());
        wide = apart(p, q);
        start = now;
      }
      board.takeCamera();
      taken = true;
    }
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
  let safariPinch: { z: number; at: SheetPoint; taken: boolean } | null = null;

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

  /** Two fingers pinch from where they are now. When a third lifts, the pair left starts afresh: the old pair's spread would make the camera jump. */
  const pinchFromHere = (): void => {
    const [p, q] = touches.values();
    pinch = p && q && !board.still ? pinchGesture(board, p, q) : null;
  };

  /** Takes the gesture off the pointer that's ending, so that nothing can end it twice. */
  const release = (e: PointerEvent): Gesture | null => {
    if (touches.delete(e.pointerId)) pinchFromHere();
    if (e.pointerId !== held) return null;
    const ending = gesture;
    gesture = null;
    held = null;
    board.set({ pressing: false, hover: null });
    return ending;
  };

  /** Ends what's under way when the pointer hasn't lifted: a second finger, the window going away. Says whether anything was. */
  const drop = (): boolean => {
    const ending = gesture;
    if (!ending) return false;
    gesture = null;
    held = null;
    board.set({ pressing: false, hover: null });
    ending.cancel();
    return true;
  };

  /** The same with the pointer still down and nothing else coming for it: Esc, another tool, the board going read-only. It stops being the sheet's, so what it does next is ordinary. A finger pinching keeps its capture, which is why `drop` doesn't do this. */
  board.letGo = () => {
    if (held !== null && sheet.hasPointerCapture(held)) sheet.releasePointerCapture(held);
    return drop();
  };

  /** Keeps a pointer's events coming wherever it goes. It fails only for a pointer already gone, so nothing would ever end its gesture. */
  const capture = (id: number): void => {
    try {
      sheet.setPointerCapture(id);
    } catch (err) {
      log.info('pointer gone before capture', { err });
      if (touches.delete(id)) pinchFromHere();
      if (id === held) drop();
    }
  };

  sheet.addEventListener('pointerdown', (e) => {
    const { target } = e;
    if (e.button > 1 || !(target instanceof Element) || target.closest(OVER_THE_SHEET)) return;
    sheet.focus({ preventScroll: true });
    board.finishEdit();
    board.closeOver();
    if (e.pointerType === 'touch') {
      // The first finger of a new touch: any fingers still listed lifted somewhere nobody saw.
      if (e.isPrimary) touches.clear();
      touches.set(e.pointerId, e);
    }
    if (touches.size > 1) {
      drop();
      pinchFromHere();
      capture(e.pointerId);
      return;
    }
    if (gesture) return;
    gesture = press(board, camera.point(e), e, target);
    if (!gesture) return;
    held = e.pointerId;
    board.set({ pressing: true });
    capture(e.pointerId);
  }, { signal });

  // The press that opened a sticky mustn't then focus the sheet, which would close it again. Anything over the sheet keeps its own focus, and with it the field's closing.
  // A press on a sticky in a vote leaves the keys with the sheet, as any press on the board does: only Tab puts them on a sticky.
  sheet.addEventListener('mousedown', (e) => {
    const onSheet = !(e.target instanceof Element && e.target.closest(OVER_THE_SHEET));
    if (onSheet && (board.getSnapshot().edit || (e.target instanceof Element && e.target.closest('.bo.is-ballot')))) e.preventDefault();
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
    // A move still waiting for its frame would put the pointer back after this says it left.
    if (held === null) latest = null;
    board.pointerAt(null);
    board.hoverOn(null);
  }, { signal });

  sheet.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (safariPinch || board.still) return;
    board.takeCamera();
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
    if (typeof clientX === 'number' && typeof clientY === 'number') safariPinch = { z: camera.getSnapshot().z, at: camera.point({ clientX, clientY }), taken: false };
  }, { signal });
  sheet.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const scale: unknown = Reflect.get(e, 'scale');
    // Two fingers on the screen are already the pointer's pinch, which keeps them under what they hold: this would fight it.
    if (!safariPinch || pinch || board.still || typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return;
    // As with a drag, a pinch that hasn't really begun leaves the camera where it is: following someone carries on until it does.
    if (!safariPinch.taken) {
      if (Math.abs(scale - 1) < PINCH_SLOP) return;
      // From here, as the camera is now and wherever the fingers are now, so nothing jumps.
      const clientX: unknown = Reflect.get(e, 'clientX'), clientY: unknown = Reflect.get(e, 'clientY');
      const at = typeof clientX === 'number' && typeof clientY === 'number' ? camera.point({ clientX, clientY }) : safariPinch.at;
      safariPinch = { at, z: camera.getSnapshot().z / scale, taken: true };
      board.takeCamera();
    }
    camera.set(camera.holding(safariPinch.at, safariPinch.at.sx, safariPinch.at.sy, safariPinch.z * scale));
  }, { signal });
  sheet.addEventListener('gestureend', (e) => {
    e.preventDefault();
    safariPinch = null;
  }, { signal });

  // A screen reader's own press on a sticky in a vote (VoiceOver's VO-Space, say) is a click with no pointer behind it: it votes, as Enter does.
  // A pointer's press voted as it went down, so its click does nothing more.
  sheet.addEventListener('click', (e) => {
    const pointer: unknown = Reflect.get(e, 'pointerType');
    if (e.detail !== 0 || (typeof pointer === 'string' && pointer !== '')) return;
    const id = e.target instanceof HTMLElement && e.target.matches('.bo.is-ballot') ? e.target.getAttribute('data-id') : null;
    if (id && board.ballot?.takes(id)) board.ballot.press(id);
  }, { signal });
  // A sticky with the keys on it in a vote gives them up as the vote ends, or as this person can no longer vote: back to the sheet, not the page.
  sheet.addEventListener('focusout', (e) => {
    if (e.relatedTarget !== null || !(e.target instanceof HTMLElement) || !e.target.matches('.bo') || e.target.hasAttribute('tabindex')) return;
    queueMicrotask(() => { if (document.activeElement === null || document.activeElement === document.body) board.focusSheet(); });
  }, { signal });
  sheet.addEventListener('dblclick', (e) => doubleClick(board, e), { signal });
  sheet.addEventListener('keydown', (e) => keyDown(board, e), { signal });
  sheet.addEventListener('keyup', (e) => keyUp(board, e), { signal });
  sheet.addEventListener('blur', () => { if (board.getSnapshot().space) board.set({ space: false }); }, { signal });
  // With the window gone, a pointer can lift where nobody sees it.
  addEventListener('blur', () => {
    drop();
    touches.clear();
    pinch = null;
    safariPinch = null;
  }, { signal });

  return () => {
    drop();
    listening.abort();
    board.letGo = () => false;
    if (frame) cancelAnimationFrame(frame);
  };
}
