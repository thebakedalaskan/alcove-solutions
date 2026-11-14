/** Revocable delegations. The bearer is returned once; only its hash reaches Postgres. */
import { AgentConnectionIdSchema, AgentScopesSchema, type AgentConnection, type AgentEndpoint, type AgentScope, type AgentTokenInput, type AgentUpdateInput } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../platform/context';
import { b64u, id128, openJson, random, sealJson, sha, stateKey, toJson, utf8 } from '../../keys/crypto';
import { bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../platform/db';
import { AuthError, ForbiddenError, NotFoundError, UnavailableError } from '../../platform/errors';
import { log } from '../../platform/log';
import { lockOwner, openOwner } from '../../keys/owners';

const alog = log.child({ component: 'agents' });
export const GRANT_MS = 30 * 86_400_000;
/** The most connections an account has at once: another is refused until one is disconnected or runs out. */
export const MAX_CONNECTIONS = 50;
/** A client normally refreshes hourly: this persists a finite bound across addresses, restarts and instances. */
export const MAX_TOKEN_HISTORY = 4096;
export const GrantInfo = z.object({ name: z.string(), kind: z.enum(['token', 'oauth']), scopes: AgentScopesSchema, clientId: z.string().nullable().default(null) });
export const GrantRow = z.object({ id: z.string(), owner_id: z.string(), info_ciphertext: bytea, created_at: timestamp, expires_at: timestamp, last_used_at: timestamp.nullable() });
export type Grant = z.infer<typeof GrantRow>;
export interface AgentPrincipal { owner: Owner; connection: AgentConnection }
export const issuerUrl = (d: Deps): string => d.cfg.API_URL.replace(/\/+$/, '');
export const resourceUrl = (d: Deps): string => `${issuerUrl(d)}/mcp`;
/** Where agents connect, the same for everyone: Settings shows it before any connection exists. */
export const endpoint = (d: Deps): AgentEndpoint => ({ endpoint: resourceUrl(d) });
export const tokenHash = (token: string): Uint8Array => sha(utf8(token));
export const newToken = (kind: 'personal' | 'access' | 'refresh'): string => `alcove_${kind}_${b64u(random(32))}`;
const header = (ownerId: string, grantId: string) => ({ v: 1 as const, kind: 'agent-grant', ownerId, grantId });
export const grantKey = (o: Owner, id: string): Uint8Array => stateKey(o.root, o.ownerId, `agent:${id}`);
export const grantInfo = (o: Owner, row: Grant): z.infer<typeof GrantInfo> => openJson(grantKey(o, row.id), header(o.ownerId, row.id), row.info_ciphertext, GrantInfo);
const sealGrant = (o: Owner, id: string, info: z.infer<typeof GrantInfo>): Uint8Array<ArrayBuffer> => new Uint8Array(sealJson(grantKey(o, id), header(o.ownerId, id), toJson(info)));
export function connectionOf(o: Owner, row: Grant): AgentConnection {
  const info = grantInfo(o, row);
  return { id: row.id, name: info.name, kind: info.kind, scopes: info.scopes, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null };
}
export async function createGrant(o: Owner, db: Db, info: z.infer<typeof GrantInfo>, expiresAt: Date): Promise<Grant> {
  const id = id128();
  const createdAt = new Date();
  const ciphertext = sealGrant(o, id, info);
  await exec(db, 'INSERT INTO agent_grants (id, owner_id, info_ciphertext, created_at, expires_at) VALUES ($1,$2,$3,$4,$5)', [id, o.ownerId, ciphertext, createdAt, expiresAt]);
  return { id, owner_id: o.ownerId, info_ciphertext: ciphertext, created_at: createdAt, expires_at: expiresAt, last_used_at: null };
}
export async function storeToken(db: Db, o: Owner, grant: Grant, token: string, kind: 'personal' | 'access' | 'refresh', expiresAt: Date): Promise<void> {
  await exec(db, 'INSERT INTO agent_tokens (token_hash, owner_id, grant_id, kind, expires_at) VALUES ($1,$2,$3,$4,$5)', [tokenHash(token), o.ownerId, grant.id, kind, expiresAt]);
}
export async function list(o: Owner): Promise<AgentConnection[]> {
  const found = await rows(o.pool, GrantRow, 'SELECT * FROM agent_grants WHERE owner_id = $1 AND expires_at > now() ORDER BY created_at DESC, id', [o.ownerId]);
  return found.map((row) => connectionOf(o, row));
}
export async function createToken(o: Owner, input: AgentTokenInput) {
  const token = newToken('personal');
  const row = await tx(o.pool, async (db) => {
    await lockOwner(o, db);
    const count = await maybeOne(db, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM agent_grants WHERE owner_id = $1 AND expires_at > now()', [o.ownerId]);
    if ((count?.n ?? 0) >= MAX_CONNECTIONS) throw new UnavailableError('Disconnect an agent before adding another.');
    const grant = await createGrant(o, db, { name: input.name, kind: 'token', scopes: input.scopes, clientId: null }, new Date(Date.now() + input.expiresInDays * 86_400_000));
    await storeToken(db, o, grant, token, 'personal', grant.expires_at);
    return grant;
  });
  alog.info('agent connected', { ownerId: o.ownerId, grantId: row.id, kind: 'token', scopes: input.scopes.length });
  return { connection: connectionOf(o, row), token, endpoint: resourceUrl(o) };
}
/**
 * Changes what a connection can do, which every MCP request reads afresh, so its next one has it; or keeps it 30 more days
 * from now. One transaction under the grant's row lock, which refresh, code redemption and disconnecting take first too.
 */
export async function update(o: Owner, id: string, input: AgentUpdateInput): Promise<AgentConnection> {
  AgentConnectionIdSchema.parse(id);
  const row = await tx(o.pool, async (db) => {
    const grant = await maybeOne(db, GrantRow, 'SELECT * FROM agent_grants WHERE owner_id = $1 AND id = $2 AND expires_at > now() FOR UPDATE', [o.ownerId, id]);
    if (!grant) throw new NotFoundError('That connection is no longer available.');
    const info = grantInfo(o, grant);
    let changed = grant;
    if (input.scopes) {
      const sealed = sealGrant(o, id, { ...info, scopes: input.scopes });
      await exec(db, 'UPDATE agent_grants SET info_ciphertext = $3 WHERE owner_id = $1 AND id = $2', [o.ownerId, id, sealed]);
      changed = { ...changed, info_ciphertext: sealed };
    }
    const until = new Date(Date.now() + GRANT_MS);
    if (input.renew && until > grant.expires_at) {
      await exec(db, 'UPDATE agent_grants SET expires_at = $3 WHERE owner_id = $1 AND id = $2', [o.ownerId, id, until]);
      // Its token, or the refresh token it hasn't used yet, lasts as long as it does. One it has used keeps its own end, so a
      // replay of it is caught until then and upkeep deletes it after: a connection kept longer doesn't pile up its history.
      await exec(db, "UPDATE agent_tokens SET expires_at = $3 WHERE owner_id = $1 AND grant_id = $2 AND kind IN ('personal', 'refresh') AND NOT consumed", [o.ownerId, id, until]);
      // Its OAuth client stays registered as long as it does, or refreshing would fail as an unknown client.
      if (info.clientId !== null) await exec(db, 'UPDATE agent_clients SET expires_at = GREATEST(expires_at, $2) WHERE id = $1', [info.clientId, until]);
      changed = { ...changed, expires_at: until };
    }
    return changed;
  });
  alog.info('agent connection changed', { ownerId: o.ownerId, grantId: id, scopes: input.scopes?.length, renew: input.renew === true });
  return connectionOf(o, row);
}
export async function revoke(o: Owner, id: string): Promise<void> {
  AgentConnectionIdSchema.parse(id);
  if (!await exec(o.pool, 'DELETE FROM agent_grants WHERE owner_id = $1 AND id = $2', [o.ownerId, id])) throw new NotFoundError('That connection is no longer available.');
  alog.info('agent disconnected', { ownerId: o.ownerId, grantId: id });
}
export async function authenticateAgent(d: Deps, token: string): Promise<AgentPrincipal> {
  if (!/^alcove_(personal|access)_[A-Za-z0-9_-]{43}$/.test(token)) throw new AuthError('Connect your agent to Alcove again.');
  const row = await maybeOne(d.pool, GrantRow, `SELECT g.* FROM agent_tokens t JOIN agent_grants g ON g.id = t.grant_id AND g.owner_id = t.owner_id
    WHERE t.token_hash = $1 AND t.kind IN ('personal','access') AND NOT t.consumed AND t.expires_at > now() AND g.expires_at > now()`, [tokenHash(token)]);
  if (!row) throw new AuthError('Connect your agent to Alcove again.');
  const owner = await openOwner(d, row.owner_id, undefined);
  try {
    const connection = connectionOf(owner, row);
    await exec(d.pool, "UPDATE agent_grants SET last_used_at = now() WHERE owner_id = $1 AND id = $2 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')", [row.owner_id, row.id]);
    return { owner, connection };
  } catch (e) { owner.root.fill(0); owner.wrapKey.fill(0); throw e; }
}
export function requireScope(principal: AgentPrincipal, scope: AgentScope): void {
  if (!principal.connection.scopes.includes(scope)) throw new ForbiddenError('This agent does not have that permission.', { context: { grantId: principal.connection.id, scope } });
}
/**
 * The tables of agents' rows that run out, each row at its `expires_at`: what the sweep removes, and what an operator's report
 * counts (features/operator/work.ts). Every credential past its end goes with them: a used refresh token's end is when a
 * replay of it stops being caught, its connection's end, or the one it had when it was kept longer.
 */
export const AGENT_ROWS = ['agent_grants', 'agent_codes', 'agent_authorizations', 'agent_clients', 'agent_operations', 'agent_tokens'] as const;
export async function sweep(d: Deps): Promise<number> {
  const counts = await Promise.all(AGENT_ROWS.map((table) => exec(d.pool, `DELETE FROM ${table} WHERE expires_at <= now()`)));
  return counts.reduce((n, count) => n + count, 0);
}
