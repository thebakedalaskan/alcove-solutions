/* Agents' query keys: the connections, what they did, the address they connect to, and a request to be let in. */
export const agentKeys = {
  agents: ['agents'] as const,
  /** What your agents did: a list of its own, read again only when it changes (disconnecting deletes what an agent did). */
  agentActivity: ['agent-activity'] as const,
  agentEndpoint: ['agent-endpoint'] as const,
  agentAuthorization: (id: string, ownerId: string) => ['agent-authorization', id, ownerId] as const
};
