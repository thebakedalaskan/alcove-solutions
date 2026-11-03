/*
 * A stand-in for Google's OpenID Connect provider, for integration tests. It serves discovery, an
 * authorize endpoint that "signs in" whoever the test says, a token endpoint that checks the client
 * secret, the one-time code, the redirect URI and the PKCE verifier, and ID tokens signed with a real
 * RS256 key published at its JWKS. The API talks to it over HTTP exactly as it talks to Google, so
 * nothing in the sign-in path is stubbed.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';

export interface GoogleUser { sub: string; email: string; name?: string | undefined; picture?: string | undefined; emailVerified?: boolean | undefined }
/** Ways the next sign-in goes wrong on Google's side. */
export type Spoil = 'deny' | 'wrong-audience' | 'wrong-nonce' | 'expired';
export interface FakeGoogle {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The redirect URI the OAuth client is registered with; anything else is refused, as Google does. */
  register(redirectUri: string): void;
  /** Who signs in at Google next, and how it should go wrong, if at all. */
  next(user: GoogleUser, spoil?: Spoil): void;
  close(): Promise<void>;
}

interface Grant { user: GoogleUser; nonce: string; challenge: string; redirectUri: string; spoil: Spoil | undefined }

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
  let issuer = '';
  let registered = '';
  let pending: { user: GoogleUser; spoil: Spoil | undefined } | null = null;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', issuer);
    if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
      return send(res, 200, { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (req.method === 'GET' && url.pathname === '/jwks') return send(res, 200, { keys: [jwk] });
    if (req.method === 'GET' && url.pathname === '/authorize') {
      const q = url.searchParams;
      const valid = q.get('client_id') === clientId && q.get('redirect_uri') === registered && q.get('response_type') === 'code'
        && q.get('scope') === 'openid email profile' && q.get('code_challenge_method') === 'S256' && !!q.get('code_challenge') && !!q.get('nonce');
      if (!valid) return send(res, 400, { error: 'invalid_request' });
      const back = new URL(registered);
      back.searchParams.set('state', q.get('state') ?? '');
      const who = pending;
      pending = null;
      if (!who || who.spoil === 'deny') back.searchParams.set('error', 'access_denied');
      else {
        const code = randomBytes(16).toString('hex');
        grants.set(code, { user: who.user, nonce: q.get('nonce') ?? '', challenge: q.get('code_challenge') ?? '', redirectUri: registered, spoil: who.spoil });
        back.searchParams.set('code', code);
      }
      res.writeHead(302, { location: back.toString() });
      res.end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/token') {
      const form = new URLSearchParams(await text(req));
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
      return send(res, 200, { access_token: randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 3599, scope: 'openid email profile', id_token: idToken });
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
    close: () => new Promise<void>((r) => server.close(() => r()))
  };
}
