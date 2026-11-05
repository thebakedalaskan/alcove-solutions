/*
 * What opens beside the rail: a tool's options, and More. What's picked stays picked for the next time that tool is used.
 * More's items come from outside the board, so they run what the surface was given.
 */
import { BoardFlyout } from '@alcove/ui';
import { useBoardState, type Board, type BoardState } from '../useBoard';

export function Flyouts({ board }: { board: Board }) {
  const fly = useBoardState(board, (s) => s.fly);
  const colour = useBoardState(board, (s) => s.colour);
  const shape = useBoardState(board, (s) => s.shape);
  const line = useBoardState(board, (s) => s.line);
  const pen = useBoardState(board, (s) => s.pen);
  const pick = (choice: Partial<BoardState>): void => {
    board.set({ ...choice, fly: null });
    board.focusSheet();
  };
  switch (fly) {
    case 'note': return <BoardFlyout kind="note" colour={colour} onColour={(c) => pick({ colour: c })} />;
    case 'shape': return <BoardFlyout kind="shape" shape={shape} onShape={(s) => pick({ shape: s })} />;
    case 'line': return <BoardFlyout kind="line" line={line} onLine={(l) => pick({ line: l })} />;
    case 'pen': return <BoardFlyout kind="pen" pen={pen} onPen={(p) => pick({ pen: p })} />;
    case 'more': return <BoardFlyout kind="more" onMore={(item) => { pick({}); board.runMore(item); }} />;
    default: return null;
  }
}
