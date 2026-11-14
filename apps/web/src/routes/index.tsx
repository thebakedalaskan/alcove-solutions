import { createFileRoute, redirect } from '@tanstack/react-router';
import { signedInHere } from '~/features/account/device';
import { sessionOrOffline } from '~/features/account/guards';

/* The front door: Home when signed in, otherwise the welcome screen. Offline, someone signed in here goes to Record. */
export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const s = await sessionOrOffline(context.queryClient);
    if (s === 'offline') throw redirect({ to: signedInHere() ? '/record' : '/welcome', replace: true });
    throw redirect({ to: s ? '/home' : '/welcome', replace: true });
  }
});
