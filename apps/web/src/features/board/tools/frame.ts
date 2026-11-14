/*
 * The Frame tool. A frame holds what's in it: moving one moves that too, and its count and its hint go by what's in it. So what
 * a frame holds has to change as it's drawn and sized, as well as when things are carried in and out.
 */
import { addObject, holds, moveObjects, sitsIn } from '@alcove/board';
import type { ToolPress } from '../input/gestures';
import { movable } from '../selection';
import type { Board } from '../useBoard';
import { drawGesture } from './draw';

const STANDARD = { w: 360, h: 530 };
const TITLE = 'Frame';

export const framePress: ToolPress = (board, { at }) => drawGesture(board, at, {
  standard: STANDARD,
  add: (box) => addObject(board.doc, { k: 'frame', ...box, c: '', role: '', hint: '', sub: '', sorted: false, title: TITLE }, board.origin),
  settle: (id) => settleFrame(board, id)
});

/** Takes in what's now inside a frame and lets go of what isn't. Moving something nowhere is how it's asked where it sits. A smaller frame inside goes on holding what it holds. */
export function settleFrame(board: Board, id: string): void {
  const view = board.written;
  const frame = view.byId.get(id);
  if (frame?.k !== 'frame') return;
  const ids = view.objects.flatMap((o) => {
    if (o.id === id) return [id];
    const home = view.byId.get(o.f);
    const held = home?.k === 'frame' && home.id !== id && holds(frame, home);
    return !held && (o.f === id || sitsIn(o, frame)) ? [o.id] : [];
  });
  moveObjects(board.doc, movable(view, ids), board.origin);
  board.read();
}
