/*
 * A board's own settings, which every picture of it follows, whoever's looking and wherever it shows: on the stage, as a
 * tile, on a note, presenting, on its page. Night board makes it a dark board in any theme, so a dark board by day, for
 * everyone. A setting is the board's, kept in its Y.Doc beside what's on it, changed by whoever can change the board, and
 * last-write-wins like everything but text. Undo leaves settings alone: pressing Night board again is its undo.
 */
import type * as Y from 'yjs';
import { rootMap } from './read';
import { BOARD_SETTINGS } from './shape';

/** Whether the board is a night board: dark in any theme. */
export function boardNight(doc: Y.Doc): boolean {
  return rootMap(doc, BOARD_SETTINGS)?.get('night') === true;
}

/** Makes it a night board, or lets it follow each person's theme again, for everyone. */
export function setNight(doc: Y.Doc, on: boolean, origin: unknown): void {
  const settings = rootMap(doc, BOARD_SETTINGS);
  if (!settings || boardNight(doc) === on) return;
  doc.transact(() => settings.set('night', on), origin);
}

/** Calls `onChange` after any change to the board's settings. Returns how to stop. */
export function observeSettings(doc: Y.Doc, onChange: () => void): () => void {
  const settings = rootMap(doc, BOARD_SETTINGS);
  if (!settings) return () => undefined;
  const changed = (): void => onChange();
  settings.observe(changed);
  return () => settings.unobserve(changed);
}
