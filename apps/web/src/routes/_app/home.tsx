/*
 * Home (features/home/HomePage.tsx): starting a call in the middle of a sunset, with For you, Upcoming and Recent notes under
 * the horizon, or once, the plans in its place. Google sends you back here after connecting the calendar from Upcoming
 * (`?calendar=`, which Home reads once and drops).
 */
import { CalendarConnectResultSchema, type CalendarConnectResult } from '@alcove/api';
import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '~/features/home/HomePage';
import { planChoiceReady } from '~/features/plans/choice';
import { accountQueries } from '~/features/account/queries';
import { callQueries } from '~/features/calls/list/queries';
import { calendarQueries } from '~/features/calls/scheduling/queries';
import { noteQueries } from '~/features/notes/queries';

export const Route = createFileRoute('/_app/home')({
  validateSearch: (search: Record<string, unknown>): { calendar?: CalendarConnectResult | undefined } => {
    const calendar = CalendarConnectResultSchema.safeParse(search['calendar']);
    return { calendar: calendar.success ? calendar.data : undefined };
  },
  loader: async ({ context: { queryClient: qc } }) => {
    const calendar = qc.ensureQueryData(calendarQueries.calendar()).catch(() => undefined);
    await Promise.all([
      qc.ensureQueryData(callQueries.upcoming()), qc.ensureQueryData(noteQueries.notes()), qc.ensureQueryData(accountQueries.prefs()),
      // What's waiting on you can fail on its own: For you says so, and the rest of Home still works.
      qc.ensureQueryData(noteQueries.inbox()).catch(() => undefined),
      // Google can be slow: the calendar gets a moment, so the list doesn't change under the reader, and no longer.
      Promise.race([calendar, new Promise((r) => setTimeout(r, 1200))]),
      // Whether the plans come first, known as Home opens, with their prices when they do.
      planChoiceReady(qc)
    ]);
  },
  component: HomeRoute
});

function HomeRoute() {
  const { calendar } = Route.useSearch();
  return <HomePage calendar={calendar} />;
}
