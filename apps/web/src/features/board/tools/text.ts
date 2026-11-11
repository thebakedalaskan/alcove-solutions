/*
 * The Text tool: a line of words straight on the board, with no box round it. Left blank, it goes again. A double-click on open
 * board, in no frame, puts one there too (`doubleClick` in gestures.ts).
 */
import type { ToolPress } from '../gestures';
import type { Board } from '../useBoard';

const LINE = { w: 260, h: 34 };
/** The press lands level with the words. */
const ABOVE = 16;

/** A line of words where the pointer is, in board units, open for typing. */
export function addText(board: Board, at: { x: number; y: number }): void {
  board.addAndType({ k: 'text', x: at.x, y: at.y - ABOVE, ...LINE, size: 'title', t: '' });
}

export const textPress: ToolPress = (board, { at }) => {
  addText(board, at);
  return null;
};
