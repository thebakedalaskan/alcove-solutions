/*
 * What a board is for and what's going on at it: the modes, what each one has, and the state components read slices of. `Board`
 * in `useBoard.ts` is what changes it.
 */
import type { BoardView, Box, LineStyle, ShapeKind, StickyColour } from '@alcove/board';
import type { BoardMoreItem, BoardPenKind, BoardTool } from '@alcove/ui';
import type { Guide } from './selection';
import type { BoardDraft } from './tools/draft';

/**
 * `read`: in a call or a note, for someone who can only look. `pageRead`: a board's own page, for someone who can only look.
 * `phone` and `pagePhone`: the call's board and a board's own page, on a phone, for someone who can add to it.
 */
export type BoardMode = 'call' | 'page' | 'pageRead' | 'pagePhone' | 'tile' | 'present' | 'phone' | 'read';

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
  pageRead: { ...LOOK, page: true, rail: false, edit: false },
  read: { ...LOOK, rail: false, edit: false },
  present: BARE,
  tile: { ...BARE, mini: true },
  /** On a phone: look round, follow, vote with a tap, and add a sticky from the sheet. Moving and drawing stay on bigger screens. */
  phone: { ...LOOK, rail: false, edit: false, clean: true, phone: true },
  /** A board's own page on a phone: the same, with the page round it, and + in the person's own theme. */
  pagePhone: { ...LOOK, rail: false, edit: false, clean: true, phone: true, page: true }
};

/** What can open beside the rail: a tool's options, More, and what two of More's items offer: templates, and the workspace's items. */
export type BoardFly = 'note' | 'shape' | 'line' | 'pen' | 'more' | 'templates' | 'items';
/** What can open from the bar to run the session: the Timer's menu, or the Vote's. */
export type BoardRunMenu = 'timer' | 'vote';

/** What More's items do, where the world round the board does them: one given here takes the place of the board's own. */
export type BoardMoreItems = Partial<Record<BoardMoreItem, (() => void) | undefined>>;

/** What the bar's More holds: Copy link and the downloads for anyone who can see the board, and Night board for whoever can change it. */
export type BoardBarItem = 'link' | 'image' | 'pdf' | 'night';
/** What each of the bar's More items does. An item that isn't given isn't shown. */
export type BoardBarItems = Partial<Record<BoardBarItem, (() => void) | undefined>>;

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
  /** In a table being typed in (`edit`), the cell. */
  cell: { row: string; col: string } | null;
  /** The bar's More is open. */
  barMenu: boolean;
  /** Night board, the board's own setting: dark in any theme, for everyone, everywhere it shows. */
  night: boolean;
  /** The row of colours under the selection bar is open. */
  picking: boolean;
  /** The selection bar's More is open. */
  menu: boolean;
  /** The bar's Timer or Vote menu is open. */
  runMenu: BoardRunMenu | null;
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
  /** Rooms' boards coming back: each frame, with what it holds, and how long it waits (ms) to land, one after another. */
  landing: ReadonlyMap<string, number>;
  /** Past 500 objects, the part of the board that's mounted, in board units. */
  near: Box | null;
  /** Whose view this is, if it isn't your own. */
  following: string | null;
  /** The frame on the sheet while presenting, which is all a presented board shows. */
  slide: string | null;
  /** Sort into themes is waiting for its answer. */
  sorting: boolean;
  canUndo: boolean;
  canRedo: boolean;
}
