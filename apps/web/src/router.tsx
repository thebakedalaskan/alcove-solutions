import { AlcoveApiError, errorCode } from '@alcove/api';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { log } from './lib/log';
import { qk } from './lib/queries';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  // When the server says the session ended (idle, expired, or the server restarted), go unlock again.
  const onError = (e: unknown) => {
    const c = errorCode(e);
    // Failed requests are already logged by the API client with their request ID; this catches the rest.
    if (!(e instanceof AlcoveApiError)) log.error('query or mutation failed', { err: e });
    if (c !== 'locked' && c !== 'unauthenticated') return;
    queryClient.setQueryData(qk.session, null);
    if (!router.state.location.pathname.startsWith('/welcome')) void router.navigate({ to: '/welcome', search: { ended: c === 'locked' ? true : undefined } });
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: { queries: { staleTime: 20_000, retry: (n, e) => n < 2 && errorCode(e) === 'network', refetchOnWindowFocus: false } }
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultPendingMinMs: 0,
    defaultOnCatch: (err) => log.error('screen crashed', { err })
  });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register { router: ReturnType<typeof getRouter> }
}
