/*
 * Signing in with Google: OpenID Connect, the authorization code flow with PKCE. The browser leaves
 * for Google from /v1/auth/google and comes back to /v1/auth/google/callback with a one-time code.
 * The server swaps the code for an ID token, checks Google's signature, the issuer, the audience,
 * the expiry and the nonce, and accepts only an email address Google has verified, because notes
 * are shared by email. It also asks for the Calendar (events only) with offline access, so Alcove
 * can show someone's meetings and put the calls they schedule on their calendar. Someone can
 * decline the calendar on Google's consent screen and still sign in.
 */
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import type { Config } from './config';
import type { Deps } from './context';
import { b64u, equalBytes, openJson, random, sealJson, sha, signInAttemptKey, unb64u, utf8 } from './crypto';
import { UnavailableError } from './errors';
import { nameFrom, type Identity } from './identity';
import { log } from './log';
import { masterKey } from './owners';

const glog = log.child({ component: 'google' });
/** How long a browser has to come back from Google. */
export const ATTEMPT_MINUTES = 10;
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const SCOPE = `openid email profile ${CALENDAR_SCOPE}`;

/** Why a sign-in didn't happen, as the welcome screen explains it. */
export type Refusal = 'unavailable' | 'cancelled' | 'expired' | 'unverified' | 'failed' | 'busy';
/** What Google granted: a short-lived access token, the scopes, and (on consent) a refresh token for later. */
export interface Grant { accessToken: string; expiresIn: number; refreshToken?: string | undefined; scopes: string[] }
/** Where the app lands after signing in: the account's first screen, Home, or a move to this device that was waiting on it. */
export type Next = '/ready' | '/home' | '/move';
export type Finish = { ok: true; identity: Identity; grant: Grant; consented: boolean; next?: Next | undefined } | { ok: false; reason: Refusal };

const Discovery = z.object({ issuer: z.string().min(1), authorization_endpoint: z.string().url(), token_endpoint: z.string().url(), revocation_endpoint: z.string().url(), jwks_uri: z.string().url() });
const TokenReply = z.object({
  id_token: z.string().min(1), access_token: z.string().min(1), expires_in: z.number().default(3600),
  refresh_token: z.string().min(1).optional(), scope: z.string().default('')
});
const RefreshReply = z.object({ access_token: z.string().min(1), expires_in: z.number().default(3600), scope: z.string().optional() });
/** Google's error code (e.g. invalid_grant) is safe to log; descriptions aren't kept. */
const TokenError = z.object({ error: z.string().max(80) }).catch({ error: 'unknown' });
const Claims = z.object({
  sub: z.string().min(1).max(255), email: z.string().email().max(254), email_verified: z.boolean().optional(),
  name: z.string().max(200).optional(), picture: z.string().url().max(2000).optional(), nonce: z.string()
});
const Attempt = z.object({
  state: z.string(), nonce: z.string(), verifier: z.string(), until: z.number(),
  /** A second pass that asked Google for consent again, and where it should land afterwards. */
  consent: z.boolean().default(false), next: z.enum(['/ready', '/home', '/move']).optional()
});
const HEADER = { v: 1 as const, kind: 'sign-in-attempt', ownerId: '', provider: 'google' };

type Ready = Config & { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
export const configured = (cfg: Config): cfg is Ready => !!cfg.GOOGLE_CLIENT_ID && !!cfg.GOOGLE_CLIENT_SECRET;
/** The redirect URI registered with Google for this deployment. */
export const redirectUri = (cfg: Config) => `${cfg.API_URL.replace(/\/$/, '')}/v1/auth/google/callback`;

/** A signal that aborts after `ms`, or sooner if `signal` does: a caller's own time limit on a request to Google. */
export const within = (ms: number, signal?: AbortSignal | undefined): AbortSignal => (signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms));

/** Waits for `p`, but no longer than `signal` allows. What `p` stands for carries on for anyone else waiting on it. */
function waitFor<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

