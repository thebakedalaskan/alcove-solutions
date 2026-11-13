/*
 * Calls: every call, ahead and past, with the calendar's meetings and the series they make (features/calls/list). Its
 * address says which place is open and what the scheduler starts from, and nothing else: no words, names or addresses
 * (features/calls/list/address.ts).
 */
import { createFileRoute } from '@tanstack/react-router';
import { CallsPage } from '~/features/calls/list/CallsPage';
import { readCallsSearch } from '~/features/calls/list/address';
import { q } from '~/lib/queries';

export const Route = createFileRoute('/_app/calls/')({
  validateSearch: readCallsSearch,
  /*
   * The calls ahead and past come up with the page. Google can be slow: the calendar gets a moment, so the list doesn't
   * change under the reader, and no longer.
   */
  loader: async ({ context: { queryClient: qc } }) => {
    const calendar = qc.ensureQueryData(q.calendar()).catch(() => undefined);
    await Promise.all([
      qc.ensureQueryData(q.notes()), qc.ensureQueryData(q.upcoming()), qc.ensureQueryData(q.inbox()), qc.ensureQueryData(q.prefs()),
      Promise.race([calendar, new Promise((r) => setTimeout(r, 1200))])
    ]);
  },
  component: Calls
});

function Calls() {
  return <CallsPage search={Route.useSearch()} />;
}
