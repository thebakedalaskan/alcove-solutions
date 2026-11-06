/*
 * What More puts on a board, drawn: a table, typed a cell at a time; a mind map's ideas, with the branches between them drawn
 * from who branches from whom; and something from the workspace, named as its reader knows it. The board's own objects are in
 * `BoardSurface.tsx`; these come here so More stays in one place.
 */
import { branchPath, branches, type BoardView, type LinkObject, type NodeObject, type TableObject } from '@alcove/board';
import { BoardLink, BoardNode, BoardTable } from '@alcove/ui';
import { createContext, memo, useContext, type ReactNode } from 'react';
import { BoardTyping } from '../editing';
import type { Board } from '../useBoard';

/** Something in the board's workspace, as this person knows it: what it's called and what it is. */
export interface BoardItem { id: string; name: string; kind: 'document' | 'board' }

/**
 * The workspace round a board, for whoever's looking: what each linked item is called for them (null where they can't open
 * it), and how to open one. Without it, every link says it can't be opened.
 */
export interface BoardLinks {
  itemFor: (item: string) => BoardItem | null;
  open?: ((item: string) => void) | undefined;
}
export const Links = createContext<BoardLinks | null>(null);

interface Shown {
  selected: boolean; pop: boolean; glide: boolean; editing: boolean; other: string | undefined;
}
const boxOf = (o: { id: string; x: number; y: number; w: number; h: number }, s: Shown) => ({ id: o.id, x: o.x, y: o.y, w: o.w, h: o.h, selected: s.selected, pop: s.pop, glide: s.glide, other: s.other });

/** A table, with the cell being typed in, and a row and a column to add while it's selected. */
export function TableObjectView({ o, board, shown, cell }: { o: TableObject; board: Board; shown: Shown; cell: { row: string; col: string } | null }) {
  const editing = shown.editing && cell ? { key: `${cell.row}:${cell.col}`, editor: <BoardTyping board={board} id={o.id} label="Edit this cell" cell={cell} /> } : undefined;
  return (
    <BoardTable {...boxOf(o, shown)} cols={o.cols} rows={o.rows} cells={o.cells} editing={editing}
      onAddRow={board.canEdit ? () => board.growTable(o.id, 'rows') : undefined} onAddCol={board.canEdit ? () => board.growTable(o.id, 'cols') : undefined} />
  );
}

/** A mind map's idea, open for typing while it's being typed in. */
export function NodeObjectView({ o, board, shown }: { o: NodeObject; board: Board; shown: Shown }) {
  const editor: ReactNode = shown.editing ? <BoardTyping board={board} id={o.id} label="Edit this idea" /> : undefined;
  return <BoardNode {...boxOf(o, shown)} text={o.t} first={!o.parent} editor={editor} />;
}

/** Something from the workspace, by this person's own name for it. */
export const LinkObjectView = memo(function LinkObjectView({ o, shown }: { o: LinkObject; shown: Shown }) {
  const links = useContext(Links);
  const item = links?.itemFor(o.item) ?? null;
  const open = links?.open;
  return <BoardLink {...boxOf(o, shown)} name={item ? item.name : null} kind={item?.kind} onOpen={item && open ? () => open(o.item) : undefined} />;
});

/** The branches of every mind map on the board, for the one drawing lines and ink go in. */
export function Branches({ view }: { view: BoardView }) {
  return <>{branches(view).map(({ from, to }) => <path key={`${from.id}-${to.id}`} className="branch" d={branchPath(from, to)} />)}</>;
}
