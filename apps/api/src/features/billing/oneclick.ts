/*
 * NEAR Intents 1Click as a deposit provider. A quote whose recipient (and refund target) is the treasury's Intents
 * account gives a one-off deposit address on the chain the person picked; whatever arrives there is swapped into USDC
 * on NEAR in the treasury's Intents balance. Only the stablecoins on the allowlist, and only while 1Click lists them.
 * Nothing about a deposit goes in a log line or an error: failures carry the HTTP status only.
 */
import { z } from 'zod';
import { toJson } from '../../crypto';
import { UnavailableError } from '../../errors';
import { log } from '../../log';
import { PROVIDER_TIMEOUT_MS, toMicroUsd, type DepositCheck, type DepositProvider, type DepositRoute, type OpenDepositState, type OpenedDeposit } from './provider';

const olog = log.child({ component: 'oneclick' });

/** USDC on NEAR: every payment ends as this, in the treasury's Intents balance. */
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
/**
 * The routes Alcove takes, keyed by 1Click asset ID (from /v0/tokens, checked 5 November 2026): USDC on chains that
 * don't need a memo, each with its decimals as listed then (18 for BNB Chain's, 6 for the rest). Every amount is
 * priced and read in those decimals, so a route 1Click lists with others isn't offered. Ethereum's minimum is higher
 * for its gas. USDT isn't taken, though 1Click lists it. Routes are offered in this order, whatever order 1Click lists them in.
 * The app asks only for a network, under Pay with USDC (apps/web/src/features/settings/topup.tsx): offering another
 * token means giving it back its token choice there.
 */
