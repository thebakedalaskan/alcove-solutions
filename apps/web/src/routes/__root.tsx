import { EmptyState, ThemeProvider, buttonClass, ToastProvider, TooltipProvider, themeBootScript } from '@alcove/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HeadContent, Link, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { RingHost } from '~/features/calls/RingHost';
import { Arrival } from '~/features/onboarding/Arrival';
import { useNotifications } from '~/features/shell/notify';
import { registerServiceWorker } from '~/lib/serviceWorker';
import css from '~/styles/app.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Alcove' },
      { name: 'description', content: 'Meetings, powered by confidential AI: notes that write themselves, live translation and breakout rooms, and nobody else can read a word.' }
    ],
    links: [
      { rel: 'stylesheet', href: css },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
    ],
    scripts: [{ children: themeBootScript }]
  }),
  shellComponent: Document,
  component: Root,
  notFoundComponent: NotFound
});

function Document({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function Root() {
  const { queryClient } = Route.useRouteContext();
  // Keeps this build in the browser, so Alcove opens without a connection.
  useEffect(registerServiceWorker, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            <Outlet />
            <Arrival />
            <RingHost />
            <Notifications />
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/** Browser notifications for whoever is signed in, on every page, a call or a recording included (features/shell/notify.ts). */
function Notifications() {
  useNotifications();
  return null;
}

function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <EmptyState title="Nothing here" action={<Link to="/" className={buttonClass()}>Go home</Link>}>That page doesn’t exist, or it was deleted.</EmptyState>
    </main>
  );
}
