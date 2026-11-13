/*
 * The plan Art is on, in the demo world (docs: Plans and usage): the Free plan by default, with the states a page or a call
 * shows when a limit is near, reached or passed, and Pro bought from the balance, with what Art is told as it ends or
 * renews. Notes are time: what's left of the period's allowance, as an estimate. Storage is against the plan's limit, in
 * the binary units the API sets them in. Made up, as everything in the demo world is.
 */
import type { BalanceEntry, Plan, PlanNotice, PlanOffers, ProMonth, Purchase } from '@alcove/api';
import { iso, on } from './clock';

const MiB = 2 ** 20;
const GiB = 2 ** 30;

/** What Free brings a period: 5 hours of notes, 10 GB of storage, files up to 512 MB. */
export const FREE = { minutes: 300, storage: 10 * GiB, file: 512 * MiB } as const;
/** What Pro brings a period: 50 hours of notes, 100 GB, and files up to 512 MB until downloads can resume. */
const PRO = { minutes: 3000, storage: 100 * GiB, file: 512 * MiB } as const;
/** What a team license brings each person a period: 50 hours of notes, 100 GB to the team's pool, files up to 512 MB. */
export const TEAM = { minutes: 3000, storage: 100 * GiB, file: 512 * MiB } as const;
/** What a team license costs: $40, for one person for a period. */
export const LICENSE_PRICE = 40_000_000;
/** A team license for a year: one person for 12 periods at $32 a period ($384), 20% off. */
export const LICENSE_YEAR = { periods: 12, microUsdPerLicense: 32_000_000 } as const;
/** How long a period, and a month of Pro, is. */
export const PERIOD_DAYS = 30;
export const PERIOD_MS = PERIOD_DAYS * 86_400_000;
/** What Pro costs a month: $20. */
export const PRO_PRICE = 20_000_000;

/** The plans on offer, as the server's limits set them. */
export const PLAN_OFFERS: PlanOffers = {
  periodDays: PERIOD_DAYS,
  free: { notesMinutes: FREE.minutes, storageBytes: FREE.storage, fileBytes: FREE.file },
  pro: { notesMinutes: PRO.minutes, storageBytes: PRO.storage, fileBytes: PRO.file, microUsdPerMonth: PRO_PRICE, maxMonths: 12, yearly: { fromMonths: 12, microUsdPerMonth: 16_000_000 } },
  hours: { minutes: 600, microUsd: 15_000_000, maxPacks: 5 },
  team: { notesMinutes: TEAM.minutes, storageBytes: TEAM.storage, fileBytes: TEAM.file, microUsdPerLicense: LICENSE_PRICE, maxLicenses: 500, yearly: { ...LICENSE_YEAR } }
};
/** Nothing of Pro bought. */
export const NO_PRO: Plan['pro'] = { months: [], until: null, renew: false, renewal: null, refundableMicroUsd: 0 };

/**
 * `plan` saying whether renewing will buy the next month as Pro ends, and why not, worked out as the server works it out
 * (apps/api/src/features/billing/plans.ts › notRenewed): none while no month of Pro is left; off; a month costs more now
 * (`price`) than it did when the last was bought (`monthly`); the balance is short of a month; or it buys.
 */
export function withRenewal(plan: Plan, price: number, monthly: number): Plan {
  const renewal: Plan['pro']['renewal'] = plan.pro.until === null ? null
    : !plan.pro.renew ? 'off'
    : price > monthly ? 'price'
    : plan.balance.microUsd < price ? 'short'
    : 'buys';
  return { ...plan, pro: { ...plan.pro, renewal } };
}

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
  notices: [],
  team: null
});

/** A new account on Free: all of the period's notes, nothing stored, and the plans not shown yet. */
export const newPlan = (): Plan => ({
  ...freePlan(),
  period: { from: iso(0, 16, 5), to: iso(30, 16, 5) },
  notes: { minutesLeft: FREE.minutes, minutesPerPeriod: FREE.minutes, stopped: false },
  storage: { usedBytes: 0, limitBytes: FREE.storage, fileBytes: FREE.file },
  choose: true
});

/**
 * An account from before plans, as the release that brought them carried it over two days ago: on Free from then, with all of
 * the period's notes, and the plans not shown yet (Art hasn't opened Alcove since).
 */
export const carriedOver = (): Plan => ({
  ...freePlan(),
  period: { from: iso(-2, 9, 0), to: iso(28, 9, 0) },
  notes: { minutesLeft: FREE.minutes, minutesPerPeriod: FREE.minutes, stopped: false },
  choose: true
});
/** The same, over Free's storage as it was carried over: 14.2 GB of 10 GB, and everything works as before for 13 more days. */
export const carriedOverInGrace = (): Plan => {
  const plan = carriedOver();
  return { ...plan, storage: { ...plan.storage, usedBytes: Math.round(14.2 * GiB) }, grace: { until: iso(13, 9, 0), storage: true } };
};

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

