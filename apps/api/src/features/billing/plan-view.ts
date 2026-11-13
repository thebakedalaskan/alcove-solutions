/*
 * An account's plan as its owner sees it (docs: Plans and usage): notes as time, about what's left of the period's AI
 * allowance once what's been spent is taken off, at what an hour of notes is reckoned at; storage against the plan's limit
 * (on Team, the team's pool), with any grace; the balance; the months of Pro bought and what the owner is told about them
 * and their team's licenses; the team they're on; and the plans on offer. The allowance itself, in dollars, never leaves
 * the server.
 */
import type { Plan, PlanOffers } from '@alcove/api';
import type { Deps } from '../../context';
import { limitsNow } from '../../limits';
import { storageOf } from './held';
import { minutesOf, standing } from './meter';
import { accountOf, freeAllowance, historyOf, noticesOf, proAllowance, proOf, teamAllowance } from './plans';
import { teamOf } from './teams';

/** How many of the balance's latest changes are shown. */
const SHOWN = 20;

export async function planOf(d: Pick<Deps, 'cfg' | 'pool'>, ownerId: string): Promise<Plan> {
  const l = await limitsNow(d);
  const now = Date.now();
  const a = await accountOf(d, d.pool, ownerId);
  const s = await storageOf(d, d.pool, ownerId, now);
  const p = s.p;
  const notes = await standing(d, d.pool, ownerId);
  const overStorage = s.usedBytes > s.planBytes;
  const inGrace = s.graceUntil !== null && overStorage;
  return {
    kind: p.kind,
    period: { from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString() },
    // From what's been spent, not what's held for requests in flight or a call's notes: it only goes down.
    notes: { minutesLeft: notes.ranOut ? 0 : minutesOf(notes.unspentNano, l), minutesPerPeriod: p.notesMinutes, stopped: notes.ranOut },
    storage: { usedBytes: s.usedBytes, limitBytes: s.heldBytes ?? s.planBytes, fileBytes: p.fileBytes },
    grace: inGrace && s.graceUntil !== null ? { until: new Date(s.graceUntil).toISOString(), storage: true } : null,
    over: { storage: overStorage && !inGrace && s.heldBytes !== null && s.usedBytes > s.heldBytes },
    balance: { microUsd: a.balanceMicroUsd, history: historyOf(a).slice(0, SHOWN) },
    choose: a.choose,
    pro: proOf(a, now),
    notices: noticesOf(a),
    team: await teamOf(d, ownerId, now)
  };
}

/** The plans on offer, from the limits in force: what each brings, what a month of Pro and a team license cost, and the most one purchase buys. */
export async function offersOf(d: Pick<Deps, 'cfg' | 'pool'>): Promise<PlanOffers> {
  const l = await limitsNow(d);
  return {
    periodDays: l.get('plan.period_seconds') / 86_400,
    free: freeAllowance(l),
    pro: { ...proAllowance(l), microUsdPerMonth: l.get('plan.pro.price_micro_usd'), maxMonths: l.get('plan.pro_max_months') },
    team: { ...teamAllowance(l), microUsdPerLicense: l.get('plan.team.price_micro_usd'), maxLicenses: l.get('team.max_licenses') }
  };
}
