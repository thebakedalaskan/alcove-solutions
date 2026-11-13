import { createFileRoute, redirect } from '@tanstack/react-router';
import { arrival } from '~/features/onboarding/store';
import { requireAccount } from '~/lib/guards';
import { q } from '~/lib/queries';

/*
 * Where a new account lands after its first sign-in. What came with it is fetched first, so the
 * account screen can say so as it plays, and the plan with it, so the screen says what opens (a new account's
 * plans come first: features/plans/choice.ts); then, once that screen covers the page, Home loads behind it
 * (and doesn't show through it as it fades in over the welcome page), and the arch opens into it.
 * The team is only asked for: a Google work account's can take a few seconds to put together, and the
 * screen doesn't wait for it.
 */
export const Route = createFileRoute('/ready')({
  beforeLoad: async ({ context: { queryClient: qc }, preload }) => {
    await requireAccount(qc, preload);
    void qc.prefetchQuery(q.trust());
    void qc.prefetchQuery(q.team());
    await Promise.allSettled([qc.ensureQueryData(q.calendar()), qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.plan())]);
    await arrival.begin();
    throw redirect({ to: '/home', replace: true });
  }
});
