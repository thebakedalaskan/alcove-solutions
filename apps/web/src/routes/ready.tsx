import { createFileRoute, redirect } from '@tanstack/react-router';
import { arrival } from '~/features/onboarding/store';
import { requireAccount } from '~/lib/guards';
import { q } from '~/lib/queries';

/*
 * Where a new account lands after its first sign-in. What came with it is fetched first, so the
 * account screen can say so as it plays; then Home loads behind that screen, and the arch opens into it.
 */
export const Route = createFileRoute('/ready')({
  beforeLoad: async ({ context: { queryClient: qc }, preload }) => {
    await requireAccount(qc, preload);
    void qc.prefetchQuery(q.trust());
    await Promise.allSettled([qc.ensureQueryData(q.calendar()), qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.team())]);
    arrival.begin();
    throw redirect({ to: '/home', replace: true });
  }
});
