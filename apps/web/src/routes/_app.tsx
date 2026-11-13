import { createFileRoute } from '@tanstack/react-router';
import { AppFrame } from '~/features/shell/AppFrame';
import { requireAccount } from '~/features/account/guards';

/*
 * Everything in the frame (features/shell/AppFrame.tsx): the side panel beside Home, Calls, a call, the Drive, Record, Team and
 * Settings, for someone signed in, or signed in here while there's no connection.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: ({ context, preload }) => requireAccount(context.queryClient, preload),
  component: Shell
});

function Shell() {
  const { account } = Route.useRouteContext();
  return <AppFrame account={account} />;
}
