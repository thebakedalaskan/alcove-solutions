import { createFileRoute } from '@tanstack/react-router';
import { AppFrame } from '~/features/shell/AppFrame';
import { requireAccount } from '~/features/account/guards';
import { teamQueries } from '~/features/team/queries';

/*
 * Everything in the frame (features/shell/AppFrame.tsx): the side panel beside Home, Calls, a call, the Drive, Record, Team and
 * Settings, for someone signed in, or signed in here while there's no connection. Whether there's a Team page (a company or a
 * team of your own) is asked as the frame opens, without waiting for it, so the side panel usually knows before it shows
 * and Team doesn't stand under Record for a moment for someone on their own.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, preload }) => requireAccount(context.queryClient, preload),
  loader: ({ context: { queryClient: qc } }) => {
    if (!navigator.onLine) return;
    void qc.prefetchQuery(teamQueries.team());
    void qc.prefetchQuery(teamQueries.myTeam());
  },
  component: Shell
});

function Shell() {
  const { account } = Route.useRouteContext();
  return <AppFrame account={account} />;
}
