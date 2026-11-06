/*
 * Typing in a table's cell. A table's cells are made with it, and a row or column brings its own, in the same transaction, so
 * whoever starts typing in an empty cell is in the one everyone has: two people starting at once both keep what they type, and
 * focusing a cell writes nothing. A cell can still be missing in a table from before cells came with their rows and columns,
 * or where two people added a row and a column at the same moment, at the cell where they cross. Focusing one of those makes
 * it, with the rest the table is missing (`fillCells`), and if two people do that at the same moment, a Y.Map key has one
 * winner: whoever's lost is moved to the one that's kept as soon as it arrives, so they lose at most what they typed before then.
 */
import * as Y from 'yjs';
import { mapOf, rootMap } from './read';
import { BOARD_OBJECTS, cellKey } from './shape';
import { tableCell } from './write';

/**
 * Binds `onText` to a cell from now on: called at once with the cell's Y.Text (made if the table was missing it), and again
 * whenever the cell's Y.Text is another one (someone else's won) or goes (its row or column went: null). Returns how to stop.
 */
export function bindCell(doc: Y.Doc, id: string, row: string, col: string, origin: unknown, onText: (text: Y.Text | null) => void): () => void {
  let current = tableCell(doc, id, row, col, origin);
  onText(current);
  const cells = mapOf(mapOf(rootMap(doc, BOARD_OBJECTS)?.get(id))?.get('cells'));
  if (!cells) return () => undefined;
  const key = cellKey(row, col);
  const watch = (e: Y.YMapEvent<unknown>): void => {
    if (!e.keysChanged.has(key)) return;
    const now = cells.get(key);
    const next = now instanceof Y.Text ? now : null;
    if (next === current) return;
    current = next;
    onText(next);
  };
  cells.observe(watch);
  return () => cells.unobserve(watch);
}
