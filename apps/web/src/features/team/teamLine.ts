/*
 * A team's people as its page says them (OnTeam.tsx): each one's license, or when they joined, in a word under their arch
 * and in a line on their row; and who stands on its horizon. The team stands first (you, its admin, then everyone else, as
 * many as fit), with an empty arch for the rest; then whoever's invited, in dashed arches; then, on your company's team, the
 * colleagues not on it, further back. So the horizon never empties when a company's page becomes its team's.
 */
import type { MyTeam, TeamInvitation, TeamMember } from '@alcove/api';
import type { TeamLicenseTone, TeamLinePerson } from '@alcove/ui';
import { waitsForLicense } from '~/features/plans/planState';
import { callName } from '~/lib/people';
import { dayMonth, daysFromToday } from '~/lib/time';
import { listed, type Member } from './data';

/** The most of the team who stand on the horizon: the rest are an empty arch at the end of them, and every one of them is a row. */
const MEMBERS = 10;
/** The most of those invited who stand after them, and of the colleagues not on it who stand further back. */
const INVITED = 6;
const BACK = 6;
/** A place on the line, its gap, and how much of a place someone further back takes (team-plan.css: --tq-slot, --tq-gap). */
const SLOT = 72;
const GAP = 12;
const BACK_K = 0.8;

/** A license as the page says it, in one word of tone: live, waiting for one (none was left), ended, or never had one. */
export function toneOf(m: TeamMember): TeamLicenseTone {
  if (m.license.state === 'live') return 'live';
  if (waitsForLicense(m)) return 'waiting';
  return m.license.state;
}
/** "12 Dec": until when someone's license runs, or nothing. */
export const until = (m: TeamMember): string => (m.license.until === null ? '' : dayMonth(new Date(m.license.until)));
const today = (m: TeamMember, now: Date): boolean => daysFromToday(new Date(m.joinedAt), now) === 0;
/** "Joined today", "Joined yesterday", "Joined 2 Nov"; for the admin, who started the team, "Started today" and so on. */
export function joinedOn(m: TeamMember, now: Date): string {
  const word = m.role === 'admin' ? 'Started' : 'Joined';
  const days = -daysFromToday(new Date(m.joinedAt), now);
  return days <= 0 ? `${word} today` : days === 1 ? `${word} yesterday` : `${word} ${dayMonth(new Date(m.joinedAt))}`;
}

/**
 * Under someone's arch on Team: "Until 12 Dec", "Waiting", "Ended", "From next visit" (one is left for them, as just after
 * upgrading), "No license yet"; on Free, "Joined today" (or "Started today") or nothing.
 */
export function shortLine(m: TeamMember, team: MyTeam, now: Date, left: number | null): string | undefined {
  if (team.tier === 'free') return today(m, now) ? joinedOn(m, now) : undefined;
  switch (toneOf(m)) {
    case 'live': return until(m) ? `Until ${until(m)}` : 'Licensed';
    case 'waiting': return 'Waiting';
    case 'ended': return 'Ended';
    case 'none': return today(m, now) ? joinedOn(m, now) : left !== null && left > 0 ? 'From next visit' : 'No license yet';
  }
}
/**
 * On someone's row: on Team, their license ("Licensed until 12 Dec", "Waiting for a license", "License ended 9 Nov. A new one
 * is taken when they next open Alcove."), after "Joined today" for someone new; on Free, when they joined, or for the admin
 * when they started it.
 */
export function rowLine(m: TeamMember, team: MyTeam, now: Date, left: number | null): string {
  if (team.tier === 'free') return joinedOn(m, now);
  const license = (() => {
    switch (toneOf(m)) {
      case 'live': return until(m) ? `Licensed until ${until(m)}` : 'Licensed';
      case 'waiting': return 'Waiting for a license';
      case 'ended': return `License ended${until(m) ? ` ${until(m)}` : ''}. A new one is taken when ${m.you ? 'you' : 'they'} next open Alcove.`;
      // Licenses bought and not taken yet, as just after upgrading: theirs is taken as they next open Alcove.
      case 'none': return left !== null && left > 0 ? `A license is taken the next time ${m.you ? 'you open' : 'they open'} Alcove` : 'No license yet';
    }
  })();
  return today(m, now) ? `${joinedOn(m, now)} · ${license}` : license;
}

/** You first, then the team's admin, then everyone else as the team lists them. */
export const inOrder = (members: readonly TeamMember[]): TeamMember[] =>
  [...members].sort((a, b) => Number(b.you) - Number(a.you) || Number(b.role === 'admin') - Number(a.role === 'admin'));

/** Who an arch on the team's horizon is: someone on it, someone invited to it, or a colleague not on it. */
export type Standing = { kind: 'member'; member: TeamMember } | { kind: 'invited'; invitation: TeamInvitation } | { kind: 'colleague'; colleague: Member };

/** The team's horizon: who stands on it, how many more of the team there are, and how wide it is in places (`--tq-n`). */
export interface TeamHorizon { people: TeamLinePerson[]; who: ReadonlyMap<string, Standing>; more: number; places: number }

/**
 * Who stands on a team's horizon: the team (`people`, in the page's order) up to ten, an empty arch for the rest; then up to
 * six of those invited (`invited`, in the order the page lists them), each "Invited" under a dashed arch; then up to six of
 * `colleagues`, further back.
 */
export function horizonOf(team: MyTeam, people: readonly TeamMember[], invited: readonly TeamInvitation[], colleagues: readonly Member[], now: Date, left: number | null): TeamHorizon {
  const who = new Map<string, Standing>();
  const free = team.tier === 'free';
  const standing = people.slice(0, MEMBERS).map((m): TeamLinePerson => {
    who.set(m.id, { kind: 'member', member: m });
    return {
      key: m.id, person: m.person, name: m.you ? 'You' : callName(m.person), license: shortLine(m, team, now, left), tone: free ? 'none' : toneOf(m),
      label: m.you ? `You, ${m.person.name}` : m.person.name
    };
  });
  const asked = invited.slice(0, INVITED).map((i): TeamLinePerson => {
    const key = `invited ${i.id}`;
    who.set(key, { kind: 'invited', invitation: i });
    return { key, person: i.person, name: callName(i.person), license: 'Invited', tone: 'none', ghost: true, label: `${listed(i.person)}, invited` };
  });
  const back = colleagues.slice(0, BACK).map((c): TeamLinePerson => {
    const key = `colleague ${c.person.email}`;
    who.set(key, { kind: 'colleague', colleague: c });
    return { key, person: c.person, name: callName(c.person), tone: 'none', ghost: !c.onAlcove, back: true, label: `${listed(c.person)}, not on ${team.name}` };
  });
  const more = people.length - standing.length;
  const front = standing.length + (more > 0 ? 1 : 0) + asked.length;
  const width = front * SLOT + back.length * SLOT * BACK_K + Math.max(0, front + back.length - 1) * GAP + (back.length && front ? GAP : 0);
  return { people: [...standing, ...asked, ...back], who, more, places: (width + GAP) / (SLOT + GAP) };
}
