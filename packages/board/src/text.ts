/*
 * A board as words, for search, the notes and follow-ups. Frames in slide order, each with what's in it in reading
 * order, then everything outside a frame.
 */
import type * as Y from 'yjs';
import { byFrame } from './geometry';
import { readBoard } from './read';
import { cellKey, hasBox, type BoardObject, type BoardView, type PlacedObject } from './shape';

function wordsIn(o: BoardObject): string[] {
  if (o.k === 'note' || o.k === 'text' || o.k === 'shape' || o.k === 'node') return [o.t];
  if (o.k === 'frame') return [o.title, o.sub];
  if (o.k === 'shot') return [o.caption];
  if (o.k === 'table') return o.rows.map((row) => o.cols.map((col) => o.cells[cellKey(row.id, col.id)] ?? '').join(' '));
  return [];
}

const heldIn = (view: BoardView): Map<string, PlacedObject[]> => byFrame(view.objects.filter(hasBox).filter((o) => o.k !== 'frame'));

/** All the words on a board. Comments aren't on the board, so they aren't here. */
export function boardText(doc: Y.Doc): string {
  const view = readBoard(doc);
  const held = heldIn(view);
  const lines = [...view.frames.flatMap((f) => [f, ...(held.get(f.id) ?? [])]), ...(held.get('') ?? [])].flatMap(wordsIn);
  return lines.map((line) => line.trim()).filter(Boolean).join('\n');
}

/** The stickies in frames with `role: 'actions'`, which is what the note lists as follow-ups. */
export function boardFollowUps(doc: Y.Doc): { id: string; text: string }[] {
  const view = readBoard(doc);
  const held = heldIn(view);
  return view.frames.filter((f) => f.role === 'actions').flatMap((f) => (held.get(f.id) ?? []).flatMap((o) => (o.k === 'note' && o.t.trim() ? [{ id: o.id, text: o.t.trim() }] : [])));
}
