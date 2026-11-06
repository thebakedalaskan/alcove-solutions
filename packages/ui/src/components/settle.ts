/* A menu's presses, which wait for its rows to settle: one rule for every menu in the kit. */
import { useLayoutEffect, useRef } from 'react';

/**
 * How long a menu ignores presses after its rows move, as when a list comes in under an open menu: the row under the
 * pointer then may not be the one someone aimed at, so they press again once they've seen where things are.
 */
const SETTLE_MS = 400;

/**
 * Presses that wait for a menu's rows to settle. `order` says what its rows are, in order, each by what it is (an item by its
 * `id`): a change once the menu is open is a move, and for `SETTLE_MS` after one a press does nothing. Each row's action goes
 * through what this returns.
 */
export function useSettledPress(order: string): (act: () => void) => () => void {
  const was = useRef(order);
  const moved = useRef(-Infinity);
  useLayoutEffect(() => {
    if (was.current === order) return;
    was.current = order;
    moved.current = performance.now();
  }, [order]);
  return (act) => () => { if (performance.now() - moved.current >= SETTLE_MS) act(); };
}
