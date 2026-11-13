/*
 * The treasury's session with 1Click, which a quote paying into the treasury's confidential balance needs, and so does
 * asking about such a deposit. Alcove signs in as the treasury the way near.com signs a NEAR account in: an empty intent,
 * signed NEP-413 style with the treasury's key (treasury-key.ts) for intents.near, its nonce carrying the contract's
 * current salt and when it was made. 1Click answers with an access token (15 minutes) and a refresh token (7 days). The
 * access token is held in this process's memory, refreshed while under a minute of it is left, and replaced by a new
 * sign-in once the refresh token has run out or 1Click refuses either one. One sign-in or refresh is in flight at a time,
 * however many requests want a token. Neither the key nor a token goes in a log line or an error, only HTTP statuses.
 */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { log } from '../../log';
import { PROVIDER_TIMEOUT_MS, providerUnavailable } from './provider';
import type { TreasuryKey } from './treasury-key';

const slog = log.child({ component: 'oneclick' });

/** The Intents contract: what a sign-in is signed for, and where the salt in its nonce comes from. */
const INTENTS_CONTRACT = 'intents.near';
/** How a versioned nonce starts: these four bytes, then its version, 0. */
const NONCE_MAGIC = [0x56, 0x28, 0xf6, 0xc6];
/** How long a signed sign-in is good for, as near.com signs one. */
const SIGN_IN_FOR_MS = 5 * 60_000;
/** A token is renewed once less than this is left of it, so none runs out on its way to 1Click. */
const RENEW_BEFORE_MS = 60_000;
/**
 * How long a refused sign-in is remembered. A refusal is a setting to fix (the key isn't registered for the treasury, or
 * isn't its key), so requests and the watcher meanwhile are told top-ups are unavailable without asking 1Click again.
 */
const REFUSED_FOR_MS = 60_000;
/** The statuses with which 1Click refuses a sign-in or a refresh token, rather than failing to answer. */
const REFUSED = new Set([400, 401, 403]);

const SignedIn = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresIn: z.number().positive(), refreshExpiresIn: z.number().positive() });
const Refreshed = z.object({ accessToken: z.string().min(1), expiresIn: z.number().positive() });
/** What NEAR's RPC answers for a view call: the method's JSON result, as bytes. */
const ViewResult = z.object({ result: z.object({ result: z.array(z.number().int().min(0).max(255)) }) });
/** intents.near's salt: 4 bytes, in hex. */
const Salt = z.string().regex(/^[0-9a-fA-F]{8}$/);

/** One request to 1Click, made by oneclick.ts with its headers and timeout, and with the treasury's token when given one. */
export type OneClickRequest = (method: 'GET' | 'POST', path: string, body: unknown, token: string | null) => Promise<Response>;

export interface TreasurySession {
  /** An access token with more than a minute left: the one held, a refreshed one, or a new sign-in's. */
  token(): Promise<string>;
  /** A new sign-in's token, after 1Click refused `refused`: one sign-in, however many requests saw that token refused. */
  renew(refused: string): Promise<string>;
}

interface Held { access: string; accessUntil: number; refresh: string; refreshUntil: number }

