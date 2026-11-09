import { AlcoveApiError, errorCode } from '@alcove/api';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { RouteError } from './features/shell/OfflinePage';
import { watchDevice } from './lib/device';
import { log } from './lib/log';
import { qk } from './lib/queries';
import { interactiveWrites } from './lib/queryWrites';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  // When the server says the session ended (idle, expired or signed out elsewhere), sign in again.
  const onError = (e: unknown) => {
    // Failed requests are already logged by the API client with their request ID; this catches the rest.
    if (!(e instanceof AlcoveApiError)) log.error('query or mutation failed', { err: e });
    if (errorCode(e) !== 'unauthenticated') return;
    queryClient.setQueryData(qk.session, null);
    if (!router.state.location.pathname.startsWith('/welcome')) void router.navigate({ to: '/welcome' });
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    // A request that didn't get through is tried twice more, unless there's no connection at all: then the screen says so at once.
    defaultOptions: { mutations: interactiveWrites, queries: { staleTime: 20_000, retry: (n, e) => n < 2 && errorCode(e) === 'network' && navigator.onLine, refetchOnWindowFocus: false } }
  });
  watchDevice(queryClient);
  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultPendingMinMs: 0,
    defaultErrorComponent: RouteError,
    // Notes or a series that have gone are a page saying so, and the API client logged the refusal: nothing crashed.
    defaultOnCatch: (err) => { if (errorCode(err) !== 'not-found') log.error('screen crashed', { err }); }
  });
  return router;
}

declare module '@tanstack/react-router' {
  interface Register { router: ReturnType<typeof getRouter> }
}
