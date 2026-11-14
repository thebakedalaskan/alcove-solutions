/* Made-up payment data only. These addresses cannot receive a real payment. */
import type { PlanOffers, Purchase, TopUp, TopUpRoute, TopUpRoutes, TopUpState } from '@alcove/api';
import { iso } from '../clock';
import type { World } from '../world';
import { buyFromBalance, forPeriods, LICENSE_YEAR, PLAN_OFFERS, PRO_PRICE } from './plans';
import { addLicenses } from './teams';

/**
 * How a payment opened to buy something plays out by itself, a step every few seconds from when it's opened, as 1Click
 * and the server would (src/api/account/payments.ts): `pays` (seen, then added and bought), `over` (more than asked arrives:
 * bought, and the rest stays in the balance), `short` (less arrives, and the address waits for the rest), `refused` (the
 * price of what it buys goes up before it's added: it's added, and stays in the balance), `expires` (nothing arrives in
 * time), `fails` (seen, then 1Click fails it) or `waits` (nothing happens while the story is open).
 */
export type PaymentPlay = 'pays' | 'over' | 'short' | 'refused' | 'expires' | 'fails' | 'waits';

export interface PaymentsWorld {
  /** What the plans cost now, as the server offers them. A story raises them to show a price that changed. */
  offers: PlanOffers;
  /**
   * What a month of Pro cost when the last month was bought (the server's `monthlyMicroUsd`): renewing never pays more than
   * this without Art buying at the new price first. Pro's price, until Pro is bought at another.
   */
  proMonthly: number;
  /** The ways to pay, or null for a server that takes no payments. */
  routes: TopUpRoutes | null;
  topUps: TopUp[];
  /** How a payment opened to buy something plays out: the scenario's switch. */
  play: PaymentPlay;
  /** The payments playing out, by top-up: when each began, how it goes, and how many of its steps have happened. */
  playing: Record<string, { from: number; play: PaymentPlay; done: number }>;
}

export const PREVIEW_DEPOSIT_ADDRESS = 'storybook-preview-only-not-a-payment-address';
/**
 * An address as long as a Base address, for the checkout's stories, so its QR code and bold ends show as they would. It
 * isn't one (it isn't hex): no wallet takes it, so nothing can be sent to it.
 */
export const PREVIEW_BASE_ADDRESS = '0xStorybookPreviewOnlyNotAPaymentAddress00';
/**
 * The top-up a story has on its way. Its ID is made up, but as long as the server's (22 characters), so the reference the
 * Pay step and Done show for support reads as it would.
 */
export const PREVIEW_TOP_UP = 'Hx4mQ8vT2nLp7WkR3sZbYc';
/** A top-up that has been added to the balance already, beside the one a story has on its way. */
export const PREVIEW_PAID_TOP_UP = 'Zr8kW2pN5vXq1TmB7cLsGd';

const route = (id: string, chain: string, chainName: string, token: TopUpRoute['token'], minimum = 5): TopUpRoute => ({
  id, chain, chainName, token, minimum: String(minimum)
});
/** USDC on Base, as 1Click names it: its route names the token's contract, so a phone can open the payment in a wallet. */
const BASE = route('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', 'base', 'Base', 'USDC');
/** Pro is $20 a period; the amounts offered first are one, three and six periods of it, in micro-USD. */
const ROUTES: TopUpRoutes = {
  // USDC only, in the order the server offers them (its allowlist's, apps/api/src/features/billing/top-ups/oneclick.ts).
  routes: [
    route('preview-near-USDC', 'near', 'NEAR', 'USDC'), route('preview-eth-USDC', 'eth', 'Ethereum', 'USDC', 20), route('preview-sol-USDC', 'sol', 'Solana', 'USDC'),
    BASE, route('preview-arb-USDC', 'arb', 'Arbitrum', 'USDC'), route('preview-pol-USDC', 'pol', 'Polygon', 'USDC'),
    route('preview-bsc-USDC', 'bsc', 'BNB Chain', 'USDC'), route('preview-op-USDC', 'op', 'Optimism', 'USDC'), route('preview-avax-USDC', 'avax', 'Avalanche', 'USDC')
  ],
  presets: [20_000_000, 60_000_000, 120_000_000]
};

/** A server without a treasury, used by the existing scenarios. */
export const paymentsOff = (): PaymentsWorld => ({ offers: structuredClone(PLAN_OFFERS), proMonthly: PRO_PRICE, routes: null, topUps: [], play: 'pays', playing: {} });
/** A server taking payments, without a top-up opened yet: a payment opened to buy something plays out as `play` says. */
export function withPayments(w: World, play: PaymentPlay = 'pays'): void {
  w.payments = { ...w.payments, routes: structuredClone(ROUTES), topUps: [], play, playing: {} };
}
/**
 * The prices go up while the story is open: Pro to $24 a month ($19.20 for a year or more), more notes to $18 for 10 hours, a
 * team license to $48 ($38.40 a period for a year).
 */
