/* Plans' data: the plan and what's on offer, buying Pro, more notes and Team's licenses, and adding money. */
import { errorCode, type Plan, type Purchase, type TopUp } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { teamKeys } from '~/features/team/queryKeys';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { planKeys } from './queryKeys';

/** Whether money can still arrive for a top-up: it's waiting, arriving or short. */
export const topUpOpen = (t: TopUp): boolean => t.state === 'waiting' || t.state === 'arriving' || t.state === 'short';

/** The top-ups list's key, carrying its type, for reading what it held before. */
const topUpsKey = queryOptions({ queryKey: planKeys.topUps, queryFn: (): Promise<TopUp[]> => api.plans.topUps() }).queryKey;

export const planQueries = {
  /** The plan: notes left, storage and the balance. Read again every minute, so notes left follows calls. */
  plan: () => queryOptions({ queryKey: planKeys.plan, queryFn: () => api.plans.plan(), refetchInterval: 60_000 }),
  /** The plans on offer: what each brings, and what Pro costs now (buying sends this price back). */
  offers: () => queryOptions({ queryKey: planKeys.offers, queryFn: () => api.plans.offers(), staleTime: 5 * 60_000 }),
  /**
   * The ways to add money. A server that can't take payments answers unavailable: nothing says so, the way to
   * add money just isn't there, and it isn't asked again for a while.
   */
  topUpRoutes: () => queryOptions({ queryKey: planKeys.topUpRoutes, queryFn: () => api.plans.routes(), staleTime: 10 * 60_000, retry: false }),
  /**
   * Top-ups still open, and the last few finished; read again every 30 seconds while one is open, so a payment that
   * settles with the sheet closed shows on Plan. A server that can't take payments answers unavailable:
   * there's nothing to show.
   */
  topUps: () => queryOptions({
    queryKey: planKeys.topUps,
    queryFn: async ({ client }) => {
      const was = client.getQueryData(topUpsKey)?.filter(topUpOpen) ?? [];
      const list = await api.plans.topUps();
      // One that was on its way has been added since: the balance catches up.
      if (list.some((t) => t.state === 'credited' && was.some((w) => w.id === t.id))) void client.invalidateQueries({ queryKey: planKeys.plan });
      return list;
    },
    refetchInterval: (query) => (query.state.data?.some(topUpOpen) ? 30_000 : false),
    retry: false
  }),
  /**
   * One top-up, read again every 5 seconds while money can still arrive. Once it has finished, the list catches up,
   * and the balance too when money was added.
   */
  topUp: (id: string) => queryOptions({
    queryKey: planKeys.topUp(id),
    queryFn: async ({ client }) => {
      const t = await api.plans.topUp(id);
      if (!topUpOpen(t)) void client.invalidateQueries({ queryKey: planKeys.topUps });
      if (t.state === 'credited') void client.invalidateQueries({ queryKey: planKeys.plan });
      return t;
    },
    refetchInterval: (query) => (query.state.data && topUpOpen(query.state.data) ? 5000 : false)
  })
};

/* ---------- buying Pro, more notes and Team's licenses ---------- */

const plog = log.child({ component: 'plans' });

/**
 * Licenses were just bought for the team you run (from the balance, or by a payment that bought them). You're using Alcove,
 * so it's a visit, which takes one of them for you when you have no live license (docs: Plans and usage › Team); then the
 * plan and the team are read again, so what's said next is what's true. A visit that isn't taken is logged and leaves yours
 * for your next one. Null when the plan couldn't be read again: it's read again as soon as anything asks.
 */
async function licensesBought(qc: QueryClient): Promise<Plan | null> {
  try {
    await api.auth.visit();
  } catch (e) {
    plog.info('a visit after buying licenses wasn’t taken', { code: errorCode(e) });
  }
  void qc.invalidateQueries({ queryKey: teamKeys.teamNotes });
  const [plan, team] = await Promise.allSettled([api.plans.plan(), api.teams.mine()]);
  if (team.status === 'fulfilled') qc.setQueryData(teamKeys.myTeam, team.value); else void qc.invalidateQueries({ queryKey: teamKeys.myTeam });
  if (plan.status === 'fulfilled') return plan.value;
  plog.info('the plan wasn’t read again after buying licenses', { code: errorCode(plan.reason) });
  return null;
}

/**
 * Buys a purchase from the balance at the price (and, for more notes, the size) shown: Pro's months, packs of more notes for
 * this period, or licenses for the team you run, a period at a time or for a year (then it's a visit too, which takes yours
 * if you have none). Refused when the price changed (409, with the server's words), the balance is short, or you don't run
 * the team; either way the plan, offers and team are read again, so what's shown is what's true now. Null when it was
 * bought but the plan couldn't be read again.
 */
