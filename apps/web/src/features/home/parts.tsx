/* Small pieces Home's widgets share. */
import { useEffect, useRef, useState } from 'react';

/**
 * A list's rows in the places they were first shown this visit, so nothing moves under your pointer: a row stays where it is
 * however the rows around it change (answered, ticked, back again after Undo), and a row that's new goes where `order` puts
 * it among them, after the rows it doesn't come before. A row that's gone is let go of, and is new if it comes back.
 */
export function useInPlace<T extends { key: string }>(rows: readonly T[], order: (x: T, y: T) => number): T[] {
  const [keys, setKeys] = useState<readonly string[]>([]);
  const placed = inPlace(keys, rows, order);
  // Only when a row came or went: a render that changes nothing leaves it be.
  if (placed.length !== keys.length || placed.some((row, i) => row.key !== keys[i])) setKeys(placed.map((row) => row.key));
  return placed;
}

/** `rows` in the order of `before` (their keys, as last shown), with each new row placed by `order` among them. */
function inPlace<T extends { key: string }>(before: readonly string[], rows: readonly T[], order: (x: T, y: T) => number): T[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const placed = before.flatMap((key) => byKey.get(key) ?? []);
  const known = new Set(before);
  for (const row of [...rows].sort(order)) {
    if (known.has(row.key)) continue;
    const at = placed.findIndex((p) => order(row, p) < 0);
    placed.splice(at < 0 ? placed.length : at, 0, row);
  }
  return placed;
}

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
