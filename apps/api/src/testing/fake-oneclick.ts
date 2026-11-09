/*
 * A stand-in for NEAR Intents 1Click, for integration tests: the tokens it swaps (/v0/tokens), quotes that hand out
 * a deposit address (/v0/quote), and what has happened to a deposit (/v0/status), in 1Click's own shapes. Every quote
 * request and API key is kept, so tests can check what Alcove asked for. A quote's `minAmountIn` is 99% of what it
 * asks for. A deposit reports PENDING_DEPOSIT until a test moves it on with `set` (which can also say what was deposited
 * so far, as 1Click does on INCOMPLETE_DEPOSIT), and the whole service can be made to refuse everything, as when 1Click is down.
 * Swap amounts a test doesn't set are missing, never 0, and each amount it sets comes with 1Click's decimal rendering of
 * it (in the deposit token's decimals, or USDC's 6 for `amountOut`) unless the test sets that too (null leaves it out).
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';

/** A token 1Click swaps that isn't on Alcove's allowlist: wrapped NEAR. */
export const NOT_ALLOWLISTED = 'nep141:wrap.near';
/** What 1Click lists at /v0/tokens: every route on the allowlist, and one that isn't. BNB Chain's tokens have 18 decimals. */
const TOKENS: readonly { assetId: string; decimals: number; blockchain: string; symbol: string }[] = [
  { blockchain: 'near', symbol: 'USDC', assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', decimals: 6 },
  { blockchain: 'eth', symbol: 'USDC', assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near', decimals: 6 },
  { blockchain: 'base', symbol: 'USDC', assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', decimals: 6 },
  { blockchain: 'arb', symbol: 'USDC', assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near', decimals: 6 },
  { blockchain: 'sol', symbol: 'USDC', assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near', decimals: 6 },
  { blockchain: 'pol', symbol: 'USDC', assetId: 'nep245:v2_1.omni.hot.tg:137_qiStmoQJDQPTebaPjgx5VBxZv6L', decimals: 6 },
  { blockchain: 'bsc', symbol: 'USDC', assetId: 'nep245:v2_1.omni.hot.tg:56_2w93GqMcEmQFDru84j3HZZWt557r', decimals: 18 },
  { blockchain: 'op', symbol: 'USDC', assetId: 'nep245:v2_1.omni.hot.tg:10_A2ewyUyDp6qsue1jqZsGypkCxRJ', decimals: 6 },
  { blockchain: 'avax', symbol: 'USDC', assetId: 'nep245:v2_1.omni.hot.tg:43114_3atVJH3r5c4GqiSYmg9fECvjc47o', decimals: 6 },
  { blockchain: 'near', symbol: 'USDT', assetId: 'nep141:usdt.tether-token.near', decimals: 6 },
  { blockchain: 'eth', symbol: 'USDT', assetId: 'nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near', decimals: 6 },
  { blockchain: 'sol', symbol: 'USDT', assetId: 'nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near', decimals: 6 },
  { blockchain: 'tron', symbol: 'USDT', assetId: 'nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near', decimals: 6 },
  { blockchain: 'pol', symbol: 'USDT', assetId: 'nep245:v2_1.omni.hot.tg:137_3hpYoaLtt8MP1Z2GH1U473DMRKgr', decimals: 6 },
  { blockchain: 'bsc', symbol: 'USDT', assetId: 'nep245:v2_1.omni.hot.tg:56_2CMMyVTGZkeyNZTSvS5sarzfir6g', decimals: 18 },
  { blockchain: 'op', symbol: 'USDT', assetId: 'nep245:v2_1.omni.hot.tg:10_359RPSJVdTxwTJT9TyGssr2rFoWo', decimals: 6 },
  { blockchain: 'avax', symbol: 'USDT', assetId: 'nep245:v2_1.omni.hot.tg:43114_372BeH7ENZieCaabwkbWkBiTTgXp', decimals: 6 },
  { blockchain: 'near', symbol: 'wNEAR', assetId: NOT_ALLOWLISTED, decimals: 24 }
];

/** A quote request as 1Click takes it at POST /v0/quote. */
const QuoteRequestBodySchema = z.object({
  dry: z.boolean(), swapType: z.string(), slippageTolerance: z.number(), originAsset: z.string(), depositType: z.string(),
  destinationAsset: z.string(), amount: z.string().regex(/^\d+$/), refundTo: z.string(), refundType: z.string(),
  recipient: z.string(), recipientType: z.string(), deadline: z.string()
}).passthrough();
export type QuoteRequestBody = z.infer<typeof QuoteRequestBodySchema>;
/** A quote as 1Click answers it, and repeats it back in every status. */
interface QuoteResponse {
  correlationId: string; timestamp: string; signature: string; quoteRequest: QuoteRequestBody;
  quote: {
    depositAddress: string; depositMemo?: string | null; amountIn: string; amountInFormatted: string; amountInUsd: string; minAmountIn: string;
    amountOut: string; amountOutFormatted: string; amountOutUsd: string; minAmountOut: string; deadline: string; timeWhenInactive: string; timeEstimate: number;
  };
}
/** What 1Click says about a deposit's swap: amounts in the token's smallest unit, as integer strings. */
export interface SwapDetails {
  /** 1Click's decimal rendering of the amounts: worked out from them unless a test sets it (null: left out). */
  depositedAmountFormatted?: string | null | undefined; refundedAmountFormatted?: string | null | undefined; amountOutFormatted?: string | null | undefined;
  intentHashes: string[]; nearTxHashes: string[]; amountIn: string | null; amountOut: string | null; depositedAmount: string | null; refundedAmount: string | null;
  originChainTxHashes: { hash: string; explorerUrl: string }[]; destinationChainTxHashes: { hash: string; explorerUrl: string }[];
}

export interface FakeOneClick {
  /** What the API is configured with to use this 1Click. */
  settings: { ONECLICK_BASE_URL: string; ONECLICK_API_KEY: string; TREASURY_INTENTS_ACCOUNT: string };
  /** Every quote request, oldest first. */
  quotes: QuoteRequestBody[];
  /** The X-API-Key of every request, oldest first ('' when there was none). */
  apiKeys: string[];
  /** Every deposit address quoted so far, oldest first. */
  addresses(): string[];
  /** What 1Click reports for a deposit from now on: its status and what happened to the swap. */
  set(address: string, status: string, swapDetails?: Partial<SwapDetails>): void;
  /**
   * The next quote answers with these instead of what was asked (the amount, 99% of it, the deadline asked for, the
   * request itself), as a misbehaving 1Click might.
   */
  nextQuote(o: NextQuote): void;
  /** /v0/tokens lists this asset with these decimals from now on (null: as it really is). */
  listDecimals(assetId: string, decimals: number | null): void;
  /** 1Click refuses every request (true), or answers again (false). */
  down(on: boolean): void;
  close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function text(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString('utf8');
}
interface NextQuote { amountIn?: string; minAmountIn?: string; deadline?: string; quoteRequest?: Partial<QuoteRequestBody> }
const noSwap = (): SwapDetails => ({
  intentHashes: [], nearTxHashes: [], amountIn: null, amountOut: null, depositedAmount: null, refundedAmount: null, originChainTxHashes: [], destinationChainTxHashes: []
});
/** An amount in a token's smallest unit as 1Click renders it: "45", "44.995". */
function formatted(amount: string, decimals: number): string {
  const unit = 10n ** BigInt(decimals);
  const fraction = (BigInt(amount) % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${BigInt(amount) / unit}.${fraction}` : `${BigInt(amount) / unit}`;
}
/** Swap details as 1Click sends them: each amount with its rendering, unless the test set that itself. */
function rendered(s: SwapDetails, decimals: number): Record<string, unknown> {
  const pick = (amount: string | null, given: string | null | undefined, d: number) => (given !== undefined ? given : amount === null ? null : formatted(amount, d));
  return {
    ...s,
    depositedAmountFormatted: pick(s.depositedAmount, s.depositedAmountFormatted, decimals),
    refundedAmountFormatted: pick(s.refundedAmount, s.refundedAmountFormatted, decimals),
    amountOutFormatted: pick(s.amountOut, s.amountOutFormatted, 6)
  };
}

export async function startFakeOneClick(): Promise<FakeOneClick> {
  const settings = { ONECLICK_BASE_URL: '', ONECLICK_API_KEY: `test-oneclick-jwt-${randomBytes(8).toString('hex')}`, TREASURY_INTENTS_ACCOUNT: 'alcove-treasury.near' };
  const quotes: QuoteRequestBody[] = [];
  const apiKeys: string[] = [];
  /** Each deposit address, with the quote response that made it and what it reports. */
  const deposits = new Map<string, { quoteResponse: QuoteResponse; decimals: number; status: string; swapDetails: SwapDetails; updatedAt: string }>();
  const listed = new Map<string, number>();
  let isDown = false;
  let override: NextQuote = {};

  async function quote(req: IncomingMessage, res: ServerResponse) {
    const body: unknown = JSON.parse(await text(req));
    const parsed = QuoteRequestBodySchema.safeParse(body);
    if (!parsed.success) return send(res, 400, { message: 'Invalid quote request' });
    const q = parsed.data;
    quotes.push(q);
    const decimals = TOKENS.find((t) => t.assetId === q.originAsset)?.decimals ?? 6;
    const amountUsd = (Number(q.amount) / 1e6).toFixed(2);
    const {
      amountIn = q.amount, minAmountIn = ((BigInt(q.amount) * 99n) / 100n).toString(), deadline = q.deadline
    } = override;
    const depositAddress = `0xcanary-deposit-address-${randomBytes(12).toString('hex')}`;
    const quoteRequest = { ...q, ...override.quoteRequest };
    override = {};
    const response: QuoteResponse = {
      correlationId: randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      signature: `ed25519:${randomBytes(32).toString('hex')}`,
      quoteRequest,
      quote: {
        // 1Click's band: it still swaps a deposit down to 99% of what the quote asked for.
        depositAddress, amountIn, amountInFormatted: amountUsd, amountInUsd: amountUsd, minAmountIn,
        amountOut: q.amount, amountOutFormatted: amountUsd, amountOutUsd: amountUsd, minAmountOut: q.amount,
        deadline, timeWhenInactive: deadline, timeEstimate: 20
      }
    };
    deposits.set(depositAddress, { quoteResponse: response, decimals, status: 'PENDING_DEPOSIT', swapDetails: noSwap(), updatedAt: new Date().toISOString() });
    send(res, 201, response);
  }
  function status(url: URL, res: ServerResponse) {
    const address = url.searchParams.get('depositAddress') ?? '';
    const d = deposits.get(address);
    if (!d) return send(res, 404, { message: 'Deposit address not found' });
    send(res, 200, {
      correlationId: randomBytes(16).toString('hex'),
      quoteResponse: d.quoteResponse,
      status: d.status,
      updatedAt: d.updatedAt,
      swapDetails: rendered(d.swapDetails, d.decimals)
    });
  }

  const server = createServer((req, res) => {
    apiKeys.push(typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '');
    if (isDown) return send(res, 503, { message: 'Service Unavailable' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/v0/tokens') {
      return send(res, 200, TOKENS.map((t) => ({ ...t, decimals: listed.get(t.assetId) ?? t.decimals, price: 1, priceUpdatedAt: new Date().toISOString() })));
    }
    if (req.method === 'POST' && url.pathname === '/v0/quote') return void quote(req, res).catch(() => send(res, 400, { message: 'Invalid quote request' }));
    if (req.method === 'GET' && url.pathname === '/v0/status') return status(url, res);
    send(res, 404, { message: 'Not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  settings.ONECLICK_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  return {
    settings, quotes, apiKeys,
    addresses: () => [...deposits.keys()],
    set(address, s, swapDetails = {}) {
      const d = deposits.get(address);
      if (!d) throw new Error('1Click never quoted that deposit address');
      deposits.set(address, { ...d, status: s, swapDetails: { ...d.swapDetails, ...swapDetails }, updatedAt: new Date().toISOString() });
    },
    nextQuote(o) { override = o; },
    listDecimals(assetId, decimals) { if (decimals === null) listed.delete(assetId); else listed.set(assetId, decimals); },
    down(on) { isDown = on; },
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}
