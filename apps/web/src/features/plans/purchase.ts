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

/** Whether two purchases are on the same terms: a month of Pro at one price, or a pack of notes at one price and size. */
export const sameTerms = (a: Purchase, b: Purchase): boolean =>
  (a.kind === 'pro' ? b.kind === 'pro' && a.microUsdPerMonth === b.microUsdPerMonth
    : b.kind === 'hours' && a.microUsdPerPack === b.microUsdPerPack && a.minutesPerPack === b.minutesPerPack);

/** The same purchase on today's terms, or null when it isn't offered any more (more notes switched off). */
export function repriced(offers: PlanOffers, buys: Purchase): Purchase | null {
  if (buys.kind === 'pro') return { kind: 'pro', months: buys.months, microUsdPerMonth: proPrice(offers, buys.months) };
  return offers.hours ? { kind: 'hours', packs: buys.packs, microUsdPerPack: offers.hours.microUsd, minutesPerPack: offers.hours.minutes } : null;
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
  return hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'} of notes` : 'More notes';
}

/** What checkout opens on to see a purchase through. */
export const checkoutFor = (buys: Purchase): CheckoutFor => (buys.kind === 'pro' ? { plan: 'pro', months: buys.months } : { plan: 'hours', packs: buys.packs });

/** Whether a payment's address has closed: past its expiry, nothing more can be sent to it, whatever its state says yet. */
export const lapsed = (t: TopUp, now = Date.now()): boolean => Date.parse(t.expiresAt) <= now;

/** A payment opened to buy something. */
export type Buying = TopUp & { purchase: NonNullable<TopUp['purchase']> };
const isBuying = (t: TopUp): t is Buying => t.purchase !== null;

/**
 * The payment on its way to buy something, if there is one: the newest top-up that can still take money (or is being
 * added) and was opened to buy `kind` (or anything), whose purchase hasn't happened yet. The side panel says it's waiting
 * (`asked.amount`), Settings lists it, and checkout opens on it instead of starting another.
 */
export function waitingPurchase(list: readonly TopUp[] | undefined, kind?: Purchase['kind'] | undefined, now = Date.now()): Buying | undefined {
  return list?.filter(isBuying).find((t) => topUpOpen(t) && t.purchase.outcome === 'waiting'
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
