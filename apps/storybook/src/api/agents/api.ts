/*
 * Agents, as the stand-in answers for them (packages/api-http/src/agents/api.ts is the real client's): the agents you've
 * let in and what they did, a token for a script, and the request an agent makes, decided on /connect. What the world
 * keeps of them is agents.ts.
 */
import { AgentAuthorizationIdSchema, AgentConnectionIdSchema, AgentDecisionInputSchema, AgentTokenInputSchema, AgentUpdateInputSchema, AlcoveApiError, type AgentConnection, type AlcoveApi } from '@alcove/api';
import { answer, refused } from '../answer';
import { nextId } from '../state';
import { activityOf, agentRequest, agentsFor, answer as answerRequest, answered, connectionAllowed, EXPIRED_AGENT_REQUEST, PREVIEW_AGENT_TOKEN, PREVIEW_MCP_ENDPOINT } from './agents';

export const agentsApi: Pick<AlcoveApi, 'agents'> = {
  agents: {
    list: () => answer((w) => agentsFor(w).connections.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))),
    endpoint: () => answer(() => ({ endpoint: PREVIEW_MCP_ENDPOINT })),
    createToken: (input) => answer((w) => {
      const parsed = AgentTokenInputSchema.parse(input);
      const held = agentsFor(w);
      const now = Date.now();
      const connection: AgentConnection = {
        id: nextId('agent').padEnd(22, '_'), name: parsed.name, kind: 'token', scopes: parsed.scopes,
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + parsed.expiresInDays * 86_400_000).toISOString(), lastUsedAt: null
      };
      held.save([...held.connections, connection]);
      return { connection, token: PREVIEW_AGENT_TOKEN, endpoint: PREVIEW_MCP_ENDPOINT };
    }),
    revoke: (id) => answer((w) => {
      AgentConnectionIdSchema.parse(id);
      const held = agentsFor(w);
      held.save(held.connections.filter((connection) => connection.id !== id));
    }),
    update: (id, input) => answer((w) => {
      AgentConnectionIdSchema.parse(id);
      const parsed = AgentUpdateInputSchema.parse(input);
      const held = agentsFor(w);
      const found = held.connections.find((connection) => connection.id === id);
      if (!found) throw refused('not-found', 'That connection is no longer available.');
      const expiresAt = parsed.renew ? new Date(Math.max(Date.parse(found.expiresAt), Date.now() + 30 * 86_400_000)).toISOString() : found.expiresAt;
      const next: AgentConnection = { ...found, scopes: parsed.scopes ?? found.scopes, expiresAt };
      held.save(held.connections.map((connection) => (connection.id === id ? next : connection)));
      return next;
    }),
    activity: (query) => answer((w) => activityOf(w, query)),
    authorization: (requestId) => answer((w) => {
      AgentAuthorizationIdSchema.parse(requestId);
      const asked = agentRequest(requestId);
      if (!asked || requestId === EXPIRED_AGENT_REQUEST) throw refused('not-found', 'This connection request has expired.');
      if (!w.session) throw new AlcoveApiError('unauthenticated', 'Sign in to Alcove first.');
      if (answered(w, requestId)) throw refused('not-found', 'This connection request has expired.');
      return { ownerId: w.session.ownerId, accountEmail: w.session.user.email, clientName: asked.clientName, redirectHost: asked.redirectHost, scopes: [...asked.scopes], expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    }),
    decide: (requestId, decision) => answer((w) => {
      AgentAuthorizationIdSchema.parse(requestId);
      const asked = agentRequest(requestId);
      if (!asked || requestId === EXPIRED_AGENT_REQUEST) throw refused('not-found', 'This connection request has expired.');
      if (decision.ownerId !== w.session?.ownerId) throw refused('conflict', 'Your account changed. Review this connection again.');
      // Story accounts have descriptive IDs, so compare those directly while parsing the actual permission choices.
      const allow = AgentDecisionInputSchema.shape.allow.parse(decision.allow);
      const scopes = AgentDecisionInputSchema.shape.scopes.parse(decision.scopes);
      if (scopes.some((scope) => !asked.scopes.includes(scope)) || new Set(scopes).size !== scopes.length || (allow && !scopes.length)) throw refused('invalid', 'Choose only permissions this agent requested.');
      if (!answerRequest(w, requestId)) throw refused('not-found', 'This connection request has expired.');
      if (allow) { const held = agentsFor(w); held.save([...held.connections, connectionAllowed(asked.clientName, scopes)]); }
      // The agent waits at its own address, outside Storybook: here it's a place in this frame, so the story stays put.
      return { redirectUrl: new URL(`#agent-callback-${allow ? 'allowed' : 'access-denied'}`, location.href).href };
    })
  }
};
