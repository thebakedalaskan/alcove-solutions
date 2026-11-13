/*
 * How your plan stands now, as the side panel's foot, Settings › Plan, Plans and the doors say it (docs: Plans and usage;
 * docs/design/pages.md › The frame and › Settings): the time of notes left, whether Pro is about to end, a team's licenses,
 * and which of the plan's notices still say something true. What a purchase is and costs is purchase.ts's. Every number is
 * the server's.
 */
import type { MyTeam, Person, Plan, PlanKind, PlanNotice, PlanOffers, TeamMember, WorkspaceSummary } from '@alcove/api';
import { daysFromToday, hoursAndMinutes } from '~/lib/time';

export const PLAN_NAMES: Record<PlanKind, string> = { free: 'Free', pro: 'Pro', team: 'Team' };


/** Whether the period's notes have run out: they stop until it renews, or until more are bought. */
export const notesOut = (plan: Plan): boolean => plan.notes.stopped || plan.notes.minutesLeft <= 0;
/** Under an hour of notes left, and not out: the time turns warm. */
export const notesLow = (plan: Plan): boolean => !notesOut(plan) && plan.notes.minutesLeft < 60;
/** "1 h 26 min", "24 min": about how much of the period's notes is left (said with About, since it's an estimate). */
export const notesLeft = (plan: Plan): string => hoursAndMinutes(plan.notes.minutesLeft);
/** How much of the period's notes is left, 0 to 1, for the meter and the sun on its line. */
export const notesShare = (plan: Plan): number => (plan.notes.minutesPerPeriod > 0 ? Math.min(1, plan.notes.minutesLeft / plan.notes.minutesPerPeriod) : 0);

/**
 * Whether renewing from the balance will buy the next month of Pro, as the server would decide now (`pro.renewal`): it's on,
 * the balance has a month's price, and a month costs no more than the last did.
 */
export const renews = (plan: Plan): boolean => plan.pro.renewal === 'buys';

/** Pro about to end: when, and how many days away by the calendar (0 is today). */
export interface ProEnding { until: string; days: number }

/**
 * Whether Pro is about to end: the one rule Plans, the side panel's foot and Settings › Plan say "ending" by. Pro is ending
 * while a pro-ending notice's `until` is the end Pro has now (`plan.pro.until`), unless renewing will buy the next month
 * (`renews`): once Pro is extended, or renewing will keep it, the notice no longer says anything true. A month that costs
 * more than the last did isn't renewed, so after a price rise Pro is ending, said the moment its owner is told. Null
 * otherwise.
 */
export function proEnding(plan: Plan, now = Date.now()): ProEnding | null {
  const until = plan.pro.until;
  if (plan.kind !== 'pro' || until === null || renews(plan)) return null;
  const warned = plan.notices.some((n) => n.kind === 'pro-ending' && n.until !== null && Date.parse(n.until) === Date.parse(until));
  return warned ? { until, days: Math.max(0, daysFromToday(new Date(until), new Date(now))) } : null;
}
/** "Ends today", "Ends tomorrow", "Ends in 6 days": how soon Pro ends, from `proEnding`'s days. */
export const endsIn = (days: number): string => (days <= 0 ? 'Ends today' : days === 1 ? 'Ends tomorrow' : `Ends in ${days} days`);

/**
 * Whether you're on a team without a live license: none was left for you, so you're on your own plan until its admin buys
 * more and you next open Alcove. Settings › Plan and the side panel's foot say so for as long as it's true, so a
 * `license-needed` notice is never shown as a notice of its own.
 */
export const waitingForLicense = (plan: Plan): boolean => plan.team !== null && !plan.team.licensed;

/** A team's admin told its licenses are short: few left, or none when someone needed one. */
export const licensesShort = (n: PlanNotice): boolean => n.kind === 'licenses-low' || n.kind === 'licenses-none';

/**
 * Whether a notice says you pay for a workspace now: whoever paid for it isn't in it any more, and it moved to you, one of
 * its admins. Only these name something of yours that the plan doesn't know, so only these need the workspaces you're in.
 */
export const payingNow = (n: PlanNotice): boolean => n.kind === 'workspace-payer';
/**
 * The workspace a notice that you pay for one now is about, as you see it among the workspaces you're in (`spaces`): its
 * name is said only from there, never kept with the plan. Undefined until they're read, or once you're not in it.
 */
