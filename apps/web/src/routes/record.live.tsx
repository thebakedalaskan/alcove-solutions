import { createFileRoute } from '@tanstack/react-router';
import { LiveRecordPage } from '~/features/record/LiveRecordPage';
import { ownerOf, requireAccount } from '~/features/account/guards';
import { accountQueries } from '~/features/account/queries';

/*
 * The stage recorder (features/record/LiveRecordPage.tsx): one microphone on the table, no call, with or without a connection.
 * Record (/record) names the recording and opens this screen, handing the name over in memory, never in the address.
 */
export const Route = createFileRoute('/record/live')({
  beforeLoad: ({ context, preload }) => requireAccount(context.queryClient, preload),
  // Whether this account records without a connection is read first, when it can be (lib/device.ts remembers it).
  loader: async ({ context }) => { if (navigator.onLine) await context.queryClient.ensureQueryData(accountQueries.prefs()).catch(() => undefined); },
  component: RecordLive
});

function RecordLive() {
  const { account } = Route.useRouteContext();
  return <LiveRecordPage owner={ownerOf(account)} />;
}
