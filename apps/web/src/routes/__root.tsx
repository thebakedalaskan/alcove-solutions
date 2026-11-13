import { ThemeProvider, ToastProvider, TooltipProvider, themeBootScript } from '@alcove/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HeadContent, Outlet, Scripts, createRootRouteWithContext, useRouter } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { RingHost } from '~/features/calls/ringing/RingHost';
import { Arrival } from '~/features/onboarding/Arrival';
import { CheckoutProvider } from '~/features/plans/checkout';
import { CheckoutHost } from '~/features/plans/CheckoutHost';
import { useNotifications } from '~/features/shell/notify';
import { TabAttention } from '~/features/shell/TabAttention';
import { registerServiceWorker } from '~/lib/serviceWorker';
import css from '~/styles/app.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Alcove' },
      { name: 'description', content: 'Video calls with built-in transcripts, summaries, live translation and breakout rooms.' }
    ],
    links: [
      { rel: 'stylesheet', href: css },
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
    ],
    scripts: [{ children: themeBootScript }]
  }),
  shellComponent: Document,
  component: Root
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
  const router = useRouter();
  // Keeps this build in the browser, so Alcove opens without a connection.
  useEffect(registerServiceWorker, []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <ToastProvider>
            {/* Checkout, over whatever page is open: Compare plans leaves it for Plans. */}
            <CheckoutProvider window={(open, close, leave) => <CheckoutHost open={open} onClose={close} onCompare={() => { leave(); void router.navigate({ to: '/plans' }); }} />}>
              <Outlet />
              <Arrival />
              <RingHost />
              <Notifications />
              <TabAttention />
            </CheckoutProvider>
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
