/*
 * A board as words, for search, the notes and follow-ups. Frames in slide order, each with what's in it in reading
 * order, then everything outside a frame. Also the smallest change between two texts, which typing and undo share.
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

/** A change to a text: `remove` characters at `start` give way to `insert`. */
export interface TextChange {
  start: number;
  remove: number;
  insert: string;
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * The smallest change that turns `was` into `now`. The caret says where it ended, which settles what a prefix and suffix
 * alone can't, such as which of three a's was just typed. It never stops inside a surrogate pair: Yjs would have to replace
 * the half it was left with, and an emoji would turn into a box for everyone.
 */
export function difference(was: string, now: string, caret: number): TextChange {
  const tailRoom = Math.min(was.length, Math.max(0, now.length - caret));
  let tail = 0;
  while (tail < tailRoom && was.charCodeAt(was.length - 1 - tail) === now.charCodeAt(now.length - 1 - tail)) tail += 1;
  const headRoom = Math.min(was.length, now.length) - tail;
  let head = 0;
  while (head < headRoom && was.charCodeAt(head) === now.charCodeAt(head)) head += 1;
  if (head > 0 && isHighSurrogate(was.charCodeAt(head - 1))) head -= 1;
  if (tail > 0 && isLowSurrogate(was.charCodeAt(was.length - tail))) tail -= 1;
  return { start: head, remove: was.length - head - tail, insert: now.slice(head, now.length - tail) };
}
