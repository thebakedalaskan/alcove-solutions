/* What the selection bar does to what's picked. Each is one undo, and only what can take a change is changed by it. */
import { setObjects, tidyObjects, type BoardObject, type NoteObject, type StickyColour, type TextObject } from '@alcove/board';
import type { Board } from '../useBoard';

const STICKY_SIZES: readonly NoteObject['size'][] = ['m', 'l', 's'];
const TEXT_SIZES: readonly TextObject['size'][] = ['title', 'heading', 'body'];

/** The next of a list, round to the start. */
const after = <T>(list: readonly T[], now: T): T | undefined => list[(list.indexOf(now) + 1) % list.length];

/** The colour something shows on the bar. Null for what has none to change. */
export function colourOf(o: BoardObject): StickyColour | null {
  if (o.k === 'note') return o.c;
  return o.k === 'shape' || o.k === 'frame' ? o.c || 'mist' : null;
}

export function colourSelected(board: Board, c: StickyColour): void {
  const { sel, view } = board.getSnapshot();
  const ids = sel.filter((id) => {
    const o = view.byId.get(id);
    return o !== undefined && colourOf(o) !== null;
  });
  board.write(() => setObjects(board.doc, ids, { c }, board.origin));
  board.set({ picking: false });
}

export const hasSizes = (o: BoardObject): boolean => o.k === 'note' || o.k === 'text';

/** The next size of a sticky or some text. */
export function sizeSelected(board: Board): void {
  const { sel, view } = board.getSnapshot();
  const [id] = sel;
  const o = id ? view.byId.get(id) : undefined;
  const size = o?.k === 'note' ? after(STICKY_SIZES, o.size) : o?.k === 'text' ? after(TEXT_SIZES, o.size) : undefined;
  if (id && size) board.write(() => setObjects(board.doc, [id], { size }, board.origin));
}

/** Tidy: everything picked travels into a grid together, as one undo. */
export function tidySelected(board: Board): void {
  const { sel } = board.getSnapshot();
  board.settle(() => board.write(() => tidyObjects(board.doc, sel, board.origin)));
}

/** Brings what's picked in front of everything else, or sends it behind. `at` orders objects within their layer. */
export function stackSelected(board: Board, edge: 'front' | 'back'): void {
  const { sel, view } = board.getSnapshot();
  const ats = view.objects.map((o) => o.at);
  const at = edge === 'front' ? Math.max(...ats) + 1 : Math.min(...ats) - 1;
  board.write(() => setObjects(board.doc, sel, { at }, board.origin));
}
