/*
 * What's round every page, signed in or not, a call and a recording included: the query client, the theme, tooltips, toasts and
 * checkout, with a new account's arrival, rings, browser notifications and the tab's attention. It keeps this build in the
 * browser, so Alcove opens without a connection. routes/__root.tsx renders it inside the document.
 */
import { ThemeProvider, ToastProvider, TooltipProvider } from '@alcove/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { RingHost } from '~/features/calls/ringing/RingHost';
import { Arrival } from '~/features/onboarding/Arrival';
import { CheckoutProvider } from '~/features/plans/checkout';
import { CheckoutHost } from '~/features/plans/CheckoutHost';
import { useNotifications } from '~/features/notifications/notify';
import { TabAttention } from '~/features/notifications/TabAttention';
import { registerServiceWorker } from '~/lib/serviceWorker';

export function AppRoot({ queryClient }: { queryClient: QueryClient }) {
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

/** Browser notifications for whoever is signed in, on every page, a call or a recording included (features/notifications/notify.ts). */
function Notifications() {
  useNotifications();
  return null;
}
