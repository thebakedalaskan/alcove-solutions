/*
 * The first time you point at a tile you can move, it says so: drag it to move it, and in the grid, pull its corner to make it
 * bigger. There are no layouts to choose; this is how the stage is arranged, and it's said once, in this browser, for your
 * account, never sent anywhere. It watches the pointer over the call's area, so the stage itself is untouched, stands
 * under the tile (or over it, where there's no room below) while the pointer rests there, and goes as it leaves.
 */
import { Coachmark, EASE, cn } from '@alcove/ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { keepTileHinted, tileHinted } from './view';

/** How long the pointer rests on a tile before it's said: passing over one on the way somewhere isn't pointing at it. */
const REST_MS = 450;
/** About how much room it takes under a tile (it's never wider than ROOM_W), and how far it stands from it. */
const ROOM_H = 84;
const ROOM_W = 280;
const SPACE = 10;

/**
 * Where it stands: under the tile, over it (by its foot, so however tall it is it ends above the tile), or, with no room for
 * either, inside the tile near its top; from the tile's left, or from its right where the stage ends soon after it (`end`),
 * pointing at the tile either way. `sizes`: the tile can be made bigger from its corner (it's in the grid).
 */
interface Shown {
  tile: Element; x: { left: number } | { right: number }; at: { top: number } | { bottom: number };
  end: boolean; above: boolean; inside: boolean; sizes: boolean;
}

/** `account`: your account's owner ID, null without one, undefined while that isn't known (nothing is said until it is). */
export function TileHint({ area, account }: { area: RefObject<HTMLElement | null>; account: string | null | undefined }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState<Shown | null>(null);
  // Who you are can come a moment after the call shows: it's read once the pointer has rested, so pointing early still counts.
  const who = useRef(account);
  who.current = account;
  // Watching from the moment the tiles are there: a pointer already resting on one counts as soon as it moves.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || (who.current !== undefined && tileHinted(who.current))) return undefined;
    let resting: ReturnType<typeof setTimeout> | undefined;
    let tile: Element | null = null;
    const movable = (t: EventTarget | null) => (t instanceof Element && !t.closest('button, [data-handle]') ? t.closest('.ic-slot.can-drag:not(.is-corner)') : null);
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const next = movable(e.target);
      if (next === tile) return;
      clearTimeout(resting);
      tile = next;
      if (!next) return;
      resting = setTimeout(() => {
        const a = who.current;
        // Not known yet: the next tile pointed at says it.
        if (a === undefined) { tile = null; return; }
        if (tileHinted(a)) { stop(); return; }
        const box = el.getBoundingClientRect();
        const t = next.getBoundingClientRect();
        const below = t.bottom - box.top + SPACE;
        const above = t.top - box.top - SPACE;
        const fitsBelow = below + ROOM_H <= box.height;
        const fitsAbove = above - ROOM_H >= 0;
        const end = t.left - box.left + 12 + ROOM_W > box.width;
        setShown({
          tile: next, x: end ? { right: Math.max(8, box.right - t.right + 12) } : { left: Math.max(8, t.left - box.left + 12) },
          at: fitsBelow ? { top: below } : fitsAbove ? { bottom: box.height - above } : { top: t.top - box.top + 12 },
          end, above: !fitsBelow && fitsAbove, inside: !fitsBelow && !fitsAbove, sizes: next.querySelector('.ic-rs') !== null
        });
        keepTileHinted(a);
        stop();
      }, REST_MS);
    };
    const stop = () => { clearTimeout(resting); el.removeEventListener('pointerover', over); el.removeEventListener('pointermove', over); };
    el.addEventListener('pointerover', over);
    el.addEventListener('pointermove', over);
    return stop;
  }, [area]);
  /* It stays while the pointer does, and goes as it leaves the tile, or at any press: moving the tile, say. */
  useEffect(() => {
    if (!shown) return undefined;
    const done = () => setShown(null);
    const away = (e: PointerEvent) => { if (!(e.target instanceof Node) || !shown.tile.contains(e.target)) done(); };
    addEventListener('pointerdown', done, { capture: true });
    addEventListener('pointerover', away, { capture: true });
    return () => { removeEventListener('pointerdown', done, { capture: true }); removeEventListener('pointerover', away, { capture: true }); };
  }, [shown]);
  return (
    <AnimatePresence>
      {shown && (
        <motion.div key="hint" className={cn('ic-tilehint', shown.end && 'is-end', shown.above && 'is-above', shown.inside && 'is-inside')} style={{ ...shown.x, ...shown.at }}
          initial={{ opacity: 0, y: reduce ? 0 : shown.above ? 4 : -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.24, ease: EASE.out }}>
          <Coachmark title="Drag a tile to move it">{shown.sizes ? 'Pull its corner to make it bigger. Only your view changes.' : 'Only your view changes.'}</Coachmark>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
