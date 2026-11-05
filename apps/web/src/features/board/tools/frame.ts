/*
 * The Frame tool. A frame holds what's in it: moving one moves that too, and its count and its hint go by what's in it. So what
 * a frame holds has to change as it's drawn and sized, as well as when things are carried in and out.
 */
import { addObject, centre, contains, hasBox, moveObjects, type BoardObject, type BoardView, type FrameObject } from '@alcove/board';
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

/** Whether something is already held inside this frame, by a smaller frame in it, which goes on holding it. */
function heldInside(view: BoardView, frame: FrameObject, o: BoardObject): boolean {
  const home = view.byId.get(o.f);
  if (!home || home.id === frame.id || !hasBox(home)) return false;
  return contains(frame, home.x, home.y) && contains(frame, home.x + home.w, home.y + home.h);
}

/** Takes in what's now inside a frame and lets go of what isn't. Moving something nowhere is how it's asked where it sits. */
export function settleFrame(board: Board, id: string): void {
  const { view } = board.getSnapshot();
  const frame = view.byId.get(id);
  if (frame?.k !== 'frame') return;
  const ids = view.objects.flatMap((o) => {
    if (o.id === id) return [id];
    if (heldInside(view, frame, o)) return [];
    const spot = hasBox(o) ? centre(o) : null;
    return o.f === id || !spot || contains(frame, spot.x, spot.y) ? [o.id] : [];
  });
  moveObjects(board.doc, movable(view, ids), board.origin);
  board.read();
}
