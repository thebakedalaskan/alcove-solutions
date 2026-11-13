/*
 * A stand-in for NEAR Intents 1Click, for integration tests: the tokens it swaps (/v0/tokens), quotes that hand out
 * a deposit address (/v0/quote), what has happened to a deposit (/v0/status), and signing in as a NEAR account
 * (/v0/auth/authenticate, /v0/auth/refresh), in 1Click's own shapes, beside NEAR's RPC for intents.near's current salt
 * (POST /near-rpc). Every quote request, API key and Bearer token is kept, so tests can check what Alcove asked for and
 * as whom. A quote's `minAmountIn` is 99% of what it asks for. A deposit reports PENDING_DEPOSIT until a test moves it on
 * with `set` (which can also say what was deposited so far, as 1Click does on INCOMPLETE_DEPOSIT), and the whole service
 * can be made to refuse everything, as when 1Click is down. Swap amounts a test doesn't set are missing, never 0, and
 * each amount it sets comes with 1Click's decimal rendering of it (in the deposit token's decimals, or USDC's 6 for
 * `amountOut`) unless the test sets that too (null leaves it out).
 *
 * Signing in is checked as 1Click checks it (as seen live, 12 November 2026): an empty intent for intents.near, signed
 * NEP-413 style by a key registered for its signer, whose nonce carries the contract's current salt and a time in the
 * last few minutes. The stand-in makes the treasury's key itself (a test key, never a real one) and registers its public
 * key for the treasury's account. Tokens last as 1Click's do (15 minutes; refresh tokens 7 days, reused, not rotated)
 * unless a test says otherwise, and can be made to run out at once. A Bearer token on a quote or a status call is the
 * caller's session only beside the partner key (X-API-Key); without it, 1Click reads the Bearer as a partner key and
 * refuses it. A confidential quote pays only the account signed in, and only that account is told about its deposit.
 */
import { createHash, createPrivateKey, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';

/** A token 1Click swaps that isn't on Alcove's allowlist: wrapped NEAR. */
export const NOT_ALLOWLISTED = 'nep141:wrap.near';
/**
 * What 1Click lists at /v0/tokens: every route on the allowlist, and some that aren't (USDT, which Alcove doesn't take,
 * and wrapped NEAR). BNB Chain's tokens have 18 decimals.
 */
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
  /**
   * What the API is configured with to use this 1Click: its address, the partner key, the treasury and the treasury's
   * key (a test key this stand-in made, registered for the treasury), and NEAR's RPC for intents.near's salt.
   */
  settings: { ONECLICK_BASE_URL: string; ONECLICK_API_KEY: string; TREASURY_INTENTS_ACCOUNT: string; TREASURY_INTENTS_KEY: string; NEAR_RPC_URL: string };
  /** The public key of the treasury's test key, as registered for the treasury in intents.near. */
  treasuryPublicKey: string;
  /** Every quote request, oldest first, refused ones too. */
  quotes: QuoteRequestBody[];
  /** The X-API-Key of every request to 1Click, oldest first ('' when there was none). */
  apiKeys: string[];
  /** The Bearer token of every request to 1Click, oldest first ('' when there was none). */
  bearers: string[];
  /** The account this 1Click issued an access token to, or null for a token it never issued. */
  accountOf(token: string): string | null;
  /** How many sign-ins and refreshes it has taken so far. */
  counts(): { signIns: number; refreshes: number };
  /** Every access and refresh token issued so far, oldest first. */
  tokens(): string[];
  /** Refuses every sign-in from now on (true), as when the key isn't registered for its account, or takes them again (false). */
  refuseSignIns(on: boolean): void;
  /** Every access token issued so far has run out, and with `refresh`, every refresh token too. */
  expireTokens(o?: { refresh?: boolean }): void;
  /** How long tokens issued from now on last, in seconds (null: as 1Click's, 900 and 604,800). */
  tokenLifetime(l: { access?: number; refresh?: number } | null): void;
  /** intents.near has a new salt: sign-ins must carry it from now on. */
  rotateSalt(): void;
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
  /**
   * Holds back what 1Click says about a deposit: a status request for it waits until `release`, then is answered as 1Click
   * is set then (refused, if it's down). `asked` settles once one is waiting, so a test knows a check of it is on its way.
   */
  hold(address: string): { asked: Promise<void>; release(): void };
  close(): Promise<void>;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Bytes in base58, by long division over its digits: written apart from the API's own on purpose, so the two must agree. */
function toBase58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += (digits[i] ?? 0) * 256;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    for (; carry > 0; carry = Math.floor(carry / 58)) digits.push(carry % 58);
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += BASE58[digits[i] ?? 0] ?? '';
  return out;
}
/** base58 as bytes, or null when it isn't. */
function fromBase58(text: string): Buffer | null {
  const bytes: number[] = [];
  for (const c of text) {
    let carry = BASE58.indexOf(c);
    if (carry < 0) return null;
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 255;
      carry >>= 8;
    }
    for (; carry > 0; carry >>= 8) bytes.push(carry & 255);
  }
  for (const c of text) {
    if (c !== '1') break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}
