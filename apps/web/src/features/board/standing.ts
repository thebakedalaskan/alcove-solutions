/*
 * How a board stands, as its seal and its pill say it, on its own page and in a call alike: sealed, Reconnecting, Couldn't save,
 * or View only. The seal, what it says on hover and what pressing it says are one standing in the same words, and Reconnecting
 * and Couldn't save take the board's pill too (`standing`, the first of `PILL_ORDER`), with Try again where something kept here
 * can go again. What the board says while all's well is each place's own: on its page where it's saved, and in a call who can
 * add to it, whether the notes read it, and in a room who can see it.
 */
import type { DocSession, DocStatus } from '@alcove/api';
import type { IconName } from '@alcove/ui';
import { useEffect, useRef, useState } from 'react';
import type { Transaction } from 'yjs';

/** A line the seal's pop says. */
export interface PopRow { icon: IconName; text: string }

/** What the seal says, with its icon and what it says on hover; what pressing it says; and the pill, while there's something to say there. */
export interface Standing {
  seal: string;
  icon: IconName;
  title: string;
  pop: { title: string; rows: PopRow[] };
  pill?: { icon: IconName; title: string; text: string; action?: { label: string; run: () => void } | undefined } | undefined;
}

/** What a board says while all's well: its seal, what that says on hover, and what pressing it says. */
export interface Sealed { seal: string; title: string; rows: PopRow[] }

export const UNREAD: PopRow = { icon: 'sealed', text: 'Alcove can’t read it.' };

/** A board's own page while all's well: Sealed, where it's kept for someone who may know, and that Alcove can't read it. */
export const sealedOnPage = (kept: PopRow | null): Sealed => ({ seal: 'Sealed', title: 'Sealed. Alcove can’t read this board.', rows: [...(kept ? [kept] : []), UNREAD] });

export interface StandingFacts {
  /** How its session is doing, or null while there's none. */
  status: DocStatus | null;
  /** There's no connection: what's done here goes once there is. */
  offline: boolean;
  /** Whoever's looking can only look. */
  readOnly: boolean;
  /** How many changes made here aren't saved (`useChangesSinceSaved`). */
  changes: number;
  /** Opens it again, so what's kept here goes again: only where something's kept. */
  tryAgain: (() => void) | undefined;
  /** Where it's saved, for someone who may know, and null for anyone else. */
  kept: PopRow | null;
  /** What it says while all's well. */
  sealed: Sealed;
}

export function standingOf({ status, offline, readOnly, changes, tryAgain, kept, sealed }: StandingFacts): Standing {
  if (readOnly) {
    const text = 'You can look round and follow people.';
    return { seal: 'View only', icon: 'eye', title: `View only. ${text}`, pop: { title: 'View only', rows: [{ icon: 'eye', text }, ...(kept ? [kept] : []), UNREAD] } };
  }
  if (status && (status.status === 'failed' || (status.closed === 'session' && status.unsent))) {
    const text = changes > 1 ? `Your last ${changes} changes are only here.` : 'Your last change is only here.';
    return {
      seal: 'Not saved', icon: 'cloudOff', title: `Couldn’t save. ${text}`, pop: { title: 'Couldn’t save', rows: [{ icon: 'cloudOff', text }, UNREAD] },
      pill: { icon: 'cloudOff', title: 'Couldn’t save', text, action: tryAgain && { label: 'Try again', run: tryAgain } }
    };
  }
  if (offline) {
    const text = 'Keep going. Your changes are safe here.';
    return { seal: 'Reconnecting', icon: 'wifiOff', title: `Reconnecting. ${text}`, pop: { title: 'Reconnecting', rows: [{ icon: 'wifiOff', text }, UNREAD] }, pill: { icon: 'wifiOff', title: 'Reconnecting', text } };
  }
  return { seal: sealed.seal, icon: 'sealed', title: sealed.title, pop: { title: sealed.seal, rows: sealed.rows } };
}

/** How long changes go on counting as one, so a drag or a sentence is one change and not a hundred. */
const ONE_CHANGE_MS = 1_000;

/**
 * How many changes made here haven't been saved: each run of edits with no pause in it is one, counted from when everything
 * was last saved. It's what Couldn't save says is only on this screen. With no session, there's nothing to count.
 */
export function useChangesSinceSaved(session: DocSession | null, status: DocStatus | null): number {
  const doc = session?.doc ?? null;
  const [count, setCount] = useState(0);
  const last = useRef(0);
  const saved = status === null || (status.status === 'saved' && !status.unsent);
  useEffect(() => { if (saved) setCount(0); }, [saved]);
  useEffect(() => {
    if (!doc) return undefined;
    const changed = (tr: Transaction) => {
      // Someone else's, or nothing at all, such as the board reading itself as it opens.
      if (!tr.local || (tr.changed.size === 0 && tr.deleteSet.clients.size === 0)) return;
      const now = Date.now();
      if (now - last.current > ONE_CHANGE_MS) setCount((n) => n + 1);
      last.current = now;
    };
    doc.on('afterTransaction', changed);
    return () => doc.off('afterTransaction', changed);
  }, [doc]);
  return count;
}
