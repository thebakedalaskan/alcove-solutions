/*
 * Ways to pay into the treasury that need nothing signed by the person paying. Each provider hands out an address to
 * send to and reports what arrived; everything else (the deposit record, watching it, crediting) is shared and uses
 * only these types. The registry is a plain object of providers, one per name.
 */
import type { Config } from '../config';
import type { Json } from '../crypto';
import { oneClick } from './oneclick';

export type DepositProviderName = 'oneclick';

/** A way to pay into the treasury that needs nothing signed by the person paying. */
export interface DepositProvider {
  readonly name: DepositProviderName;
  /** Routes the provider can take right now, filtered to the allowlist. Cached for 10 minutes. */
  routes(): Promise<DepositRoute[]>;
  /** Opens a deposit: a quote whose recipient is the treasury. Throws UnavailableError if the provider won't quote. */
  open(route: DepositRoute): Promise<OpenedDeposit>;
}

/** One token on one chain. `minimum` is in the token's smallest unit; `chainName` is the chain as people call it. */
export interface DepositRoute { id: string; provider: DepositProviderName; chain: string; chainName: string; token: 'USDC' | 'USDT'; decimals: number; minimum: bigint }
export interface OpenedDeposit { route: DepositRoute; address: string; memo: string | null; expiresAt: string; minimum: bigint; quote: Json }
/** What has happened to a deposit so far, in Alcove's terms. Amounts are micro-USD; `providerRef` is the provider's name for the settlement. */
export type DepositCheck =
  | { state: 'waiting' | 'arriving' | 'short' }
  | { state: 'settled'; sentMicroUsd: bigint; outMicroUsd: bigint; refundedMicroUsd: bigint; providerRef: string }
  | { state: 'failed'; reason: string };

/** An amount of a USD stablecoin, at face value, in micro-USD (rounded down). */
export function toMicroUsd(amount: bigint, decimals: number): bigint {
  return decimals >= 6 ? amount / 10n ** BigInt(decimals - 6) : amount * 10n ** BigInt(6 - decimals);
}
/** An amount in a token's smallest unit as a decimal string, without trailing zeros: "5", "44.995". */
export function formatUnits(amount: bigint, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const whole = amount / unit;
  const fraction = (amount % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

const made = new WeakMap<Config, { oneclick: DepositProvider } | null>();
/** The providers this server is set up with (one set per configuration, so their caches last), or null when top-ups are off. */
export function depositProviders(cfg: Config): { oneclick: DepositProvider } | null {
  const known = made.get(cfg);
  if (known !== undefined) return known;
  const providers = cfg.ONECLICK_API_KEY && cfg.TREASURY_INTENTS_ACCOUNT
    ? { oneclick: oneClick({ baseUrl: cfg.ONECLICK_BASE_URL, apiKey: cfg.ONECLICK_API_KEY, treasury: cfg.TREASURY_INTENTS_ACCOUNT }) }
    : null;
  made.set(cfg, providers);
  return providers;
}