/** NEAR's key and signature format: `ed25519:` and base58. */
const ed25519 = (text: string) => (text.startsWith('ed25519:') ? fromBase58(text.slice('ed25519:'.length)) : null);
/** Bytes in NEAR's key format, `ed25519:` and base58, whatever they are: for a test to make keys that aren't keys. */
export const nearKeyText = (bytes: Uint8Array): string => `ed25519:${toBase58(bytes)}`;

/**
 * A NEAR key for tests, never a real one: its secret in NEAR's format (`ed25519:` and the seed and public key, base58)
 * and its public key. Its seed starts with a zero byte, so the secret's base58 starts with a '1', the case base58 most
 * easily gets wrong.
 */
export function testNearKey(): { secret: string; publicKey: string } {
  const seed = randomBytes(32);
  seed[0] = 0;
  const x = createPublicKey(createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]), format: 'der', type: 'pkcs8' })).export({ format: 'jwk' }).x;
  if (!x) throw new Error('Node made an Ed25519 key without a public key');
  const publicKey = Buffer.from(x, 'base64url');
  return { secret: nearKeyText(Buffer.concat([seed, publicKey])), publicKey: nearKeyText(publicKey) };
}

/** A sign-in as 1Click takes it: a NEP-413 MultiPayload. */
const SignInSchema = z.object({
  signedData: z.object({
    standard: z.literal('nep413'),
    payload: z.object({ message: z.string(), nonce: z.string(), recipient: z.string(), callbackUrl: z.string().optional() }),
    public_key: z.string(), signature: z.string()
  })
});
/** What a sign-in signs: an intent with nothing in it. */
const IntentSchema = z.object({ deadline: z.string(), intents: z.array(z.unknown()), signer_id: z.string() });
/** NEP-413: SHA-256 of 2^31 + 413 (u32, little-endian) and the borsh payload { message, nonce, recipient, callback_url }. */
function nep413Hash(message: string, nonce: Buffer, recipient: string, callbackUrl: string | undefined): Buffer {
  const borsh = (s: string) => {
    const b = Buffer.from(s, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32LE(b.length);
    return Buffer.concat([length, b]);
  };
  const tag = Buffer.alloc(4);
  tag.writeUInt32LE(2 ** 31 + 413);
  const callback = callbackUrl === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), borsh(callbackUrl)]);
  return createHash('sha256').update(Buffer.concat([tag, borsh(message), nonce, borsh(recipient), callback])).digest();
}
/** How a versioned nonce starts: its magic, then version 0. */
const NONCE_START = Buffer.from([0x56, 0x28, 0xf6, 0xc6, 0]);
/** A nonce made longer ago, or further ahead, than this isn't taken (10 minutes old was refused live, 2 minutes taken). */
const NONCE_FRESH_MS = 5 * 60_000;
/** A NEAR RPC view call, as NEAR's JSON-RPC takes one. */
const RpcQuerySchema = z.object({
  id: z.unknown(), method: z.literal('query'),
  params: z.object({ request_type: z.literal('call_function'), account_id: z.string(), method_name: z.string(), args_base64: z.string() })
});
const json = (text: string): unknown => {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
};

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

