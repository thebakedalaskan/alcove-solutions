/*
 * Ways to pay into the treasury that need nothing signed by the person paying. Each provider hands out an address to
 * send to and reports what arrived; everything else (the deposit record, watching it, crediting) is shared and uses
 * only these types. The registry is a plain object of providers, one per name.
 */
import type { Config } from '../../config';
import type { Json } from '../../crypto';
import { UnavailableError } from '../../errors';
import { oneClick } from './oneclick';

export type DepositProviderName = 'oneclick';

/** A way to pay into the treasury that needs nothing signed by the person paying. */
export interface DepositProvider {
  readonly name: DepositProviderName;
  /** Routes the provider can take right now, filtered to the allowlist. Cached for 10 minutes. */
  routes(): Promise<DepositRoute[]>;
  /**
   * Opens a deposit for `amount` (in the token's smallest unit): a quote whose recipient is the treasury's confidential
   * balance. Throws UnavailableError if the provider won't quote.
   */
  open(route: DepositRoute, amount: bigint): Promise<OpenedDeposit>;
  /**
   * What the provider says has happened to a deposit so far, in Alcove's terms; `unknown` for a status Alcove doesn't
   * know, and `doubtful` for a finished swap it can't read or trust. Throws UnavailableError if it won't answer.
   */
  check(deposit: DepositAddress): Promise<DepositCheck>;
}
/** How long one call to a provider may take before it counts as no answer. */
export const PROVIDER_TIMEOUT_MS = 15_000;
/**
 * A provider that can't be used right now (down, refusing, or answering what can't be trusted), in the words people see
 * for it. `context` says why in codes and statuses, never what a deposit is about.
 */
export const providerUnavailable = (provider: DepositProviderName, context: Record<string, string | number>, level: 'info' | 'warn' | 'error' = 'warn') =>
  new UnavailableError('Adding money isn’t available right now. Try again in a minute.', { context: { provider, ...context }, level });
/** The states of a deposit that money can still be on its way to. */
export type OpenDepositState = 'waiting' | 'arriving' | 'short';

/**
 * One token on one chain. `minimum` is in the token's smallest unit; `chainName` is the chain as people call it. Only
 * USDC is offered; USDT is the route of a deposit opened before that, still watched and settled.
 */
export interface DepositRoute { id: string; provider: DepositProviderName; chain: string; chainName: string; token: 'USDC' | 'USDT'; decimals: number; minimum: bigint }
/**
 * Where a deposit is paid, and the provider's quote for it as it was kept, which is all a provider needs to say what
 * happened to it: the quote says how the provider is to be asked (1Click: signed in as the treasury, for a deposit into
 * its confidential balance).
 */
export interface DepositAddress { route: DepositRoute; address: string; memo: string | null; quote: unknown }
/**
 * A deposit as the provider handed it out. `amountIn` is what the person is asked to send and `minAmountIn` the least
 * the provider still swaps, both in the token's smallest unit.
 */
export interface OpenedDeposit extends DepositAddress { expiresAt: string; amountIn: bigint; minAmountIn: bigint; quote: Json }
/**
 * What has happened to a deposit so far, in Alcove's terms. Amounts are micro-USD; `sentMicroUsd` on an open deposit
 * is what the provider has seen arrive, when it says; `providerRef` is the provider's name for the settlement.
 * `doubtful`: the provider says the swap finished, but its answer doesn't read, or its amounts don't agree with
 * themselves. Money came, so the deposit is `arriving`, and nothing is credited on it.
 */
export type DepositCheck =
  | { state: OpenDepositState; sentMicroUsd?: bigint | undefined }
  | { state: 'unknown' }
  | { state: 'settled'; sentMicroUsd: bigint; outMicroUsd: bigint; refundedMicroUsd: bigint; providerRef: string }
  | { state: 'doubtful'; reason: DoubtReason }
  | { state: 'failed'; reason: string };
/** Why a finished swap isn't credited: a short code, logged with the deposit's ID and never with what it is about. */
export type DoubtReason =
  | 'unreadable-finished-swap' | 'amounts-disagree-with-formatted'
  | 'nothing-sent' | 'less-reached-treasury-than-sent' | 'more-than-a-top-up-buys';

/** An amount of a USD stablecoin, at face value, in micro-USD (rounded down). */
export function toMicroUsd(amount: bigint, decimals: number): bigint {
  return decimals >= 6 ? amount / 10n ** BigInt(decimals - 6) : amount * 10n ** BigInt(6 - decimals);
}
/** Micro-USD as an amount of a USD stablecoin in its smallest unit, at face value, rounded up. */
export function fromMicroUsd(microUsd: bigint, decimals: number): bigint {
  if (decimals >= 6) return microUsd * 10n ** BigInt(decimals - 6);
  const unit = 10n ** BigInt(6 - decimals);
  return (microUsd + unit - 1n) / unit;
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
  // Top-ups take the treasury, its key to sign in to 1Click as it, and a partner key, beside which alone 1Click takes
  // that session on a quote. Without any of them they're off: no deposit is opened that would only be refused.
  const { TREASURY_INTENTS_ACCOUNT: account, TREASURY_INTENTS_KEY: key, ONECLICK_API_KEY: apiKey } = cfg;
  const providers = account && key && apiKey
    ? { oneclick: oneClick({ baseUrl: cfg.ONECLICK_BASE_URL, nearRpcUrl: cfg.NEAR_RPC_URL, apiKey, treasury: { account, key } }) }
    : null;
  made.set(cfg, providers);
  return providers;
}
