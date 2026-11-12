/*
 * How your plan stands now, as the side panel's foot, Settings › Plan, Plans and the doors say it (docs: Plans and usage;
 * docs/design/pages.md › The frame and › Settings): the time of notes left, whether Pro is about to end, and which of the
 * plan's notices still say something true. What a purchase is and costs is purchase.ts's. Every number is the server's.
 */
import type { Plan, PlanKind, PlanNotice, PlanOffers } from '@alcove/api';
import { daysFromToday, hoursAndMinutes } from '~/lib/time';

export const PLAN_NAMES: Record<PlanKind, string> = { free: 'Free', pro: 'Pro', team: 'Team' };


/** Whether the period's notes have run out: they stop until it renews, or until more are bought. */
export const notesOut = (plan: Plan): boolean => plan.notes.stopped || plan.notes.minutesLeft <= 0;
/** Under an hour of notes left, and not out: the time turns warm. */
export const notesLow = (plan: Plan): boolean => !notesOut(plan) && plan.notes.minutesLeft < 60;
/** "1 h 26 min", "24 min": about how much of the period's notes is left (said with About, since it's an estimate). */
export const notesLeft = (plan: Plan): string => hoursAndMinutes(plan.notes.minutesLeft);
/** How much of the period's notes is left, 0 to 1, for the meter and the sun on its line. */
export const notesShare = (plan: Plan): number => (plan.notes.minutesPerPeriod > 0 ? Math.min(1, plan.notes.minutesLeft / plan.notes.minutesPerPeriod) : 0);

/** Whether renewing from the balance will buy the next month of Pro: it's on, and the balance has a month's price. */
export const renews = (plan: Plan, offers: PlanOffers | undefined): boolean =>
  plan.pro.renew && offers !== undefined && plan.balance.microUsd >= offers.pro.microUsdPerMonth;

/** Pro about to end: when, and how many days away by the calendar (0 is today). */
export interface ProEnding { until: string; days: number }

/**
 * Whether Pro is about to end: the one rule Plans, the side panel's foot and Settings › Plan say "ending" by. Pro is ending
 * while a pro-ending notice's `until` is the end Pro has now (`plan.pro.until`), unless renewing will buy the next month
 * (it's on, and the balance has a month's price): once Pro is extended, or renewing will keep it, the notice no longer
 * says anything true. Null otherwise.
 */
export function proEnding(plan: Plan, offers: PlanOffers | undefined, now = Date.now()): ProEnding | null {
  const until = plan.pro.until;
  if (plan.kind !== 'pro' || until === null || renews(plan, offers)) return null;
  const warned = plan.notices.some((n) => n.kind === 'pro-ending' && Date.parse(n.until) === Date.parse(until));
  return warned ? { until, days: Math.max(0, daysFromToday(new Date(until), new Date(now))) } : null;
}
/** "Ends today", "Ends tomorrow", "Ends in 6 days": how soon Pro ends, from `proEnding`'s days. */
export const endsIn = (days: number): string => (days <= 0 ? 'Ends today' : days === 1 ? 'Ends tomorrow' : `Ends in ${days} days`);

/** The plan's other notices that still say something true, newest first: Pro renewed while on Pro, Pro ended while on Free. */
export const noticesNow = (plan: Plan): PlanNotice[] =>
  plan.notices.filter((n) => (n.kind === 'pro-renewed' ? plan.kind === 'pro' : n.kind === 'pro-ended' ? plan.kind === 'free' : false));

/** About how many minutes of notes the next period brings: Free's once Pro's last month is over, else the plan's own. */
export function nextPeriodMinutes(plan: Plan, offers: PlanOffers | undefined): number {
  if (!offers) return plan.notes.minutesPerPeriod;
  if (plan.kind === 'free') return offers.free.notesMinutes;
  if (plan.kind === 'team') return plan.notes.minutesPerPeriod;
  const lastMonth = plan.pro.until === null || Date.parse(plan.pro.until) <= Date.parse(plan.period.to) + 60_000;
  return lastMonth && !renews(plan, offers) ? offers.free.notesMinutes : offers.pro.notesMinutes;
}