/** `months` of Pro back to back from `from` (ms), each a period long, at `microUsd` a month (Pro's price unless said). */
export function monthsFrom(from: number, months: number, microUsd = PRO_PRICE): ProMonth[] {
  return Array.from({ length: months }, (_, i) => ({
    from: new Date(from + i * PERIOD_MS).toISOString(), to: new Date(from + (i + 1) * PERIOD_MS).toISOString(), microUsd
  }));
}

/** Pro's price a month for buying `months` at once, as the offers have it: the yearly price from its length on. */
export function proPriceOf(offers: PlanOffers, months: number): number {
  const yearly = offers.pro.yearly;
  return yearly && months >= yearly.fromMonths ? yearly.microUsdPerMonth : offers.pro.microUsdPerMonth;
}
/** About how many hours `packs` of more notes are, as the offers have it. */
export const hoursOf = (offers: PlanOffers, packs: number): number => (packs * (offers.hours?.minutes ?? 0)) / 60;

/** How long a team license is bought for, after "license" as the server says it: nothing for one period, " for a year" for 12. */
export const forPeriods = (periods: number): string => (periods <= 1 ? '' : periods === 12 ? ' for a year' : ` for ${periods} months`);
/** "6 licenses", "6 licenses for a year": licenses bought, and how long each runs when it's more than a period. */
export const licensesFor = (count: number, periods: number): string => `${count} ${count === 1 ? 'license' : 'licenses'}${forPeriods(periods)}`;
/** What a purchase costs at the price it carries: licenses are a price a period, for each of their periods. */
export const costOf = (buys: Purchase): number =>
  (buys.kind === 'pro' ? buys.months * buys.microUsdPerMonth : buys.kind === 'licenses' ? buys.count * buys.periods * buys.microUsdPerLicense : buys.packs * buys.microUsdPerPack);

/**
 * `plan` with `buys` bought from its balance, as the server buys it: months of Pro after the last bought (or from now),
 * or more notes for this period, which lift notes that the allowance stopped; and the balance's line for it, `entry`
 * ("Team, 6 licenses for a year"). Whoever calls it has checked that it can be bought.
 */