export function raisePrices(w: World): void {
  const o = w.payments.offers;
  w.payments.offers = {
    ...o,
    pro: { ...o.pro, microUsdPerMonth: 24_000_000, yearly: o.pro.yearly ? { ...o.pro.yearly, microUsdPerMonth: 19_200_000 } : null },
    hours: o.hours ? { ...o.hours, microUsd: 18_000_000 } : null,
    team: { ...o.team, microUsdPerLicense: 48_000_000, yearly: o.team.yearly ? { ...o.team.yearly, microUsdPerLicense: 38_400_000 } : null }
  };
}

/**
 * `buys` bought from the balance, as the server buys it once its checks pass: the plan pays for it (and has Pro's months or
 * more notes), and licenses go to the team Art runs, not taken by anyone yet, each with what it cost and how many periods it
 * runs once taken. `entry` is the balance's line for it.
 */
export function boughtFromBalance(w: World, buys: Purchase, entry: string, now = Date.now()): void {
  w.plan = buyFromBalance(w.plan, buys, entry, now);
  // Months of Pro bought at the price in force: what renewing goes by from now on.
  if (buys.kind === 'pro') w.payments.proMonthly = w.payments.offers.pro.microUsdPerMonth;
  if (buys.kind === 'licenses' && w.myTeam) addLicenses(w.myTeam, buys.count, buys.microUsdPerLicense * buys.periods, buys.periods);
}

/** No team license for a year on offer, as the release that brings them ships at first: a license is a period's alone. */
export function noTeamYear(w: World): void {
  w.payments.offers = { ...w.payments.offers, team: { ...w.payments.offers.team, yearly: null } };
}

/** An ID for a new line of the balance that none of its lines has yet: a list of them keys on it. */
export function freshEntryId(w: World): string {
  const taken = new Set(w.plan.balance.history.map((e) => e.id));
  let n = w.plan.balance.history.length + 1;
  while (taken.has(`sb-entry-${n}`)) n += 1;
  return `sb-entry-${n}`;
}

/** `microUsd` more in the balance, with the line the balance lists it by. A token is added as a dollar. */
export function addToBalance(w: World, microUsd: number, tokens: string): void {
  const { balance } = w.plan;
  const entry = { id: freshEntryId(w), at: new Date().toISOString(), label: `Added, ${tokens} USDC`, microUsd };
  w.plan = { ...w.plan, balance: { microUsd: balance.microUsd + microUsd, history: [entry, ...balance.history] } };
}

/** One top-up of `dollars` in the state a page story needs. The clock is the story's demo clock. */
export function topUpOf(id: string, state: TopUpState, dollars: number, expired = false): TopUp {
  const asked = String(dollars);
  const received: TopUp['received'] = state === 'waiting' || state === 'cancelled' || state === 'expired' ? null
    : state === 'short' ? { amount: '3.5', microUsd: null }
    : state === 'held' ? { amount: '0.000001', microUsd: 0 }
    : { amount: asked, microUsd: state === 'credited' ? dollars * 1_000_000 : null };
  return {
    id, route: BASE, address: state === 'waiting' || state === 'short' ? PREVIEW_DEPOSIT_ADDRESS : null, memo: null,
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString(), state, asked: { amount: asked }, received, purchase: null
  };
}

/**
 * A payment of `asked` USDC on Base opened to buy `buys`, waiting for it, as the checkout opens one: its address made for
 * it and open for a day, until `expiresAt` (a day from now, or a scenario's own: a world is made before its clock is set).
 * It doesn't play out by itself: it waits, as a payment someone hasn't sent yet does.
 */
export function purchaseTopUp(id: string, buys: Purchase, asked: number, expiresAt = new Date(Date.now() + 86_400_000).toISOString()): TopUp {
  return {
    id, route: BASE, address: PREVIEW_BASE_ADDRESS, memo: null, expiresAt,
    state: 'waiting', asked: { amount: String(asked) }, received: null, purchase: { buys, outcome: 'waiting', why: null }
  };
}

/** A year of Pro at the yearly price: what most of the checkout's stories are buying. */
export const PRO_YEAR: Purchase = { kind: 'pro', months: 12, microUsdPerMonth: 16_000_000 };
/** Six licenses at $40, for the six people at Vandelay on Alcove: what starting Art's team buys, a period at a time. */
export const TEAM_SIX: Purchase = { kind: 'licenses', count: 6, microUsdPerLicense: PLAN_OFFERS.team.microUsdPerLicense, periods: 1 };
/** The same six for a year, at $32 a period: $2,304. */
export const TEAM_SIX_YEAR: Purchase = { kind: 'licenses', count: 6, ...LICENSE_YEAR };
/** Why a purchase whose price went up before its payment arrived wasn't bought, as the server says it. */
const priceChanged = (buys: Purchase): string => (buys.kind === 'pro' ? 'The price of Pro changed before your payment arrived. It’s in your balance.'
  : buys.kind === 'hours' ? 'The price of more notes changed before your payment arrived. It’s in your balance.'
  : `The price of a team license${forPeriods(buys.periods)} changed before your payment arrived. It’s in your balance.`);

