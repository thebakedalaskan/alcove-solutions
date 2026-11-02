import { QueryClient } from '@tanstack/react-query';
import { errorCode } from '@alcove/api';
import { createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 20_000, retry: (n, e) => n < 2 && errorCode(e) === 'network', refetchOnWindowFocus: false } }
  });
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultPendingMinMs: 0
  });
}

declare module '@tanstack/react-router' {
  interface Register { router: ReturnType<typeof getRouter> }
}