export function buyFromBalance(plan: Plan, buys: Purchase, entry: string, now = Date.now()): Plan {
  const cost = costOf(buys);
  const label = buys.kind === 'pro' ? `Pro, ${buys.months} ${buys.months === 1 ? 'month' : 'months'}` : buys.kind === 'licenses' ? `Team, ${licensesFor(buys.count, buys.periods)}` : `${(buys.packs * buys.minutesPerPack) / 60} more hours of notes`;
  const line: BalanceEntry = { id: entry, at: new Date(now).toISOString(), label, microUsd: -cost };
  const paid = { ...plan, balance: { microUsd: plan.balance.microUsd - cost, history: [line, ...plan.balance.history] } };
  if (buys.kind === 'pro') {
    const lastTo = Date.parse(plan.pro.until ?? '');
    const from = Number.isFinite(lastTo) && lastTo > now ? lastTo : now;
    return withProMonths(paid, [...plan.pro.months, ...monthsFrom(from, buys.months, buys.microUsdPerMonth)], now);
  }
  // Licenses go to the team (world/teams.ts); the plan only pays for them.
  if (buys.kind === 'licenses') return paid;
  const minutes = buys.packs * buys.minutesPerPack;
  return { ...paid, notes: { minutesLeft: plan.notes.minutesLeft + minutes, minutesPerPeriod: plan.notes.minutesPerPeriod + minutes, stopped: false } };
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

const notice = (id: string, kind: PlanNotice['kind'], at: string, until: string): PlanNotice => ({ id, kind, at, until, count: null, workspaceId: null });
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

/**
 * The month a period before 6 days from now (Tuesday 10 November), so Pro ends then. Its first reminder, a week before the
 * end, came yesterday; the second comes a day before it.
 */
const endingIn6Days = (months: number) => monthsFrom(on(6, 10, 0).getTime() - PERIOD_MS, months);

/**
 * Pro's last month ends in 6 days and won't renew: renewing is off, and $5 doesn't buy a month. Art was told yesterday, a
 * week before.
 */
export const proEnding = (): Plan => {
  const months = endingIn6Days(1);
  const history: BalanceEntry[] = [
    { id: 'sb-entry-pro', at: iso(-24, 10, 0), label: 'Pro, 1 month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-1', at: iso(-24, 9, 55), label: 'Added, 25 USDC', microUsd: 25_000_000 }
  ];
  const plan = withProMonths({ ...freePlan(), balance: { microUsd: 5_000_000, history } }, months, AFTERNOON());
  return { ...plan, notes: { ...plan.notes, minutesLeft: 940 }, notices: [notice('sb-notice-ending', 'pro-ending', iso(-1, 10, 0), months[0]?.to ?? iso(6, 10, 0))] };
};

/**
 * Pro's last month ends in 6 days and won't renew, though renewing is on and $60 is in the balance: a month costs more now
 * than the $20 the last did (the scenario raises the price), and renewing never pays more without Art buying at it first.
 * Art is told Pro is ending.
 */
export const proEndingPriceRose = (): Plan => {
  const plan = proEnding();
  const history: BalanceEntry[] = [
    { id: 'sb-entry-pro', at: iso(-24, 10, 0), label: 'Pro, 1 month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-1', at: iso(-24, 9, 55), label: 'Added, 80 USDC', microUsd: 80_000_000 }
  ];
  return { ...plan, balance: { microUsd: 60_000_000, history }, pro: { ...plan.pro, renew: true } };
};

/** Renewing is on, so yesterday, a week before Pro was to end, a month was bought from the balance: Pro runs a month further. */
export const proRenewed = (): Plan => {
  const months = endingIn6Days(2);
  const history: BalanceEntry[] = [
    { id: 'sb-entry-renew', at: iso(-1, 10, 0), label: 'Pro, renewed for a month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-pro', at: iso(-24, 10, 0), label: 'Pro, 1 month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-1', at: iso(-24, 9, 55), label: 'Added, 60 USDC', microUsd: 60_000_000 }
  ];
  const plan = withProMonths({ ...freePlan(), balance: { microUsd: 20_000_000, history } }, months, AFTERNOON());
  return {
    ...plan, notes: { ...plan.notes, minutesLeft: 940 }, pro: { ...plan.pro, renew: true },
    notices: [notice('sb-notice-renewed', 'pro-renewed', iso(-1, 10, 0), months[1]?.to ?? iso(36, 10, 0))]
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

/* ---------- Pro paid for in one go, renewed, ended ---------- */

/** What a month costs when a year or more is bought at once. */
export const PRO_YEARLY_PRICE = PLAN_OFFERS.pro.yearly?.microUsdPerMonth ?? PRO_PRICE;

/**
 * Pro extended by a year yesterday, paid with 192 USDC on Base at the yearly price, bought from the payment as it was
 * added: the month running since 10 days ago, twelve after it that can be refunded, and $5 left in the balance.
 */
export const proExtended = (): Plan => {
  const history: BalanceEntry[] = [
    { id: 'sb-entry-year', at: iso(-1, 18, 40), label: 'Pro, 12 months', microUsd: -12 * PRO_YEARLY_PRICE },
    { id: 'sb-entry-paid', at: iso(-1, 18, 40), label: 'Added, 192 USDC', microUsd: 12 * PRO_YEARLY_PRICE },
    { id: 'sb-entry-pro', at: iso(-10, 10, 0), label: 'Pro, 1 month', microUsd: -PRO_PRICE },
    { id: 'sb-entry-1', at: iso(-10, 9, 55), label: 'Added, 25 USDC', microUsd: 25_000_000 }
  ];
  const first = on(-10, 10, 0).getTime();
  const months = [...monthsFrom(first, 1), ...monthsFrom(first + PERIOD_MS, 12, PRO_YEARLY_PRICE)];
  const plan = withProMonths({ ...freePlan(), balance: { microUsd: 5_000_000, history } }, months, AFTERNOON());
  return { ...plan, notes: { ...plan.notes, minutesLeft: 2460 } };
};

/**
 * Pro's month ends with renewing on and a month's price in the balance: a month is bought from it, after the last, and
 * its owner is told it renewed.
 */
export function renewedFromBalance(plan: Plan, now = Date.now()): Plan {
  const end = Date.parse(plan.pro.until ?? '');
  const from = Number.isFinite(end) && end > now ? end : now;
  const entry: BalanceEntry = { id: `sb-entry-renew-${from}`, at: new Date(now).toISOString(), label: 'Pro, renewed for a month', microUsd: -PRO_PRICE };
  const paid: Plan = { ...plan, balance: { microUsd: plan.balance.microUsd - PRO_PRICE, history: [entry, ...plan.balance.history] } };
  const renewed = withProMonths(paid, [...plan.pro.months, ...monthsFrom(from, 1)], now);
  return { ...renewed, notices: [notice(`sb-notice-renewed-${from}`, 'pro-renewed', new Date(now).toISOString(), renewed.pro.until ?? new Date(from).toISOString()), ...plan.notices] };
}

/**
 * Pro's last month is over, without renewing: back on Free with all of Free's notes, and its owner told. Nothing is deleted.
 * It ends now, whatever end was bought: a journey moves time on by ending it.
 */
export function proHasEnded(plan: Plan, now = Date.now()): Plan {
  const ended = new Date(now).toISOString();
  return {
    ...plan, kind: 'free',
    period: { from: new Date(now).toISOString(), to: new Date(now + PERIOD_MS).toISOString() },
    notes: { minutesLeft: FREE.minutes, minutesPerPeriod: FREE.minutes, stopped: false },
    storage: { ...plan.storage, limitBytes: FREE.storage, fileBytes: FREE.file },
    pro: { ...NO_PRO, renew: plan.pro.renew },
    notices: [notice(`sb-notice-ended-${now}`, 'pro-ended', new Date(now).toISOString(), ended), ...plan.notices]
  };
}
