/* Made-up payment data only. These addresses cannot receive a real payment. */
import type { TopUp, TopUpRoute, TopUpRoutes, TopUpState } from '@alcove/api';
import type { World } from './index';

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
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString(), state, asked: { amount: asked }, received
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