/** Where a payment opened to buy something is, for a story that opens on it. */
export type PurchaseAt = 'waiting' | 'short' | 'closed-short' | 'seen' | 'bought' | 'over' | 'refused' | 'expired' | 'cancelled' | 'failed';

/**
 * A payment of `asked` USDC on Base for `buys` (192 USDC for a year of Pro), where a story needs it: waiting, less arrived
 * (128 of 192), less arrived and its address closed since (settling into the balance), seen, bought (the plan bought too,
 * from the balance it arrived in), 6 USDC more than asked, refused (the prices went up first), expired, cancelled or
 * failed. It stays there: nothing plays out by itself.
 */
export const purchaseAt = (at: PurchaseAt, buys: Purchase = PRO_YEAR, asked = 192) => (w: World): void => {
  withPayments(w, 'waits');
  const t = purchaseTopUp(PREVIEW_TOP_UP, buys, asked);
  const sent = at === 'over' ? asked + 6 : at === 'short' || at === 'closed-short' ? Math.floor((asked * 2) / 3) : asked;
  const received = { amount: String(sent), microUsd: null };
  const settled = { amount: String(sent), microUsd: sent * 1_000_000 };
  const closed = { address: null, memo: null };
  let now: TopUp = t;
  switch (at) {
    case 'waiting': break;
    case 'short': now = { ...t, state: 'short', received }; break;
    case 'closed-short': now = { ...t, state: 'short', received, expiresAt: new Date(Date.now() - 60_000).toISOString() }; break;
    case 'seen': now = { ...t, ...closed, state: 'arriving', received }; break;
    case 'bought':
    case 'over':
      addToBalance(w, settled.microUsd, String(sent));
      boughtFromBalance(w, buys, freshEntryId(w));
      now = { ...t, ...closed, state: 'credited', received: settled, purchase: { buys, outcome: 'bought', why: null } };
      break;
    case 'refused':
      raisePrices(w);
      addToBalance(w, settled.microUsd, String(sent));
      now = { ...t, ...closed, state: 'credited', received: settled, purchase: { buys, outcome: 'refused', why: priceChanged(buys) } };
      break;
    case 'expired': now = { ...t, ...closed, state: 'expired', expiresAt: new Date(Date.now() - 60_000).toISOString() }; break;
    case 'cancelled': now = { ...t, ...closed, state: 'cancelled' }; break;
    case 'failed': now = { ...t, ...closed, state: 'failed', received }; break;
  }
  w.payments.topUps = [now];
};

/** One payment of $20, the first amount offered, in the state a page story needs. */
export const withTopUp = (state: TopUpState, expired = false) => (w: World): void => {
  withPayments(w);
  w.payments.topUps = [topUpOf(PREVIEW_TOP_UP, state, 20, expired)];
  if (state === 'credited') addToBalance(w, 20_000_000, '20');
};

/** The provider's side of the journey: incoming money, followed by a settled payment. Reads pick this up normally. */
export function receiveTopUp(w: World, id: string, state: 'short' | 'arriving' | 'credited'): void {
  const t = w.payments.topUps.find((x) => x.id === id);
  if (!t) return;
  const credited = state === 'credited';
  const microUsd = Math.round(Number(t.asked.amount) * 1_000_000);
  if (credited && t.state !== 'credited') addToBalance(w, microUsd, t.asked.amount);
  w.payments.topUps = w.payments.topUps.map((x) => x.id === id ? {
    ...x, state, address: state === 'short' ? PREVIEW_DEPOSIT_ADDRESS : null,
    received: { amount: state === 'short' ? '3.5' : x.asked.amount, microUsd: credited ? microUsd : null }
  } : x);
}

/**
 * A payment opened to buy `buys`, of `dollars` in USDC on Base, waiting for it: what checkout leaves on its way when it's
 * closed. Opened at 16:12 on the demo day, so its address is open until the same time tomorrow.
 */
export function buyingWith(id: string, buys: Purchase, dollars: number): TopUp {
  return { ...topUpOf(id, 'waiting', dollars), expiresAt: iso(1, 16, 12), purchase: { buys, outcome: 'waiting', why: null } };
}

/**
 * The provider's side of a payment that buys something: it arrives in full, is added to the balance, and what it was for
 * is bought from it in the same go, as the server does. Reads pick it up as they come.
 */
export function settlePurchase(w: World, id: string, now = Date.now()): void {
  const t = w.payments.topUps.find((x) => x.id === id);
  if (!t || !t.purchase) return;
  const microUsd = Math.round(Number(t.asked.amount) * 1_000_000);
  addToBalance(w, microUsd, t.asked.amount);
  boughtFromBalance(w, t.purchase.buys, `sb-entry-bought-${id}`, now);
  w.payments.topUps = w.payments.topUps.map((x) => x.id === id && x.purchase ? {
    ...x, state: 'credited', address: null, received: { amount: x.asked.amount, microUsd }, purchase: { ...x.purchase, outcome: 'bought' }
  } : x);
}
