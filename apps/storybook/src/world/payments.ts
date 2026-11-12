/* Made-up payment data only. These addresses cannot receive a real payment. */
import type { TopUp, TopUpRoute, TopUpRoutes, TopUpState } from '@alcove/api';
import type { World } from './index';

export interface PaymentsWorld { routes: TopUpRoutes | null; topUps: TopUp[] }

export const PREVIEW_DEPOSIT_ADDRESS = 'storybook-preview-only-not-a-payment-address';
export const PREVIEW_TOP_UP = 'storybook-top-up';

const route = (chain: string, chainName: string, token: TopUpRoute['token'], minimum = 5): TopUpRoute => ({
  id: `preview-${chain}-${token}`, chain, chainName, token, minimum: String(minimum), minimumCredits: minimum * 1000
});
const BASE = route('base', 'Base', 'USDC');
const ROUTES: TopUpRoutes = {
  routes: [route('near', 'NEAR', 'USDC'), route('eth', 'Ethereum', 'USDC', 20), route('sol', 'Solana', 'USDC'), BASE, route('bsc', 'BNB Chain', 'USDC')],
  tiers: [{ fromCredits: 0, creditsPerUsd: 1000 }, { fromCredits: 50_000, creditsPerUsd: 10_000 / 9 }, { fromCredits: 100_000, creditsPerUsd: 1250 }],
  presets: [10_000, 50_000, 100_000], perMinute: 25
};

/** A server without a treasury, used by the existing scenarios. */
export const paymentsOff = (): PaymentsWorld => ({ routes: null, topUps: [] });
/** A server taking payments, without a top-up opened yet. */
export function withPayments(w: World): void { w.payments = { routes: structuredClone(ROUTES), topUps: [] }; }

/** One payment in the state a page story needs. The clock is the story's demo clock. */
export const withTopUp = (state: TopUpState, expired = false) => (w: World): void => {
  withPayments(w);
  const received = state === 'waiting' || state === 'cancelled' || state === 'expired' ? null
    : { amount: state === 'short' ? '3.5' : '10', credits: state === 'credited' ? 10_000 : state === 'held' ? 0 : null };
  w.payments.topUps = [{
    id: PREVIEW_TOP_UP, route: BASE,
    address: state === 'waiting' || state === 'short' ? PREVIEW_DEPOSIT_ADDRESS : null, memo: null,
    expiresAt: new Date(Date.now() + (expired ? -60_000 : 3_600_000)).toISOString(), state,
    asked: { amount: '10', credits: 10_000 }, received
  }];
  if (state === 'held') w.payments.topUps = w.payments.topUps.map((t) => ({ ...t, received: { amount: '0.000001', credits: 0 } }));
  if (state === 'credited') w.credits = { ...w.credits, balance: w.credits.balance + 10_000, granted: w.credits.granted + 10_000 };
};

/** The provider's side of the journey: incoming money, followed by a settled payment. Reads pick this up normally. */
export function receiveTopUp(w: World, id: string, state: 'short' | 'arriving' | 'credited'): void {
  const t = w.payments.topUps.find((x) => x.id === id);
  if (!t) return;
  const credited = state === 'credited';
  if (credited && t.state !== 'credited') w.credits = { ...w.credits, balance: w.credits.balance + t.asked.credits, granted: w.credits.granted + t.asked.credits };
  w.payments.topUps = w.payments.topUps.map((x) => x.id === id ? {
    ...x, state, address: state === 'short' ? PREVIEW_DEPOSIT_ADDRESS : null,
    received: { amount: state === 'short' ? '3.5' : x.asked.amount, credits: credited ? x.asked.credits : null }
  } : x);
}
