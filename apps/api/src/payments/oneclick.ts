/*
 * NEAR Intents 1Click as a deposit provider. A quote whose recipient (and refund target) is the treasury's Intents
 * account gives a one-off deposit address on the chain the person picked; whatever arrives there is swapped into USDC
 * on NEAR in the treasury's Intents balance. Only the stablecoins on the allowlist, and only while 1Click lists them.
 * Nothing about a deposit goes in a log line or an error: failures carry the HTTP status only.
 */
import { z } from 'zod';
import { toJson } from '../crypto';
import { UnavailableError } from '../errors';
import { log } from '../log';
import { toMicroUsd, type DepositCheck, type DepositProvider, type DepositRoute, type OpenDepositState, type OpenedDeposit } from './provider';

const olog = log.child({ component: 'oneclick' });

/** USDC on NEAR: every payment ends as this, in the treasury's Intents balance. */
const NEAR_USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
/**
 * The routes Alcove takes, keyed by 1Click asset ID (from /v0/tokens, checked 5 November 2026): USD stablecoins on
 * chains that don't need a memo. Ethereum's minimum is higher for its gas.
 */
const ALLOWLIST: Record<string, { chain: string; chainName: string; token: 'USDC' | 'USDT'; minimumUsd: bigint }> = {
  'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1': { chain: 'near', chainName: 'NEAR', token: 'USDC', minimumUsd: 5n },
  'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near': { chain: 'eth', chainName: 'Ethereum', token: 'USDC', minimumUsd: 20n },
  'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near': { chain: 'base', chainName: 'Base', token: 'USDC', minimumUsd: 5n },
  'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near': { chain: 'arb', chainName: 'Arbitrum', token: 'USDC', minimumUsd: 5n },
  'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near': { chain: 'sol', chainName: 'Solana', token: 'USDC', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L': { chain: 'pol', chainName: 'Polygon', token: 'USDC', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r': { chain: 'bsc', chainName: 'BNB Chain', token: 'USDC', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ': { chain: 'op', chainName: 'Optimism', token: 'USDC', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o': { chain: 'avax', chainName: 'Avalanche', token: 'USDC', minimumUsd: 5n },
  'nep141:usdt.tether-token.near': { chain: 'near', chainName: 'NEAR', token: 'USDT', minimumUsd: 5n },
  'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near': { chain: 'eth', chainName: 'Ethereum', token: 'USDT', minimumUsd: 20n },
  'nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near': { chain: 'sol', chainName: 'Solana', token: 'USDT', minimumUsd: 5n },
  'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near': { chain: 'tron', chainName: 'Tron', token: 'USDT', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr': { chain: 'pol', chainName: 'Polygon', token: 'USDT', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g': { chain: 'bsc', chainName: 'BNB Chain', token: 'USDT', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:10_359RPSJVdTxwTJT9TyGssr2rFoWo': { chain: 'op', chainName: 'Optimism', token: 'USDT', minimumUsd: 5n },
  'nep245:v2_1.omni.hot.tg:43114_372BeH7ENZieCaabwkbWkBiTTgXp': { chain: 'avax', chainName: 'Avalanche', token: 'USDT', minimumUsd: 5n }
};
const TOKENS_FOR_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;
const DEADLINE_MS = 24 * 3_600_000;

const TokensSchema = z.array(z.object({ assetId: z.string(), decimals: z.number().int().min(0).max(36) }));
const units = z.string().regex(/^\d+$/);
/** A quote: where to send, until when, what to send and the least that 1Click still swaps (the token's smallest unit). */
const QuoteResponseSchema = z.object({
  quote: z.object({ depositAddress: z.string().min(1), depositMemo: z.string().nullish(), deadline: z.string().datetime(), amountIn: units, minAmountIn: units })
});

/** What /v0/status says about a deposit. Its swap details are read for what was sent so far, and once the swap is done. */
const StatusSchema = z.object({ status: z.string(), swapDetails: z.unknown() });
/** What an unfinished swap says arrived so far, when it says. */
const seen = z.object({ depositedAmount: units.nullish() });
/**
 * A finished swap: what was sent, what reached the treasury as USDC (micro-USDC) and what was refunded to it instead.
 * A swap that succeeded must say what came out, a refunded one what was refunded; only the other may be missing (0).
 */
const settled = z.object({ depositedAmount: units, amountOut: units.nullish(), refundedAmount: units.nullish(), intentHashes: z.array(z.string().min(1)).min(1) });
const SETTLED = {
  SUCCESS: settled.extend({ amountOut: units }),
  REFUNDED: settled.extend({ refundedAmount: units })
} as const;
/** 1Click's statuses for a deposit still on its way, in Alcove's terms. */
const IN_PROGRESS = new Map<string, OpenDepositState>([
  ['PENDING_DEPOSIT', 'waiting'], ['KNOWN_DEPOSIT_TX', 'arriving'], ['PROCESSING', 'arriving'], ['INCOMPLETE_DEPOSIT', 'short']
]);

const unavailable = (context: Record<string, string | number>, level: 'warn' | 'error' = 'warn') =>
  new UnavailableError('Adding credits isn’t available right now. Try again in a minute.', { context: { provider: 'oneclick', ...context }, level });
/**
 * The widest band of a quote Alcove takes, in basis points below what it asks for: 1% slippage and half a percent more.
 * A payment anywhere in the band earns the full promise, so a wider one would give credits away.
 */
const MAX_BAND_BPS = 150n;

/** `apiKey` is the partner JWT; without one 1Click still quotes, with its own fee on top. */
export function oneClick(o: { baseUrl: string; apiKey: string | undefined; treasury: string }): DepositProvider {
  let tokens: { routes: DepositRoute[]; until: number } | null = null;

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
        signal: AbortSignal.timeout(TIMEOUT_MS)
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
      if (tokens && tokens.until > Date.now()) return tokens.routes;
      const { data } = await call(TokensSchema, 'GET', '/v0/tokens');
      const routes = data.flatMap((t): DepositRoute[] => {
        const a = ALLOWLIST[t.assetId];
        if (!a) return [];
        return [{ id: t.assetId, provider: 'oneclick', chain: a.chain, chainName: a.chainName, token: a.token, decimals: t.decimals, minimum: a.minimumUsd * 10n ** BigInt(t.decimals) }];
      });
      tokens = { routes, until: Date.now() + TOKENS_FOR_MS };
      return routes;
    },
    async open(route, amount): Promise<OpenedDeposit> {
      const { data, raw } = await call(QuoteResponseSchema, 'POST', '/v0/quote', {
        dry: false, swapType: 'FLEX_INPUT', slippageTolerance: 100,
        originAsset: route.id, depositType: 'ORIGIN_CHAIN', destinationAsset: NEAR_USDC, amount: amount.toString(),
        refundTo: o.treasury, refundType: 'INTENTS', recipient: o.treasury, recipientType: 'INTENTS',
        deadline: new Date(Date.now() + DEADLINE_MS).toISOString()
      });
      // The person is told to send exactly what was asked for, and anything from `minAmountIn` up earns the promise: a
      // quote for another amount, or with a wider band, isn't one to hand out. Either means the integration is broken
      // (not that 1Click is down), so it's an error; amounts stay out of the log.
      const amountIn = BigInt(data.quote.amountIn);
      const minAmountIn = BigInt(data.quote.minAmountIn);
      if (amountIn !== amount) throw unavailable({ endpoint: '/v0/quote', error: 'unexpected-quote-amount' }, 'error');
      if (minAmountIn > amountIn || minAmountIn * 10_000n < amount * (10_000n - MAX_BAND_BPS)) {
        throw unavailable({ endpoint: '/v0/quote', error: 'unexpected-quote-band' }, 'error');
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
        const s = SETTLED[data.status].safeParse(data.swapDetails);
        if (s.success) {
          return {
            state: 'settled',
            sentMicroUsd: toMicroUsd(BigInt(s.data.depositedAmount), deposit.route.decimals),
            outMicroUsd: BigInt(s.data.amountOut ?? '0'),
            refundedMicroUsd: toMicroUsd(BigInt(s.data.refundedAmount ?? '0'), deposit.route.decimals),
            providerRef: s.data.intentHashes[0] ?? ''
          };
        }
        // A finished swap it can't read: money came, so it's arriving (the address no longer shown), and it's asked again.
        olog.warn('unreadable finished swap', { provider: 'oneclick', status: data.status });
        return { state: 'arriving' };
      }
      // A status this code doesn't know: say so, and let the caller decide (it keeps watching until the deadline).
      olog.warn('unreadable deposit status', { provider: 'oneclick', status: data.status.slice(0, 40) });
      return { state: 'unknown' };
    }
  };
}
