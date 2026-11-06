import type { AlcoveApi } from '@alcove/api';
import { AgentAuthorizationIdSchema, AgentAuthorizationSchema, AgentConnectionIdSchema, AgentConnectionSchema, AgentDecisionInputSchema, AgentDecisionResultSchema, AgentTokenInputSchema, AgentTokenResultSchema } from '@alcove/api';
import type { HttpTransport } from '../transport/http';
import { z } from 'zod';

export function createAgentsApi(t: HttpTransport): Pick<AlcoveApi, 'agents'> {
  const { req } = t;
  return {
    agents: {
      list: () => req(z.array(AgentConnectionSchema), 'GET', '/agents'),
      createToken: (input) => req(AgentTokenResultSchema, 'POST', '/agents/tokens', AgentTokenInputSchema.parse(input)),
      revoke: async (id) => { await req(z.object({ revoked: z.literal(true) }), 'DELETE', `/agents/${AgentConnectionIdSchema.parse(id)}`); },
      authorization: (id) => req(AgentAuthorizationSchema, 'GET', `/agents/authorization/${AgentAuthorizationIdSchema.parse(id)}`),
      decide: (id, decision) => req(AgentDecisionResultSchema, 'POST', `/agents/authorization/${AgentAuthorizationIdSchema.parse(id)}`, AgentDecisionInputSchema.parse(decision))
    }
  };
}
