/*
 * The seam left of the people at the window's edge (panels.ts places it): the people's one control. At rest it's a faint grip in
 * the middle of the gap between them and whatever's left of them; point at it and the whole seam lights up. Click it, or drag it
 * the way you want them to go: right makes the people smaller, folding their column into a rail of arches in the same place, and
 * left makes them bigger again. It does what ⇧P does, and changes only your screen.
 */
import { Tooltip, cn } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Box } from './stageLayout';
import { GLIDE } from './Stage';

/** How far the seam is dragged before the people fold or open out. */
const PULL = 36;

export function PeopleSeam({ box, small, onToggle }: {
  box: Box;
  /** They're a rail of arches: the seam opens them out into their column. */
  small: boolean;
  onToggle: () => void;
}) {
  const reduce = useReducedMotion();
  const drag = useRef<{ x: number; done: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const says = small ? 'Make the people bigger' : 'Make the people smaller';
  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, done: false };
    setDragging(true);
  };
  const move = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.done) return;
    const dx = e.clientX - d.x;
    if ((!small && dx > PULL) || (small && dx < -PULL)) { d.done = true; onToggle(); }
  };
  const up = () => setDragging(false);
  // A press that didn't drag far enough is a click; one that did has done its work already.
  const click = () => { const d = drag.current; drag.current = null; if (!d?.done) onToggle(); };
  return (
    <Tooltip side="left" label={`${says}: click, or drag ${small ? 'left' : 'right'} · ⇧P`}>
      <motion.button type="button" className={cn('ic-seam', dragging && 'is-drag')} aria-label={says} aria-keyshortcuts="Shift+P"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={click}
        initial={false} animate={{ left: box.x, top: box.y, width: box.w, height: box.h }} transition={reduce ? { duration: 0 } : GLIDE}>
        <span className="grip" aria-hidden="true" />
      </motion.button>
    </Tooltip>
  );
}
