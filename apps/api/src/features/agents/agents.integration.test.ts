/** Agent delegation through real HTTP, with real account sessions and persistent storage. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { Client, SdkHttpError, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startHarness, type Harness } from '../../testing/harness';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });
const TokenReply = z.object({ connection: z.object({ id: z.string(), name: z.string(), scopes: z.array(z.string()) }), token: z.string(), endpoint: z.string() });
const Registered = z.object({ client_id: z.string() });
const OAuthTokens = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number(), scope: z.string(), token_type: z.literal('Bearer') });
const post = (path: string, values: Record<string, string>) => fetch(`${h.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values) });
async function mcp(baseUrl: string, token: string): Promise<{ status: number }> {
  const client = new Client({ name: 'delegation-flow', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { authProvider: { token: async () => token } }));
    await client.listTools();
    return { status: 200 };
  } catch (error) {
    if (error instanceof SdkHttpError) return { status: error.status };
    if (error instanceof Error && error.name === 'UnauthorizedError') return { status: 401 };
    throw error;
  } finally { await client.close(); }
}
const encodings = (value: string) => [value, Buffer.from(value).toString('hex'), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')];
async function pendingAuthorization() {
  const registration = await fetch(`${h.baseUrl}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.8.0.10' }, body: JSON.stringify({ client_name: 'Bound client', redirect_uris: ['https://client.example/callback'] }) });
  expect(registration.status).toBe(201);
  const client = Registered.parse(await registration.json());
  const verifier = randomBytes(32).toString('base64url');
  const parameters = { response_type: 'code', client_id: client.client_id, redirect_uri: 'https://client.example/callback', resource: `${h.baseUrl}/mcp`, scope: 'notes:read', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' };
  const url = new URL(`${h.baseUrl}/oauth/authorize`);
  url.search = new URLSearchParams(parameters).toString();
  const response = await fetch(url, { redirect: 'manual', headers: { 'x-forwarded-for': '10.8.0.10' } });
  expect(response.status).toBe(302);
  return { client, verifier, parameters, requestId: new URL(response.headers.get('location') ?? '').searchParams.get('request') ?? '' };
}
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error('The database did not reach the expected wait.');
}

describe('agent connections', () => {
  it('creates a one-time scoped credential and physically disconnects it without touching another account', async () => {
    const owner = h.browser();
    const other = h.browser();
    await owner.api.auth.signIn('sso', { email: 'agent-owner@tests.example' });
    await other.api.auth.signIn('sso', { email: 'agent-other@tests.example' });
    const created = await owner.fetch(`${h.baseUrl}/v1/agents/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'CANARY-AGENT private assistant', scopes: ['notes:read'], expiresInDays: 30 }) });
    expect(created.status).toBe(200);
    const result = TokenReply.parse(await created.json());
    expect(result.connection.scopes).toEqual(['notes:read']);
    expect(created.headers.get('cache-control')).toBe('no-store');
    expect(await (await owner.fetch(`${h.baseUrl}/v1/agents`)).json()).toEqual([expect.objectContaining({ id: result.connection.id })]);
    expect((await other.fetch(`${h.baseUrl}/v1/agents/${result.connection.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await owner.fetch(`${h.baseUrl}/v1/agents/${result.connection.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(await (await owner.fetch(`${h.baseUrl}/v1/agents`)).json()).toEqual([]);
  });
  it('keeps delegation independent of browser sign-out and shares revocation, expiry and deletion across instances', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'agent-life@tests.example' });
    const token = await owner.api.agents.createToken({ name: 'Lifecycle client', scopes: ['notes:read'], expiresInDays: 1 });
    const second = await h.secondServer();
    try {
      expect((await mcp(second.baseUrl, token.token)).status).toBe(200);
      await owner.api.auth.signOut();
      expect((await mcp(h.baseUrl, token.token)).status).toBe(200);
      await owner.api.auth.signIn('sso', { email: 'agent-life@tests.example' });
      await owner.api.agents.revoke(token.connection.id);
      expect((await mcp(second.baseUrl, token.token)).status).toBe(401);
      const expired = await owner.api.agents.createToken({ name: 'Expired client', scopes: ['notes:read'], expiresInDays: 1 });
      await h.pool.query("UPDATE agent_grants SET expires_at = now() - interval '1 second' WHERE owner_id = $1 AND id = $2", [signed.session.ownerId, expired.connection.id]);
      expect((await mcp(second.baseUrl, expired.token)).status).toBe(401);
      const deleted = await owner.api.agents.createToken({ name: 'Deleted client', scopes: ['notes:read'], expiresInDays: 1 });
      await owner.api.account.delete();
      expect((await mcp(second.baseUrl, deleted.token)).status).toBe(401);
      for (const table of ['agent_grants', 'agent_tokens', 'agent_codes', 'agent_operations']) expect((await h.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id = $1`, [signed.session.ownerId])).rows[0]?.n).toBe(0);
    } finally { await second.close(); }
  });
  it('refuses invalid scopes and browser origins and keeps bearer secrets out of rows, logs and receipts', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'agent-secrets@tests.example' });
    for (const scopes of [[], ['notes:read', 'notes:read'], ['account:delete']]) {
      const refused = await owner.fetch(`${h.baseUrl}/v1/agents/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Invalid client', scopes, expiresInDays: 30 }) });
      expect(refused.status).toBe(400);
    }
    const forbidden = await owner.fetch(`${h.baseUrl}/v1/agents/tokens`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://other.example' }, body: JSON.stringify({ name: 'Cross-site client', scopes: ['notes:read'], expiresInDays: 30 }) });
    expect(forbidden.status).toBe(403);
    const created = await owner.fetch(`${h.baseUrl}/v1/agents/tokens`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-alcove-operation': randomBytes(16).toString('base64url') }, body: JSON.stringify({ name: 'CANARY-TOKEN private client', scopes: ['notes:read'], expiresInDays: 30 }) });
    const token = TokenReply.parse(await created.json());
    expect((await fetch(`${h.baseUrl}/v1/agents`, { headers: { authorization: `Bearer ${token.token}` } })).status).toBe(401);
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM operations WHERE owner_id = $1', [signed.session.ownerId])).rows[0]?.n).toBe(0);
    const tables = ['agent_grants', 'agent_tokens'];
    const dump = (await Promise.all(tables.map(async (table) => String((await h.pool.query(`SELECT string_agg(row_to_json(x)::text, ' ') AS text FROM ${table} x`)).rows[0]?.text ?? '')))).join('');
    for (const canary of [token.token, 'CANARY-TOKEN']) for (const encoded of encodings(canary)) { expect(dump).not.toContain(encoded); expect(h.logs.join('')).not.toContain(encoded); }
  });
});

describe('OAuth agent consent', () => {
  it('binds explicit consent and one-use codes to the client, resource and S256 verifier, then rotates refresh tokens and revokes a replay', async () => {
    const discovery = await fetch(`${h.baseUrl}/.well-known/oauth-authorization-server`);
    expect(discovery.status).toBe(200);
    const meta = z.object({ issuer: z.string(), registration_endpoint: z.string(), code_challenge_methods_supported: z.array(z.string()) }).parse(await discovery.json());
    expect(meta.issuer).toBe(h.baseUrl);
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    const registration = await fetch(meta.registration_endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'CANARY-OAUTH private client', redirect_uris: ['http://127.0.0.1:8123/callback'], token_endpoint_auth_method: 'none' }) });
    expect(registration.status).toBe(201);
    const client = Registered.parse(await registration.json());
    const owner = h.browser();
    const signedIn = await owner.api.auth.signIn('sso', { email: 'oauth-owner@tests.example' });
    const verifier = randomBytes(32).toString('base64url');
    const requested = new URL(`${h.baseUrl}/oauth/authorize`);
    requested.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'http://127.0.0.1:9999/callback', resource: `${h.baseUrl}/mcp`, scope: 'notes:read meetings:write', state: 'CANARY-STATE private state', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
    const pending = await fetch(requested, { redirect: 'manual' });
    expect(pending.status).toBe(302);
    const requestId = new URL(pending.headers.get('location') ?? '').searchParams.get('request') ?? '';
    expect(requestId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await owner.api.agents.list()).toEqual([]);
    const pendingRows = String((await h.pool.query("SELECT string_agg(row_to_json(x)::text, ' ') AS text FROM agent_authorizations x")).rows[0]?.text ?? '');
    for (const canary of ['CANARY-OAUTH', 'CANARY-STATE', 'http://127.0.0.1:9999/callback']) for (const encoded of encodings(canary)) expect(pendingRows).not.toContain(encoded);
    expect(await owner.api.agents.authorization(requestId)).toMatchObject({ clientName: 'CANARY-OAUTH private client', scopes: ['notes:read', 'meetings:write'] });
    const decision = await owner.api.agents.decide(requestId, { allow: true, scopes: ['notes:read'], ownerId: signedIn.session.ownerId });
    const redirect = new URL(decision.redirectUrl);
    expect(redirect.origin).toBe('http://127.0.0.1:9999');
    expect(redirect.searchParams.get('state')).toBe('CANARY-STATE private state');
    expect(redirect.searchParams.get('iss')).toBe(h.baseUrl);
    const code = redirect.searchParams.get('code') ?? '';
    const codeRows = String((await h.pool.query("SELECT string_agg(row_to_json(x)::text, ' ') AS text FROM agent_codes x")).rows[0]?.text ?? '');
    for (const canary of [code, verifier, 'http://127.0.0.1:9999/callback']) for (const encoded of encodings(canary)) expect(codeRows).not.toContain(encoded);
    const parameters = { grant_type: 'authorization_code', client_id: client.client_id, redirect_uri: 'http://127.0.0.1:9999/callback', resource: `${h.baseUrl}/mcp`, code, code_verifier: verifier };
    expect((await post('/oauth/token', { ...parameters, resource: `${h.baseUrl}/wrong` })).status).toBe(400);
    expect((await post('/oauth/token', { ...parameters, code_verifier: randomBytes(32).toString('base64url') })).status).toBe(400);
    const exchanged = await post('/oauth/token', parameters);
    expect(exchanged.status).toBe(200);
    expect(exchanged.headers.get('cache-control')).toBe('no-store');
    const tokens = OAuthTokens.parse(await exchanged.json());
    expect(tokens.scope).toBe('notes:read');
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
    const tokenRows = String((await h.pool.query("SELECT string_agg(row_to_json(x)::text, ' ') AS text FROM agent_tokens x")).rows[0]?.text ?? '');
    for (const canary of [tokens.access_token, tokens.refresh_token]) for (const encoded of encodings(canary)) expect(tokenRows).not.toContain(encoded);
    expect((await post('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, resource: `${h.baseUrl}/wrong`, refresh_token: tokens.refresh_token })).status).toBe(400);
    expect((await post('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, resource: `${h.baseUrl}/mcp`, refresh_token: tokens.refresh_token, scope: 'notes:read notes:delete' })).status).toBe(400);
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM operations WHERE owner_id = $1', [signedIn.session.ownerId])).rows[0]?.n).toBe(0);
    expect((await post('/oauth/token', parameters)).status).toBe(400);
    const rotated = await post('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, resource: `${h.baseUrl}/mcp`, refresh_token: tokens.refresh_token });
    expect(rotated.status).toBe(200);
    const fresh = OAuthTokens.parse(await rotated.json());
    expect(fresh.refresh_token).not.toBe(tokens.refresh_token);
    expect((await post('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, resource: `${h.baseUrl}/mcp`, refresh_token: tokens.refresh_token })).status).toBe(400);
    expect(await owner.api.agents.list()).toEqual([]);
    expect((await post('/oauth/token', { grant_type: 'refresh_token', client_id: client.client_id, resource: `${h.baseUrl}/mcp`, refresh_token: fresh.refresh_token })).status).toBe(400);
    const dump = String((await h.pool.query("SELECT string_agg(row_to_json(x)::text, ' ') AS text FROM agent_authorizations x")).rows[0]?.text ?? '') + String((await h.pool.query("SELECT string_agg(row_to_json(x)::text, ' ') AS text FROM agent_clients x")).rows[0]?.text ?? '');
    for (const canary of [tokens.access_token, tokens.refresh_token, verifier, 'CANARY-OAUTH', 'CANARY-STATE']) {
      expect(dump).not.toContain(canary);
      expect(h.logs.join('')).not.toContain(canary);
    }
  });
  it('binds the previewed account to consent when the browser changes accounts before allowing', async () => {
    const accountA = h.browser();
    const accountB = h.browser();
    const a = await accountA.api.auth.signIn('sso', { email: 'consent-a@tests.example' });
    await accountB.api.auth.signIn('sso', { email: 'consent-b@tests.example' });
    const registration = await fetch(`${h.baseUrl}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Account bound client', redirect_uris: ['https://client.example/callback'] }) });
    const client = Registered.parse(await registration.json());
    const url = new URL(`${h.baseUrl}/oauth/authorize`);
    url.search = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://client.example/callback', resource: `${h.baseUrl}/mcp`, scope: 'notes:read', code_challenge: createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url'), code_challenge_method: 'S256' }).toString();
    const requested = await fetch(url, { redirect: 'manual' });
    const requestId = new URL(requested.headers.get('location') ?? '').searchParams.get('request') ?? '';
    expect(await accountA.api.agents.authorization(requestId)).toMatchObject({ ownerId: a.session.ownerId, accountEmail: 'consent-a@tests.example' });
    const changed = await accountB.fetch(`${h.baseUrl}/v1/agents/authorization/${requestId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ownerId: a.session.ownerId, allow: true, scopes: ['notes:read'] }) });
    expect(changed.status).toBe(403);
    expect(await accountB.api.agents.list()).toEqual([]);
    expect(await accountA.api.agents.decide(requestId, { ownerId: a.session.ownerId, allow: true, scopes: ['notes:read'] })).toEqual({ redirectUrl: expect.stringContaining('code=') });
  });
  it('refuses unsafe redirects, unknown clients, non-S256 requests and permission escalation without redirecting', async () => {
    for (const redirect of ['http://remote.example/callback', 'https://user:password@client.example/callback', 'https://client.example/callback#token', 'javascript:alert(1)']) {
      const registration = await fetch(`${h.baseUrl}/oauth/register`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.8.0.11' }, body: JSON.stringify({ client_name: 'Invalid', redirect_uris: [redirect] }) });
      expect(registration.status).toBe(400);
      expect(registration.headers.get('location')).toBeNull();
    }
    const pending = await pendingAuthorization();
    for (const patch of [{ client_id: randomBytes(16).toString('base64url') }, { redirect_uri: 'https://attacker.example/callback' }, { resource: 'https://attacker.example/mcp' }, { code_challenge_method: 'plain' }, { scope: 'account:delete' }, { scope: '' }]) {
      const url = new URL(`${h.baseUrl}/oauth/authorize`);
      url.search = new URLSearchParams({ ...pending.parameters, ...patch }).toString();
      const response = await fetch(url, { redirect: 'manual', headers: { 'x-forwarded-for': '10.8.0.11' } });
      expect(response.status).toBe(400);
      expect(response.headers.get('location')).toBeNull();
    }
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'oauth-scope@tests.example' });
    await expect(owner.api.agents.decide(pending.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:delete'] })).rejects.toMatchObject({ code: 'invalid' });
    expect(await owner.api.agents.list()).toEqual([]);
    const refused = new URL((await owner.api.agents.decide(pending.requestId, { ownerId: signed.session.ownerId, allow: false, scopes: [] })).redirectUrl);
    expect(refused.origin).toBe('https://client.example');
    expect(refused.searchParams.get('error')).toBe('access_denied');
    expect(refused.searchParams.has('code')).toBe(false);
    await expect(owner.api.agents.authorization(pending.requestId)).rejects.toMatchObject({ code: 'not-found' });
  });
  it('consumes a code once under concurrency, revokes by token without an existence oracle and deletes pending codes with the account', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'oauth-delete@tests.example' });
    const pending = await pendingAuthorization();
    const redirect = new URL((await owner.api.agents.decide(pending.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:read'] })).redirectUrl);
    const parameters = { grant_type: 'authorization_code', client_id: pending.client.client_id, redirect_uri: pending.parameters.redirect_uri, resource: `${h.baseUrl}/mcp`, code: redirect.searchParams.get('code') ?? '', code_verifier: pending.verifier };
    const replies = await Promise.all([post('/oauth/token', parameters), post('/oauth/token', parameters)]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 400]);
    const successful = replies.find((reply) => reply.status === 200);
    if (!successful) throw new Error('No code exchange succeeded.');
    const tokens = OAuthTokens.parse(await successful.json());
    expect((await mcp(h.baseUrl, tokens.access_token)).status).toBe(200);
    expect((await post('/oauth/revoke', { token: tokens.access_token, client_id: randomBytes(16).toString('base64url') })).status).toBe(200);
    expect((await mcp(h.baseUrl, tokens.access_token)).status).toBe(200);
    expect((await post('/oauth/revoke', { token: tokens.access_token, client_id: pending.client.client_id })).status).toBe(200);
    expect((await mcp(h.baseUrl, tokens.access_token)).status).toBe(401);
    expect((await post('/oauth/revoke', { token: tokens.access_token, client_id: pending.client.client_id })).status).toBe(200);
    expect(await owner.api.auth.getSession()).not.toBeNull();
    const unredeemed = await pendingAuthorization();
    await owner.api.agents.decide(unredeemed.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:read'] });
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_codes WHERE owner_id = $1', [signed.session.ownerId])).rows[0]?.n).toBe(1);
    await owner.api.account.delete();
    for (const table of ['agent_codes', 'agent_grants', 'agent_tokens']) expect((await h.pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE owner_id = $1`, [signed.session.ownerId])).rows[0]?.n).toBe(0);
  });
  it('refuses expired consent requests and codes without issuing credentials', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'oauth-expiry@tests.example' });
    const pending = await pendingAuthorization();
    await h.pool.query("UPDATE agent_authorizations SET expires_at = now() - interval '1 second' WHERE id = $1", [pending.requestId]);
    await expect(owner.api.agents.authorization(pending.requestId)).rejects.toMatchObject({ code: 'not-found' });
    await expect(owner.api.agents.decide(pending.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:read'] })).rejects.toMatchObject({ code: 'not-found' });
    const next = await pendingAuthorization();
    const redirect = new URL((await owner.api.agents.decide(next.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:read'] })).redirectUrl);
    await h.pool.query("UPDATE agent_codes SET expires_at = now() - interval '1 second' WHERE owner_id = $1", [signed.session.ownerId]);
    const refused = await post('/oauth/token', { grant_type: 'authorization_code', client_id: next.client.client_id, redirect_uri: next.parameters.redirect_uri, resource: `${h.baseUrl}/mcp`, code: redirect.searchParams.get('code') ?? '', code_verifier: next.verifier });
    expect(refused.status).toBe(400);
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_tokens WHERE owner_id = $1', [signed.session.ownerId])).rows[0]?.n).toBe(0);
  });
  it('physically sweeps expired delegations, authorization metadata and credentials', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'oauth-sweep@tests.example' });
    const personal = await owner.api.agents.createToken({ name: 'Swept client', scopes: ['notes:read'], expiresInDays: 1 });
    const pending = await pendingAuthorization();
    await h.pool.query("UPDATE agent_grants SET expires_at = now() - interval '1 second' WHERE owner_id = $1 AND id = $2", [signed.session.ownerId, personal.connection.id]);
    await h.pool.query("UPDATE agent_authorizations SET expires_at = now() - interval '1 second' WHERE id = $1", [pending.requestId]);
    await h.pool.query("UPDATE agent_clients SET expires_at = now() - interval '1 second' WHERE id = $1", [pending.client.client_id]);
    const { maintain } = await import('../../maintenance');
    const result = await maintain(h.deps);
    expect(result.agents).toBeGreaterThanOrEqual(3);
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_tokens WHERE owner_id = $1', [signed.session.ownerId])).rows[0]?.n).toBe(0);
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_authorizations WHERE id = $1', [pending.requestId])).rows[0]?.n).toBe(0);
    expect((await h.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM agent_clients WHERE id = $1', [pending.client.client_id])).rows[0]?.n).toBe(0);
  });
  it('serializes disconnect with a code redemption without a database deadlock', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'oauth-disconnect-race@tests.example' });
    const pending = await pendingAuthorization();
    const redirect = new URL((await owner.api.agents.decide(pending.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:read'] })).redirectUrl);
    const connection = (await owner.api.agents.list())[0];
    if (!connection) throw new Error('The connection was not created.');
    const held = await h.pool.connect();
    await held.query('BEGIN');
    try {
      await held.query('SELECT 1 FROM agent_codes WHERE owner_id = $1 FOR UPDATE', [signed.session.ownerId]);
      const redemption = post('/oauth/token', { grant_type: 'authorization_code', client_id: pending.client.client_id, redirect_uri: pending.parameters.redirect_uri, resource: `${h.baseUrl}/mcp`, code: redirect.searchParams.get('code') ?? '', code_verifier: pending.verifier });
      await until(async () => (await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FROM agent_codes%'")).rows[0]?.n === 1);
      const revoke = owner.fetch(`${h.baseUrl}/v1/agents/${connection.id}`, { method: 'DELETE' });
      await until(async () => (await h.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'DELETE FROM agent_grants%'")).rows[0]?.n === 1);
      await held.query('COMMIT');
      const [redeemed, revoked] = await Promise.all([redemption, revoke]);
      expect([200, 400]).toContain(redeemed.status);
      expect(revoked.status).toBe(200);
      expect(await owner.api.agents.list()).toEqual([]);
    } finally { await held.query('ROLLBACK'); held.release(); }
  });
  it('keeps a newly approved connection refreshable for its full life when its client metadata was near expiry', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'oauth-old-client@tests.example' });
    const pending = await pendingAuthorization();
    await h.pool.query("UPDATE agent_clients SET expires_at = now() + interval '1 minute' WHERE id = $1", [pending.client.client_id]);
    await owner.api.agents.decide(pending.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:read'] });
    const lifetime = (await h.pool.query<{ seconds: number }>('SELECT extract(epoch FROM expires_at - now())::int AS seconds FROM agent_clients WHERE id = $1', [pending.client.client_id])).rows[0]?.seconds ?? 0;
    expect(lifetime).toBeGreaterThanOrEqual(30 * 86_400);
  });
  it('bounds refresh-token history per connection across API instances', async () => {
    const owner = h.browser();
    const signed = await owner.api.auth.signIn('sso', { email: 'oauth-rotation-bound@tests.example' });
    const pending = await pendingAuthorization();
    const redirect = new URL((await owner.api.agents.decide(pending.requestId, { ownerId: signed.session.ownerId, allow: true, scopes: ['notes:read'] })).redirectUrl);
    const exchanged = await post('/oauth/token', { grant_type: 'authorization_code', client_id: pending.client.client_id, redirect_uri: pending.parameters.redirect_uri, resource: `${h.baseUrl}/mcp`, code: redirect.searchParams.get('code') ?? '', code_verifier: pending.verifier });
    const tokens = OAuthTokens.parse(await exchanged.json());
    const connection = (await owner.api.agents.list())[0];
    if (!connection) throw new Error('The connection was not created.');
    // A long-lived client has reached its finite persisted rotation allowance, as after many uses on other instances.
    await h.pool.query("INSERT INTO agent_tokens (token_hash, owner_id, grant_id, kind, consumed, expires_at) SELECT decode(md5(n::text), 'hex'), $1, $2, 'refresh', true, now() + interval '30 days' FROM generate_series(1,4096) n", [signed.session.ownerId, connection.id]);
    const response = await post('/oauth/token', { grant_type: 'refresh_token', client_id: pending.client.client_id, resource: `${h.baseUrl}/mcp`, refresh_token: tokens.refresh_token });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'temporarily_unavailable' });
  });
  it('discovers canonical metadata for an issuer behind a path prefix', async () => {
    const second = await h.secondServer({ API_URL: `${h.baseUrl}/api` });
    try {
      const issuer = await fetch(`${second.baseUrl}/.well-known/oauth-authorization-server/api`);
      expect(issuer.status).toBe(200);
      expect(await issuer.json()).toMatchObject({ issuer: `${h.baseUrl}/api`, token_endpoint: `${h.baseUrl}/api/oauth/token` });
      const resource = await fetch(`${second.baseUrl}/.well-known/oauth-protected-resource/api/mcp`);
      expect(resource.status).toBe(200);
      expect(await resource.json()).toMatchObject({ resource: `${h.baseUrl}/api/mcp`, authorization_servers: [`${h.baseUrl}/api`] });
      const unauthorized = await fetch(`${second.baseUrl}/mcp`, { method: 'POST', body: '{}' });
      expect(unauthorized.headers.get('www-authenticate')).toContain(`${h.baseUrl}/api/.well-known/oauth-protected-resource/mcp`);
    } finally { await second.close(); }
  });
});
