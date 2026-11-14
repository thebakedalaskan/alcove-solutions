/*
 * The team's data: the company directory and finding people in it, the invite link to copy and what a link says, the team
 * you're on with its people, invitations, licenses and notes, the invitations to you, and the changes to all of them. A
 * team's change touches the plan too (a license decides it, and the plan names the team), and joining or leaving one changes
 * which notes and workspaces are yours to open.
 */
import { errorCode, type InvitationForYou, type MyTeam } from '@alcove/api';
import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { noteKeys } from '~/features/notes/queryKeys';
import { planKeys } from '~/features/plans/queryKeys';
import { workspaceKeys } from '~/features/workspace/queryKeys';
import { api } from '~/lib/api';
import { log } from '~/lib/log';
import { holdAside, takeBack, withAside } from './invitations/aside';
import { teamKeys } from './queryKeys';

const tlog = log.child({ component: 'team' });

/** How often the invitations to you are read again while Alcove is open (and whenever its window comes back). */
const INVITATIONS_MS = 60_000;

export const teamQueries = {
  team: () => queryOptions({ queryKey: teamKeys.team, queryFn: () => api.people.team(), staleTime: 5 * 60_000 }),
  people: (query: string) => queryOptions({ queryKey: teamKeys.people(query), queryFn: () => api.people.search(query), staleTime: 30_000, placeholderData: (prev) => prev }),
  /**
   * The invite link Copy link copies: the team's (its admin's) while you're on a team, your own while you're on none. The same
   * every time until its admin makes a new one. Asked for through `useInviteLink`, which knows who has one.
   */
  inviteLink: () => queryOptions({ queryKey: teamKeys.inviteLink, queryFn: () => api.people.inviteLink(), staleTime: 60_000 }),
  /**
   * What a secret after /invite# says, signed in or not: an invitation's own link or a team's, who it's from, the team it
   * joins, and whether it's yours. Asked afresh each time, as who's signed in decides whether it's yours, and once: a link
   * that leads nowhere stays that way.
   */
  peek: (secret: string) => queryOptions({ queryKey: teamKeys.peek(secret), queryFn: () => api.people.peekInvite(secret), retry: false, staleTime: 0 }),
  /** The team you're on, or null: its members and their licenses, who's invited, and for its admin the licenses left. */
  myTeam: () => queryOptions({ queryKey: teamKeys.myTeam, queryFn: () => api.teams.mine(), staleTime: 60_000 }),
  /**
   * The invitations to your sign-in addresses, newest first, put aside or not (one put aside here, while Undo is offered,
   * says so before Alcove has been told: invitations/aside.ts). Nothing pushes a new one to an open tab, so they're read as
   * the app opens, every minute while it's open, and whenever its window comes back.
   */
  invitations: () => queryOptions({
    queryKey: teamKeys.invitations, queryFn: async () => withAside(await api.teams.invitations()), staleTime: 20_000, refetchInterval: INVITATIONS_MS, refetchOnWindowFocus: true
  }),
  /**
   * The notes made visible to your team that you can open (a live license needed). Their organizers turn that on and off
   * from their own windows, and nothing tells this one, so the list is read again whenever it's shown and whenever you come
   * back to the window, unless it was read in the last few seconds: what you see is never much older than your last look,
   * and going back and forth between two windows doesn't read it every time.
   */
  teamNotes: () => queryOptions({ queryKey: teamKeys.teamNotes, queryFn: () => api.teams.notes(), staleTime: 10_000, refetchOnWindowFocus: true })
};

/**
 * The invite link to copy, asked for only by someone who has one: with a company page or a team. It waits until both are
 * known.
 */
