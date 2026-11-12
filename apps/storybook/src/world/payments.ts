/* Made-up payment data only. These addresses cannot receive a real payment. */
import type { PlanOffers, Purchase, TopUp, TopUpRoute, TopUpRoutes, TopUpState } from '@alcove/api';
import type { World } from './index';
import { buyFromBalance, PLAN_OFFERS } from './plans';

/**
 * How a payment opened to buy something plays out by itself, a step every few seconds from when it's opened, as 1Click
 * and the server would (src/api/payments.ts): `pays` (seen, then added and bought), `over` (more than asked arrives:
 * bought, and the rest stays in the balance), `short` (less arrives, and the address waits for the rest), `refused` (the
 * price of what it buys goes up before it's added: it's added, and stays in the balance), `expires` (nothing arrives in
 * time), `fails` (seen, then 1Click fails it) or `waits` (nothing happens while the story is open).
 */
export type PaymentPlay = 'pays' | 'over' | 'short' | 'refused' | 'expires' | 'fails' | 'waits';

export interface PaymentsWorld {
  /** What the plans cost now, as the server offers them. A story raises them to show a price that changed. */
  offers: PlanOffers;
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
export const PREVIEW_TOP_UP = 'storybook-top-up';
/** A top-up that has been added to the balance already, beside the one a story has on its way. */
export const PREVIEW_PAID_TOP_UP = 'storybook-top-up-paid';

const route = (id: string, chain: string, chainName: string, token: TopUpRoute['token'], minimum = 5): TopUpRoute => ({
  id, chain, chainName, token, minimum: String(minimum)
});
/** USDC on Base, as 1Click names it: its route names the token's contract, so a phone can open the payment in a wallet. */
const BASE = route('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', 'base', 'Base', 'USDC');
/** Pro is $20 a period; the amounts offered first are one, three and six periods of it, in micro-USD. */
const ROUTES: TopUpRoutes = {
  routes: [
    BASE, route('preview-sol-USDC', 'sol', 'Solana', 'USDC'), route('preview-eth-USDC', 'eth', 'Ethereum', 'USDC', 20),
    route('preview-arb-USDC', 'arb', 'Arbitrum', 'USDC'), route('preview-pol-USDC', 'pol', 'Polygon', 'USDC'),
    route('preview-near-USDC', 'near', 'NEAR', 'USDC'), route('preview-op-USDC', 'op', 'Optimism', 'USDC'),
    route('preview-avax-USDC', 'avax', 'Avalanche', 'USDC'), route('preview-bsc-USDC', 'bsc', 'BNB Chain', 'USDC'),
    route('preview-near-USDT', 'near', 'NEAR', 'USDT'), route('preview-bsc-USDT', 'bsc', 'BNB Chain', 'USDT')
  ],
  presets: [20_000_000, 60_000_000, 120_000_000]
};

/** A server without a treasury, used by the existing scenarios. */
export const paymentsOff = (): PaymentsWorld => ({ offers: structuredClone(PLAN_OFFERS), routes: null, topUps: [], play: 'pays', playing: {} });
/** A server taking payments, without a top-up opened yet: a payment opened to buy something plays out as `play` says. */
export function withPayments(w: World, play: PaymentPlay = 'pays'): void {
  w.payments = { ...w.payments, routes: structuredClone(ROUTES), topUps: [], play, playing: {} };
}
/** The prices go up while the story is open: Pro to $24 a month ($19.20 for a year or more), more notes to $18 for 10 hours. */
export function raisePrices(w: World): void {
  const o = w.payments.offers;
  w.payments.offers = {
    ...o,
    pro: { ...o.pro, microUsdPerMonth: 24_000_000, yearly: o.pro.yearly ? { ...o.pro.yearly, microUsdPerMonth: 19_200_000 } : null },
    hours: o.hours ? { ...o.hours, microUsd: 18_000_000 } : null
  };
}

/** `microUsd` more in the balance, with the line the balance lists it by. A token is added as a dollar. */
export function addToBalance(w: World, microUsd: number, tokens: string): void {
  const { balance } = w.plan;
  const entry = { id: `sb-entry-${balance.history.length + 1}`, at: new Date().toISOString(), label: `Added, ${tokens} USDC`, microUsd };
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

/** Where a payment opened to buy something is, for a story that opens on it. */
export type PurchaseAt = 'waiting' | 'short' | 'seen' | 'bought' | 'over' | 'refused' | 'expired' | 'cancelled' | 'failed';

/**
 * A payment of `asked` USDC on Base for `buys` (192 USDC for a year of Pro), where a story needs it: waiting, less arrived
 * (128 of 192), seen, bought (the plan bought too, from the balance it arrived in), 6 USDC more than asked, refused (the
 * prices went up first), expired, cancelled or failed. It stays there: nothing plays out by itself.
 */
export const purchaseAt = (at: PurchaseAt, buys: Purchase = PRO_YEAR, asked = 192) => (w: World): void => {
  withPayments(w, 'waits');
  const t = purchaseTopUp(PREVIEW_TOP_UP, buys, asked);
  const sent = at === 'over' ? asked + 6 : at === 'short' ? Math.floor((asked * 2) / 3) : asked;
  const received = { amount: String(sent), microUsd: null };
  const settled = { amount: String(sent), microUsd: sent * 1_000_000 };
  const closed = { address: null, memo: null };
  let now: TopUp = t;
  switch (at) {
    case 'waiting': break;
    case 'short': now = { ...t, state: 'short', received }; break;
    case 'seen': now = { ...t, ...closed, state: 'arriving', received }; break;
    case 'bought':
    case 'over':
      addToBalance(w, settled.microUsd, String(sent));
      w.plan = buyFromBalance(w.plan, buys, w.payments.offers, 'sb-entry-bought');
      now = { ...t, ...closed, state: 'credited', received: settled, purchase: { buys, outcome: 'bought', why: null } };
      break;
    case 'refused':
      raisePrices(w);
      addToBalance(w, settled.microUsd, String(sent));
      now = {
        ...t, ...closed, state: 'credited', received: settled,
        purchase: { buys, outcome: 'refused', why: buys.kind === 'pro' ? 'The price of Pro changed before your payment arrived. It’s in your balance.' : 'The price of more notes changed before your payment arrived. It’s in your balance.' }
      };
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
