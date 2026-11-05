/*
 * The one pill at the top of a board in a call. Everything the whole board shares goes in it, and only one shows at a time,
 * the most pressing first: someone presenting, a vote under way, a vote's results, following someone, then the timer. Each
 * pill is built by whatever it's about; this only decides which shows, so whoever adds a kind adds it here and nowhere else.
 */
import { BoardPill } from '@alcove/ui';
import type { ReactNode } from 'react';
import type { BoardPerson } from './BoardSurface';

/** What can be in the pill, the most pressing first. */
export const PILL_ORDER = ['presenting', 'voting', 'results', 'following', 'timer'] as const;
export type PillKind = (typeof PILL_ORDER)[number];
/** The pills there are now, by kind. Only the first in `PILL_ORDER` shows. */
export type Pills = Partial<Record<PillKind, ReactNode>>;

/** Following someone: whose view this is, with the way back to your own. */
export function FollowingPill({ person, onStop }: { person: BoardPerson; onStop: () => void }) {
  return <BoardPill icon="eye" title={`Following ${person.name}`} action="Stop" onAction={onStop} />;
}

/** Whichever pill matters most now, or nothing. */
export function BoardPills({ pills }: { pills: Pills }) {
  const kind = PILL_ORDER.find((k) => pills[k] !== undefined && pills[k] !== null && pills[k] !== false);
  return kind ? pills[kind] : null;
}
