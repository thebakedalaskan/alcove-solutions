import type { AlcoveApi } from '@alcove/api';
import { AgentActivityPageSchema, AgentActivityQuerySchema, AgentAuthorizationIdSchema, AgentAuthorizationSchema, AgentConnectionIdSchema, AgentConnectionSchema, AgentDecisionInputSchema, AgentDecisionResultSchema, AgentEndpointSchema, AgentTokenInputSchema, AgentTokenResultSchema, AgentUpdateInputSchema } from '@alcove/api';
import type { HttpTransport } from '../transport/http';
import { z } from 'zod';

export function createAgentsApi(t: HttpTransport): Pick<AlcoveApi, 'agents'> {
  const { req } = t;
  return {
    agents: {
      list: () => req(z.array(AgentConnectionSchema), 'GET', '/agents'),
      endpoint: () => req(AgentEndpointSchema, 'GET', '/agents/endpoint'),
      createToken: (input) => req(AgentTokenResultSchema, 'POST', '/agents/tokens', AgentTokenInputSchema.parse(input)),
      revoke: async (id) => { await req(z.object({ revoked: z.literal(true) }), 'DELETE', `/agents/${AgentConnectionIdSchema.parse(id)}`); },
      update: (id, input) => req(AgentConnectionSchema, 'PATCH', `/agents/${AgentConnectionIdSchema.parse(id)}`, AgentUpdateInputSchema.parse(input)),
      activity: (query) => {
        const { before, limit } = AgentActivityQuerySchema.parse(query ?? {});
        const search = new URLSearchParams({ limit: String(limit) });
        if (before) search.set('before', before);
        return req(AgentActivityPageSchema, 'GET', `/agents/activity?${search.toString()}`);
      },
      authorization: (id) => req(AgentAuthorizationSchema, 'GET', `/agents/authorization/${AgentAuthorizationIdSchema.parse(id)}`),
      decide: (id, decision) => req(AgentDecisionResultSchema, 'POST', `/agents/authorization/${AgentAuthorizationIdSchema.parse(id)}`, AgentDecisionInputSchema.parse(decision))
    }
  };
}
