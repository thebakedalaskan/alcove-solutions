/* Made-up agent connections, scoped to the story's world and signed-in account. */
import { AgentConnectionSchema, AlcoveApiError, type AgentConnection } from '@alcove/api';
import type { World } from '../world';
import { iso } from '../world/clock';

/** Public consent pointers for previews; neither grants access or works outside Storybook. */
export const AGENT_REQUEST = 'storybook-agent-request'.padEnd(43, '_');
export const EXPIRED_AGENT_REQUEST = 'storybook-expired-request'.padEnd(43, '_');
export const AGENT_CONNECT_PATH = `/connect?request=${AGENT_REQUEST}`;
export const PREVIEW_AGENT_TOKEN = 'storybook-preview-token-not-valid-outside-this-story';
export const PREVIEW_MCP_ENDPOINT = 'https://api.example.com/mcp';

const connectionsByWorld = new WeakMap<World, Map<string, AgentConnection[]>>();
export function agentsFor(w: World): { connections: AgentConnection[]; save(connections: AgentConnection[]): void } {
  const ownerId = w.session?.ownerId;
  if (!ownerId) throw new AlcoveApiError('unauthenticated', 'Sign in to Alcove first.');
  let owners = connectionsByWorld.get(w);
  if (!owners) { owners = new Map(); connectionsByWorld.set(w, owners); }
  const connections = (owners.get(ownerId) ?? []).filter((connection) => Date.parse(connection.expiresAt) > Date.now());
  owners.set(ownerId, connections);
  return { connections, save: (next) => { owners.set(ownerId, next.map(connection => AgentConnectionSchema.parse(connection))); } };
}
export const forgetAgents = (w: World): void => { connectionsByWorld.delete(w); };

/** One OAuth client and one unused personal token, so Settings shows scopes, expiry and both last-use states. */
export function withAgentConnections(w: World): void {
  agentsFor(w).save([
    { id: 'storybook-oauth'.padEnd(22, '_'), name: 'Workspace assistant', kind: 'oauth', scopes: ['notes:read', 'meetings:read', 'calendar:read'], createdAt: iso(-2, 11, 30), expiresAt: iso(28, 11, 30), lastUsedAt: iso(0, 15, 55) },
    { id: 'storybook-token'.padEnd(22, '_'), name: 'Scheduling assistant', kind: 'token', scopes: ['meetings:read', 'meetings:write'], createdAt: iso(-1, 9, 0), expiresAt: iso(6, 9, 0), lastUsedAt: null }
  ]);
}
