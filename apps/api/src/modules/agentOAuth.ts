/** Public-client OAuth, bound to the canonical MCP resource and an explicit browser decision. */
import {
  AGENT_SCOPES, AgentAuthorizationIdSchema, AgentAuthorizeInputSchema, AgentClientInputSchema,
  AgentScopesSchema, AgentTokenBodySchema, type AgentDecisionInput, type AgentScope
} from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../context';
import { b64u, equalBytes, id128, openJson, random, sealJson, serviceKey, sha, toJson, unb64u, utf8 } from '../crypto';
import { bytea, exec, maybeOne, timestamp, tx, type Db } from '../db';
import { ForbiddenError, NotFoundError, UnavailableError, ValidationError } from '../errors';
import { log } from '../log';
import { lockOwner, openOwner } from '../owners';
import { profile } from './account';
import { createGrant, GRANT_MS, GrantRow, grantInfo, grantKey, issuerUrl, newToken, resourceUrl, storeToken, tokenHash, type Grant } from './agents';

const olog = log.child({ component: 'agent-oauth' });
const CLIENT_MS = 90 * 86_400_000;
const REQUEST_MS = 10 * 60_000;
const ACCESS_MS = 60 * 60_000;
/** A client normally refreshes hourly: this persists a finite bound across addresses, restarts and instances. */
const MAX_TOKEN_HISTORY = 4096;
const Client = AgentClientInputSchema;
const RequestInfo = z.object({ clientId: z.string(), clientName: z.string(), redirectUri: z.string(), resource: z.string(), state: z.string().nullable(), challenge: z.string(), scopes: AgentScopesSchema });
const CodeInfo = z.object({ clientId: z.string(), redirectUri: z.string(), resource: z.string(), challenge: z.string(), scopes: AgentScopesSchema });
const Stored = z.object({ id: z.string(), info_ciphertext: bytea, expires_at: timestamp });
const CodeRow = z.object({ owner_id: z.string(), grant_id: z.string(), info_ciphertext: bytea, expires_at: timestamp });
const RefreshRow = z.object({ owner_id: z.string(), grant_id: z.string(), consumed: z.boolean(), expires_at: timestamp });

