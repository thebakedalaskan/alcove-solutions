/*
 * How much is on a board, as the board itself reads it: its frames and its stickies. Loaded with the board's surface, never
 * before (`loadCounts` in lazy.ts), so a page with a board's card on it, such as a note, pays for reading boards only once the
 * card is on screen.
 */
import { observeBoard, readBoard, type BoardView } from '@alcove/board';
import type * as Y from 'yjs';

export interface BoardCounts { frames: number; stickies: number }

/** Says how many frames and stickies the board has now, and again, at most once a frame, each time that changes. Returns how to stop. */
export function watchCounts(doc: Y.Doc, said: (counts: BoardCounts) => void): () => void {
  let view: BoardView | undefined;
  let last: BoardCounts | null = null;
  let frame = 0;
  const count = (): void => {
    frame = 0;
    view = readBoard(doc, view);
    const now = { frames: view.frames.length, stickies: view.objects.filter((o) => o.k === 'note').length };
    if (last && last.frames === now.frames && last.stickies === now.stickies) return;
    last = now;
    said(now);
  };
  count();
  const stop = observeBoard(doc, () => { frame ||= requestAnimationFrame(count); });
  return () => {
    stop();
    if (frame) cancelAnimationFrame(frame);
  };
}
