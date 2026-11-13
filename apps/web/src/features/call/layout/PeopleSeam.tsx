/*
 * The seam left of the people at the window's edge (panels.ts places it): the people's one control. At rest it's a faint grip in
 * the middle of the gap between them and whatever's left of them; point at it and the whole seam lights up. Click it, or drag it
 * the way you want them to go: right makes the people smaller, folding their column into a rail of arches in the same place, and
 * left makes them bigger again. A drag that goes the other way, or not far enough, does nothing. It does what ⇧P does, and
 * changes only your screen.
 */
import { Tooltip, cn } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Box } from '../stage/stageLayout';
import { GLIDE } from '../stage/Stage';

/** How far the seam is dragged before the people fold or open out. */
const PULL = 36;
/** A press that moves further than this is a drag, never a click. */
const SLOP = 4;

export function PeopleSeam({ box, small, onToggle }: {
  box: Box;
  /** They're a rail of arches: the seam opens them out into their column. */
  small: boolean;
  onToggle: () => void;
}) {
  const reduce = useReducedMotion();
  /** The press under way, or the last one: where it started, whether it moved, and whether it has already done its work. */
  const press = useRef<{ x: number; y: number; moved: boolean; done: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const says = small ? 'Make the people bigger' : 'Make the people smaller';
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, moved: false, done: false };
    setDragging(true);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    // Only while the press is held: pointing at the seam afterwards moves nothing.
    if (!p || (e.buttons & 1) === 0) return;
    const dx = e.clientX - p.x;
    if (Math.hypot(dx, e.clientY - p.y) > SLOP) p.moved = true;
    if (p.done) return;
    if ((!small && dx > PULL) || (small && dx < -PULL)) { p.done = true; onToggle(); }
  };
  const up = () => setDragging(false);
  // A press the browser takes back (a scroll, a lost pointer) ends with no click, so nothing of it is kept.
  const cancel = () => { press.current = null; setDragging(false); };
  // From the keyboard (Enter, Space) a click is the whole press. From a pointer it's a click only if the press didn't move.
  const click = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    if (e.detail !== 0 && p && (p.moved || p.done)) return;
    onToggle();
  };
  return (
    <Tooltip side="left" label={`${says}: click, or drag ${small ? 'left' : 'right'} · ⇧P`}>
      <motion.button type="button" className={cn('ic-seam', dragging && 'is-drag')} aria-label={says} aria-keyshortcuts="Shift+P"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onClick={click}
        initial={false} animate={{ left: box.x, top: box.y, width: box.w, height: box.h }} transition={reduce ? { duration: 0 } : GLIDE}>
        <span className="grip" aria-hidden="true" />
      </motion.button>
    </Tooltip>
  );
}
