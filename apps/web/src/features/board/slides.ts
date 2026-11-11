/*
 * A board's frames as whoever presents it steps through them: its top-level frames in the order they sit, top to bottom and left
 * to right, as a page is read, so the order can be told from the board itself and moving a frame moves it in the order. Frames
 * held in another are part of it, not stops of their own. The call keeps which one the presenter is on (`section`), for their
 * pager and their notes, and every browser reads the same order.
 */
import { observeBoard, readBoard, type BoardView, type Box } from '@alcove/board';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

/** Whether `a` comes before `b` reading a board: row by row, a row being boxes that overlap by at least half the shorter one's height, and left to right along each. */
export const reading = (a: Box, b: Box): number => (Math.abs(a.y - b.y) < Math.min(a.h, b.h) / 2 ? a.x - b.x : a.y - b.y);

const slidesOf = (view: BoardView): readonly string[] => view.frames.filter((f) => !f.f).sort(reading).map((f) => f.id);
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => b[i] === id);

/** The board's slides as they are now, read again once a frame after it changes. */
export function useSlides(doc: Y.Doc): readonly string[] {
  const [slides, setSlides] = useState<readonly string[]>(() => slidesOf(readBoard(doc)));
  useEffect(() => {
    let view = readBoard(doc);
    let frame = 0;
    const read = () => {
      frame = 0;
      view = readBoard(doc, view);
      const now = slidesOf(view);
      setSlides((was) => (same(was, now) ? was : now));
    };
    read();
    const stop = observeBoard(doc, () => { frame ||= requestAnimationFrame(read); });
    return () => {
      stop();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [doc]);
  return slides;
}

/** Which frame a section is: past the last, the last; null when the board has no frames. */
export const slideAt = (slides: readonly string[], section: number): { id: string | null; at: number } => {
  if (!slides.length) return { id: null, at: 0 };
  const at = Math.min(Math.max(0, section), slides.length - 1);
  return { id: slides[at] ?? null, at };
};
