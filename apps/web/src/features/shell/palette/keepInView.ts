/*
 * Something lit in the palette, kept in view: the lit row of a list as ↑ and ↓ move it, or the lit line of a moment's
 * transcript in the preview (Preview.tsx). Whatever box it's in scrolls, never the page or the window.
 */

/** Room left above and below the lit row. */
const ROOM = 8;

/** The nearest box around `el` that scrolls. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if ((overflowY === 'auto' || overflowY === 'scroll') && at.scrollHeight > at.clientHeight) return at;
  }
  return null;
}

/**
 * Scrolls the nearest scrolling box around `el` just enough to show it, with a little room around it: a row of a list,
 * or the lit line of a preview's transcript. A row under a call's head (`.pal-head`, in a list only) shows the head too.
 * `first`: it's the first row of its list, so the list goes back to its top, with what's above the row.
 */
export function keepInView(el: HTMLElement, first: boolean): void {
  const box = scrollerOf(el);
  if (!box) return;
  if (first) { box.scrollTop = 0; return; }
  const above = el.previousElementSibling;
  const head = above?.classList.contains('pal-head') ? above : el;
  const top = head.getBoundingClientRect().top;
  const bottom = el.getBoundingClientRect().bottom;
  const view = box.getBoundingClientRect();
  if (top < view.top + ROOM) box.scrollTop -= view.top + ROOM - top;
  else if (bottom > view.bottom - ROOM) box.scrollTop += bottom - (view.bottom - ROOM);
}