interface Provider { endpoints: z.infer<typeof Discovery>; keys: JWTVerifyGetKey }
const providers = new Map<string, Promise<Provider>>();
/**
 * Google's endpoints and signing keys, discovered once per issuer (jose refetches keys when Google rotates them).
 * A caller with a time limit of its own stops waiting when it's up, without cancelling the discovery for others.
 */
function provider(issuer: string, signal?: AbortSignal | undefined): Promise<Provider> {
  const known = providers.get(issuer);
  if (known) return waitFor(known, signal);
  const p = (async () => {
    const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new UnavailableError('Google can’t be reached right now.', { context: { step: 'discovery', status: res.status } });
    const endpoints = Discovery.parse(await res.json());
    return { endpoints, keys: createRemoteJWKSet(new URL(endpoints.jwks_uri)) };
  })();
  providers.set(issuer, p);
  // A failed discovery is tried again next time instead of being remembered.
  p.catch(() => providers.delete(issuer));
  return waitFor(p, signal);
}

const same = (a: string, b: string) => equalBytes(utf8(a), utf8(b));
/** Google writes its issuer with and without the scheme. */
const issuers = (iss: string) => [...new Set([iss, iss.replace(/^https:\/\//, '')])];

function refuse(reason: Refusal, context: Record<string, string | number | boolean> = {}): Finish {
  glog.info('google sign-in refused', { reason, ...context });
  return { ok: false, reason };
}

/**
 * Where to send the browser, and the sealed attempt it keeps in a cookie until it comes back. With
 * `consent`, Google asks again even if the person agreed before, which is the only way to get a new
 * refresh token; `hint` picks the account so they aren't asked which one.
 */
export async function begin(d: Deps, o: { consent?: boolean; hint?: string | undefined; next?: Next | undefined } = {}): Promise<{ url: string; attempt: string }> {
  const cfg = d.cfg;
  if (!configured(cfg)) throw new UnavailableError('Google sign-in isn’t set up on this server.');
  const { endpoints } = await provider(cfg.GOOGLE_ISSUER);
  const a = { state: b64u(random(32)), nonce: b64u(random(32)), verifier: b64u(random(32)), until: Date.now() + ATTEMPT_MINUTES * 60_000, consent: !!o.consent, ...(o.next ? { next: o.next } : {}) };
  const url = new URL(endpoints.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: cfg.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(cfg), response_type: 'code', scope: SCOPE,
    access_type: 'offline', include_granted_scopes: 'true', prompt: o.consent ? 'consent' : 'select_account',
    ...(o.hint ? { login_hint: o.hint } : {}),
    state: a.state, nonce: a.nonce, code_challenge: b64u(sha(utf8(a.verifier))), code_challenge_method: 'S256'
  }).toString();
  glog.debug('google sign-in started', { consent: !!o.consent });
  return { url: url.toString(), attempt: b64u(sealJson(signInAttemptKey(masterKey(d)), HEADER, a)) };
}

/**
 * A fresh access token from a stored refresh token; `revoked` when Google no longer honours it. A timeout or a
 * network failure is thrown as fetch throws it; `signal` is the caller's own time limit, if it has one.
 */
export async function refreshAccess(d: Deps, refreshToken: string, signal?: AbortSignal | undefined): Promise<{ ok: true; accessToken: string; expiresIn: number } | { ok: false; revoked: boolean }> {
  const cfg = d.cfg;
  if (!configured(cfg)) return { ok: false, revoked: false };
  const p = await provider(cfg.GOOGLE_ISSUER, signal);
  const res = await fetch(p.endpoints.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.GOOGLE_CLIENT_ID, client_secret: cfg.GOOGLE_CLIENT_SECRET }),
    signal: within(8000, signal)
  });
  if (!res.ok) {
    const error = TokenError.parse(await res.json().catch(() => ({}))).error;
    glog.warn('google access refresh refused', { status: res.status, googleError: error });
    return { ok: false, revoked: error === 'invalid_grant' };
  }
  const r = RefreshReply.safeParse(await res.json().catch(() => null));
  if (!r.success) return { ok: false, revoked: false };
  return { ok: true, accessToken: r.data.access_token, expiresIn: r.data.expires_in };
}

