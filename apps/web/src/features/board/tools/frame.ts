/*
 * The Frame tool. A frame holds what's in it: moving one moves that too, and its count and its hint go by what's in it. So what
 * a frame holds has to change as it's drawn and sized, as well as when things are carried in and out.
 */
import { addObject, centre, contains, hasBox, moveObjects, setObjects, type BoardObject, type Box, type FrameObject } from '@alcove/board';
import type { ToolPress } from '../gestures';
import { movable } from '../selection';
import type { Board } from '../useBoard';
import { drawGesture } from './draw';

const STANDARD = { w: 360, h: 530 };
const TITLE = 'Frame';

export const framePress: ToolPress = (board, { at }) => drawGesture(board, at, {
  standard: STANDARD,
  add: (box) => addObject(board.doc, { k: 'frame', ...box, c: '', role: '', hint: '', sub: '', title: TITLE }, board.origin),
  settle: (id) => settleFrame(board, id)
});

const holds = (outer: Box, inner: Box): boolean => contains(outer, inner.x, inner.y) && contains(outer, inner.x + inner.w, inner.y + inner.h);

/** Whether something belongs to this frame by where it is: a frame if all of it fits, and anything else by its middle. A line goes by its free ends, which `moveObjects` looks at. */
function within(frame: FrameObject, o: BoardObject): boolean {
  if (!hasBox(o)) return true;
  if (o.k === 'frame') return holds(frame, o);
  const { x, y } = centre(o);
  return contains(frame, x, y);
}

/** Takes in what's now inside a frame and lets go of what isn't. Moving something nowhere is how it's asked where it sits. A smaller frame inside goes on holding what it holds. */
export function settleFrame(board: Board, id: string): void {
  const { view } = board.getSnapshot();
  const frame = view.byId.get(id);
  if (frame?.k !== 'frame') return;
  const ids = view.objects.flatMap((o) => {
    if (o.id === id) return [id];
    const home = view.byId.get(o.f);
    const held = home?.k === 'frame' && home.id !== id && holds(frame, home);
    return !held && (o.f === id || within(frame, o)) ? [o.id] : [];
  });
  moveObjects(board.doc, movable(view, ids), board.origin);
  board.read();
  raiseHeld(board, [id]);
}

/**
 * Frames draw in `at` order, so one held in another has to be above it: under it, its title would be covered, and a frame is
 * only picked by its title. What's added there goes by the same order, to the one on top. This goes through the frames named and
 * what they hold, in the undo step that moved them. A frame in a frame isn't a slide, so no slide changes place.
 */
export function raiseHeld(board: Board, ids: readonly string[]): void {
  const { view } = board.getSnapshot();
  const named = new Set(ids);
  const ats = new Map(view.frames.map((f) => [f.id, f.at]));
  const inside = new Map<string, FrameObject[]>();
  for (const f of view.frames) {
    const list = inside.get(f.f);
    if (list) list.push(f);
    else inside.set(f.f, [f]);
  }
  const waiting = view.frames.filter((f) => named.has(f.id));
  for (let f = waiting.pop(); f; f = waiting.pop()) {
    const holder = ats.get(f.f);
    if (holder !== undefined && (ats.get(f.id) ?? f.at) <= holder) {
      ats.set(f.id, holder + 1);
      setObjects(board.doc, [f.id], { at: holder + 1 }, board.origin);
    }
    waiting.push(...(inside.get(f.id) ?? []));
  }
  board.read();
}
