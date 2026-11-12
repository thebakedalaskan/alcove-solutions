/*
 * A team in the demo world (docs: Plans and usage › Team): Vandelay's, with its admin, its members and their licenses, the
 * licenses bought and not yet taken, and the notes its members made visible to it. Art is on it as its admin or as a
 * member, or has an invite's link to open. The plan follows the license: on Team while Art's is live, otherwise Free with
 * the team named. Made up, as everything in the demo world is.
 */
import type { MyTeam, Note, Person, Plan, PlanNotice, TeamMember, TeamRole } from '@alcove/api';
import { writeNote } from './build';
import { iso, on } from './clock';
import { AIKO, ART, COMPANY, INES, KOFI, MAYA, PRIYA } from './people';
import { FREE, LICENSE_PRICE, NO_PRO, PERIOD_MS, TEAM } from './plans';

const GiB = 2 ** 30;

/** Someone on the team, as the world keeps them: when their license runs, and when they last needed one. */
export interface TeamMemberWorld {
  id: string;
  person: Person;
  role: TeamRole;
  /** The license taken last, or null if they've never had one. */
  license: { from: string; until: string } | null;
  wanted: string | null;
  joinedAt: string;
}
export interface TeamWorld {
  id: string;
  name: string;
  members: TeamMemberWorld[];
  /** What each license bought and not yet taken cost. */
  unconsumed: number[];
  autoPurchase: boolean;
  /** Whether the admin has been told the licenses are low, until there are 5 or more again. */
  lowSaid: boolean;
  /** Notes other members made visible to the team, as they read for Art. */
  notes: Note[];
  /** What the licensed members store, together. */
  usedBytes: number;
}
/** A link to join a team: its secret, until when it works, and the team. */
export interface TeamInviteWorld { secret: string; expiresAt: string; team: TeamWorld; admin: Person }

/** Below this many unconsumed licenses the admin is told. */
export const LOW_LICENSES = 5;
/** How long an invite's link works. */
export const INVITE_MS = 86_400_000;

export const isLive = (m: TeamMemberWorld, now = Date.now()): boolean => m.license !== null && Date.parse(m.license.until) > now;
export const meOn = (t: TeamWorld, email: string): TeamMemberWorld | undefined => t.members.find((m) => m.person.email === email);
export const adminOf = (t: TeamWorld): TeamMemberWorld | undefined => t.members.find((m) => m.role === 'admin');
/** The team's storage: 100 GB for each live license. */
export const poolOf = (t: TeamWorld, now = Date.now()): number => t.members.filter((m) => isLive(m, now)).length * TEAM.storage;

/** The team as `teams.mine()` gives it to whoever's signed in. */
export function teamView(t: TeamWorld, email: string, now = Date.now()): MyTeam | null {
  const mine = meOn(t, email);
  if (!mine) return null;
  const members = t.members.map((m): TeamMember => ({
    id: m.id, person: m.person, role: m.role, joinedAt: m.joinedAt, you: m.person.email === email,
    license: { state: m.license === null ? 'none' : isLive(m, now) ? 'live' : 'ended', until: m.license?.until ?? null, wanted: m.wanted }
  }));
  return {
    id: t.id, name: t.name, role: mine.role, licensed: isLive(mine, now), members,
    storage: { usedBytes: t.usedBytes, limitBytes: poolOf(t, now) },
    licenses: mine.role === 'admin'
      ? { unconsumed: t.unconsumed.length, refundableMicroUsd: t.unconsumed.reduce((s, x) => s + x, 0), autoPurchase: t.autoPurchase }
      : null
  };
}

/**
 * The plan as the team makes it: on Team while the license is live, with a fresh period and the whole of a person's notes
 * when the license is a new one, and storage from the team's pool. Without a live license, Free (with the team named).
 */
export function planWithTeam(plan: Plan, t: TeamWorld | null, email: string, now = Date.now()): Plan {
  const mine = t ? meOn(t, email) : undefined;
  if (!t || !mine) return plan.kind === 'team' ? onFree({ ...plan, team: null }, now) : { ...plan, team: null };
  const licensed = isLive(mine, now);
  const team: Plan['team'] = { id: t.id, name: t.name, role: mine.role, licensed };
  if (!licensed || !mine.license) return plan.kind === 'team' ? onFree({ ...plan, team }, now) : { ...plan, team };
  const fresh = plan.kind !== 'team' || plan.period.from !== mine.license.from;
  return {
    ...plan, team, kind: 'team',
    period: { from: mine.license.from, to: mine.license.until },
    notes: fresh ? { minutesLeft: TEAM.minutes, minutesPerPeriod: TEAM.minutes, stopped: false } : plan.notes,
    storage: { usedBytes: t.usedBytes, limitBytes: poolOf(t, now), fileBytes: TEAM.file },
    grace: null, over: { storage: false }
  };
}
/** Back on Free when a license ends: a fresh period and Free's limits. */
function onFree(plan: Plan, now: number): Plan {
  return {
    ...plan, kind: 'free',
    period: { from: new Date(now).toISOString(), to: new Date(now + PERIOD_MS).toISOString() },
    notes: { minutesLeft: FREE.minutes, minutesPerPeriod: FREE.minutes, stopped: false },
    storage: { ...plan.storage, limitBytes: FREE.storage, fileBytes: FREE.file }
  };
}

