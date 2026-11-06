/* The Text tool: a line of words straight on the board, with no box round it. Left blank, it goes again. */
import type { ToolPress } from '../gestures';

const LINE = { w: 260, h: 34 };
/** The press lands level with the words. */
const ABOVE = 16;

export const textPress: ToolPress = (board, { at }) => {
  board.addAndType({ k: 'text', x: at.x, y: at.y - ABOVE, ...LINE, size: 'title', t: '' });
  return null;
};
