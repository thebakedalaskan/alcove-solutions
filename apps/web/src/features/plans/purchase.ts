/*
 * What a purchase is and costs (docs/superpowers/specs/2026-11-12-plans-frontend-design.md › The checkout window), from the
 * server's offers: Pro's price a month for that many months (the lower, yearly one from `yearly.fromMonths` on), packs of
 * more notes, what the balance covers and what's left to send, and the words for a purchase that the side panel, Settings
 * and checkout share. Every amount is micro-USD, as the server's; a token is sent as a dollar.
 */
import type { PlanOffers, Purchase, TopUp } from '@alcove/api';
import { topUpOpen } from '~/lib/queries';
import type { CheckoutFor } from './checkout';

/** The lengths of Pro offered as cards, up to the most one purchase buys. */
export const LENGTHS = [1, 3, 6, 12, 24] as const;

/** "1 month", "12 months". */
export const monthsWord = (n: number): string => `${n} ${n === 1 ? 'month' : 'months'}`;

/** Pro's price a month for buying `months` at once: the yearly price from the yearly offer's length on. */
export function proPrice(offers: PlanOffers, months: number): number {
  const yearly = offers.pro.yearly;
  return yearly && months >= yearly.fromMonths ? yearly.microUsdPerMonth : offers.pro.microUsdPerMonth;
}

/** How much less a month the yearly price is, in whole percent ("20"), or null when there's no lower price. */
export function yearlyOff(offers: PlanOffers): number | null {
  const yearly = offers.pro.yearly;
  const month = offers.pro.microUsdPerMonth;
  if (!yearly || month <= 0 || yearly.microUsdPerMonth >= month) return null;
  return Math.round((1 - yearly.microUsdPerMonth / month) * 100);
}

/** What a purchase costs at the price it carries. */
export const costOf = (buys: Purchase): number => (buys.kind === 'pro' ? buys.months * buys.microUsdPerMonth : buys.packs * buys.microUsdPerPack);

/** The price of one of what's bought: a month of Pro, or a pack of notes. */
export const unitPrice = (buys: Purchase): number => (buys.kind === 'pro' ? buys.microUsdPerMonth : buys.microUsdPerPack);

/** The same purchase at today's prices, or null when it isn't offered any more (more notes switched off). */
export function repriced(offers: PlanOffers, buys: Purchase): Purchase | null {
  if (buys.kind === 'pro') return { kind: 'pro', months: buys.months, microUsdPerMonth: proPrice(offers, buys.months) };
  return offers.hours ? { kind: 'hours', packs: buys.packs, microUsdPerPack: offers.hours.microUsd } : null;
}

/** About how many hours `packs` of more notes are: 10, 1.5. */
export function hoursIn(offers: PlanOffers | undefined, packs: number): number {
  const minutes = offers?.hours?.minutes ?? 0;
  return Math.round((packs * minutes) / 6) / 10;
}

/** "Pro, 12 months", "10 hours of notes": what a purchase is, as the side panel, Settings and checkout say it. */
export function purchaseName(buys: Purchase, offers: PlanOffers | undefined): string {
  if (buys.kind === 'pro') return `Pro, ${monthsWord(buys.months)}`;
  const hours = hoursIn(offers, buys.packs);
  return hours > 0 ? `${hours} hours of notes` : 'More notes';
}

/** What checkout opens on to see a purchase through. */
export const checkoutFor = (buys: Purchase): CheckoutFor => (buys.kind === 'pro' ? { plan: 'pro', months: buys.months } : { plan: 'hours', packs: buys.packs });

/** Whether a payment's address has closed: past its expiry, nothing more can be sent to it, whatever its state says yet. */
export const lapsed = (t: TopUp, now = Date.now()): boolean => Date.parse(t.expiresAt) <= now;

/**
 * The payment on its way to buy something, if there is one: the newest top-up that can still take money (or is being
 * added) and was opened to buy `kind` (or anything), whose purchase hasn't happened yet. The side panel says it's waiting
 * (`asked.amount`), Settings lists it, and checkout opens on it instead of starting another.
 */
export function waitingPurchase(list: TopUp[] | undefined, kind?: Purchase['kind'] | undefined, now = Date.now()): TopUp | undefined {
  return list?.find((t) => topUpOpen(t) && t.purchase !== null && t.purchase.outcome === 'waiting'
    && (kind === undefined || t.purchase.buys.kind === kind) && !(t.state === 'waiting' && lapsed(t, now)));
}

/* ---------- amounts of tokens ---------- */

/** Micro-units in a decimal amount of tokens ("187", "3.5", "0.000001"), to the micro-unit; null when it isn't one. */
export function microOf(amount: string): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return null;
  const whole = Number(m[1] ?? '0');
  const fraction = Number((m[2] ?? '').slice(0, 6).padEnd(6, '0'));
  const n = whole * 1_000_000 + fraction;
  return Number.isSafeInteger(n) ? n : null;
}

const TOKENS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const PLAIN = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false });
/** An amount of tokens as it's shown, to the cent at least: "187.00", "1,152.00", "0.000001". */
export const tokens = (micro: number): string => TOKENS.format(micro / 1_000_000);
/** The same without grouping, for pasting into a wallet: "1152.00". */
export const plainTokens = (micro: number): string => PLAIN.format(micro / 1_000_000);
/** The same, whole when it's whole: "100", "3.50". */
export const roundTokens = (micro: number): string => tokens(micro).replace(/\.00$/, '');