/** 1Click's lifetimes: an access token for 15 minutes, a refresh token for 7 days. */
const LIFETIME = { access: 900, refresh: 604_800 };

export async function startFakeOneClick(): Promise<FakeOneClick> {
  const treasury = 'alcove-treasury.near';
  const key = testNearKey();
  const settings = {
    ONECLICK_BASE_URL: '', ONECLICK_API_KEY: `test-oneclick-jwt-${randomBytes(8).toString('hex')}`,
    TREASURY_INTENTS_ACCOUNT: treasury, TREASURY_INTENTS_KEY: key.secret, NEAR_RPC_URL: ''
  };
  /** The public keys registered in intents.near for each account. */
  const registered = new Map<string, Set<string>>([[treasury, new Set([key.publicKey])]]);
  let salt = randomBytes(4);
  const quotes: QuoteRequestBody[] = [];
  const apiKeys: string[] = [];
  const bearers: string[] = [];
  /** Each token issued: an access or a refresh token, the account it's for, and until when. */
  const issued = new Map<string, { kind: 'access' | 'refresh'; account: string; until: number }>();
  let lifetime = { ...LIFETIME };
  let signIns = 0;
  let refreshes = 0;
  let refusing = false;
  /** Each deposit address, with the quote response that made it, the account it pays when confidential, and what it reports. */
  const deposits = new Map<string, { quoteResponse: QuoteResponse; decimals: number; confidentialFor: string | null; status: string; swapDetails: SwapDetails; updatedAt: string }>();
  const listed = new Map<string, number>();
  let isDown = false;
  let override: NextQuote = {};
  /** Deposits whose status is held back, with the requests waiting for it. */
  const held = new Map<string, { waiting: (() => void)[]; asked: () => void }>();

  const mint = (kind: 'access' | 'refresh', account: string) => {
    const token = `${kind === 'access' ? 'at' : 'rt'}-${randomBytes(24).toString('base64url')}`;
    issued.set(token, { kind, account, until: Date.now() + lifetime[kind] * 1000 });
    return token;
  };
  /**
   * Whom a quote or status call is signed in as. Its Bearer token is a session only beside the partner key: without it
   * 1Click reads the Bearer as a partner key, which a session's token isn't. A token that has run out is refused too.
   */
  function sessionOf(req: IncomingMessage): { account: string } | 'none' | 'refused' {
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== undefined && apiKey !== settings.ONECLICK_API_KEY) return 'refused';
    const auth = req.headers.authorization;
    if (auth === undefined) return 'none';
    const token = /^Bearer (\S+)$/.exec(auth)?.[1];
    const t = token === undefined ? undefined : issued.get(token);
    if (apiKey === undefined || !t || t.kind !== 'access' || t.until <= Date.now()) return 'refused';
    return { account: t.account };
  }

  /** Why 1Click refuses a sign-in (401, or 400 for one it can't read), or the account it signs in. */
  function signIn(body: unknown): { account: string } | { status: number; message: string } {
    const parsed = SignInSchema.safeParse(body);
    if (!parsed.success) return { status: 400, message: 'Invalid signed data' };
    const { payload, public_key: publicKey, signature } = parsed.data.signedData;
    const nonce = Buffer.from(payload.nonce, 'base64');
    const intent = IntentSchema.safeParse(json(payload.message));
    if (nonce.length !== 32 || !intent.success) return { status: 400, message: 'Invalid signed data' };
    const made = Number(nonce.readBigInt64LE(17) / 1_000_000n);
    if (!nonce.subarray(0, 5).equals(NONCE_START) || Math.abs(Date.now() - made) > NONCE_FRESH_MS) return { status: 401, message: 'timestamp validation failed' };
    const raw = ed25519(publicKey);
    const sig = ed25519(signature);
    const valid = !refusing && payload.recipient === 'intents.near' && intent.data.intents.length === 0
      && Date.parse(intent.data.deadline) > Date.now() && Number(nonce.readBigUInt64LE(9) / 1_000_000n) > Date.now()
      && nonce.subarray(5, 9).equals(salt) && (registered.get(intent.data.signer_id)?.has(publicKey) ?? false)
      && raw !== null && raw.length === 32 && sig !== null && sig.length === 64
      && verify(null, nep413Hash(payload.message, nonce, payload.recipient, payload.callbackUrl),
        createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' }), sig);
    return valid ? { account: intent.data.signer_id } : { status: 401, message: 'signature verification failed' };
  }

  async function authenticate(req: IncomingMessage, res: ServerResponse) {
    const r = signIn(json(await text(req)));
    if ('status' in r) return send(res, r.status, { message: r.message, error: r.status === 400 ? 'Bad Request' : 'Unauthorized', statusCode: r.status });
    signIns++;
    send(res, 201, { accessToken: mint('access', r.account), refreshToken: mint('refresh', r.account), expiresIn: lifetime.access, refreshExpiresIn: lifetime.refresh });
  }
  async function refresh(req: IncomingMessage, res: ServerResponse) {
    const body = z.object({ refreshToken: z.string() }).safeParse(json(await text(req)));
    const t = body.success ? issued.get(body.data.refreshToken) : undefined;
    if (!t || t.kind !== 'refresh' || t.until <= Date.now()) return send(res, 401, { message: 'invalid refresh token', error: 'Unauthorized', statusCode: 401 });
    refreshes++;
    send(res, 201, { accessToken: mint('access', t.account), expiresIn: lifetime.access });
  }

  async function quote(req: IncomingMessage, res: ServerResponse) {
    const body: unknown = JSON.parse(await text(req));
    const parsed = QuoteRequestBodySchema.safeParse(body);
    if (!parsed.success) return send(res, 400, { message: 'Invalid quote request' });
    const q = parsed.data;
    quotes.push(q);
    const who = sessionOf(req);
    if (who === 'refused') return send(res, 401, { message: 'Invalid token' });
    let confidentialFor: string | null = null;
    if (q.recipientType === 'CONFIDENTIAL_INTENTS' || q.refundType === 'CONFIDENTIAL_INTENTS') {
      if (who === 'none') return send(res, 401, { message: 'User authentication is required for confidential intent quotes' });
      if (q.recipient !== who.account || q.refundTo !== who.account) return send(res, 403, { message: 'A confidential quote pays the account signed in' });
      confidentialFor = who.account;
    }
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
    deposits.set(depositAddress, { quoteResponse: response, decimals, confidentialFor, status: 'PENDING_DEPOSIT', swapDetails: noSwap(), updatedAt: new Date().toISOString() });
    send(res, 201, response);
  }
  function status(req: IncomingMessage, url: URL, res: ServerResponse) {
    const who = sessionOf(req);
    if (who === 'refused') return send(res, 401, { message: 'Invalid token' });
    const address = url.searchParams.get('depositAddress') ?? '';
    const holding = held.get(address);
    if (holding) {
      holding.waiting.push(() => (isDown ? send(res, 503, { message: 'Service Unavailable' }) : status(req, url, res)));
      holding.asked();
      return;
    }
    const d = deposits.get(address);
    if (!d) return send(res, 404, { message: 'Deposit address not found' });
    // A deposit into a confidential balance is told only to that balance's account, signed in.
    if (d.confidentialFor !== null && (who === 'none' || who.account !== d.confidentialFor)) return send(res, 401, { message: 'User authentication is required' });
    send(res, 200, {
      correlationId: randomBytes(16).toString('hex'),
      quoteResponse: d.quoteResponse,
      status: d.status,
      updatedAt: d.updatedAt,
      swapDetails: rendered(d.swapDetails, d.decimals)
    });
  }
  /** NEAR's RPC, as far as a sign-in needs it: intents.near's `current_salt`, a hex string, its JSON as bytes. */
  async function nearRpc(req: IncomingMessage, res: ServerResponse) {
    const q = RpcQuerySchema.safeParse(json(await text(req)));
    if (!q.success || q.data.params.account_id !== 'intents.near' || q.data.params.method_name !== 'current_salt') {
      return send(res, 200, { jsonrpc: '2.0', id: q.success ? q.data.id : null, error: { code: -32000, message: 'Server error', data: 'not in the stand-in' } });
    }
    send(res, 200, { jsonrpc: '2.0', id: q.data.id, result: { result: [...Buffer.from(JSON.stringify(salt.toString('hex')))], logs: [], block_height: 1, block_hash: '11111111111111111111111111111111' } });
  }

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/near-rpc') return void nearRpc(req, res).catch(() => send(res, 400, { message: 'Bad request' }));
    apiKeys.push(typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '');
    bearers.push(/^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '');
    if (isDown) return send(res, 503, { message: 'Service Unavailable' });
    if (req.method === 'GET' && url.pathname === '/v0/tokens') {
      return send(res, 200, TOKENS.map((t) => ({ ...t, decimals: listed.get(t.assetId) ?? t.decimals, price: 1, priceUpdatedAt: new Date().toISOString() })));
    }
    if (req.method === 'POST' && url.pathname === '/v0/auth/authenticate') return void authenticate(req, res).catch(() => send(res, 400, { message: 'Invalid signed data' }));
    if (req.method === 'POST' && url.pathname === '/v0/auth/refresh') return void refresh(req, res).catch(() => send(res, 401, { message: 'invalid refresh token' }));
    if (req.method === 'POST' && url.pathname === '/v0/quote') return void quote(req, res).catch(() => send(res, 400, { message: 'Invalid quote request' }));
    if (req.method === 'GET' && url.pathname === '/v0/status') return status(req, url, res);
    send(res, 404, { message: 'Not found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  settings.ONECLICK_BASE_URL = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  settings.NEAR_RPC_URL = `${settings.ONECLICK_BASE_URL}/near-rpc`;

  return {
    settings, treasuryPublicKey: key.publicKey, quotes, apiKeys, bearers,
    accountOf(token) {
      const t = issued.get(token);
      return t && t.kind === 'access' ? t.account : null;
    },
    counts: () => ({ signIns, refreshes }),
    tokens: () => [...issued.keys()],
    refuseSignIns(on) { refusing = on; },
    expireTokens(o = {}) {
      for (const t of issued.values()) if (t.kind === 'access' || o.refresh) t.until = 0;
    },
    tokenLifetime(l) { lifetime = { ...LIFETIME, ...(l ?? {}) }; },
    rotateSalt() { salt = randomBytes(4); },
    addresses: () => [...deposits.keys()],
    set(address, s, swapDetails = {}) {
      const d = deposits.get(address);
      if (!d) throw new Error('1Click never quoted that deposit address');
      deposits.set(address, { ...d, status: s, swapDetails: { ...d.swapDetails, ...swapDetails }, updatedAt: new Date().toISOString() });
    },
    nextQuote(o) { override = o; },
    listDecimals(assetId, decimals) { if (decimals === null) listed.delete(assetId); else listed.set(assetId, decimals); },
    down(on) { isDown = on; },
    hold(address) {
      let asked: () => void = () => undefined;
      const waited = new Promise<void>((r) => { asked = () => r(); });
      const waiting: (() => void)[] = [];
      held.set(address, { waiting, asked: () => asked() });
      return {
        asked: waited,
        release() {
          held.delete(address);
          for (const answer of waiting.splice(0)) answer();
        }
      };
    },
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}
