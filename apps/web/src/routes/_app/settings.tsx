/*
 * Settings (features/settings/SettingsPage.tsx): seven groups of panels under you on the horizon. Google's way back says what it
 * connected (`?calendar=`, `?drive=`), and the page lands on it.
 */
import { CalendarConnectResultSchema, DriveConnectResultSchema, type CalendarConnectResult, type DriveConnectResult } from '@alcove/api';
import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '~/features/settings/SettingsPage';
import { accountQueries } from '~/features/account/queries';
import { calendarQueries } from '~/features/calls/scheduling/queries';
import { planQueries } from '~/features/plans/queries';
import { teamQueries } from '~/features/team/queries';

export const Route = createFileRoute('/_app/settings')({
  validateSearch: (search: Record<string, unknown>): { calendar?: CalendarConnectResult | undefined; drive?: DriveConnectResult | undefined } => {
    const calendar = CalendarConnectResultSchema.safeParse(search['calendar']);
    const drive = DriveConnectResultSchema.safeParse(search['drive']);
    return { calendar: calendar.success ? calendar.data : undefined, drive: drive.success ? drive.data : undefined };
  },
  // A panel that doesn't load leaves the rest of the page (and Sign out) usable. Google can be slow: the calendar gets a
  // moment, so the page doesn't move under the reader, and no longer.
  loader: async ({ context: { queryClient: qc } }) => {
    const calendar = qc.ensureQueryData(calendarQueries.calendar()).catch(() => undefined);
    // On a team, Plan says whose and (to its admin) the licenses: the team comes with the plan.
    const plan = qc.ensureQueryData(planQueries.plan()).then((p) => (p.team ? qc.ensureQueryData(teamQueries.myTeam()) : null));
    await Promise.allSettled([qc.ensureQueryData(accountQueries.prefs()), plan, qc.ensureQueryData(teamQueries.team()), Promise.race([calendar, new Promise((r) => setTimeout(r, 1200))])]);
  },
  component: Settings
});

function Settings() {
  const { calendar, drive } = Route.useSearch();
  return <SettingsPage calendar={calendar} drive={drive} />;
}
