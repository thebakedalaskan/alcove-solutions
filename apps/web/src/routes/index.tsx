import { createFileRoute, redirect } from '@tanstack/react-router';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/')({
  beforeLoad: async ({ context }) => {
    const s = await context.queryClient.ensureQueryData(q.session());
    throw redirect({ to: s ? '/home' : '/welcome' });
  }
});