export const paidFor = (n: PlanNotice, spaces: WorkspaceSummary[] | undefined): (WorkspaceSummary & { name: string }) | undefined => {
  const found = n.workspaceId === null ? undefined : spaces?.find((s) => s.id === n.workspaceId);
  return found && found.name !== null ? { ...found, name: found.name } : undefined;
};

/**
 * The plan's notices that still say something true, newest first, each kind once (its newest): the one rule Settings ›
 * Plan shows them by and the side panel's foot picks from. Pro renewed while on Pro; Pro ended while on Free. For a team's
 * admin with a license (without one, waiting for it says it): licenses low until more are bought (none bought since, so no
 * more are left than it counted), and none left while none is, said instead of low. A team license replacing Pro, while
 * on Team. That you pay for a workspace now, once for each workspace, while its files don't count against your storage yet
 * and you're still in it (`spaces`, the workspaces you're in, once they're read: its name is said from there). `team` is
 * the team as `teams.mine` gives it, once it's known.
 */
export function noticesNow(plan: Plan, team?: MyTeam | null | undefined, spaces?: WorkspaceSummary[] | undefined, now = Date.now()): PlanNotice[] {
  const admin = plan.team?.role === 'admin' && !waitingForLicense(plan);
  const left = team?.licenses?.unconsumed;
  const none = admin && (left === undefined || left === 0) && plan.notices.some((n) => n.kind === 'licenses-none');
  const holds = (n: PlanNotice): boolean => {
    switch (n.kind) {
      case 'pro-renewed': return plan.kind === 'pro';
      case 'pro-ended': return plan.kind === 'free';
      case 'licenses-low': return admin && !none && (left === undefined || left <= (n.count ?? 0));
      case 'licenses-none': return none;
      case 'license-replaced-pro': return plan.kind === 'team';
      case 'workspace-payer': return (n.until === null || Date.parse(n.until) > now) && paidFor(n, spaces) !== undefined;
      case 'pro-ending': case 'license-needed': return false;
    }
  };
  const said = new Set<string>();
  return plan.notices.filter((n) => {
    const key = sameAs(n);
    if (!holds(n) || said.has(key)) return false;
    said.add(key);
    return true;
  });
}
/** What makes two notices say the same thing: their kind, and for a workspace you pay for now, which workspace. */
const sameAs = (n: PlanNotice): string => (payingNow(n) ? `${n.kind}:${n.workspaceId ?? ''}` : n.kind);
/** Every notice that says what `n` says, so dismissing the one shown dismisses those it stood for too. */
export const noticesLike = (plan: Plan, n: PlanNotice): string[] => plan.notices.filter((m) => sameAs(m) === sameAs(n)).map((m) => m.id);

/** How many licenses a short notice is about: how many are left now, once the team is known, else as many as it counted. */
export const licensesLeft = (n: PlanNotice, team: MyTeam | null | undefined): number => team?.licenses?.unconsumed ?? (n.kind === 'licenses-low' ? n.count ?? 0 : 0);

/** A team's admin, as `teams.mine` lists them. */
export const teamAdmin = (team: MyTeam | null | undefined): Person | undefined => team?.members.find((m) => m.role === 'admin')?.person;

/** A team's licenses: how many are left to take, of how many are running or left, and who's waiting for one. */
export interface TeamLicenses { left: number; of: number; waiting: TeamMember[] }
/**
 * A team's licenses as its admin sees them (null for a member): how many are left to take, of how many are running or left,
 * and who needed one when none was left and is waiting for one still.
 */
export function teamLicenses(team: MyTeam): TeamLicenses | null {
  if (!team.licenses) return null;
  const left = team.licenses.unconsumed;
  return {
    left, of: left + team.members.filter((m) => m.license.state === 'live').length,
    waiting: team.members.filter((m) => m.license.state !== 'live' && m.license.wanted !== null)
  };
}

/**
 * About how many minutes of notes the next period brings: Free's once Pro's last month is over; a team license's when it's
 * next taken; else the plan's own.
 */
export function nextPeriodMinutes(plan: Plan, offers: PlanOffers | undefined): number {
  if (!offers) return plan.notes.minutesPerPeriod;
  if (plan.kind === 'free') return offers.free.notesMinutes;
  if (plan.kind === 'team') return offers.team.notesMinutes;
  const lastMonth = plan.pro.until === null || Date.parse(plan.pro.until) <= Date.parse(plan.period.to) + 60_000;
  return lastMonth && !renews(plan) ? offers.free.notesMinutes : offers.pro.notesMinutes;
}