const ALLOWLIST: Record<string, { chain: string; chainName: string; token: 'USDC'; decimals: number; minimumUsd: bigint }> = {
  'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': { chain: 'near', chainName: 'NEAR', token: 'USDC', decimals: 6, minimumUsd: 5n },
  'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near': { chain: 'eth', chainName: 'Ethereum', token: 'USDC', decimals: 6, minimumUsd: 20n },
  'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near': { chain: 'sol', chainName: 'Solana', token: 'USDC', decimals: 6, minimumUsd: 5n },
  'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near': { chain: 'base', chainName: 'Base', token: 'USDC', decimals: 6, minimumUsd: 5n },
  'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near': { chain: 'arb', chainName: 'Arbitrum', token: 'USDC', decimals: 6, minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L': { chain: 'pol', chainName: 'Polygon', token: 'USDC', decimals: 6, minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r': { chain: 'bsc', chainName: 'BNB Chain', token: 'USDC', decimals: 18, minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ': { chain: 'op', chainName: 'Optimism', token: 'USDC', decimals: 6, minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o': { chain: 'avax', chainName: 'Avalanche', token: 'USDC', decimals: 6, minimumUsd: 5n }
};
const TOKENS_FOR_MS = 10 * 60_000;
/** How long a /v0/tokens failure is remembered, so a 1Click outage isn't asked about on every request. */
const TOKENS_FAILED_FOR_MS = 30_000;
const DEADLINE_MS = 24 * 3_600_000;
/** The earliest and latest deadline a quote may have: one that's about to pass, or watched for a long time, isn't handed out. */
const DEADLINE_AT_LEAST_MS = 3_600_000;
const DEADLINE_AT_MOST_MS = 7 * 24 * 3_600_000;
/** USDC on NEAR, what every swap ends as, has 6 decimals: `amountOut` is in micro-USDC. */
const OUT_DECIMALS = 6;

const TokensSchema = z.array(z.object({ assetId: z.string(), decimals: z.number().int().min(0).max(36) }));
const units = z.string().regex(/^\d+$/);
/** What a quote was for, as 1Click repeats it back in a quote. */
const Asked = z.object({
  originAsset: z.string(), destinationAsset: z.string(), recipient: z.string(), recipientType: z.string(), refundTo: z.string(), refundType: z.string()
});
/**
 * A quote: what it was asked for, where to send, until when, what to send and the least that 1Click still swaps (the
 * token's smallest unit).
 */
const QuoteResponseSchema = z.object({
  quoteRequest: Asked.extend({ swapType: z.string(), amount: z.string() }),
  quote: z.object({ depositAddress: z.string().min(1), depositMemo: z.string().nullish(), deadline: z.string().datetime(), amountIn: units, minAmountIn: units })
});

/** What /v0/status says about a deposit: its status and the swap details, read for what was sent so far, and once the swap is done. */
const StatusSchema = z.object({ status: z.string(), swapDetails: z.unknown() });
/** What an unfinished swap says arrived so far, when it says. */
const seen = z.object({ depositedAmount: units.nullish() });
/**
 * A finished swap: what was sent, what reached the treasury as USDC (micro-USDC) and what was refunded to it instead,
 * each with 1Click's own decimal rendering of it when it gives one. A swap that succeeded must say what came out, a
 * refunded one what was refunded; only the other may be missing (0).
 */
const settled = z.object({
  depositedAmount: units, depositedAmountFormatted: z.string().nullish(),
  amountOut: units.nullish(), amountOutFormatted: z.string().nullish(),
  refundedAmount: units.nullish(), refundedAmountFormatted: z.string().nullish(),
  intentHashes: z.array(z.string().min(1)).min(1)
});
/**
 * Whether an amount in a token's smallest unit says the same as 1Click's own decimal rendering of it ("1500000" and
 * "1.5" at 6 decimals), when there is one. When they disagree, the units aren't what this code assumes (the token's
 * decimals), so the amount isn't credited.
 */
function agrees(amount: string | null | undefined, formatted: string | null | undefined, decimals: number): boolean {
  if (amount === null || amount === undefined || formatted === null || formatted === undefined) return true;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(formatted);
  if (!m) return false;
  const fraction = m[2] ?? '';
  if (fraction.length > decimals) return false;
  return BigInt(`${m[1] ?? '0'}${fraction.padEnd(decimals, '0')}`) === BigInt(amount);
}
const SETTLED = {
  SUCCESS: settled.extend({ amountOut: units }),
  REFUNDED: settled.extend({ refundedAmount: units })
} as const;
/** 1Click's statuses for a deposit still on its way, in Alcove's terms. */
const IN_PROGRESS = new Map<string, OpenDepositState>([
  ['PENDING_DEPOSIT', 'waiting'], ['KNOWN_DEPOSIT_TX', 'arriving'], ['PROCESSING', 'arriving'], ['INCOMPLETE_DEPOSIT', 'short']
]);

const unavailable = (context: Record<string, string | number>, level: 'warn' | 'error' = 'warn') =>
  new UnavailableError('Adding money isn’t available right now. Try again in a minute.', { context: { provider: 'oneclick', ...context }, level });
/**
 * The widest band of a quote Alcove takes, in basis points below what it asks for: 1% slippage and half a percent more.
 * A payment anywhere in the band earns the full promise, so a wider one would give money away.
 */
const MAX_BAND_BPS = 150n;

/** `apiKey` is the partner JWT; without one 1Click still quotes, with its own fee on top. */
export function oneClick(o: { baseUrl: string; apiKey: string | undefined; treasury: string }): DepositProvider {
  let tokens: { routes: DepositRoute[]; until: number } | { failed: true; until: number } | null = null;

  /** One request to 1Click, its JSON body parsed with `schema`. Anything but a 2xx answer that parses is unavailable. */
  async function call<S extends z.ZodType>(schema: S, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ data: z.infer<S>; raw: unknown }> {
    // Errors name the endpoint, never its query, which can name a deposit.
    const endpoint = path.split('?')[0] ?? '';
    let res: Response;
    try {
      res = await fetch(`${o.baseUrl}${path}`, {
        method,
        headers: { ...(o.apiKey === undefined ? {} : { 'X-API-Key': o.apiKey }), 'User-Agent': 'alcove-api', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
      });
    } catch (e) {
      throw unavailable({ endpoint, error: e instanceof Error ? e.name : 'unknown' });
    }
    if (!res.ok) throw unavailable({ endpoint, status: res.status });
    const raw: unknown = await res.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw unavailable({ endpoint, status: res.status, error: 'unexpected-response' });
    return { data: parsed.data, raw };
  }

  return {
    name: 'oneclick',
    async routes() {
      if (tokens && tokens.until > Date.now()) {
        if ('routes' in tokens) return tokens.routes;
        throw unavailable({ endpoint: '/v0/tokens', error: 'failed-recently' });
      }
      let data: z.infer<typeof TokensSchema>;
      try {
        ({ data } = await call(TokensSchema, 'GET', '/v0/tokens'));
      } catch (e) {
        tokens = { failed: true, until: Date.now() + TOKENS_FAILED_FOR_MS };
        throw e;
      }
      // The allowlist's routes that 1Click lists, in the allowlist's order.
      const listed = new Map(data.map((t) => [t.assetId, t.decimals]));
      const routes = Object.entries(ALLOWLIST).flatMap(([id, a]): DepositRoute[] => {
        const decimals = listed.get(id);
        if (decimals === undefined) return [];
        if (decimals !== a.decimals) {
          // Every amount on this route would be off by a power of ten: it isn't offered until someone looks.
          olog.error('route listed with other decimals than allowlisted', { provider: 'oneclick', route: id, listed: decimals, allowlisted: a.decimals });
          return [];
        }
        return [{ id, provider: 'oneclick', chain: a.chain, chainName: a.chainName, token: a.token, decimals: a.decimals, minimum: a.minimumUsd * 10n ** BigInt(a.decimals) }];
      });
      tokens = { routes, until: Date.now() + TOKENS_FOR_MS };
      return routes;
    },
    async open(route, amount): Promise<OpenedDeposit> {
      const asked = {
        originAsset: route.id, destinationAsset: NEAR_USDC, recipient: o.treasury, recipientType: 'INTENTS', refundTo: o.treasury, refundType: 'INTENTS'
      };
      const { data, raw } = await call(QuoteResponseSchema, 'POST', '/v0/quote', {
        dry: false, swapType: 'FLEX_INPUT', slippageTolerance: 100, depositType: 'ORIGIN_CHAIN', amount: amount.toString(), ...asked,
        deadline: new Date(Date.now() + DEADLINE_MS).toISOString()
      });
      // The person is told to send exactly what was asked for, and anything from `minAmountIn` up earns the promise: a
      // quote for another amount, with a wider band, for another request or with a deadline out of bounds isn't one to
      // hand out. Each means the integration is broken (not that 1Click is down), so it's an error; amounts stay out of the log.
      const q = data.quoteRequest;
      if (q.swapType !== 'FLEX_INPUT' || q.amount !== amount.toString() || !sameRequest(q, asked)) {
        throw unavailable({ endpoint: '/v0/quote', error: 'unexpected-quote-request' }, 'error');
      }
      const amountIn = BigInt(data.quote.amountIn);
      const minAmountIn = BigInt(data.quote.minAmountIn);
      if (amountIn !== amount) throw unavailable({ endpoint: '/v0/quote', error: 'unexpected-quote-amount' }, 'error');
      if (minAmountIn > amountIn || minAmountIn * 10_000n < amount * (10_000n - MAX_BAND_BPS)) {
        throw unavailable({ endpoint: '/v0/quote', error: 'unexpected-quote-band' }, 'error');
      }
      const deadline = Date.parse(data.quote.deadline);
      if (!(deadline >= Date.now() + DEADLINE_AT_LEAST_MS && deadline <= Date.now() + DEADLINE_AT_MOST_MS)) {
        throw unavailable({ endpoint: '/v0/quote', error: 'unexpected-quote-deadline' }, 'error');
      }
      return { route, address: data.quote.depositAddress, memo: data.quote.depositMemo || null, expiresAt: data.quote.deadline, amountIn, minAmountIn, quote: toJson(raw) };
    },
    async check(deposit): Promise<DepositCheck> {
      const query = new URLSearchParams({ depositAddress: deposit.address, ...(deposit.memo === null ? {} : { depositMemo: deposit.memo }) });
      const { data } = await call(StatusSchema, 'GET', `/v0/status?${query.toString()}`);
      const progress = IN_PROGRESS.get(data.status);
      if (progress) {
        const sent = seen.safeParse(data.swapDetails);
        const deposited = sent.success && sent.data.depositedAmount ? BigInt(sent.data.depositedAmount) : 0n;
        return deposited > 0n ? { state: progress, sentMicroUsd: toMicroUsd(deposited, deposit.route.decimals) } : { state: progress };
      }
      if (data.status === 'FAILED') return { state: 'failed', reason: 'FAILED' };
      if (data.status === 'SUCCESS' || data.status === 'REFUNDED') {
        // Money came. Whatever here can't be read or trusted makes it doubtful: nothing is credited, and the caller
        // logs it once and leaves it to reach support.
        const s = SETTLED[data.status].safeParse(data.swapDetails);
        if (!s.success) return { state: 'doubtful', reason: 'unreadable-finished-swap' };
        const d = deposit.route.decimals;
        const x = s.data;
        if (!agrees(x.depositedAmount, x.depositedAmountFormatted, d) || !agrees(x.refundedAmount, x.refundedAmountFormatted, d) || !agrees(x.amountOut, x.amountOutFormatted, OUT_DECIMALS)) {
          return { state: 'doubtful', reason: 'amounts-disagree-with-formatted' };
        }
        return {
          state: 'settled',
          sentMicroUsd: toMicroUsd(BigInt(x.depositedAmount), d),
          outMicroUsd: toMicroUsd(BigInt(x.amountOut ?? '0'), OUT_DECIMALS),
          refundedMicroUsd: toMicroUsd(BigInt(x.refundedAmount ?? '0'), d),
          providerRef: x.intentHashes[0] ?? ''
        };
      }
      // A status this code doesn't know: say so, and let the caller decide (it keeps watching until the deadline).
      olog.warn('unreadable deposit status', { provider: 'oneclick', status: data.status.slice(0, 40) });
      return { state: 'unknown' };
    }
  };
}

/** Whether 1Click's repetition of a quote request is the request Alcove makes: from the route, to the treasury, as USDC on NEAR. */
function sameRequest(got: z.infer<typeof Asked>, want: z.infer<typeof Asked>): boolean {
  return got.originAsset === want.originAsset && got.destinationAsset === want.destinationAsset && got.recipient === want.recipient
    && got.recipientType === want.recipientType && got.refundTo === want.refundTo && got.refundType === want.refundType;
}
