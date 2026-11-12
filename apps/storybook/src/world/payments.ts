/* Made-up payment data only. These addresses cannot receive a real payment. */
import type { Purchase, TopUp, TopUpRoute, TopUpRoutes, TopUpState } from '@alcove/api';
import { iso } from './clock';
import type { World } from './index';
import { PLAN_OFFERS, monthsAt, withProMonths } from './plans';

export interface PaymentsWorld { routes: TopUpRoutes | null; topUps: TopUp[] }

export const PREVIEW_DEPOSIT_ADDRESS = 'storybook-preview-only-not-a-payment-address';
export const PREVIEW_TOP_UP = 'storybook-top-up';
/** A top-up that has been added to the balance already, beside the one a story has on its way. */
export const PREVIEW_PAID_TOP_UP = 'storybook-top-up-paid';

const route = (chain: string, chainName: string, token: TopUpRoute['token'], minimum = 5): TopUpRoute => ({
  id: `preview-${chain}-${token}`, chain, chainName, token, minimum: String(minimum)
});
const BASE = route('base', 'Base', 'USDC');
/** Pro is $20 a period; the amounts offered first are one, three and six periods of it, in micro-USD. */
const ROUTES: TopUpRoutes = {
  routes: [BASE, route('sol', 'Solana', 'USDC'), route('eth', 'Ethereum', 'USDC', 20), route('near', 'NEAR', 'USDC'), route('near', 'NEAR', 'USDT'), route('bsc', 'BNB Chain', 'USDT')],
  presets: [20_000_000, 60_000_000, 120_000_000]
};

/** A server without a treasury, used by the existing scenarios. */
export const paymentsOff = (): PaymentsWorld => ({ routes: null, topUps: [] });
/** A server taking payments, without a top-up opened yet. */
export function withPayments(w: World): void { w.payments = { routes: structuredClone(ROUTES), topUps: [] }; }

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
  const { buys } = t.purchase;
  const microUsd = Math.round(Number(t.asked.amount) * 1_000_000);
  addToBalance(w, microUsd, t.asked.amount);
  const at = new Date(now).toISOString();
  if (buys.kind === 'pro') {
    const cost = buys.months * buys.microUsdPerMonth;
    const entry = { id: `sb-entry-bought-${id}`, at, label: `Pro, ${buys.months} ${buys.months === 1 ? 'month' : 'months'}`, microUsd: -cost };
    const paid = { ...w.plan, balance: { microUsd: w.plan.balance.microUsd - cost, history: [entry, ...w.plan.balance.history] } };
    const end = Date.parse(w.plan.pro.until ?? '');
    const from = Number.isFinite(end) && end > now ? end : now;
    w.plan = withProMonths(paid, [...w.plan.pro.months, ...monthsAt(from, buys.months, buys.microUsdPerMonth)], now);
  } else {
    const pack = PLAN_OFFERS.hours?.minutes ?? 600;
    const cost = buys.packs * buys.microUsdPerPack;
    const minutes = buys.packs * pack;
    const entry = { id: `sb-entry-bought-${id}`, at, label: `${minutes / 60} more hours of notes`, microUsd: -cost };
    w.plan = {
      ...w.plan, balance: { microUsd: w.plan.balance.microUsd - cost, history: [entry, ...w.plan.balance.history] },
      notes: { minutesLeft: w.plan.notes.minutesLeft + minutes, minutesPerPeriod: w.plan.notes.minutesPerPeriod + minutes, stopped: false }
    };
  }
  w.payments.topUps = w.payments.topUps.map((x) => x.id === id && x.purchase ? {
    ...x, state: 'credited', address: null, received: { amount: x.asked.amount, microUsd }, purchase: { ...x.purchase, outcome: 'bought' }
  } : x);
}