export function treasurySession(o: { request: OneClickRequest; nearRpcUrl: string; account: string; key: TreasuryKey }): TreasurySession {
  let held: Held | null = null;
  let pending: Promise<Held> | null = null;
  let refusedUntil = 0;

  /** A request to 1Click's auth endpoints. One that doesn't get an answer is unavailable, saying only how it failed. */
  async function send(path: string, body: unknown): Promise<Response> {
    try {
      return await o.request('POST', path, body, null);
    } catch (e) {
      throw providerUnavailable('oneclick', { endpoint: path, error: e instanceof Error ? e.name : 'unknown' });
    }
  }
  /** An answer's JSON parsed with `schema`; anything but a 2xx answer that parses is unavailable. */
  async function read<S extends z.ZodType>(res: Response, schema: S, endpoint: string): Promise<z.infer<S>> {
    if (!res.ok) throw providerUnavailable('oneclick', { endpoint, status: res.status });
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw providerUnavailable('oneclick', { endpoint, status: res.status, error: 'unexpected-response' });
    return parsed.data;
  }

  /** intents.near's current salt, from NEAR's RPC: a sign-in's nonce has to carry it. */
  async function salt(): Promise<Uint8Array> {
    const endpoint = 'near-rpc';
    let res: Response;
    try {
      res = await fetch(o.nearRpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'User-Agent': 'alcove-api' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'alcove', method: 'query',
          params: { request_type: 'call_function', finality: 'optimistic', account_id: INTENTS_CONTRACT, method_name: 'current_salt', args_base64: Buffer.from('{}').toString('base64') }
        }),
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
      });
    } catch (e) {
      throw providerUnavailable('oneclick', { endpoint, error: e instanceof Error ? e.name : 'unknown' });
    }
    const view = await read(res, ViewResult, endpoint);
    let value: unknown = null;
    try {
      value = JSON.parse(Buffer.from(view.result.result).toString('utf8'));
    } catch {
      value = null;
    }
    const hex = Salt.safeParse(value);
    if (!hex.success) throw providerUnavailable('oneclick', { endpoint, status: res.status, error: 'unexpected-response' });
    return Buffer.from(hex.data, 'hex');
  }

  /**
   * The empty intent a sign-in signs, as near.com's createVerificationMessage makes it: the treasury as signer, a deadline
   * 5 minutes out, and a versioned nonce (its magic and version, the contract's salt, the deadline in nanoseconds, then
   * when it was made in nanoseconds and 7 random bytes: 1Click refuses one that wasn't made in the last few minutes).
   */
  function signedData(contractSalt: Uint8Array) {
    const now = Date.now();
    const deadline = new Date(now + SIGN_IN_FOR_MS);
    const nonce = Buffer.alloc(32);
    nonce.set(NONCE_MAGIC, 0);
    nonce.set(contractSalt, 5);
    nonce.writeBigUInt64LE(BigInt(deadline.getTime()) * 1_000_000n, 9);
    nonce.writeBigInt64LE(BigInt(now) * 1_000_000n, 17);
    randomBytes(7).copy(nonce, 25);
    const message = JSON.stringify({ deadline: deadline.toISOString(), intents: [], signer_id: o.account });
    return {
      standard: 'nep413',
      payload: { message, nonce: nonce.toString('base64'), recipient: INTENTS_CONTRACT },
      public_key: o.key.publicKey,
      signature: o.key.signNep413({ message, nonce, recipient: INTENTS_CONTRACT })
    };
  }

  async function signIn(): Promise<Held> {
    if (Date.now() < refusedUntil) throw providerUnavailable('oneclick', { endpoint: '/v0/auth/authenticate', error: 'refused-recently' }, 'info');
    const res = await send('/v0/auth/authenticate', { signedData: signedData(await salt()) });
    if (REFUSED.has(res.status)) {
      refusedUntil = Date.now() + REFUSED_FOR_MS;
      // The one line that says so: every request it fails meanwhile is unavailable at info.
      slog.error('1Click refused the treasury’s sign-in', { provider: 'oneclick', status: res.status });
      throw providerUnavailable('oneclick', { endpoint: '/v0/auth/authenticate', status: res.status }, 'info');
    }
    const t = await read(res, SignedIn, '/v0/auth/authenticate');
    const at = Date.now();
    slog.info('treasury signed in to 1Click', { provider: 'oneclick', expiresIn: t.expiresIn, refreshExpiresIn: t.refreshExpiresIn });
    return { access: t.accessToken, accessUntil: at + t.expiresIn * 1000, refresh: t.refreshToken, refreshUntil: at + t.refreshExpiresIn * 1000 };
  }

  async function refresh(h: Held): Promise<Held> {
    const res = await send('/v0/auth/refresh', { refreshToken: h.refresh });
    if (REFUSED.has(res.status)) {
      held = null;
      slog.warn('1Click refused the treasury’s refresh token, signing in again', { provider: 'oneclick', status: res.status });
      return signIn();
    }
    const t = await read(res, Refreshed, '/v0/auth/refresh');
    slog.debug('treasury’s 1Click token refreshed', { provider: 'oneclick', expiresIn: t.expiresIn });
    return { ...h, access: t.accessToken, accessUntil: Date.now() + t.expiresIn * 1000 };
  }

  /** `get` as the one renewal in flight: every request that wants a token meanwhile waits for it rather than starting another. */
  function once(get: () => Promise<Held>): Promise<Held> {
    if (pending) return pending;
    const renewal = get().then((h) => {
      held = h;
      return h;
    }).finally(() => {
      pending = null;
    });
    pending = renewal;
    return renewal;
  }

  return {
    async token() {
      const now = Date.now();
      if (held && held.accessUntil - now > RENEW_BEFORE_MS) return held.access;
      const current = held;
      return (await once(() => (current && current.refreshUntil - now > RENEW_BEFORE_MS ? refresh(current) : signIn()))).access;
    },
    async renew(refused) {
      if (pending) return (await pending).access;
      if (held && held.access !== refused) return held.access;
      held = null;
      return (await once(signIn)).access;
    }
  };
}