export function useBuy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: Purchase): Promise<Plan | null> => {
      if (b.kind === 'pro') return api.plans.buyPro(b.months, b.microUsdPerMonth);
      if (b.kind === 'hours') return api.plans.buyHours(b.packs, b.microUsdPerPack, b.minutesPerPack);
      await api.teams.buyLicenses(b.count, b.microUsdPerLicense, b.periods);
      return licensesBought(qc);
    },
    // What's open on the plan (the side panel, Settings, a call's notes) follows at once.
    onSuccess: (p) => {
      if (p) qc.setQueryData(planKeys.plan, p); else void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true });
      void qc.invalidateQueries({ queryKey: planKeys.topUps });
    },
    // `plan` is the offers' prefix: both are read again, and the team with them when it was licenses.
    onError: (_e, b) => {
      void qc.invalidateQueries({ queryKey: planKeys.plan });
      if (b.kind === 'licenses') void qc.invalidateQueries({ queryKey: teamKeys.myTeam });
    }
  });
}

/** A payment bought licenses for the team you run: the visit and the reads buying them from the balance makes. */
export function useLicensesBought() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => licensesBought(qc),
    onSuccess: (p) => { if (p) qc.setQueryData(planKeys.plan, p); else void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true }); }
  });
}

/** Refunds the months of Pro that haven't started to the balance. */
export function useRefundPro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.plans.refundPro(),
    onSuccess: (p) => { qc.setQueryData(planKeys.plan, p); },
    onError: () => { void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true }); }
  });
}

/** Turns buying a month from the balance as Pro is about to end on or off. */
export function useSetRenew() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (renew: boolean) => api.plans.setRenew(renew),
    onSuccess: (p) => { qc.setQueryData(planKeys.plan, p); },
    onError: () => { void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true }); }
  });
}

/** Stops showing one of the plan's notices, here and in the side panel. */
export function useDismissPlanNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.plans.dismissNotice(id),
    onSuccess: (p) => { qc.setQueryData(planKeys.plan, p); },
    onError: () => { void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true }); }
  });
}

/**
 * Says the plans were shown (`Plan.choose` is false from then; saying it again changes nothing), once the plan choice or Plans
 * itself has been on screen (features/plans/choice.ts). Nobody waits on it, so it's quiet: tried again a few times, and
 * held while there's no connection, and a failure is logged and never shows the plans again in this tab. They show once
 * more on a later visit, since the server still says they haven't been. It keeps going if the page that asked goes.
 */
export function useChosePlans() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['plan', 'chosen'],
    mutationFn: () => api.plans.chose(),
    networkMode: 'online',
    retry: 4,
    retryDelay: (n) => Math.min(30_000, 2000 * 2 ** n),
    onSuccess: (p) => { qc.setQueryData(planKeys.plan, p); plog.debug('the plans are marked shown', { choose: p.choose }); },
    onError: (e) => { plog.warn('the plans weren’t marked shown; they show again on a later visit', { code: errorCode(e) }); }
  });
}

/* ---------- adding money ---------- */

/**
 * Opens a top-up on a route: the address to pay to. It joins the open ones on Plan. With `buys`, what it's for is bought
 * the moment it's added; a refusal (a changed price) reads the plan and the offers again, as buying does.
 */
export function useStartTopUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ routeId, microUsd, buys = null }: { routeId: string; microUsd: number; buys?: Purchase | null | undefined }) => api.plans.startTopUp(routeId, microUsd, buys),
    onSuccess: (t) => { qc.setQueryData(planQueries.topUp(t.id).queryKey, t); void qc.invalidateQueries({ queryKey: planKeys.topUps }); },
    onError: (_e, { buys }) => { if (buys) void qc.invalidateQueries({ queryKey: planKeys.plan }); }
  });
}

/** Cancels a top-up nothing has reached: it leaves the open ones on Plan. */
export function useCancelTopUp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.plans.cancelTopUp(id),
    onSuccess: (t) => {
      qc.setQueryData(planQueries.topUp(t.id).queryKey, t);
      // It leaves the open ones at once, before the list is read again.
      qc.setQueryData(topUpsKey, (list) => list?.map((x) => (x.id === t.id ? t : x)));
      void qc.invalidateQueries({ queryKey: planKeys.topUps });
      void qc.invalidateQueries({ queryKey: planKeys.plan });
    },
    // Refused because a payment just reached it, say: read it again, so the address goes now.
    onError: (_e, id) => { void qc.invalidateQueries({ queryKey: planKeys.topUp(id) }); void qc.invalidateQueries({ queryKey: planKeys.topUps }); }
  });
}
