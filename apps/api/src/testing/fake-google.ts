/*
 * A stand-in for Google, for integration tests: OpenID Connect discovery, an authorize endpoint that
 * "signs in" whoever the test says, a token endpoint that checks the client secret, the one-time code,
 * the redirect URI and the PKCE verifier, ID tokens signed with a real RS256 key published at its
 * JWKS, refresh tokens issued the way Google issues them (only on first consent, or when asked again),
 * and a Calendar API behind bearer tokens. The API talks to it over HTTP exactly as it talks to
 * Google, so nothing in the sign-in or calendar path is stubbed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export interface GoogleUser { sub: string; email: string; name?: string | undefined; picture?: string | undefined; emailVerified?: boolean | undefined }
/** Ways the next sign-in goes wrong on Google's side; `no-calendar` is someone unticking calendar access. */
export type Spoil = 'deny' | 'wrong-audience' | 'wrong-nonce' | 'expired' | 'no-calendar';
/** A calendar event as Google stores it (the fields Alcove uses). */
export interface FakeEvent {
  id: string; status?: string; summary?: string; description?: string; location?: string; htmlLink?: string; eventType?: string; hangoutLink?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[];
  extendedProperties?: { private?: Record<string, string> };
}
export interface FakeGoogle {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The redirect URI the OAuth client is registered with; anything else is refused, as Google does. */
  register(redirectUri: string): void;
  /** Who signs in at Google next (and on any second pass), and how it should go wrong, if at all. */
  next(user: GoogleUser, spoil?: Spoil): void;
  /** Someone's primary calendar, to seed and to check. */
  calendar(sub: string): FakeEvent[];
  /** Calls to the Calendar API, oldest first. */
  calls: { method: string; path: string; sendUpdates: string | null }[];
  /** As if this person had agreed before: Google then sends no refresh token unless asked again. */
  preconsent(sub: string): void;
  /** Every access token stops working (as when one expires); refresh tokens still do. */
  expireAccess(): void;
  /** The person withdraws Alcove's access at Google. */
  revoke(sub: string): void;
  /** Refresh tokens issued so far, to check they never leak. */
  refreshTokens(): string[];
  /** How many times a profile photo was fetched from here. */
  photoFetches(): number;
  close(): Promise<void>;
}

