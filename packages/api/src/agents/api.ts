import type { AgentAuthorization, AgentConnection, AgentDecisionInput, AgentDecisionResult, AgentEndpoint, AgentTokenInput, AgentTokenResult } from './schema';
import type { ID } from '../shared/ids';

export interface AgentsApi {
  /** Active connections, including their permissions, expiry and last use. Credentials are never returned here. */
  list(): Promise<AgentConnection[]>;
  /** The MCP address an agent connects to: the same for every connection, and shown before any token exists. */
  endpoint(): Promise<AgentEndpoint>;
  /** Creates a named personal token and reveals its bearer once. */
  createToken(input: AgentTokenInput): Promise<AgentTokenResult>;
  /** Disconnects a connection for good, with its credentials. */
  revoke(id: ID): Promise<void>;
  /** The validated client's request, for a signed-in person to review before deciding. */
  authorization(requestId: string): Promise<AgentAuthorization>;
  /** Grants a subset of the requested permissions, or declines, returning the validated callback URL. */
  decide(requestId: string, decision: AgentDecisionInput): Promise<AgentDecisionResult>;
}
