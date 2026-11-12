import type { AgentActivityPage, AgentActivityQuery, AgentAuthorization, AgentConnection, AgentDecisionInput, AgentDecisionResult, AgentEndpoint, AgentTokenInput, AgentTokenResult, AgentUpdateInput } from './schema';
import type { ID } from '../shared/ids';

export interface AgentsApi {
  /** Active connections, including their permissions, expiry and last use. Credentials are never returned here. */
  list(): Promise<AgentConnection[]>;
  /** The MCP address an agent connects to: the same for every connection, and shown before any token exists. */
  endpoint(): Promise<AgentEndpoint>;
  /** Creates a named personal token and reveals its bearer once. */
  createToken(input: AgentTokenInput): Promise<AgentTokenResult>;
  /** Disconnects a connection for good, with its credentials and what it did. */
  revoke(id: ID): Promise<void>;
  /** Changes what a connection can do, from its next request, or keeps it 30 more days from now. Returns it as it now is. */
  update(id: ID, input: AgentUpdateInput): Promise<AgentConnection>;
  /** What your agents did, newest first, a page at a time. Only you can read it. */
  activity(query?: AgentActivityQuery): Promise<AgentActivityPage>;
  /** The validated client's request, for a signed-in person to review before deciding. */
  authorization(requestId: string): Promise<AgentAuthorization>;
  /** Grants a subset of the requested permissions, or declines, returning the validated callback URL. */
  decide(requestId: string, decision: AgentDecisionInput): Promise<AgentDecisionResult>;
}
