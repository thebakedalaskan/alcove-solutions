/*
 * Where an agent sends you to let it use your Alcove (features/agents/ConnectPage.tsx), with its request (`request`, a pointer,
 * never a credential).
 */
import { AgentAuthorizationIdSchema } from '@alcove/api';
import { createFileRoute } from '@tanstack/react-router';
import { ConnectPage } from '~/features/agents/ConnectPage';

export const Route = createFileRoute('/connect')({
  validateSearch: (search: Record<string, unknown>): { request?: string | undefined } => {
    const request = AgentAuthorizationIdSchema.safeParse(search['request']);
    return { request: request.success ? request.data : undefined };
  },
  component: Connect
});

function Connect() {
  const { request } = Route.useSearch();
  return <ConnectPage request={request} />;
}