export class OAuthError extends ValidationError {
  constructor(readonly oauthCode: string) { super('The agent authorization request is not valid.', { context: { oauthCode } }); }
}
const fail = (code = 'invalid_request'): never => { throw new OAuthError(code); };
const globalKey = (d: Deps) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'agents');
const globalHeader = (kind: 'agent-client' | 'agent-authorization', id: string) => ({ v: 1 as const, kind, ownerId: '', id });
const codeHeader = (o: Owner, grantId: string, hash: Uint8Array) => ({ v: 1 as const, kind: 'agent-code', ownerId: o.ownerId, grantId, codeHash: b64u(hash) });
const secureRedirect = (value: string): URL => {
  let url: URL;
  try { url = new URL(value); } catch { return fail('invalid_redirect_uri'); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || value.includes('#')) return fail('invalid_redirect_uri');
  return url;
};
function allowedRedirect(value: string, registered: string[]): boolean {
  const url = secureRedirect(value);
  if (registered.includes(value)) return true;
  // RFC 8252's variable port is only for IP-literal loopback callbacks; paths and queries still match exactly.
  if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]')) return false;
  return registered.some((stored) => {
    const expected = secureRedirect(stored);
    return expected.protocol === url.protocol && expected.hostname === url.hostname && expected.pathname === url.pathname && expected.search === url.search;
  });
}
const scopesFrom = (scope: string): AgentScope[] => {
  const parsed = AgentScopesSchema.safeParse(scope.split(' '));
  return parsed.success ? parsed.data : fail('invalid_scope');
};
async function client(d: Deps, id: string, db: Db = d.pool) {
  const row = await maybeOne(db, Stored, 'SELECT id, info_ciphertext, expires_at FROM agent_clients WHERE id = $1 AND expires_at > now()', [id]);
  if (!row) return fail('invalid_client');
  return openJson(globalKey(d), globalHeader('agent-client', id), row.info_ciphertext, Client);
}
export function metadata(d: Deps) {
  const issuer = issuerUrl(d);
  return { issuer, authorization_endpoint: `${issuer}/oauth/authorize`, token_endpoint: `${issuer}/oauth/token`, registration_endpoint: `${issuer}/oauth/register`, revocation_endpoint: `${issuer}/oauth/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: [...AGENT_SCOPES], authorization_response_iss_parameter_supported: true };
}
export const resourceMetadata = (d: Deps) => ({ resource: resourceUrl(d), authorization_servers: [issuerUrl(d)], scopes_supported: [...AGENT_SCOPES], bearer_methods_supported: ['header'] });

export async function register(d: Deps, input: z.infer<typeof AgentClientInputSchema>) {
  for (const uri of input.redirect_uris) secureRedirect(uri);
  if (!input.grant_types.includes('authorization_code') || !input.response_types.includes('code')) return fail('invalid_client_metadata');
  const id = id128();
  await tx(d.pool, async (db) => {
    await exec(db, "SELECT pg_advisory_xact_lock(hashtext('alcove:agent-clients'))");
    await exec(db, 'DELETE FROM agent_clients WHERE expires_at <= now()');
    const total = await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM agent_clients');
    if ((total?.n ?? 0) >= 10_000) throw new UnavailableError('Agent registration is busy. Try again later.');
    await exec(db, 'INSERT INTO agent_clients (id, info_ciphertext, expires_at) VALUES ($1,$2,$3)', [id, sealJson(globalKey(d), globalHeader('agent-client', id), toJson(input)), new Date(Date.now() + CLIENT_MS)]);
  });
  olog.info('agent client registered', { clientId: id });
  return { ...input, client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000) };
}
export async function authorize(d: Deps, input: z.infer<typeof AgentAuthorizeInputSchema>): Promise<string> {
  const registered = await client(d, input.client_id);
  if (!allowedRedirect(input.redirect_uri, registered.redirect_uris)) return fail('invalid_redirect_uri');
  if (input.resource !== resourceUrl(d)) return fail('invalid_target');
  const scopes = scopesFrom(input.scope);
  const id = b64u(random(32));
  const info = { clientId: input.client_id, clientName: registered.client_name, redirectUri: input.redirect_uri, resource: input.resource, state: input.state ?? null, challenge: input.code_challenge, scopes };
  await tx(d.pool, async (db) => {
    await exec(db, "SELECT pg_advisory_xact_lock(hashtext('alcove:agent-authorizations'))");
    await exec(db, 'DELETE FROM agent_authorizations WHERE expires_at <= now()');
    const total = await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM agent_authorizations');
    if ((total?.n ?? 0) >= 10_000) throw new UnavailableError('Agent authorization is busy. Try again later.');
    await exec(db, 'INSERT INTO agent_authorizations (id, info_ciphertext, expires_at) VALUES ($1,$2,$3)', [id, sealJson(globalKey(d), globalHeader('agent-authorization', id), toJson(info)), new Date(Date.now() + REQUEST_MS)]);
  });
  return `${d.cfg.WEB_ORIGIN}/connect?request=${id}`;
}
async function request(d: Deps, id: string, db: Db = d.pool, lock = false) {
  AgentAuthorizationIdSchema.parse(id);
  const row = await maybeOne(db, Stored, `SELECT id, info_ciphertext, expires_at FROM agent_authorizations WHERE id = $1 AND expires_at > now()${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) throw new NotFoundError('This connection request ended. Start again from your agent.');
  const info = openJson(globalKey(d), globalHeader('agent-authorization', id), row.info_ciphertext, RequestInfo);
  await client(d, info.clientId, db);
  return { row, info };
}
export async function authorization(o: Owner, id: string) {
  const { row, info } = await request(o, id);
  return { clientName: info.clientName, scopes: info.scopes, expiresAt: row.expires_at.toISOString(), ownerId: o.ownerId, accountEmail: (await profile(o)).email };
}
export async function decide(o: Owner, id: string, decision: AgentDecisionInput) {
  if (decision.ownerId !== o.ownerId) throw new ForbiddenError('Your signed-in account changed. Review the connection again.');
  return tx(o.pool, async (db) => {
    const { info } = await request(o, id, db, true);
    if (decision.scopes.some((scope) => !info.scopes.includes(scope))) return fail('invalid_scope');
    await exec(db, 'DELETE FROM agent_authorizations WHERE id = $1', [id]);
    const redirect = new URL(info.redirectUri);
    if (info.state !== null) redirect.searchParams.set('state', info.state);
    redirect.searchParams.set('iss', issuerUrl(o));
    if (!decision.allow) { redirect.searchParams.set('error', 'access_denied'); return { redirectUrl: redirect.href }; }
    await lockOwner(o, db);
    const total = await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM agent_grants WHERE owner_id = $1 AND expires_at > now()', [o.ownerId]);
    if ((total?.n ?? 0) >= 50) throw new UnavailableError('Disconnect an agent before adding another.');
    const grant = await createGrant(o, db, { name: info.clientName, kind: 'oauth', scopes: decision.scopes, clientId: info.clientId }, new Date(Date.now() + GRANT_MS));
    // An explicitly approved connection must remain refreshable for its whole grant, even for an older registration.
    await exec(db, 'UPDATE agent_clients SET expires_at = GREATEST(expires_at, $2) WHERE id = $1', [info.clientId, new Date(Date.now() + CLIENT_MS)]);
    const code = b64u(random(32));
    const hash = tokenHash(code);
    const bound = { clientId: info.clientId, redirectUri: info.redirectUri, resource: info.resource, challenge: info.challenge, scopes: decision.scopes };
    await exec(db, 'INSERT INTO agent_codes (code_hash, owner_id, grant_id, info_ciphertext, expires_at) VALUES ($1,$2,$3,$4,$5)', [hash, o.ownerId, grant.id, sealJson(grantKey(o, grant.id), codeHeader(o, grant.id, hash), toJson(bound)), new Date(Date.now() + 60_000)]);
    redirect.searchParams.set('code', code);
    olog.info('agent authorization allowed', { ownerId: o.ownerId, grantId: grant.id, scopes: decision.scopes.length });
    return { redirectUrl: redirect.href };
  });
}

async function issue(o: Owner, db: Db, grant: Grant, scopes: AgentScope[]) {
  const accessToken = newToken('access');
  const refreshToken = newToken('refresh');
  const expiresAt = new Date(Math.min(Date.now() + ACCESS_MS, grant.expires_at.getTime()));
  await storeToken(db, o, grant, accessToken, 'access', expiresAt);
  await storeToken(db, o, grant, refreshToken, 'refresh', grant.expires_at);
  return { access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer' as const, expires_in: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)), scope: scopes.join(' ') };
}
async function exchangeCode(d: Deps, input: z.infer<typeof AgentTokenBodySchema>) {
  if (!input.code || !input.redirect_uri || !input.code_verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier)) return fail('invalid_grant');
  const code = input.code;
  const verifier = input.code_verifier;
  return tx(d.pool, async (db) => {
    const hash = tokenHash(code);
    const reference = await maybeOne(db, CodeRow, 'SELECT owner_id, grant_id, info_ciphertext, expires_at FROM agent_codes WHERE code_hash = $1', [hash]);
    if (!reference) return fail('invalid_grant');
    // Disconnect and refresh take the family lock first, then its child rows. Redemption must use that same order.
    const grant = await maybeOne(db, GrantRow, 'SELECT * FROM agent_grants WHERE owner_id = $1 AND id = $2 AND expires_at > now() FOR UPDATE', [reference.owner_id, reference.grant_id]);
    if (!grant) return fail('invalid_grant');
    const found = await maybeOne(db, CodeRow, 'SELECT owner_id, grant_id, info_ciphertext, expires_at FROM agent_codes WHERE owner_id = $1 AND code_hash = $2 FOR UPDATE', [reference.owner_id, hash]);
    if (!found || found.expires_at.getTime() <= Date.now()) return fail('invalid_grant');
    const o = await openOwner(d, found.owner_id, undefined, db);
    try {
      const info = openJson(grantKey(o, found.grant_id), codeHeader(o, found.grant_id, hash), found.info_ciphertext, CodeInfo);
      if (info.clientId !== input.client_id || info.redirectUri !== input.redirect_uri || info.resource !== input.resource || !equalBytes(utf8(info.challenge), utf8(b64u(sha(utf8(verifier)))))) return fail('invalid_grant');
      if (input.scope !== undefined && input.scope !== info.scopes.join(' ')) return fail('invalid_scope');
      await exec(db, 'DELETE FROM agent_codes WHERE owner_id = $1 AND code_hash = $2', [o.ownerId, hash]);
      return await issue(o, db, grant, info.scopes);
    } finally { o.root.fill(0); o.wrapKey.fill(0); }
  });
}
async function refresh(d: Deps, input: z.infer<typeof AgentTokenBodySchema>) {
  if (!input.refresh_token) return fail('invalid_grant');
  const hash = tokenHash(input.refresh_token);
  const result = await tx(d.pool, async (db) => {
    // The grant is the family lock. Concurrent refresh/revoke cannot turn an old credential into a second family.
    const reference = await maybeOne(db, z.object({ owner_id: z.string(), grant_id: z.string() }), "SELECT owner_id, grant_id FROM agent_tokens WHERE token_hash = $1 AND kind = 'refresh'", [hash]);
    if (!reference) return undefined;
    const grant = await maybeOne(db, GrantRow, 'SELECT * FROM agent_grants WHERE owner_id = $1 AND id = $2 AND expires_at > now() FOR UPDATE', [reference.owner_id, reference.grant_id]);
    if (!grant) return undefined;
    const token = await maybeOne(db, RefreshRow, "SELECT owner_id, grant_id, consumed, expires_at FROM agent_tokens WHERE owner_id = $1 AND token_hash = $2 AND kind = 'refresh'", [reference.owner_id, hash]);
    if (!token || token.expires_at.getTime() <= Date.now()) return undefined;
    const o = await openOwner(d, reference.owner_id, undefined, db);
    try {
      const info = grantInfo(o, grant);
      if (info.clientId !== input.client_id || info.kind !== 'oauth') return undefined;
      if (token.consumed) {
        await exec(db, 'DELETE FROM agent_grants WHERE owner_id = $1 AND id = $2', [o.ownerId, grant.id]);
        olog.info('agent refresh replay revoked its connection', { ownerId: o.ownerId, grantId: grant.id });
        return undefined;
      }
      if (input.scope !== undefined && input.scope !== info.scopes.join(' ')) return fail('invalid_scope');
      const history = await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM agent_tokens WHERE owner_id = $1 AND grant_id = $2', [o.ownerId, grant.id]);
      if ((history?.n ?? 0) >= MAX_TOKEN_HISTORY) return fail('temporarily_unavailable');
      await exec(db, 'UPDATE agent_tokens SET consumed = true WHERE owner_id = $1 AND token_hash = $2', [o.ownerId, hash]);
      return await issue(o, db, grant, info.scopes);
    } finally { o.root.fill(0); o.wrapKey.fill(0); }
  });
  return result ?? fail('invalid_grant');
}
export async function token(d: Deps, input: z.infer<typeof AgentTokenBodySchema>) {
  if (input.resource !== resourceUrl(d)) return fail('invalid_target');
  await client(d, input.client_id);
  return input.grant_type === 'authorization_code' ? exchangeCode(d, input) : refresh(d, input);
}
export async function revoke(d: Deps, credential: string, clientId: string | undefined): Promise<void> {
  const row = await maybeOne(d.pool, z.object({ owner_id: z.string(), grant_id: z.string() }), 'SELECT owner_id, grant_id FROM agent_tokens WHERE token_hash = $1', [tokenHash(credential)]);
  if (!row) return;
  const o = await openOwner(d, row.owner_id, undefined);
  try {
    const grant = await maybeOne(d.pool, GrantRow, 'SELECT * FROM agent_grants WHERE owner_id = $1 AND id = $2', [o.ownerId, row.grant_id]);
    if (!grant) return;
    const info = grantInfo(o, grant);
    if (clientId !== undefined && clientId !== info.clientId) return;
    await exec(d.pool, 'DELETE FROM agent_grants WHERE owner_id = $1 AND id = $2', [o.ownerId, row.grant_id]);
    olog.info('agent credential revoked', { ownerId: o.ownerId, grantId: row.grant_id });
  } finally { o.root.fill(0); o.wrapKey.fill(0); }
}
