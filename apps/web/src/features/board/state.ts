/*
 * What a board is for and what's going on at it: the modes, what each one has, and the state components read slices of. `Board`
 * in `useBoard.ts` is what changes it.
 */
import type { BoardView, Box, LineStyle, ShapeKind, StickyColour } from '@alcove/board';
import type { BoardMoreItem, BoardPenKind, BoardTool } from '@alcove/ui';
import type { Guide } from './selection';
import type { BoardDraft } from './tools/draft';

export type BoardMode = 'call' | 'page' | 'tile' | 'present' | 'phone' | 'read';

/** What each mode has. */
export interface BoardLook {
  /** The bar along the top of the sheet. */
  bar: boolean;
  /** The tools beside it. */
  rail: boolean;
  /** Whether anything can be changed. Without it, a drag moves the board around. */
  edit: boolean;
  /** No dots on the sheet. */
  clean: boolean;
  page: boolean;
  phone: boolean;
  /** A picture of the board: it can't be pressed, and always shows all of it. */
  mini: boolean;
}

const LOOK: BoardLook = { bar: true, rail: true, edit: true, clean: false, page: false, phone: false, mini: false };
const BARE: BoardLook = { ...LOOK, bar: false, rail: false, edit: false, clean: true };

export const BOARD_LOOKS: Record<BoardMode, BoardLook> = {
  call: LOOK,
  page: { ...LOOK, page: true },
  read: { ...LOOK, rail: false, edit: false },
  present: BARE,
  tile: { ...BARE, mini: true },
  phone: { ...BARE, page: true, phone: true }
};

/** What can open beside the rail: a tool's options, or More's. */
export type BoardFly = 'note' | 'shape' | 'line' | 'pen' | 'more';

/** What More's items do. Each comes from outside the board, and one that isn't given does nothing. */
export type BoardMoreItems = Partial<Record<BoardMoreItem, (() => void) | undefined>>;

export interface BoardState {
  view: BoardView;
  tool: BoardTool;
  /** The colour picked on the sticky tool, which a sticky takes where no frame says otherwise. */
  colour: StickyColour;
  /** What the Shape tool draws, how the Line tool runs, and what the Pen tool is holding. */
  shape: ShapeKind;
  line: LineStyle;
  pen: BoardPenKind;
  /** What's open beside the rail. */
  fly: BoardFly | null;
  sel: readonly string[];
  /** What's being typed in. */
  edit: string | null;
  /** The row of colours under the selection bar is open. */
  picking: boolean;
  /** The selection bar's More is open. */
  menu: boolean;
  /** What the pointer is near, whose dots are showing. */
  hover: string | null;
  /** What's being drawn, which only this person sees until it's let go. */
  draft: BoardDraft | null;
  /** The object a line waits to go from, after Draw a line from this. */
  lineFrom: string | null;
  /** A press is held, so the selection bar keeps out of the way. */
  pressing: boolean;
  /** The map is open. */
  map: boolean;
  /** The box being dragged out, in board units. */
  marquee: Box | null;
  guides: readonly Guide[];
  /** Space is held, so a press drags the board. */
  space: boolean;
  /** The board is being dragged around. */
  panning: boolean;
  /** The camera is easing to where it was last put. */
  glide: boolean;
  /** Objects travelling to new places together, as they do after an undo. */
  settling: ReadonlySet<string>;
  /** Objects that have just landed, which pop in. */
  landed: ReadonlySet<string>;
  /** Past 500 objects, the part of the board that's mounted, in board units. */
  near: Box | null;
  /** Whose view this is, if it isn't your own. */
  following: string | null;
  canUndo: boolean;
  canRedo: boolean;
}
