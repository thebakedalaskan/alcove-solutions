/*
 * The people's own button beside what's open on your stage (panels.ts places it): Hide the people, over their column or at
 * the end of their row of arches, and once they're hidden, Show the people, first on the horizon by the dock. It does what ⇧P
 * does, for anyone who doesn't know the key, and changes only your screen.
 */
import { Icon, Tooltip, cn, type IconName } from '@alcove/ui';
import { motion, useReducedMotion } from 'motion/react';
import type { Box } from './stageLayout';
import { GLIDE } from './Stage';

export function PeopleAside({ box, hidden, row, onToggle }: {
  box: Box;
  /** They're on the horizon: it brings them back. */
  hidden: boolean;
  /** They sit, or come back, as a row of arches over what's open (a narrow stage), not a column at its right. */
  row: boolean;
  onToggle: () => void;
}) {
  const reduce = useReducedMotion();
  const icon: IconName = row ? (hidden ? 'panelTopOpen' : 'panelTopClose') : hidden ? 'panelRightOpen' : 'panelRightClose';
  return (
    <Tooltip label={hidden ? 'Show the people beside it · ⇧P' : 'Hide the people: they wait small by the dock · ⇧P'}>
      <motion.button type="button" className={cn('ic-aside', hidden && 'is-hidden')} aria-label={hidden ? 'Show the people' : 'Hide the people'} aria-keyshortcuts="Shift+P"
        onClick={onToggle} initial={false} animate={{ left: box.x, top: box.y, width: box.w, height: box.h }} transition={reduce ? { duration: 0 } : GLIDE}>
        <Icon name={icon} size={17} />
      </motion.button>
    </Tooltip>
  );
}