const CALENDAR = 'https://www.googleapis.com/auth/calendar.events';
/** A 1×1 PNG, as a profile photo. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let photoFetches = 0;
interface Grant { user: GoogleUser; nonce: string; challenge: string; redirectUri: string; spoil: Spoil | undefined; scopes: string[]; refresh: boolean }

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function text(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks).toString('utf8');
}

export async function startFakeGoogle(): Promise<FakeGoogle> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const clientId = 'alcove-test.apps.googleusercontent.com';
  const clientSecret = randomBytes(16).toString('hex');
  const grants = new Map<string, Grant>();
  const accessTokens = new Map<string, { sub: string; scopes: string[] }>();
  const refreshTokens = new Map<string, { sub: string; scopes: string[] }>();
  const consented = new Map<string, Set<string>>();
  const calendars = new Map<string, FakeEvent[]>();
  const calls: FakeGoogle['calls'] = [];
  let issuer = '';
  let registered = '';
  let pending: { user: GoogleUser; spoil: Spoil | undefined } | null = null;
  const calendarOf = (sub: string) => { let c = calendars.get(sub); if (!c) { c = []; calendars.set(sub, c); } return c; };
  const issueAccess = (sub: string, scopes: string[]) => { const t = randomBytes(16).toString('hex'); accessTokens.set(t, { sub, scopes }); return t; };

  /** The Calendar API: primary calendar only, behind a bearer token that carries the calendar scope. */
  async function calendarApi(req: IncomingMessage, res: ServerResponse, url: URL) {
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const who = accessTokens.get(bearer);
    if (!who) return send(res, 401, { error: { code: 401, message: 'Invalid Credentials' } });
    if (!who.scopes.includes(CALENDAR)) return send(res, 403, { error: { code: 403, message: 'Insufficient Permission' } });
    calls.push({ method: req.method ?? '', path: url.pathname, sendUpdates: url.searchParams.get('sendUpdates') });
    const events = calendarOf(who.sub);
    const id = decodeURIComponent(url.pathname.split('/events/')[1] ?? '');
    const found = events.find((e) => e.id === id);
    if (req.method === 'GET' && !id) {
      const from = Date.parse(url.searchParams.get('timeMin') ?? '1970-01-01T00:00:00Z');
      const to = Date.parse(url.searchParams.get('timeMax') ?? '2999-01-01T00:00:00Z');
      const at = (e: FakeEvent) => Date.parse(e.start?.dateTime ?? `${e.start?.date ?? '1970-01-01'}T00:00:00Z`);
      const end = (e: FakeEvent) => Date.parse(e.end?.dateTime ?? `${e.end?.date ?? '1970-01-01'}T00:00:00Z`);
      return send(res, 200, { items: events.filter((e) => end(e) > from && at(e) < to).sort((a, b) => at(a) - at(b)) });
    }
    if (req.method === 'POST' && !id) {
      const body: unknown = JSON.parse(await text(req));
      const event: FakeEvent = { ...(typeof body === 'object' && body ? body : {}), id: randomBytes(10).toString('hex'), status: 'confirmed' };
      event.htmlLink = `https://calendar.google.com/calendar/event?eid=${event.id}`;
      event.organizer = { email: who.sub === '' ? '' : (users.get(who.sub) ?? ''), self: true };
      events.push(event);
      return send(res, 200, event);
    }
    if (!found) return send(res, 404, { error: { code: 404, message: 'Not Found' } });
    if (req.method === 'GET') return send(res, 200, found);
    if (req.method === 'PATCH') {
      const body: unknown = JSON.parse(await text(req));
      Object.assign(found, typeof body === 'object' && body ? body : {});
      return send(res, 200, found);
    }
    if (req.method === 'DELETE') {
      events.splice(events.indexOf(found), 1);
      res.writeHead(204);
      res.end();
      return;
    }
    return send(res, 405, { error: { code: 405 } });
  }
  const users = new Map<string, string>();

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', issuer);
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (req.method === 'GET' && url.pathname === '/jwks') return send(res, 200, { keys: [jwk] });
    // Profile photos, as lh3.googleusercontent.com serves them: a small PNG for any name.
    if (req.method === 'GET' && url.pathname.startsWith('/photo/')) {
      photoFetches++;
      res.writeHead(200, { 'content-type': 'image/png' });
      return res.end(PNG);
    }
    if (url.pathname.startsWith('/calendar/v3/calendars/primary/events')) return calendarApi(req, res, url);
    if (req.method === 'GET' && url.pathname === '/authorize') {
      const q = url.searchParams;
      const asked = (q.get('scope') ?? '').split(' ');
      const valid = q.get('client_id') === clientId && q.get('redirect_uri') === registered && q.get('response_type') === 'code'
        && ['openid', 'email', 'profile'].every((x) => asked.includes(x)) && q.get('code_challenge_method') === 'S256' && !!q.get('code_challenge') && !!q.get('nonce');
      if (!valid) return send(res, 400, { error: 'invalid_request' });
      const back = new URL(registered);
      back.searchParams.set('state', q.get('state') ?? '');
      const who = pending;
      if (!who || who.spoil === 'deny') back.searchParams.set('error', 'access_denied');
      else {
        // Granular consent: someone can untick the calendar. Earlier grants carry over (include_granted_scopes).
        const before = consented.get(who.user.sub);
        const scopes = [...new Set([...asked.filter((x) => x !== CALENDAR || who.spoil !== 'no-calendar'), ...(q.get('include_granted_scopes') === 'true' ? before ?? [] : [])])];
        // Like Google: a refresh token for offline access only the first time someone agrees, or when asked to agree again.
        const refresh = q.get('access_type') === 'offline' && (!before || (q.get('prompt') ?? '').includes('consent'));
        consented.set(who.user.sub, new Set([...(before ?? []), ...scopes]));
        users.set(who.user.sub, who.user.email.toLowerCase());
        const code = randomBytes(16).toString('hex');
        grants.set(code, { user: who.user, nonce: q.get('nonce') ?? '', challenge: q.get('code_challenge') ?? '', redirectUri: registered, spoil: who.spoil, scopes, refresh });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      const form = new URLSearchParams(await text(req));
      if (form.get('grant_type') === 'refresh_token') {
        const held = refreshTokens.get(form.get('refresh_token') ?? '');
        if (!held || form.get('client_id') !== clientId || form.get('client_secret') !== clientSecret) return send(res, 400, { error: 'invalid_grant' });
        return send(res, 200, { access_token: issueAccess(held.sub, held.scopes), token_type: 'Bearer', expires_in: 3599, scope: held.scopes.join(' ') });
      }
      const code = form.get('code') ?? '';
      const grant = grants.get(code);
      grants.delete(code);
      const verified = !!grant && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === grant.challenge;
      if (!grant || !verified || form.get('grant_type') !== 'authorization_code' || form.get('client_id') !== clientId
        || form.get('client_secret') !== clientSecret || form.get('redirect_uri') !== grant.redirectUri) return send(res, 400, { error: 'invalid_grant' });
      const now = Math.floor(Date.now() / 1000);
      const issuedAt = grant.spoil === 'expired' ? now - 7200 : now;
      const idToken = await new SignJWT({
        email: grant.user.email, email_verified: grant.user.emailVerified ?? true,
        ...(grant.user.name ? { name: grant.user.name } : {}), ...(grant.user.picture ? { picture: grant.user.picture } : {}),
        nonce: grant.spoil === 'wrong-nonce' ? 'not-the-nonce' : grant.nonce
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer).setSubject(grant.user.sub).setAudience(grant.spoil === 'wrong-audience' ? 'someone-else.apps.googleusercontent.com' : clientId)
        .setIssuedAt(issuedAt).setExpirationTime(issuedAt + 3600)
        .sign(privateKey);
      const refreshToken = grant.refresh ? randomBytes(24).toString('hex') : undefined;
      if (refreshToken) refreshTokens.set(refreshToken, { sub: grant.user.sub, scopes: grant.scopes });
      return send(res, 200, {
        access_token: issueAccess(grant.user.sub, grant.scopes), token_type: 'Bearer', expires_in: 3599, scope: grant.scopes.join(' '), id_token: idToken,
        ...(refreshToken ? { refresh_token: refreshToken } : {})
      });
    }
    return send(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => { handle(req, res).catch(() => send(res, 500, { error: 'server_error' })); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  issuer = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return {
    issuer, clientId, clientSecret,
    register: (uri) => { registered = uri; },
    next: (user, spoil) => { pending = { user, spoil }; },
    calendar: calendarOf,
    calls,
    preconsent: (sub) => { consented.set(sub, new Set(['openid', 'email', 'profile', CALENDAR])); },
    expireAccess: () => accessTokens.clear(),
    revoke: (sub) => { for (const [t, v] of refreshTokens) if (v.sub === sub) refreshTokens.delete(t); for (const [t, v] of accessTokens) if (v.sub === sub) accessTokens.delete(t); },
    refreshTokens: () => [...refreshTokens.keys()],
    photoFetches: () => photoFetches,
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}
