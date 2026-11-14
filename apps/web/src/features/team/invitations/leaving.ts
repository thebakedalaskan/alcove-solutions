/*
 * Joining a team while you're on another (the design's 4.6): one team at a time, so joining asks in place first. A member
 * leaves the team they're on; its admin, alone on it, deletes it; its admin with others on it can't join until they're the
 * only one left. What the question says, from the team you're on now (`teams.mine`). When the two teams have the same name
 * (two teams at one company), the one you'd join is named by who invited you, and yours is "yours".
 */
import type { MyTeam, Person } from '@alcove/api';
import { teamAdmin } from '~/features/plans/planState';
import { callName } from '~/lib/people';
import { plural, usd } from '~/lib/words';

/** What joining another team does to the one you're on. */
export type Leaving =
  | { kind: 'none' }
  | { kind: 'member'; team: MyTeam }
  | { kind: 'alone'; team: MyTeam }
  | { kind: 'blocked'; team: MyTeam; others: number };

export function leavingOf(mine: MyTeam | null | undefined): Leaving {
  if (!mine) return { kind: 'none' };
  if (mine.role !== 'admin') return { kind: 'member', team: mine };
  const others = mine.members.filter((m) => !m.you).length;
  return others === 0 ? { kind: 'alone', team: mine } : { kind: 'blocked', team: mine, others };
}

/** The team joining would put you on: its name, and who invited you to it (or whose link it is). */
export interface Joinable { name: string; from: Person }

/** The question asked in place of Join, before leaving (or deleting) the team you're on to join another. */
export interface LeaveAsk { title: string; text: string; confirm: string; keep: string }

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function leaveAsk(l: Leaving, joining: Joinable): LeaveAsk | null {
  if (l.kind !== 'member' && l.kind !== 'alone') return null;
  const twins = same(l.team.name, joining.name);
  const there = twins ? `${callName(joining.from)}’s ${joining.name}` : joining.name;
  if (l.kind === 'member') {
    const admin = teamAdmin(l.team);
    const yours = twins ? (admin ? `${callName(admin)}’s` : 'the one you’re on') : l.team.name;
    return {
      title: `Joining ${there} takes you off ${yours}.`,
      text: l.team.licensed ? `Your license on ${l.team.name} isn’t refunded, and notes you made visible to it stay visible.` : `Notes you made visible to ${l.team.name} stay visible to it.`,
      confirm: twins ? (admin ? `Leave ${callName(admin)}’s and join` : 'Leave it and join') : `Leave ${l.team.name} and join`, keep: 'Stay'
    };
  }
  const back = l.team.licenses?.refundableMicroUsd ?? 0;
  return {
    title: `Joining ${there} deletes ${twins ? 'yours' : l.team.name}, which only you are on, and its invitations.`,
    text: back > 0 ? `The licenses nobody took go back to your balance: ${usd(back)}.` : 'Its workspaces stop being the team’s.',
    confirm: `Delete ${twins ? 'yours' : l.team.name} and join`, keep: 'Stay'
  };
}
/** Why you can't join yet, in place of Join: you admin a team others are on. */
export function cantJoin(l: Leaving, joining: string): string | null {
  if (l.kind !== 'blocked') return null;
  return `You admin ${l.team.name}, and ${plural(l.others, 'other is', 'others are')} on it. You can join ${joining} once you’re the only one left.`;
}