/**
 * A license replaces Pro at once: the month running is lost, and the months that haven't started go back to the balance
 * with a line in its history, and the notice that says so.
 */
export function proReplaced(plan: Plan, now = Date.now()): Plan {
  if (!plan.pro.months.length) return plan;
  const later = plan.pro.months.filter((m) => Date.parse(m.from) > now);
  const back = later.reduce((s, m) => s + m.microUsd, 0);
  const at = new Date(now).toISOString();
  const history = later.length
    ? [{ id: `sb-entry-replaced-${now}`, at, label: `Refund: ${later.length} ${later.length === 1 ? 'month' : 'months'} of Pro, for a team license`, microUsd: back }, ...plan.balance.history]
    : plan.balance.history;
  const said: PlanNotice = { id: `sb-notice-replaced-${now}`, kind: 'license-replaced-pro', at, until: null, count: later.length };
  return { ...plan, pro: NO_PRO, balance: { microUsd: plan.balance.microUsd + back, history }, notices: [said, ...plan.notices] };
}

/* ---------- Vandelay's team ---------- */

/** A license taken `daysAgo` days ago, running a period from then. */
const takenAgo = (daysAgo: number) => ({ from: iso(-daysAgo, 9, 0), until: new Date(on(-daysAgo, 9, 0).getTime() + PERIOD_MS).toISOString() });
/** A license that ran out `daysAgo` days ago. */
const endedAgo = (daysAgo: number) => ({ from: new Date(on(-daysAgo, 9, 0).getTime() - PERIOD_MS).toISOString(), until: iso(-daysAgo, 9, 0) });
const member = (id: string, person: Person, role: TeamRole, license: TeamMemberWorld['license'], joinedDaysAgo: number, wanted: string | null = null): TeamMemberWorld =>
  ({ id: `tm-${id}`, person, role, license, wanted, joinedAt: iso(-joinedDaysAgo, 10, 0) });

/** The notes Priya and Kofi made visible to the team, as Art reads them: from them, to read and ask about. */
export function teamNotes(): Note[] {
  const made = (n: Note, by: Person, at: string): Note => ({ ...n, teamVisible: true, received: { role: 'team', by, at } });
  return [
    made(writeNote({
      id: 'tn-roadmap', title: 'Roadmap review', startedAt: iso(-1, 10, 0), minutes: 40, organizer: PRIYA, invited: [KOFI, MAYA],
      excerpt: 'Team plans ship in December. Shared workspaces come first, then the admin page.',
      summary: 'Team plans ship in December. Shared workspaces come first, then the admin page; billing by license follows in January.',
      said: [
        { at: '04:10', who: PRIYA, text: 'Team plans ship in December. Shared workspaces first.' },
        { at: '19:30', who: KOFI, text: 'The admin page needs a week of design before anyone builds it.' }
      ],
      decisions: [{ id: 'tn-roadmap-d1', text: 'Team plans ship in December.', at: '04:10', state: 'confirmed' }],
      actions: [{ id: 'tn-roadmap-a1', text: 'Design the admin page', at: '19:30', owner: KOFI, due: 'Next Friday' }]
    }), PRIYA, iso(-1, 11, 0)),
    made(writeNote({
      id: 'tn-onboarding', title: 'Onboarding research readout', startedAt: iso(-3, 14, 0), minutes: 30, organizer: KOFI, invited: [AIKO],
      excerpt: 'Five of eight people missed the invite step. It moves to the first screen.',
      summary: 'Five of the eight people interviewed missed the invite step, so it moves to the first screen.',
      said: [{ at: '06:00', who: KOFI, text: 'Five of eight missed the invite step entirely.' }],
      decisions: [{ id: 'tn-onboarding-d1', text: 'The invite step moves to the first screen.', at: '06:00', state: 'confirmed' }]
    }), KOFI, iso(-3, 15, 0))
  ];
}

/**
 * Vandelay's team with Art as its admin: six people, Maya's license ran out last week, three licenses bought and not yet
 * taken, auto-purchase off, and 210 GB of its 500 GB stored.
 */
export function vandelayTeam(): TeamWorld {
  return {
    id: 'team-vandelay', name: COMPANY.name,
    members: [
      member('art', ART, 'admin', takenAgo(12), 60), member('priya', PRIYA, 'member', takenAgo(10), 58), member('kofi', KOFI, 'member', takenAgo(9), 58),
      member('aiko', AIKO, 'member', takenAgo(4), 40), member('ines', INES, 'member', takenAgo(2), 30), member('maya', MAYA, 'member', endedAgo(6), 45)
    ],
    unconsumed: [LICENSE_PRICE, LICENSE_PRICE, LICENSE_PRICE], autoPurchase: false, lowSaid: true,
    notes: teamNotes(), usedBytes: Math.round(210 * GiB)
  };
}

/** The same team with Priya as its admin and Art a member, licensed since 12 days ago. */
export function priyasTeam(): TeamWorld {
  const t = vandelayTeam();
  return {
    ...t,
    members: t.members.map((m): TeamMemberWorld => (m.person === ART ? { ...m, role: 'member' } : m.person === PRIYA ? { ...m, role: 'admin', joinedAt: iso(-60, 10, 0) } : m))
  };
}
