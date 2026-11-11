/*
 * Where you write beside a note: Your notes, then the shared notes. Wide, it's in the column beside the note, its own
 * scroll area. In one column (1180px and narrower) it comes after what was decided and before the transcript, and it's
 * there in the page's order too, not only on screen, so the keyboard and a screen reader meet it where it's seen. React
 * keeps it in one place, a portal into one element, and this moves that element between the two places as the window
 * crosses 1180px: what's being written in it stays, and so does the keyboard.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMedia } from '~/lib/live';

/** One column, where the note's parts follow one another (note.css). */
const ONE_COLUMN = '(max-width: 1180px)';

/**
 * `inMain` goes between what was decided and the transcript, `beside` in the column beside the note, and `put` renders
 * what goes there. Both places are `.nd-spot`s, which draw no box of their own.
 */
export function useWhereYouWrite() {
  const oneColumn = useMedia(ONE_COLUMN);
  /* The element where you write: this owns it, and it goes with the page, inside whichever place it's in. */
  const [box] = useState(() => {
    const el = document.createElement('div');
    el.className = 'nd-yours';
    return el;
  });
  const inMain = useRef<HTMLDivElement>(null);
  const beside = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const place = (oneColumn ? inMain : beside).current;
    if (!place || box.parentElement === place) return;
    // Moving an element takes the keyboard out of it, so it's put back where it was.
    const focused = document.activeElement instanceof HTMLElement && box.contains(document.activeElement) ? document.activeElement : null;
    place.append(box);
    focused?.focus({ preventScroll: true });
  }, [oneColumn, box]);
  return { inMain, beside, put: (children: ReactNode) => createPortal(children, box) };
}
