/*
 * Plans: what each plan brings and what it costs, on the last of the sunset (features/plans/Plans.tsx). `checkout` opens
 * checkout on Pro or on more notes as the page opens, once, and leaves the address: the welcome page's Get Pro lands here
 * after signing in (`/plans?checkout=pro`).
 */
import { CheckoutParamSchema, type CheckoutParam } from '@alcove/api';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plans } from '~/features/plans/Plans';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/_app/plans')({
  validateSearch: (s: Record<string, unknown>): { checkout?: CheckoutParam | undefined } => {
    const c = CheckoutParamSchema.safeParse(s['checkout']);
    return { checkout: c.success ? c.data : undefined };
  },
  /*
   * The offers and the plan get a moment, so the prices come up with the page, and no longer: if they're slow the cards wait
   * for them in place, and if they don't load the page says so where they'd be.
   */
  loader: async ({ context: { queryClient: qc } }) => {
    if (!navigator.onLine) return;
    await Promise.race([
      Promise.allSettled([qc.ensureQueryData(q.offers()), qc.ensureQueryData(q.plan())]),
      new Promise((r) => setTimeout(r, 1200))
    ]);
  },
  component: PlansPage
});

function PlansPage() {
  const { checkout } = Route.useSearch();
  const navigate = useNavigate();
  return <Plans opening={checkout} onOpened={() => void navigate({ to: '/plans', search: {}, replace: true, resetScroll: false })} />;
}
