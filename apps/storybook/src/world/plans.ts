/*
 * The plan Art is on, in the demo world (docs: Plans and usage): the Free plan by default, with the states a page or a call
 * shows when a limit is near, reached or passed, and Pro bought from the balance, with what Art is told as it ends or
 * renews. Notes are time: what's left of the period's allowance, as an estimate. Storage is against the plan's limit, in
 * the binary units the API sets them in. Made up, as everything in the demo world is.
 */
import type { BalanceEntry, Plan, PlanNotice, PlanOffers, ProMonth } from '@alcove/api';
import { iso, on } from './clock';

const MiB = 2 ** 20;
const GiB = 2 ** 30;

/** What Free brings a period: 5 hours of notes, 10 GB of storage, files up to 512 MB. */
const FREE = { minutes: 300, storage: 10 * GiB, file: 512 * MiB } as const;
/** What Pro brings a period: 50 hours of notes, 100 GB, and files up to 512 MB until downloads can resume. */
const PRO = { minutes: 3000, storage: 100 * GiB, file: 512 * MiB } as const;
/** How long a period, and a month of Pro, is. */
export const PERIOD_DAYS = 30;
const PERIOD_MS = PERIOD_DAYS * 86_400_000;
/** What Pro costs a month: $20. */
export const PRO_PRICE = 20_000_000;

/** The plans on offer, as the server's limits set them. */
export const PLAN_OFFERS: PlanOffers = {
  periodDays: PERIOD_DAYS,
  free: { notesMinutes: FREE.minutes, storageBytes: FREE.storage, fileBytes: FREE.file },
  pro: { notesMinutes: PRO.minutes, storageBytes: PRO.storage, fileBytes: PRO.file, microUsdPerMonth: PRO_PRICE, maxMonths: 12, yearly: { fromMonths: 12, microUsdPerMonth: 16_000_000 } },
  hours: { minutes: 600, microUsd: 15_000_000, maxPacks: 5 }
};
/** Nothing of Pro bought. */
const NO_PRO: Plan['pro'] = { months: [], until: null, renew: false, refundableMicroUsd: 0 };

/**
 * Art on Free, the demo afternoon: 3 h 20 min of its 5 hours of notes left, 2.1 GB of 10 GB used, nothing in the balance, and the period renewing in about 12 days.
 */
export const freePlan = (): Plan => ({
  kind: 'free',
  period: { from: iso(-18, 9, 0), to: iso(16, 9, 0) },
  notes: { minutesLeft: 200, minutesPerPeriod: FREE.minutes, stopped: false },
  storage: { usedBytes: Math.round(2.1 * GiB), limitBytes: FREE.storage, fileBytes: FREE.file },
  grace: null,
  over: { storage: false },
  balance: { microUsd: 0, history: [] },
  choose: false,
  pro: NO_PRO,
  notices: []
});

/** A new account on Free: all of the period's notes, nothing stored, and the plans not shown yet. */
export const newPlan = (): Plan => ({
  ...freePlan(),
  period: { from: iso(0, 16, 5), to: iso(30, 16, 5) },
  notes: { minutesLeft: FREE.minutes, minutesPerPeriod: FREE.minutes, stopped: false },
  storage: { usedBytes: 0, limitBytes: FREE.storage, fileBytes: FREE.file },
  choose: true
});

/** Free with `minutes` of notes left. */
export const withNotesLeft = (minutes: number): Plan => {
  const plan = freePlan();
  return { ...plan, notes: { ...plan.notes, minutesLeft: minutes } };
};

/** The period's notes have run out: they stop until it renews. */
export const notesStopped = (): Plan => {
  const plan = freePlan();
  return { ...plan, notes: { ...plan.notes, minutesLeft: 0, stopped: true } };
};

/** Over Free's storage, in grace: 14.2 GB of 10 GB, and everything works as before for 9 more days. */
export const inGrace = (): Plan => {
  const plan = freePlan();
  return {
    ...plan,
    storage: { ...plan.storage, usedBytes: Math.round(14.2 * GiB) },
    grace: { until: iso(9, 9, 0), storage: true }
  };
};

/** The grace is over: uploads have stopped. */
export const overLimits = (): Plan => ({ ...inGrace(), grace: null, over: { storage: true } });

/** A $60 balance, with how it got there: two top-ups, the later one just added. */
export const withBalance = (): Plan => {
  const history: BalanceEntry[] = [
    { id: 'sb-entry-2', at: iso(-2, 11, 30), label: 'Added, 40 USDC', microUsd: 40_000_000 },
    { id: 'sb-entry-1', at: iso(-9, 15, 5), label: 'Added, 20 USDC', microUsd: 20_000_000 }
  ];
  return { ...freePlan(), balance: { microUsd: 60_000_000, history } };
};

/* ---------- Pro ---------- */

/** `months` of Pro back to back from `from` (ms), each a period long, at Pro's price. */
export function monthsFrom(from: number, months: number): ProMonth[] {
  return Array.from({ length: months }, (_, i) => ({
    from: new Date(from + i * PERIOD_MS).toISOString(), to: new Date(from + (i + 1) * PERIOD_MS).toISOString(), microUsd: PRO_PRICE
  }));
}

