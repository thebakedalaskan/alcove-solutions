/*
 * The Frame tool. A frame holds what's in it: moving one moves that too, and its count and its hint go by what's in it. So what
 * a frame holds has to change as it's drawn and sized, as well as when things are carried in and out.
 */
import { addObject, centre, contains, hasBox, moveObjects, type BoardObject, type Box, type FrameObject } from '@alcove/board';
import type { ToolPress } from '../gestures';
import { movable } from '../selection';
import type { Board } from '../useBoard';
import { drawGesture } from './draw';

const STANDARD = { w: 360, h: 530 };
const TITLE = 'Frame';

export const framePress: ToolPress = (board, { at }) => drawGesture(board, at, {
  standard: STANDARD,
  add: (box) => addObject(board.doc, { k: 'frame', ...box, c: '', role: '', hint: '', sub: '', title: TITLE }, board.origin),
  done(id) {
    settleFrame(board, id);
    board.endStep();
  }
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
}
