/* Small pieces Home's widgets share. */
import { useEffect, useRef, useState } from 'react';

/** How many rows a widget's list shows before Show N more. */
const FIRST = 5;

/**
 * A widget's list of `rows`: the `first` five, then Show N more, though one more than that shows rather than "Show 1 more".
 * `first` is larger for a list of slimmer rows, as Upcoming's with your own events shown. `shown` is how many to show, and
 * `more` what the widget's foot offers (nothing once they all show). Show more puts focus on the first row that was hidden
 * (the `[data-row]`s under `list`) once it's there, since the button goes with the foot. `open` shows them all without that,
 * for a row that must be seen; `close` goes back to the first ones.
 */
export function useShowMore<T extends HTMLElement>(rows: number, first: number = FIRST) {
  const [all, setAll] = useState(false);
  const list = useRef<T>(null);
  const revealing = useRef(false);
  useEffect(() => {
    if (!revealing.current) return;
    revealing.current = false;
    const listed = list.current ? Array.from(list.current.querySelectorAll('[data-row]')) : [];
    listed[first]?.querySelector<HTMLElement>('a[href], button:not(:disabled)')?.focus();
  });
  const shown = all || rows <= first + 1 ? rows : first;
  const more = shown < rows ? { count: rows - shown, onShow: () => { revealing.current = true; setAll(true); } } : undefined;
  return { list, shown, more, open: () => setAll(true), close: () => setAll(false) };
}
