/*
 * A board's frames as whoever presents it steps through them: its top-level frames in the order they sit, top to bottom and left
 * to right, as a page is read, so the order can be told from the board itself and moving a frame moves it in the order. Frames
 * held in another are part of it, not stops of their own. The call keeps which one the presenter is on (`section`), for their
 * pager and their notes, and every browser reads the same order. A frame moved into a new place in the order is still the one
 * it was, so each browser holds the presenter's by the frame (`usePresentedFrame`) until the call says its new place.
 */
import { observeBoard, readBoard, type BoardView, type Box } from '@alcove/board';
import { useEffect, useRef, useState } from 'react';
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

/**
 * The frame whoever presents is on, and where it sits in the order now: what the call's `section` says (null while it isn't
 * presented, which holds nothing), held by the frame it meant while the section stays the same. Someone dragging a frame
 * changes the order, and with it which frame a number means; the frame stays the one it was, at its new place, until the call
 * says another section (whoever presents tells it the new place, so every browser means the same frame again), or the frame
 * leaves the board.
 */
export function usePresentedFrame(slides: readonly string[], section: number | null): { id: string | null; at: number } {
  const held = useRef<{ section: number; id: string } | null>(null);
  const was = section === null ? null : held.current;
  const k = was !== null && was.section === section ? slides.indexOf(was.id) : -1;
  const on = was !== null && k >= 0 ? { id: was.id, at: k } : slideAt(slides, section ?? 0);
  // Worked out again the same from the same section and frames, so a render that's thrown away holds nothing it shouldn't.
  held.current = section === null || on.id === null ? null : { section, id: on.id };
  return on;
}
