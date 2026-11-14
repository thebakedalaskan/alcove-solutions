/*
 * Visits (docs: Plans and usage › Team): the app says someone is using Alcove when it opens signed in, and when a tab comes
 * back after 30 minutes or more hidden, never on a timer and never from the reads that poll in the background. On a team a
 * visit can take a license, so the plan, the team and what a license opens are read again after it (`useVisit`).
 */
import { errorCode } from '@alcove/api';
import { useEffect, useRef } from 'react';
import { log } from '~/lib/log';
import { useVisit } from '~/features/team/queries';

const vlog = log.child({ component: 'visits' });
/** How long a tab is hidden before coming back to it is a visit. */
const AWAY_MS = 30 * 60_000;

/** One visit as the shell opens for `owner`, and one each time this tab comes back after 30 minutes or more away. */
export function useVisits(owner: string | null, offline: boolean): void {
  const visit = useVisit();
  const send = useRef(visit.mutate);
  send.current = visit.mutate;
  useEffect(() => {
    if (owner === null || offline) return;
    const go = (why: 'opened' | 'back') => send.current(undefined, {
      onError: (e) => vlog.info('a visit wasn’t taken', { why, code: errorCode(e) })
    });
    go('opened');
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;
    const seen = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= AWAY_MS) go('back');
    };
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [owner, offline]);
}
