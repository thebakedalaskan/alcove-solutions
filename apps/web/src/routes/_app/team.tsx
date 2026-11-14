/*
 * Team (features/team/TeamPage.tsx): your company standing on the horizon, your groups and the people not on Alcove yet under
 * the water. Someone on their own has no team, so no Team page: nothing links here, and its address goes Home.
 */
import { GroupParamSchema } from '@alcove/api';
import { createFileRoute } from '@tanstack/react-router';
import { OpenHost } from '~/features/team/open';
import { TeamPage } from '~/features/team/TeamPage';
import { accountQueries } from '~/features/account/queries';
import { noteQueries } from '~/features/notes/queries';
import { teamQueries } from '~/features/team/queries';

export const Route = createFileRoute('/_app/team')({
  /** `group`: one of your groups to show open (from its tile, or the address), or NEW_GROUP to make one. */
  validateSearch: (s: Record<string, unknown>): { group?: string | undefined } => {
    const g = GroupParamSchema.safeParse(s['group']);
    return { group: g.success ? g.data : undefined };
  },
  /*
   * The team gets a moment, so it comes up with the page, and no longer: from your calendar it can take seconds, and
   * empty arches wait on the line until it's here. Your invite link follows it, once there's a company to invite people
   * to, so an invitation opened from the page has it. Your groups and notes load beside them, as Settings' parts do: if the
   * team or one of them doesn't load, the page says so where it would have been and the rest stays usable.
   */
  loader: async ({ context: { queryClient: qc } }) => {
    if (!navigator.onLine) return;
    const team = qc.ensureQueryData(teamQueries.team());
    await Promise.race([
      Promise.allSettled([
        team, team.then((t) => (t ? qc.ensureQueryData(teamQueries.inviteLink()) : null)),
        qc.ensureQueryData(teamQueries.myTeam()), qc.ensureQueryData(accountQueries.prefs()), qc.ensureQueryData(noteQueries.notes())
      ]),
      new Promise((r) => setTimeout(r, 1200))
    ]);
  },
  component: Team
});

function Team() {
  const { group } = Route.useSearch();
  return <OpenHost><TeamPage group={group} /></OpenHost>;
}
