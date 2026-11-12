/*
 * An account's plan as its owner sees it (docs: Plans and usage): notes as time, about what's left of the period's AI
 * allowance once what's been spent is taken off, at what an hour of notes is reckoned at; storage against the plan's limit, with any
 * grace; the balance; the months of Pro bought and what the owner is told about them; and the plans on offer. The
 * allowance itself, in dollars, never leaves the server.
 */
import type { Plan, PlanOffers } from '@alcove/api';
import type { Deps } from '../../context';
import { limitsNow } from '../../limits';
import { minutesOf, standing } from './meter';
import { accountOf, freeAllowance, graceUntil, heldTo, historyOf, inForce, noticesOf, proAllowance, proOf, yearlyOf } from './plans';
import { usedBytes } from './storage';

/** How many of the balance's latest changes are shown. */
const SHOWN = 20;

export async function planOf(d: Pick<Deps, 'cfg' | 'pool'>, ownerId: string): Promise<Plan> {
  const l = await limitsNow(d);
  const now = Date.now();
  const a = await accountOf(d, d.pool, ownerId);
  const p = inForce(a, l, now);
  const s = await standing(d, d.pool, ownerId);
  const used = await usedBytes(d.pool, ownerId);
  const overStorage = used > p.storageBytes;
  const until = graceUntil(a, p, l, now);
  const inGrace = until !== null && overStorage;
  const held = heldTo(a, p, l, now);
  return {
    kind: p.kind,
    period: { from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString() },
    // From what's been spent, not what's held for requests in flight or a call's notes: it only goes down.
    notes: { minutesLeft: s.ranOut ? 0 : minutesOf(s.unspentNano, l), minutesPerPeriod: p.notesMinutes, stopped: s.ranOut },
    storage: { usedBytes: used, limitBytes: held.storageBytes ?? p.storageBytes, fileBytes: p.fileBytes },
    grace: inGrace ? { until: new Date(until).toISOString(), storage: true } : null,
    over: { storage: overStorage && !inGrace },
    balance: { microUsd: a.balanceMicroUsd, history: historyOf(a).slice(0, SHOWN) },
    choose: a.choose,
    pro: proOf(a, now),
    notices: noticesOf(a)
  };
}

/**
 * The plans on offer, from the limits in force: what each brings, what a month of Pro costs, and less for a year or more,
 * and the most months one purchase buys.
 */
export async function offersOf(d: Pick<Deps, 'cfg' | 'pool'>): Promise<PlanOffers> {
  const l = await limitsNow(d);
  return {
    periodDays: l.get('plan.period_seconds') / 86_400,
    free: freeAllowance(l),
    pro: { ...proAllowance(l), microUsdPerMonth: l.get('plan.pro.price_micro_usd'), maxMonths: l.get('plan.pro_max_months'), yearly: yearlyOf(l) },
    hours: null
  };
}
