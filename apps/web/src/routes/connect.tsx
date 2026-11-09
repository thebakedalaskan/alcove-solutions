import { AgentAuthorizationIdSchema, AgentScopeSchema, errorCode, errorMessage, type AgentAuthorization, type AgentScope } from '@alcove/api';
import { AgentConsentFrame, AgentDisclosure, AgentPermissions, Button, EmptyState, Spinner } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PERMISSIONS } from '~/features/agents/permissions';
import { useAuth, WaysIn } from '~/features/welcome/WaysIn';
import { q, qk, useAgentDecision } from '~/lib/queries';
import { onSignedOutElsewhere } from '~/lib/signedOut';

export const Route = createFileRoute('/connect')({
  validateSearch: (search: Record<string, unknown>): { request?: string | undefined } => {
    const request = AgentAuthorizationIdSchema.safeParse(search['request']);
    return { request: request.success ? request.data : undefined };
  },
  component: Connect
});

function Connect() {
  const { request } = Route.useSearch();
  const qc = useQueryClient();
  const session = useQuery({ ...q.session(), staleTime: 0 });
  const authorization = useQuery({ ...q.agentAuthorization(request ?? '', session.data?.ownerId ?? 'signed-out'), enabled: Boolean(request && session.data) });
  const auth = useAuth({ agent: request });
  useEffect(() => onSignedOutElsewhere(() => {
    qc.setQueryData(qk.session, null);
    qc.removeQueries({ queryKey: ['agent-authorization'] });
  }), [qc]);
  if (!request) return <AgentConsentFrame title="Connect an agent"><EmptyState title="Open the connection from your agent">The agent will send you here to choose its permissions.</EmptyState></AgentConsentFrame>;
  if (session.isPending) return <AgentConsentFrame title="Connect an agent"><p role="status"><Spinner /> Checking your sign-in…</p></AgentConsentFrame>;
  if (session.isError) return <AgentConsentFrame title="Connect an agent"><p role="alert">{errorMessage(session.error)}</p><Button onClick={() => void session.refetch()}>Try again</Button></AgentConsentFrame>;
  if (!session.data) return <AgentConsentFrame title="Sign in to connect your agent"><p>Choose which account your agent can use. You’ll review its permissions after signing in.</p><WaysIn auth={auth} layout="stack" /></AgentConsentFrame>;
  if (authorization.isPending) return <AgentConsentFrame title="Connect an agent"><p role="status"><Spinner /> Loading the request…</p></AgentConsentFrame>;
  if (authorization.isError) return <AgentConsentFrame title="Connection unavailable"><EmptyState title={errorCode(authorization.error) === 'not-found' ? 'This request ended' : 'The request couldn’t be loaded'}>{errorCode(authorization.error) === 'not-found' ? 'It expired or has already been answered. Start connecting again from your agent.' : errorMessage(authorization.error)}</EmptyState><Button onClick={() => void authorization.refetch()}>Try again</Button></AgentConsentFrame>;
  return <Consent key={`${request}:${authorization.data.ownerId}`} requestId={request} authorization={authorization.data} />;
}

function Consent({ requestId, authorization }: { requestId: string; authorization: AgentAuthorization }) {
  const [scopes, setScopes] = useState<AgentScope[]>(authorization.scopes);
  const [problem, setProblem] = useState<string>();
  const decision = useAgentDecision(requestId);
  const choose = (id: string, on: boolean) => {
    const scope = AgentScopeSchema.parse(id);
    setScopes((old) => on ? [...old.filter((s) => s !== scope), scope] : old.filter((s) => s !== scope));
  };
  const decide = async (allow: boolean) => {
    setProblem(undefined);
    try {
      const result = await decision.mutateAsync({ allow, scopes: allow ? scopes : [], ownerId: authorization.ownerId });
      decision.reset();
      location.assign(result.redirectUrl);
    } catch (e) { setProblem(errorMessage(e)); }
  };
  return <AgentConsentFrame title="Connect your agent">
    <p><strong>{authorization.clientName}</strong> wants access to your Alcove account, {authorization.accountEmail}.</p>
    <p className="ac-agent-hint">The client supplies this name. Only continue if you started this connection.</p>
    <AgentPermissions details permissions={PERMISSIONS.filter((p) => authorization.scopes.includes(p.id))} selected={scopes} onChange={choose} disabled={decision.isPending} />
    <AgentDisclosure />
    <p className="ac-agent-hint">Access ends after 30 days. You can disconnect it sooner in Settings.</p>
    {problem && <p role="alert">{problem}</p>}
    <div className="ac-agent-actions"><Button variant="primary" loading={decision.isPending && decision.variables?.allow} disabled={decision.isPending || scopes.length === 0} onClick={() => void decide(true)}>Allow selected access</Button><Button loading={decision.isPending && !decision.variables?.allow} disabled={decision.isPending} onClick={() => void decide(false)}>Cancel</Button></div>
  </AgentConsentFrame>;
}
