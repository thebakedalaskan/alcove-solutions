/*
 * A board as slides: its top-level frames, in order, which is how everyone who has it reads them, so a presentation's `section`
 * means the same frame in every browser. Frames held in another are part of it, not slides of their own.
 */
import { observeBoard, readBoard, type BoardView } from '@alcove/board';
import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

const slidesOf = (view: BoardView): readonly string[] => view.frames.filter((f) => !f.f).map((f) => f.id);
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

/** Which slide to show for a section the call says everyone's on: past the last, the last; null when the board has no frames. */
export const slideAt = (slides: readonly string[], section: number): { id: string | null; at: number } => {
  if (!slides.length) return { id: null, at: 0 };
  const at = Math.min(Math.max(0, section), slides.length - 1);
  return { id: slides[at] ?? null, at };
};
