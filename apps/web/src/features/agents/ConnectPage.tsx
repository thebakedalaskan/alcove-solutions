/*
 * Where an agent sends you to let it use your Alcove, with its request (`request`, a pointer, never a credential). Signed
 * in, Agents asks on its sky (/agents?request=…), in place of this page. Signed out, it's signing in first, and then the
 * same. Without a request there's nothing to allow, and it says where to start.
 */
import { errorMessage } from '@alcove/api';
import { AgentConsentFrame, Button, EmptyState, Spinner } from '@alcove/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useAuth, WaysIn } from '~/features/account/WaysIn';
import { accountQueries } from '~/features/account/queries';
import { accountKeys } from '~/features/account/queryKeys';
import { onSignedOutElsewhere } from '~/lib/signedOut';

export function ConnectPage({ request }: { request: string | undefined }) {
  const qc = useQueryClient();
  const session = useQuery({ ...accountQueries.session(), staleTime: 0 });
  const auth = useAuth({ agent: request });
  useEffect(() => onSignedOutElsewhere(() => { qc.setQueryData(accountKeys.session, null); }), [qc]);
  if (!request) return <AgentConsentFrame title="Connect an agent"><EmptyState title="Open the connection from your agent">The agent will send you here to choose its permissions.</EmptyState></AgentConsentFrame>;
  if (session.isPending) return <AgentConsentFrame title="Connect an agent"><p role="status"><Spinner /> Checking your sign-in…</p></AgentConsentFrame>;
  if (session.isError) return <AgentConsentFrame title="Connect an agent"><p role="alert">{errorMessage(session.error)}</p><Button onClick={() => void session.refetch()}>Try again</Button></AgentConsentFrame>;
  if (!session.data) return <AgentConsentFrame title="Sign in to connect your agent"><p>Choose which account your agent can use. You’ll review its permissions after signing in.</p><WaysIn auth={auth} layout="stack" /></AgentConsentFrame>;
  return <Navigate to="/agents" search={{ request }} replace />;
}
