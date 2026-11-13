/*
 * Signed out in another tab, or the account deleted there (lib/signedOut.ts): a page that shows what's written for the account
 * (the frame, and the page a call leaves you on, which is outside it) goes to the welcome page at once and says why. What it
 * had read is forgotten: it was deleted on purpose there, so this tab mustn't go on showing it, or saying that it's safe.
 */
import { useToast } from '@alcove/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { log } from '~/lib/log';
import { q } from '~/lib/queries';
import { onSignedOutElsewhere } from '~/lib/signedOut';

const alog = log.child({ component: 'account' });

/** Leaves for the welcome page, forgetting everything read here, once `owner` signs out in another tab. Nothing for null. */
export function useSignedOutElsewhere(owner: string | null): void {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  useEffect(() => onSignedOutElsewhere((who, deleted) => {
    if (who !== owner) return;
    alog.info('signed out in another tab', { deleted });
    qc.clear();
    qc.setQueryData(q.session().queryKey, null);
    void navigate({ to: '/welcome', replace: true });
    toast(deleted ? 'Your account was deleted in another tab.' : 'You signed out in another tab.', { icon: 'signOut' });
  }), [owner, qc, navigate, toast]);
}
