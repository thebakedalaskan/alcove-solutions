import { AlcoveApiError, errorCode } from '@alcove/api';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { RouteError } from './features/shell/OfflinePage';
import { watchDevice } from './features/account/device';
import { log } from './lib/log';
import { accountKeys } from './features/account/queryKeys';
import { interactiveWrites } from './lib/queryWrites';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  // When the server says the session ended (idle, expired or signed out elsewhere), sign in again.
  const onError = (e: unknown) => {
    // Failed requests are already logged by the API client with their request ID; this catches the rest.
    if (!(e instanceof AlcoveApiError)) log.error('query or mutation failed', { err: e });
    if (errorCode(e) !== 'unauthenticated') return;
    queryClient.setQueryData(accountKeys.session, null);
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
  /**
   * What a page hands the next one in its history entry, never in the address (so it reaches no server and no log).
   * `searched`: the words typed into the palette when See all opened Calls, which Calls puts in its line, and takes out of
   * the entry as it reads them. `scheduleWith`: who a call being scheduled starts with, as addresses, which an address
   * would carry to the web server's logs (features/calls/scheduling/search.ts parses it). The browser keeps history state
   * across reloads and restored sessions, so each is unknown here.
   */
  interface HistoryState { searched?: unknown; scheduleWith?: unknown }
}
