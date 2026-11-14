/*
 * The team's data: the company directory and finding people in it, your own invite link and who an invite link is from, the
 * team you're on with its licenses and notes, and the changes to it. A team's change touches the plan too (a license decides
 * it), and joining or leaving one changes which notes and workspaces are yours to open.
 */
import type { MyTeam } from '@alcove/api';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { noteKeys } from '~/features/notes/queryKeys';
import { planKeys } from '~/features/plans/queryKeys';
import { workspaceKeys } from '~/features/workspace/queryKeys';
import { api } from '~/lib/api';
import { teamKeys } from './queryKeys';

export const teamQueries = {
  team: () => queryOptions({ queryKey: teamKeys.team, queryFn: () => api.people.team(), staleTime: 5 * 60_000 }),
  people: (query: string) => queryOptions({ queryKey: teamKeys.people(query), queryFn: () => api.people.search(query), staleTime: 30_000, placeholderData: (prev) => prev }),
  /**
   * Your own invite link, the same every time, and who joined Alcove from it: what Copy invite link copies and every
   * invitation carries. Only someone at a company has one, so it's asked for once the company is known.
   */
  inviteLink: () => queryOptions({ queryKey: teamKeys.inviteLink, queryFn: () => api.people.inviteLink(), staleTime: 60_000 }),
  /** Who an invite link is from, signed in or not. Asked once: a link that leads nowhere stays that way. */
  invitedBy: (secret: string) => queryOptions({ queryKey: teamKeys.invitedBy(secret), queryFn: () => api.people.peekInvite(secret), retry: false, staleTime: Infinity }),
  /** The team you're on, or null: its members and their licenses, and for its admin the licenses left. */
  myTeam: () => queryOptions({ queryKey: teamKeys.myTeam, queryFn: () => api.teams.mine(), staleTime: 60_000 }),
  /** The notes made visible to your team that you can open (a live license needed). */
  teamNotes: () => queryOptions({ queryKey: teamKeys.teamNotes, queryFn: () => api.teams.notes(), staleTime: 60_000 }),
  /** Whose team an invite's link joins, before joining. Asked once: a link that leads nowhere stays that way. */
  teamInvite: (secret: string) => queryOptions({ queryKey: teamKeys.teamInvite(secret), queryFn: () => api.teams.peek(secret), retry: false, staleTime: Infinity })
};

export function useInviteTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (emails: string[]) => api.people.inviteToTeam(emails), onSuccess: (t) => qc.setQueryData(teamKeys.team, t) });
}
/** Says the account just made came from someone's invite link, so they see it joined. Nothing of it is read back here. */
export function useJoinedByInvite() {
  return useMutation({ mutationFn: (secret: string) => api.people.joinedByInvite(secret) });
}

/** What a team's change touches: the team, its notes, and the plan (a license decides it). */
function teamChanged(qc: QueryClient) {
  for (const queryKey of [teamKeys.myTeam, planKeys.plan]) void qc.invalidateQueries({ queryKey });
}
/** A change that answers with the team as it is now: kept, and the plan read again. A refusal reads both again. */
function teamWrite<V>(qc: QueryClient, write: (v: V) => Promise<MyTeam>) {
  return {
    mutationFn: write,
    onSuccess: (t: MyTeam) => { qc.setQueryData(teamKeys.myTeam, t); void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true }); },
    onError: () => teamChanged(qc)
  };
}
/**
 * Says you're using Alcove: when the app opens signed in, and when a tab comes back after a long while away. On a team it
 * can take a license, so the plan, the team and what a license opens are read again after.
 */
export function useVisit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.auth.visit(),
    onSuccess: () => {
      teamChanged(qc);
      void qc.invalidateQueries({ queryKey: teamKeys.teamNotes });
    }
  });
}
export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, (name: string) => api.teams.create(name)));
}
/** A new one-time link to join the team. Shown once: it isn't kept anywhere. */
export function useTeamInvite() {
  return useMutation({ gcTime: 0, mutationFn: () => api.teams.invite() });
}
/** Joins the team an invite's link is for: the team, the plan, and everything a license opens are read again. */
export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (secret: string) => api.teams.join(secret),
    onSuccess: (t) => {
      qc.setQueryData(teamKeys.myTeam, t);
      for (const queryKey of [planKeys.plan, teamKeys.teamNotes, noteKeys.notes, workspaceKeys.workspaces]) void qc.invalidateQueries({ queryKey });
    },
    onError: () => teamChanged(qc)
  });
}
export function useRemoveTeamMember() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, (memberId: string) => api.teams.remove(memberId)));
}
/** Leaving, or deleting the team: there's no team after, so everything it opened is read again. */
function teamGone(qc: QueryClient) {
  qc.setQueryData(teamKeys.myTeam, null);
  qc.removeQueries({ queryKey: teamKeys.teamNotes });
  for (const queryKey of [planKeys.plan, noteKeys.notes, workspaceKeys.workspaces]) void qc.invalidateQueries({ queryKey });
}
export function useLeaveTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.teams.leave(), onSuccess: () => teamGone(qc), onError: () => teamChanged(qc) });
}
export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.teams.delete(), onSuccess: () => teamGone(qc), onError: () => teamChanged(qc) });
}
/** Buys licenses from the balance at the price shown. A refusal (a changed price, a short balance) reads the offers again too. */
export function useBuyLicenses() {
  const qc = useQueryClient();
  return useMutation({
    ...teamWrite(qc, ({ count, microUsdPerLicense }: { count: number; microUsdPerLicense: number }) => api.teams.buyLicenses(count, microUsdPerLicense)),
    onError: () => { void qc.invalidateQueries({ queryKey: teamKeys.myTeam }); void qc.invalidateQueries({ queryKey: planKeys.plan }); }
  });
}
export function useRefundLicenses() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, () => api.teams.refundLicenses()));
}
export function useSetAutoPurchase() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, (on: boolean) => api.teams.setAutoPurchase(on)));
}
