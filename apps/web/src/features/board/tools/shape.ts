/* The Shape tool: drag to size it, or click for a standard one, and type straight onto it. */
import { addObject } from '@alcove/board';
import type { ToolPress } from '../gestures';
import { drawGesture } from './draw';

const STANDARD = { w: 170, h: 84 };

export const shapePress: ToolPress = (board, { at }) => drawGesture(board, at, {
  standard: STANDARD,
  add: (box) => addObject(board.doc, { k: 'shape', ...box, s: board.getSnapshot().shape, c: '', t: '' }, board.origin),
  // The step stays open through what's typed, so one undo takes back the shape and its words. If it has just gone, there's nothing to type on.
  done(id) {
    board.startEdit(id);
    if (!board.getSnapshot().edit) board.endStep();
  }
});
