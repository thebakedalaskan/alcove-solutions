/*
 * The plan Art is on, in the demo world (docs: Plans and usage): the Free plan by default, with the states a page or a call
 * shows when a limit is near, reached or passed. Notes are time: what's left of the period's allowance, as an estimate.
 * Storage is against the plan's limit, in the binary units the API sets them in. Made up, as
 * everything in the demo world is.
 */
import type { BalanceEntry, Plan } from '@alcove/api';
import { iso } from './clock';

const MiB = 2 ** 20;
const GiB = 2 ** 30;

/** What Free brings a period: 5 hours of notes, 10 GB of storage, files up to 512 MB. */
const FREE = { minutes: 300, storage: 10 * GiB, file: 512 * MiB } as const;

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
  choose: false
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