/**
 * The plan as the months bought make it at `now`: Pro while one covers now, with a fresh period and the whole allowance
 * when the month running is a new one; Free otherwise. Months that have ended go, and those that haven't started can be
 * refunded.
 */
export function withProMonths(plan: Plan, months: ProMonth[], now = Date.now()): Plan {
  const left = months.filter((m) => Date.parse(m.to) > now);
  const running = left.find((m) => Date.parse(m.from) <= now);
  const pro: Plan['pro'] = {
    ...plan.pro, months: left, until: left[left.length - 1]?.to ?? null,
    refundableMicroUsd: left.filter((m) => Date.parse(m.from) > now).reduce((sum, m) => sum + m.microUsd, 0)
  };
  if (!running) return { ...plan, pro };
  const fresh = plan.kind !== 'pro' || plan.period.from !== running.from;
  return {
    ...plan, pro, kind: 'pro',
    period: { from: running.from, to: running.to },
    notes: fresh ? { minutesLeft: PRO.minutes, minutesPerPeriod: PRO.minutes, stopped: false } : plan.notes,
    storage: { ...plan.storage, limitBytes: PRO.storage, fileBytes: PRO.file },
    // Only Pro's limits apply on Pro: any grace is over.
    grace: null, over: { storage: false }
  };
}

const notice = (id: string, kind: PlanNotice['kind'], at: string, until: string): PlanNotice => ({ id, kind, at, until });
/** The demo afternoon the Pro scenarios open on: the world is made before the clock is set to it. */
const AFTERNOON = () => on(0, 16, 12).getTime();

/**
 * Art on Pro: the month running since 10 days ago and two bought after it, renewing off, $35 left of the balance once
 * the three months were bought, and about 41 hours of the period's 50 left.
 */
export const proPlan = (): Plan => {
  const history: BalanceEntry[] = [
    { id: 'sb-entry-pro', at: iso(-10, 10, 0), label: 'Pro, 3 months', microUsd: -3 * PRO_PRICE },
    { id: 'sb-entry-1', at: iso(-10, 9, 50), label: 'Added, 95 USDC', microUsd: 95_000_000 }
  ];
  const plan = withProMonths({ ...freePlan(), balance: { microUsd: 35_000_000, history } }, monthsFrom(on(-10, 10, 0).getTime(), 3), AFTERNOON());
  return { ...plan, notes: { ...plan.notes, minutesLeft: 2460 } };
};

/** The month a period before 3 days from now, so Pro ends then. */
const endingIn3Days = (months: number) => monthsFrom(on(3, 10, 0).getTime() - PERIOD_MS, months);

/** Pro's last month ends in 3 days and won't renew: renewing is off, and $5 doesn't buy a month. */
export const proEnding = (): Plan => {
  const months = endingIn3Days(1);
  const history: BalanceEntry[] = [
    { id: 'sb-entry-pro', at: iso(-27, 10, 0), label: 'Pro, 1 month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-1', at: iso(-27, 9, 55), label: 'Added, 25 USDC', microUsd: 25_000_000 }
  ];
  const plan = withProMonths({ ...freePlan(), balance: { microUsd: 5_000_000, history } }, months, AFTERNOON());
  return { ...plan, notes: { ...plan.notes, minutesLeft: 940 }, notices: [notice('sb-notice-ending', 'pro-ending', iso(0, 10, 0), months[0]?.to ?? iso(3, 10, 0))] };
};

/** Renewing is on, so this morning, 3 days before Pro was to end, a month was bought from the balance: Pro runs a month further. */
export const proRenewed = (): Plan => {
  const months = endingIn3Days(2);
  const history: BalanceEntry[] = [
    { id: 'sb-entry-renew', at: iso(0, 10, 0), label: 'Pro, renewed for a month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-pro', at: iso(-27, 10, 0), label: 'Pro, 1 month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-1', at: iso(-27, 9, 55), label: 'Added, 60 USDC', microUsd: 60_000_000 }
  ];
  const plan = withProMonths({ ...freePlan(), balance: { microUsd: 20_000_000, history } }, months, AFTERNOON());
  return {
    ...plan, notes: { ...plan.notes, minutesLeft: 940 }, pro: { ...plan.pro, renew: true },
    notices: [notice('sb-notice-renewed', 'pro-renewed', iso(0, 10, 0), months[1]?.to ?? iso(33, 10, 0))]
  };
};

/**
 * Pro ended two days ago and Art is back on Free, storing 14.2 GB of Free's 10: everything works as before until the
 * grace after Pro ended is over, 13 days from now.
 */
export const proEnded = (): Plan => {
  const plan = inGrace();
  return {
    ...plan, period: { from: iso(-2, 10, 0), to: iso(28, 10, 0) },
    notes: { minutesLeft: FREE.minutes, minutesPerPeriod: FREE.minutes, stopped: false },
    grace: { until: iso(13, 10, 0), storage: true },
    balance: {
      microUsd: 5_000_000,
      history: [
        { id: 'sb-entry-pro', at: iso(-32, 10, 0), label: 'Pro, 1 month', microUsd: -PRO_PRICE },
        { id: 'sb-entry-1', at: iso(-32, 9, 55), label: 'Added, 25 USDC', microUsd: 25_000_000 }
      ]
    },
    notices: [notice('sb-notice-ended', 'pro-ended', iso(-2, 10, 0), iso(-2, 10, 0))]
  };
};
