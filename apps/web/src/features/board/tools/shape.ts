/* The Shape tool: drag to size it, or click for a standard one, and type straight onto it. */
import { addObject } from '@alcove/board';
import type { ToolPress } from '../gestures';
import { drawGesture } from './draw';

const STANDARD = { w: 170, h: 84 };

export const shapePress: ToolPress = (board, { at }) => drawGesture(board, at, {
  standard: STANDARD,
  add: (box) => addObject(board.doc, { k: 'shape', ...box, s: board.getSnapshot().shape, c: '', t: '' }, board.origin),
  typed: true
});
