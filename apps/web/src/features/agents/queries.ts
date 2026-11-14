/* Agents' data: the connections on the line, what they did, where they connect, and the changes Agents makes to them. */
import type { AgentDecisionInput, AgentTokenInput, AgentUpdateInput } from '@alcove/api';
import { infiniteQueryOptions, queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '~/lib/api';
import { agentKeys } from './queryKeys';

/** How much of what your agents did a page of it holds, and where the first page starts (nowhere before it). */
const ACTIVITY_PAGE = 12;
const newest = (): string | null => null;

export const agentQueries = {
  agents: () => queryOptions({ queryKey: agentKeys.agents, queryFn: () => api.agents.list() }),
  /**
   * What your agents did, newest first, a page at a time: Show more reads the page after the last one. Read again every
   * minute while only the first page is open; once more are, reading again would read them all, so it waits to be asked.
   */
  agentActivity: () => infiniteQueryOptions({
    queryKey: agentKeys.agentActivity,
    queryFn: ({ pageParam }) => api.agents.activity(pageParam === null ? { limit: ACTIVITY_PAGE } : { limit: ACTIVITY_PAGE, before: pageParam }),
    initialPageParam: newest(),
    getNextPageParam: (page) => page.next,
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 1) > 1 ? false : 60_000)
  }),
  /** The MCP address agents connect to: it stays the same while the app is open. */
  agentEndpoint: () => queryOptions({ queryKey: agentKeys.agentEndpoint, queryFn: () => api.agents.endpoint(), staleTime: Infinity }),
  agentAuthorization: (id: string, ownerId: string) => queryOptions({ queryKey: agentKeys.agentAuthorization(id, ownerId), queryFn: () => api.agents.authorization(id), retry: false, staleTime: 0 })
};

/** Credentials live in the active form only, never in a query or a persisted mutation. */
/*
 * After a change to the connections, the list alone is read again, and nothing waits for it: what was changed answers at
 * once (a token shows, Saved says so, allowing hands back to the agent) and the list catches up behind it.
 */
const readConnectionsAgain = (qc: QueryClient) => { void qc.invalidateQueries({ queryKey: agentKeys.agents, exact: true }); };
export function useCreateAgentToken() {
  const qc = useQueryClient();
  return useMutation({ gcTime: 0, mutationFn: (input: AgentTokenInput) => api.agents.createToken(input), onSuccess: () => readConnectionsAgain(qc) });
}
/** Disconnecting deletes what the agent did too: it leaves the line at once, and what they did is read again. */
export function useRevokeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.agents.revoke(id),
    onSuccess: (_, id) => {
      qc.setQueryData(agentQueries.agents().queryKey, (list) => list?.filter((c) => c.id !== id));
      readConnectionsAgain(qc);
      void qc.invalidateQueries({ queryKey: agentKeys.agentActivity });
    }
  });
}
/** Allowing an agent connects it: the list is read again, so it stands on the line. */
export function useAgentDecision(requestId: string) {
  const qc = useQueryClient();
  return useMutation({ gcTime: 0, mutationFn: (decision: AgentDecisionInput) => api.agents.decide(requestId, decision), onSuccess: () => readConnectionsAgain(qc) });
}
/**
 * Changing a connection: what it can do, or 30 more days. One change at a time, in the order they were made (`scope`), so
 * quick presses of its chips land as pressed. What comes back is the connection as it now is, and it shows at once.
 */
export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    scope: { id: 'agent-update' },
    mutationFn: ({ id, ...change }: AgentUpdateInput & { id: string }) => api.agents.update(id, change),
    onSuccess: (connection) => {
      qc.setQueryData(agentQueries.agents().queryKey, (list) => list?.map((c) => (c.id === connection.id ? connection : c)));
      readConnectionsAgain(qc);
    }
  });
}