export function useInviteLink() {
  const company = useQuery(teamQueries.team()).data;
  const onTeam = useQuery(teamQueries.myTeam()).data;
  return useQuery({ ...teamQueries.inviteLink(), enabled: company !== undefined && onTeam !== undefined && (company !== null || onTeam !== null) });
}
/** A new invite link in place of the one there is: kept at once, so whatever copies it has the new one. */
export function useNewInviteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.people.newInviteLink(),
    onSuccess: async (made) => {
      // A read of the old link still on its way would put it back over the new one.
      await qc.cancelQueries({ queryKey: teamKeys.inviteLink });
      qc.setQueryData(teamKeys.inviteLink, made);
    }
  });
}

/** What a team's change touches: the team, and the plan (a license decides it). */
function teamChanged(qc: QueryClient) {
  for (const queryKey of [teamKeys.myTeam, planKeys.plan]) void qc.invalidateQueries({ queryKey });
}
/**
 * Whether a change was answered from what Alcove kept of it, made already by this same request (sent again after its answer
 * was lost): the same shape, with every name and address blank, the team's name too, which is never blank otherwise.
 */
const replayed = (t: MyTeam): boolean => t.name === '';
/**
 * The team a change answered with, read again when that answer names nobody (`replayed`), so no blank name is kept or said.
 * Should that read fail, the answer stands, and `keep` has the team read again later.
 */
async function named(t: MyTeam): Promise<MyTeam> {
  if (!replayed(t)) return t;
  try {
    return (await api.teams.mine()) ?? t;
  } catch (e) {
    tlog.info('the team wasn’t read again after a change answered from its receipt', { code: errorCode(e) });
    return t;
  }
}
/** Keeps the team a change answered with, unless it still names nobody: then it's read again instead. */
function keep(qc: QueryClient, t: MyTeam) {
  if (replayed(t)) void qc.invalidateQueries({ queryKey: teamKeys.myTeam });
  else qc.setQueryData(teamKeys.myTeam, t);
}
/**
 * A change that answers with the team as it is now: kept, and the plan read again, with the company directory when who's
 * invited may have changed (`invites`). A refusal reads the team and the plan again.
 */
function teamWrite<V>(qc: QueryClient, write: (v: V) => Promise<MyTeam>, invites = false) {
  return {
    mutationFn: async (v: V) => named(await write(v)),
    onSuccess: (t: MyTeam) => {
      keep(qc, t);
      void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true });
      if (invites) void qc.invalidateQueries({ queryKey: teamKeys.team });
    },
    onError: () => teamChanged(qc)
  };
}
/** On a team now, by an invitation or a link: everything a team decides is read again, and the invite link is the team's. */
function joined(qc: QueryClient, t: MyTeam) {
  keep(qc, t);
  for (const queryKey of [planKeys.plan, teamKeys.invitations, teamKeys.team, teamKeys.inviteLink, teamKeys.teamNotes, noteKeys.notes, workspaceKeys.workspaces]) {
    void qc.invalidateQueries({ queryKey });
  }
}
/** No team after this: everything it opened is read again, and so are the link and the directory's invitations. */
function teamGone(qc: QueryClient) {
  qc.setQueryData(teamKeys.myTeam, null);
  qc.removeQueries({ queryKey: teamKeys.teamNotes });
  for (const queryKey of [planKeys.plan, teamKeys.team, teamKeys.inviteLink, noteKeys.notes, workspaceKeys.workspaces]) void qc.invalidateQueries({ queryKey });
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
/** Starts a team, free, with you its admin. */
export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    ...teamWrite(qc, (name: string) => api.teams.create(name)),
    onSuccess: (t: MyTeam) => {
      keep(qc, t);
      for (const queryKey of [planKeys.plan, teamKeys.inviteLink]) void qc.invalidateQueries({ queryKey });
    }
  });
}
export function useRenameTeam() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, (name: string) => api.teams.rename(name)));
}
/**
 * Invites these addresses to your team (making it first when you're on none): the team as it is now is kept, and the
 * directory and the plan, which name it, are read again.
 */
