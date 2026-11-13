/*
 * Signing in on this device: with Google (./googleSignIn.ts), or with a demo account. Signing in changes whose data everything
 * is, so the cache starts over and every tab hears it (lib/signedOut.ts); the session is then read again through the picture
 * fence (features/call/media/backgrounds/backgrounds.ts).
 */
import { AlcoveApiError, type DemoProvider } from '@alcove/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { forgetWords } from '~/features/workspace/find/words';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { announceSignIn } from '~/lib/signedOut';
import { openGoogleSignIn, waitForGoogleReturn } from './googleSignIn';
import { accountQueries } from './queries';
import { accountKeys } from './queryKeys';

/** Google signs in in a popup; the API, rather than its completion message, confirms the session. */
export function useGoogleSignIn() {
  const qc = useQueryClient();
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const mutation = useMutation({
    mutationFn: async ({ finished, signal }: { finished: ReturnType<typeof openGoogleSignIn>; signal: AbortSignal }) => {
      try {
        const result = await finished;
        if (signal.aborted) return null;
        if (!result || result === 'redirecting' || result.type !== 'complete') return result;
        await waitForGoogleReturn(signal);
        if (signal.aborted) return null;
        const session = await api.auth.getSession();
        if (signal.aborted) return null;
        if (!session) throw new AlcoveApiError('unauthenticated', 'Google sign-in didn’t open a session. Try again.');
        return { next: result.next, session };
      } catch (e) {
        if (signal.aborted) return null;
        throw e;
      }
    },
    onSuccess: (r, { signal }) => {
      if (signal.aborted || !r || r === 'redirecting' || !('session' in r)) return;
      forgetWords();
      announceSignIn(r.session.ownerId);
      qc.clear();
      qc.setQueryData(accountKeys.session, r.session);
      // Signing in rotates background access; refresh through the session query to reopen its picture fence.
      void qc.fetchQuery({ ...accountQueries.session(), staleTime: 0 }).catch((e: unknown) => {
        log.child({ component: 'account' }).warn('session could not be refreshed after sign-in', { err: e });
      });
    }
  });
  return {
    start: async (next?: '/move') => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      // Open before handing the promise to the mutation, while the browser still has the button press.
      const finished = openGoogleSignIn((popup) => api.auth.signInUrl('google', { next, popup }), controller.signal);
      const result = await mutation.mutateAsync({ finished, signal: controller.signal });
      return controller.signal.aborted ? null : result;
    },
    cancel: () => pending.current?.abort()
  };
}

/** Signing in or out changes whose data everything is, so the cache starts over. */
export function useSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { provider: DemoProvider; email?: string | undefined }) => api.auth.signIn(v.provider, { email: v.email }),
    onSuccess: (r) => {
      forgetWords();
      if (r.session) announceSignIn(r.session.ownerId);
      qc.clear();
      qc.setQueryData(accountKeys.session, r.session);
      // Cached sign-in data is fresh for a minute. Read the authenticated session now to reopen the picture fence.
      if (r.session) void qc.fetchQuery({ ...accountQueries.session(), staleTime: 0 }).catch((e: unknown) => {
        log.child({ component: 'account' }).warn('session could not be refreshed after sign-in', { err: e });
      });
    }
  });
}
