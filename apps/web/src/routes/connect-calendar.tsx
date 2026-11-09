import { createFileRoute, redirect } from '@tanstack/react-router';
import { CalendarConsent } from '~/features/settings/CalendarConsent';
import { requireAccount } from '~/lib/guards';

export const Route = createFileRoute('/connect-calendar')({
  beforeLoad: async ({ context, preload }) => {
    const { account } = await requireAccount(context.queryClient, preload);
    if (account.offline) throw redirect({ to: '/home' });
    if (account.session.provider !== 'google') throw redirect({ to: '/settings', hash: 'calendar' });
  },
  component: CalendarConsent
});