export function useInviteToTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (emails: string[]) => {
      const made = await api.teams.invite(emails);
      return { ...made, team: await named(made.team) };
    },
    onSuccess: (made) => {
      keep(qc, made.team);
      for (const queryKey of [teamKeys.team, teamKeys.inviteLink]) void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({ queryKey: planKeys.plan, exact: true });
    },
    onError: () => teamChanged(qc)
  });
}
export function useResendInvitation() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, (id: string) => api.teams.resendInvitation(id)));
}
export function useCancelInvitation() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, (id: string) => api.teams.cancelInvitation(id), true));
}
/**
 * Accepts an invitation to one of your addresses; `leave` once you've said, in place, to leave the team you're on. One put
 * aside here a moment ago, Alcove not told yet, is simply joined.
 */
export function useAcceptInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, leave }: { id: string; leave: boolean }) => { takeBack(id); return named(await api.teams.acceptInvitation(id, leave)); },
    onSuccess: (t) => joined(qc, t),
    onError: () => { teamChanged(qc); void qc.invalidateQueries({ queryKey: teamKeys.invitations }); }
  });
}
/** Joins the team a secret after /invite# leads to: an invitation's own link, or a team's. */
export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ secret, leave }: { secret: string; leave: boolean }) => named(await api.teams.join(secret, leave)),
    onSuccess: (t) => joined(qc, t),
    onError: () => teamChanged(qc)
  });
}
/**
 * Not now, with Undo (invitations/aside.ts): `aside` puts an invitation aside here at once, out of your count, and tells
 * Alcove once Undo has had its moment, then reads the list again; if Alcove refuses, it's waiting again and `failed` says
 * why. `undo` takes it back while it's still only here (false once Alcove has been told).
 */
export function useNotNow() {
  const qc = useQueryClient();
  const key = teamQueries.invitations().queryKey;
  const mark = (id: string, putAside: boolean) => qc.setQueryData(key, (list: InvitationForYou[] | undefined) => list?.map((i) => (i.id === id ? { ...i, putAside } : i)));
  return {
    aside: (id: string, failed: (e: unknown) => void) => {
      void qc.cancelQueries({ queryKey: key });
      mark(id, true);
      holdAside(id, () => api.teams.putInvitationAside(id).then(
        () => { void qc.invalidateQueries({ queryKey: key }); },
        (e: unknown) => { mark(id, false); void qc.invalidateQueries({ queryKey: key }); failed(e); }
      ));
    },
    undo: (id: string): boolean => {
      if (!takeBack(id)) return false;
      mark(id, false);
      return true;
    }
  };
}
/** Stops Alcove's invitation emails to the address a token after /stop-email# was sent to. The same answer for any token. */
export function useStopEmails() {
  return useMutation({ mutationFn: (token: string) => api.people.stopEmails(token) });
}
/**
 * A member of a free team asks its admin to upgrade it. Refused (the team changed: it's on Team now, say, or you're its admin
 * or off it), the team and the plan are read again, so the page says what's true.
 */
export function useAskToUpgrade() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.teams.askToUpgrade(), onError: () => teamChanged(qc) });
}
/** Takes someone off the team. It makes the team a new invite link, so the link is read again with the team. */
export function useRemoveTeamMember() {
  const qc = useQueryClient();
  const write = teamWrite(qc, (memberId: string) => api.teams.remove(memberId), true);
  return useMutation({
    ...write,
    onSuccess: (t: MyTeam) => {
      write.onSuccess(t);
      void qc.invalidateQueries({ queryKey: teamKeys.inviteLink });
    }
  });
}
export function useLeaveTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.teams.leave(), onSuccess: () => teamGone(qc), onError: () => teamChanged(qc) });
}
export function useDeleteTeam() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => api.teams.delete(), onSuccess: () => teamGone(qc), onError: () => teamChanged(qc) });
}
export function useRefundLicenses() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, () => api.teams.refundLicenses()));
}
export function useSetAutoPurchase() {
  const qc = useQueryClient();
  return useMutation(teamWrite(qc, (on: boolean) => api.teams.setAutoPurchase(on)));
}
