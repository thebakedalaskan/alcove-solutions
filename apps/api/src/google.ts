/*
 * Signing in with Google: OpenID Connect, the authorization code flow with PKCE. The browser leaves
 * for Google from /v1/auth/google and comes back to /v1/auth/google/callback with a one-time code.
 * The server swaps the code for an ID token, checks Google's signature, the issuer, the audience,
 * the expiry and the nonce, and accepts only an email address Google has verified, because notes
 * are shared by email. Alcove asks for the identity scopes only: it reads nothing else from the
 * Google account.
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
const SCOPE = 'openid email profile';

/** Why a sign-in didn't happen, as the welcome screen explains it. */
export type Refusal = 'unavailable' | 'cancelled' | 'expired' | 'unverified' | 'failed' | 'busy';
export type Finish = { ok: true; identity: Identity } | { ok: false; reason: Refusal };

const Discovery = z.object({ issuer: z.string().min(1), authorization_endpoint: z.string().url(), token_endpoint: z.string().url(), jwks_uri: z.string().url() });
const TokenReply = z.object({ id_token: z.string().min(1) });
/** Google's error code (e.g. invalid_grant) is safe to log; descriptions aren't kept. */
const TokenError = z.object({ error: z.string().max(80) }).catch({ error: 'unknown' });
const Claims = z.object({
  sub: z.string().min(1).max(255), email: z.string().email().max(254), email_verified: z.boolean().optional(),
  name: z.string().max(200).optional(), picture: z.string().url().max(2000).optional(), nonce: z.string()
});
const Attempt = z.object({ state: z.string(), nonce: z.string(), verifier: z.string(), until: z.number() });
const HEADER = { v: 1 as const, kind: 'sign-in-attempt', ownerId: '', provider: 'google' };

type Ready = Config & { GOOGLE_CLIENT_ID: string; GOOGLE_CLIENT_SECRET: string };
export const configured = (cfg: Config): cfg is Ready => !!cfg.GOOGLE_CLIENT_ID && !!cfg.GOOGLE_CLIENT_SECRET;
/** The redirect URI registered with Google for this deployment. */
export const redirectUri = (cfg: Config) => `${cfg.API_URL.replace(/\/$/, '')}/v1/auth/google/callback`;

interface Provider { endpoints: z.infer<typeof Discovery>; keys: JWTVerifyGetKey }
const providers = new Map<string, Promise<Provider>>();
/** Google's endpoints and signing keys, discovered once per issuer (jose refetches keys when Google rotates them). */
function provider(issuer: string): Promise<Provider> {
  const known = providers.get(issuer);
  if (known) return known;
  const p = (async () => {
    const res = await fetch(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new UnavailableError('Google can’t be reached right now.', { context: { step: 'discovery', status: res.status } });
    const endpoints = Discovery.parse(await res.json());
    return { endpoints, keys: createRemoteJWKSet(new URL(endpoints.jwks_uri)) };
  })();
  providers.set(issuer, p);
  // A failed discovery is tried again next time instead of being remembered.
  p.catch(() => providers.delete(issuer));
  return p;
}

const same = (a: string, b: string) => equalBytes(utf8(a), utf8(b));
/** Google writes its issuer with and without the scheme. */
const issuers = (iss: string) => [...new Set([iss, iss.replace(/^https:\/\//, '')])];

function refuse(reason: Refusal, context: Record<string, string | number | boolean> = {}): Finish {
  glog.info('google sign-in refused', { reason, ...context });
  return { ok: false, reason };
}

/** Where to send the browser, and the sealed attempt it keeps in a cookie until it comes back. */
export async function begin(d: Deps): Promise<{ url: string; attempt: string }> {
  const cfg = d.cfg;
  if (!configured(cfg)) throw new UnavailableError('Google sign-in isn’t set up on this server.');
  const { endpoints } = await provider(cfg.GOOGLE_ISSUER);
  const a = { state: b64u(random(32)), nonce: b64u(random(32)), verifier: b64u(random(32)), until: Date.now() + ATTEMPT_MINUTES * 60_000 };
  const url = new URL(endpoints.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: cfg.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(cfg), response_type: 'code', scope: SCOPE,
    state: a.state, nonce: a.nonce, code_challenge: b64u(sha(utf8(a.verifier))), code_challenge_method: 'S256', prompt: 'select_account'
  }).toString();
  glog.debug('google sign-in started');
  return { url: url.toString(), attempt: b64u(sealJson(signInAttemptKey(masterKey(d)), HEADER, a)) };
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
  glog.debug('google sign-in checked');
  return { ok: true, identity: { subject: `google:${claims.data.sub}`, email, name: claims.data.name?.trim() || nameFrom(email), photoUrl: claims.data.picture, sample: false } };
}