/**
 * Withdraws Alcove's grant at Google, so a refresh token that is no longer wanted stops working there too. Best
 * effort: false when Google didn't confirm, with a warning that says why. `signal` is the caller's own time limit.
 */
export async function revokeRefresh(d: Deps, refreshToken: string, signal?: AbortSignal | undefined): Promise<boolean> {
  const cfg = d.cfg;
  if (!configured(cfg)) return false;
  try {
    const p = await provider(cfg.GOOGLE_ISSUER, signal);
    const res = await fetch(p.endpoints.revocation_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ token: refreshToken }),
      signal: within(8000, signal)
    });
    if (res.ok) return true;
    glog.warn('google grant not revoked', { status: res.status, googleError: TokenError.parse(await res.json().catch(() => ({}))).error });
  } catch (e) {
    // Discovery or the request failed (a timeout, a network failure): the error carries neither the token nor anything of the person.
    glog.warn('google grant not revoked', { err: e });
  }
  return false;
}

function openAttempt(d: Deps, cookie: string | undefined): z.infer<typeof Attempt> | null {
  if (!cookie) return null;
  try {
    return openJson(signInAttemptKey(masterKey(d)), HEADER, unb64u(cookie), Attempt);
  } catch (e) {
    glog.info('google sign-in attempt cookie rejected', { err: e });
    return null;
  }
}

/** Checks what came back from Google. Refusals are expected (a cancel, a stale tab) and returned, not thrown. */
export async function finish(d: Deps, q: Record<string, string>, cookie: string | undefined): Promise<Finish> {
  const cfg = d.cfg;
  if (!configured(cfg)) return refuse('unavailable');
  const err = q['error'];
  if (err) return refuse(err === 'access_denied' ? 'cancelled' : 'failed', { googleError: err.slice(0, 60) });
  const attempt = openAttempt(d, cookie);
  if (!attempt || attempt.until < Date.now() || !same(q['state'] ?? '', attempt.state)) return refuse('expired', { hadAttempt: !!attempt });
  const code = q['code'];
  if (!code) return refuse('failed', { step: 'code' });

  const p = await provider(cfg.GOOGLE_ISSUER);
  const res = await fetch(p.endpoints.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(cfg), client_id: cfg.GOOGLE_CLIENT_ID, client_secret: cfg.GOOGLE_CLIENT_SECRET, code_verifier: attempt.verifier }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return refuse('failed', { step: 'token', status: res.status, googleError: TokenError.parse(await res.json().catch(() => ({}))).error });
  const token = TokenReply.safeParse(await res.json().catch(() => null));
  if (!token.success) return refuse('failed', { step: 'token-reply' });

  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token.data.id_token, p.keys, { issuer: issuers(p.endpoints.issuer), audience: cfg.GOOGLE_CLIENT_ID, algorithms: ['RS256'], clockTolerance: 60 }));
  } catch (e) {
    return refuse('failed', { step: 'id-token', joseCode: e instanceof joseErrors.JOSEError ? e.code : 'unknown' });
  }
  const claims = Claims.safeParse(payload);
  if (!claims.success) return refuse('failed', { step: 'claims' });
  if (!same(claims.data.nonce, attempt.nonce)) return refuse('failed', { step: 'nonce' });
  if (claims.data.email_verified !== true) return refuse('unverified');

  const email = claims.data.email.trim().toLowerCase();
  const grant: Grant = {
    accessToken: token.data.access_token, expiresIn: token.data.expires_in, refreshToken: token.data.refresh_token,
    scopes: token.data.scope.split(/\s+/).filter(Boolean)
  };
  glog.debug('google sign-in checked', { calendar: grant.scopes.includes(CALENDAR_SCOPE), refresh: !!grant.refreshToken });
  return {
    ok: true, grant, consented: attempt.consent, next: attempt.next,
    identity: { subject: `google:${claims.data.sub}`, email, name: claims.data.name?.trim() || nameFrom(email), photoUrl: claims.data.picture, sample: false }
  };
}
