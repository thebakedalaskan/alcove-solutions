/*
 * How your plan stands now, as the side panel's foot and Settings › Plan both say it (docs/superpowers/specs/
 * 2026-11-12-plans-frontend-design.md): the time of notes left, whether Pro is about to end, which of the plan's notices
 * still say something true, a payment for a plan on its way, and what a purchase is called. Every number is the server's.
 */
import type { Plan, PlanKind, PlanNotice, PlanOffers, Purchase, TopUp } from '@alcove/api';
import { topUpOpen } from '~/lib/queries';
import { daysFromToday, hoursAndMinutes } from '~/lib/time';
import type { CheckoutFor } from './checkout';

export const PLAN_NAMES: Record<PlanKind, string> = { free: 'Free', pro: 'Pro', team: 'Team' };


/** "5 hours", "1 hour", "50 hours": an allowance of notes, to the hour as the server's own words round it. */
export function hoursOf(minutes: number): string {
  const h = Math.round(minutes / 60);
  return h >= 1 ? `${h} ${h === 1 ? 'hour' : 'hours'}` : `${Math.max(0, Math.round(minutes))} min`;
}

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

/** A payment opened to buy something. */
export type Buying = TopUp & { purchase: NonNullable<TopUp['purchase']> };
const isBuying = (t: TopUp): t is Buying => t.purchase !== null;
/** Whether money can still reach it: it's waiting with its address open, arriving, or short. */
const onItsWay = (t: TopUp, now: number) => topUpOpen(t) && (t.state !== 'waiting' || Date.parse(t.expiresAt) > now);

/**
 * The newest payment opened to buy a plan or more notes that hasn't bought it yet: still on its way, or added and being
 * bought. Null when there's none.
 */
export function buyingNow(topUps: readonly TopUp[] | undefined, now = Date.now()): Buying | null {
  return topUps?.filter(isBuying).find((t) => t.purchase.outcome === 'waiting' && (onItsWay(t, now) || t.state === 'credited')) ?? null;
}

/** What checkout reopens a payment on: what it was opened to buy. */
export const checkoutFor = (buys: Purchase): CheckoutFor => (buys.kind === 'pro' ? { plan: 'pro', months: buys.months } : { plan: 'hours', packs: buys.packs });

/** "Pro, 12 months", "10 hours of notes": what a purchase buys. A pack's hours come from the offers. */
export function purchaseName(buys: Purchase, offers: PlanOffers | undefined): string {
  if (buys.kind === 'pro') return `Pro, ${buys.months} ${buys.months === 1 ? 'month' : 'months'}`;
  const pack = offers?.hours?.minutes;
  return pack ? `${hoursOf(buys.packs * pack)} of notes` : 'More notes';
}

/** `a` minus `b`, two token amounts as decimal strings ("5" − "1.5" = "3.5"), never below 0. */
export function amountLeft(a: string, b: string): string {
  const places = Math.max(a.split('.')[1]?.length ?? 0, b.split('.')[1]?.length ?? 0);
  const units = (x: string) => { const [w = '0', f = ''] = x.split('.'); return BigInt(w + f.padEnd(places, '0')); };
  const left = units(a) - units(b);
  if (left <= 0n) return '0';
  const digits = left.toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fraction = digits.slice(digits.length - places).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}
/** What's still to send on a short payment: what was asked less what arrived. */
export const restToSend = (t: TopUp): string => amountLeft(t.asked.amount, t.received?.amount ?? '0');

/** "144", "187.5": an amount of tokens as a short line says it, with no zeros after the point. */
export const tokensShort = (amount: string): string => (amount.includes('.') ? amount.replace(/0+$/, '').replace(/\.$/, '') : amount);
/** "144.00", "187.50": an amount of tokens to the cent, as what to send is said; finer amounts as they are. */
export function tokensExact(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.');
  return fraction.length <= 2 ? `${whole}.${fraction.padEnd(2, '0')}` : amount;
}
