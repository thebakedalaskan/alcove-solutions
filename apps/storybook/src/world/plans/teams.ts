/*
 * A team in the demo world (docs: Plans and usage › Team; docs/superpowers/specs/2026-11-14-team-invitations-design.md): its
 * admin, its members and their licenses, the licenses bought and not yet taken, the notes its members made visible to it,
 * who's been invited to it and every invitation it sent. A team is free to start, and its tier is never kept: `team` while
 * anyone on it has a live license or it has licenses bought and waiting to be taken, `free` otherwise. Art is on one as its
 * admin or as a member, or on none. The plan follows the license: on Team while Art's is live, otherwise Art's own (Free or
 * Pro) with the team named. A license stays with whoever took it for its period: off the team and back before it runs out,
 * it's theirs again. Made up, as everything in the demo world is.
 */
import type { MyTeam, Note, Person, Plan, PlanNotice, ProMonth, TeamInvitation, TeamMember, TeamRole, TeamTier } from '@alcove/api';
import { writeNote } from '../build';
import { iso, on } from '../clock';
import { AIKO, ART, COMPANY, INES, KOFI, MAYA, PRIYA } from '../people';
import { FREE, LICENSE_PRICE, NO_PRO, PERIOD_MS, TEAM } from './plans';

const GiB = 2 ** 30;
const DAY_MS = 86_400_000;

/** A license as someone took it: from when, until when. */
export interface LicenseWorld { from: string; until: string }
/** Someone on the team, as the world keeps them: when their license runs, and when they last needed one. */
export interface TeamMemberWorld {
  id: string;
  person: Person;
  role: TeamRole;
  /** The license taken last, or null if they've never had one. */
  license: LicenseWorld | null;
  wanted: string | null;
  joinedAt: string;
}
/**
 * Someone asked to join a team and not on it yet, as the world keeps it (design 3.3): who (as the directory knows them, or
 * by their address), who on the team asked (their member ID: what they asked goes when they leave), when they were first
 * invited, when it was made or last sent again, when it runs out (30 days from then), its own link's secret, which only its
 * email carries, and whether whoever it's for pressed Not now. Every time it was sent is the team's (`TeamWorld.sends`).
 */
export interface InvitationWorld {
  id: string;
  person: Person;
  /** The `TeamMemberWorld.id` of whoever asked. */
  by: string;
  /** When they were first invited: kept while it's invited again or sent again. One cancelled and invited again is new. */
  madeAt: string;
  /** When it was made, or last invited or sent again: its 30 days run from then. */
  at: string;
  expiresAt: string;
  secret: string;
  putAside: boolean;
}
/** The team sent an invitation to an address: when. What Resend's limits count, whichever invitation it was. */
export interface InvitationSend { email: string; at: string }
/** A live license someone left the team with, or was taken off it with: theirs again if they're back before it runs out. */
export interface HeldLicense { email: string; license: LicenseWorld }
export interface TeamWorld {
  id: string;
  name: string;
  members: TeamMemberWorld[];
  /** Each license bought and not yet taken: what it cost (all its periods), and how many periods it runs once taken. */
  unconsumed: UnconsumedLicense[];
  autoPurchase: boolean;
  /** Whether the admin has been told the licenses are low, until 5 or more are spare again. */
  lowSaid: boolean;
  /** Notes other members made visible to the team, as they read for Art. */
  notes: Note[];
  /** What the licensed members store, together. */
  usedBytes: number;
  /** Who's been asked to join it and hasn't yet. Each ends when it's used, cancelled, runs out, or its inviter goes. */
  invitations: InvitationWorld[];
  /**
   * Every time it sent an invitation, newest first: an address is sent one once a day at most, and 3 times in 30 days, by this
   * team (`mail.address_per_team`). They stay when the invitation goes, as the server keeps them apart from it.
   */
  sends: InvitationSend[];
  /** Live licenses of people who left it or were taken off it, until they're back or the licenses run out. */
  held: HeldLicense[];
  /** When Art, on it and not its admin, last asked the admin to upgrade it: Art's side alone, as the admin's notice is theirs. */
  upgradeAsked: string | null;
  /** How many licenses auto-purchase has bought for it on a UTC day, the latest it bought on: at most 10 a day. */
  autoBought?: { day: string; count: number };
}
/** A license bought and not yet taken: what it cost, for all its periods, and how many it runs (1, or a year's 12). */
export interface UnconsumedLicense { microUsd: number; periods: number }

/** Below this many spare licenses the admin is told (`team.low_licenses`). */
export const LOW_LICENSES = 5;
/** How long an invitation lasts from when it was made or last sent: 30 days (`team.invitation_seconds`). */
export const INVITATION_MS = 30 * DAY_MS;
/** How often an invitation can be sent again: once a day (`team.invitation_resend_seconds`)... */
const RESEND_MS = DAY_MS;
/** ...and this many times in 30 days to one address from one team, the first among them (`mail.address_per_team`). */
export const MOST_SENT = 3;
/** How many invitations and resends one account sends in a day (`team.invitations_per_day`). */
export const INVITES_A_DAY = 20;
/** The most licenses auto-purchase buys for one team in a UTC day (`team.auto_purchase_per_day`). */
export const AUTO_BOUGHT_A_DAY = 10;

export const isLive = (m: TeamMemberWorld, now = Date.now()): boolean => m.license !== null && Date.parse(m.license.until) > now;
export const meOn = (t: TeamWorld, email: string): TeamMemberWorld | undefined => t.members.find((m) => m.person.email === email);
export const adminOf = (t: TeamWorld): TeamMemberWorld | undefined => t.members.find((m) => m.role === 'admin');
/**
 * `team` while anyone on it has a live license, or licenses were bought for it and wait to be taken; `free` otherwise:
 * worked out, never kept.
 */
export const tierOf = (t: TeamWorld, now = Date.now()): TeamTier => (t.unconsumed.length > 0 || t.members.some((m) => isLive(m, now)) ? 'team' : 'free');
/**
 * The licenses nobody has spoken for: those waiting to be taken, less one for each person on the team without a live license
 * (each takes one on their next visit), never below none. What `licenses-low` counts.
 */
export const spareLicenses = (t: TeamWorld, now = Date.now()): number => Math.max(0, t.unconsumed.length - t.members.filter((m) => !isLive(m, now)).length);
/** The invitations that still stand: not run out, and whoever asked still on the team. */
export const liveInvitations = (t: TeamWorld, now = Date.now()): InvitationWorld[] =>
  t.invitations.filter((i) => Date.parse(i.expiresAt) > now && t.members.some((m) => m.id === i.by));

/* ---------- sending invitations ---------- */

/** When this team sent `email` an invitation in the 30 days to `now`, the newest first (in ms). */
const sendsTo = (t: TeamWorld, email: string, now: number): number[] =>
  t.sends.filter((s) => s.email === email).map((s) => Date.parse(s.at)).filter((at) => at > now - INVITATION_MS).sort((a, b) => b - a);
/** How many times this team has sent `email` an invitation in the 30 days to `now`. */
export const sendsOf = (t: TeamWorld, email: string, now = Date.now()): number => sendsTo(t, email, now).length;
/** The team sent `email` an invitation `at`. */
export function sentTo(t: TeamWorld, email: string, at: string): void {
  t.sends = [{ email, at }, ...t.sends].sort((a, b) => b.at.localeCompare(a.at));
}
/**
 * When an invitation can next be sent again, or null while it can be now (invitations.ts › nextSend): a day after it was
 * last, and once this team has sent the address 3 in 30 days, when the oldest of those 3 is 30 days old.
 */
export function resendAtOf(t: TeamWorld, i: InvitationWorld, now = Date.now()): string | null {
  const third = sendsTo(t, i.person.email, now)[MOST_SENT - 1];
  const next = Math.max(Date.parse(i.at) + RESEND_MS, third === undefined ? -Infinity : third + INVITATION_MS);
  return next > now ? new Date(next).toISOString() : null;
}
/**
 * Why it can't be sent again yet, or null while it can be (invitations.ts › holdOf): it went less than a day ago (`recent`),
 * or this team has sent the address as many as 30 days take (`most`); when both hold, whichever ends later.
 */
export function resendWhyOf(t: TeamWorld, i: InvitationWorld, now = Date.now()): TeamInvitation['resendWhy'] {
  const third = sendsTo(t, i.person.email, now)[MOST_SENT - 1];
  const wait = Date.parse(i.at) + RESEND_MS;
  const capped = third === undefined ? -Infinity : third + INVITATION_MS;
  if (Math.max(wait, capped) <= now) return null;
  return capped >= wait ? 'most' : 'recent';
}
/** Whether a new invitation to `email` is sent as it's made: this team hasn't sent the address 3 in 30 days. It's made either way. */
export const sendsNew = (t: TeamWorld, email: string, now = Date.now()): boolean => sendsOf(t, email, now) < MOST_SENT;

/* ---------- licenses ---------- */

/**
 * `count` licenses bought for the team at `microUsd` each (for all its `periods`), from its admin's balance or by a payment:
 * nobody's taken them yet. Buying answers anyone who asked the admin to upgrade, and the admin may be told again once fewer
 * than 5 are spare.
 */
export function addLicenses(t: TeamWorld, count: number, microUsd: number, periods = 1): void {
  t.unconsumed = [...t.unconsumed, ...Array.from({ length: count }, (): UnconsumedLicense => ({ microUsd, periods }))];
  if (spareLicenses(t) >= LOW_LICENSES) t.lowSaid = false;
  t.upgradeAsked = null;
}
/**
 * Someone off the team, left or taken off: what they asked goes with them (design 3.3), and a live license of theirs is held
 * for them until it runs out, in case they're back. It isn't refunded.
 */
export function dropMember(t: TeamWorld, m: TeamMemberWorld, now = Date.now()): void {
  t.members = t.members.filter((x) => x.id !== m.id);
  t.invitations = t.invitations.filter((i) => i.by !== m.id);
  t.held = t.held.filter((h) => h.email !== m.person.email);
  if (m.license && isLive(m, now)) t.held = [...t.held, { email: m.person.email, license: m.license }];
}
/**
 * Someone on the team from `now`, by an invitation or a link, as `id` on it: with the license they left it with while it's
 * still live (it stays theirs for its period, so none is taken for them), or none yet.
 */
export function memberFrom(t: TeamWorld, person: Person, role: TeamRole, id: string, now = Date.now()): TeamMemberWorld {
  const held = t.held.find((h) => h.email === person.email && Date.parse(h.license.until) > now);
  t.held = t.held.filter((h) => h.email !== person.email);
  return { id, person, role, license: held?.license ?? null, wanted: null, joinedAt: new Date(now).toISOString() };
}
/** What refunding the licenses nobody has taken gives back: what each cost. */
export const refundOf = (t: TeamWorld): number => t.unconsumed.reduce((s, x) => s + x.microUsd, 0);
/** The team's storage: 100 GB for each live license. */
export const poolOf = (t: TeamWorld, now = Date.now()): number => t.members.filter((m) => isLive(m, now)).length * TEAM.storage;

/**
 * The team as `teams.mine()` gives it to whoever's signed in: its tier, its people, and who's invited, newest first, with
 * when they were first invited, whether you can Resend or Cancel each (you asked them, or you're the admin), when Resend can
 * next be pressed and why not now, and how many times this team has sent it in 30 days.
 */
export function teamView(t: TeamWorld, email: string, now = Date.now()): MyTeam | null {
  const mine = meOn(t, email);
  if (!mine) return null;
  const members = t.members.map((m): TeamMember => ({
    id: m.id, person: m.person, role: m.role, joinedAt: m.joinedAt, you: m.person.email === email,
    license: { state: m.license === null ? 'none' : isLive(m, now) ? 'live' : 'ended', until: m.license?.until ?? null, wanted: m.wanted }
  }));
  const invitations = liveInvitations(t, now).flatMap((i): TeamInvitation[] => {
    const by = t.members.find((m) => m.id === i.by);
    if (!by) return [];
    const you = by.id === mine.id;
    return [{
      id: i.id, person: i.person, invitedBy: by.person, you, madeAt: i.madeAt, at: i.at, expiresAt: i.expiresAt, manage: you || mine.role === 'admin',
      resendAt: resendAtOf(t, i, now), resendWhy: resendWhyOf(t, i, now), sends: sendsOf(t, i.person.email, now)
    }];
  }).sort((a, b) => b.at.localeCompare(a.at));
  return {
    id: t.id, name: t.name, role: mine.role, tier: tierOf(t, now), licensed: isLive(mine, now), members, invitations,
    storage: { usedBytes: t.usedBytes, limitBytes: poolOf(t, now) },
    licenses: mine.role === 'admin'
      ? { unconsumed: t.unconsumed.length, refundableMicroUsd: refundOf(t), autoPurchase: t.autoPurchase }
      : null
  };
}

/**
 * The period of a live license running at `now`, as the server runs it (plans.ts › planAt): one period from when it was
 * taken, then each after it, the last ending with the license. A license for one period is that period.
 */
function licensePeriod(license: { from: string; until: string }, now: number): { from: string; to: string } {
  const from = Date.parse(license.from);
  const n = Math.max(0, Math.floor((now - from) / PERIOD_MS));
  const start = from + n * PERIOD_MS;
  const end = start + PERIOD_MS;
  return { from: n === 0 ? license.from : new Date(start).toISOString(), to: end >= Date.parse(license.until) ? license.until : new Date(end).toISOString() };
}

/**
 * The plan as the team makes it: on Team while the license is live, with a fresh period and the whole of a person's notes
 * when a new period of it starts (a license for a year runs 12 of them, each with all its notes), and storage from the
 * team's pool. Without a live license, Art's own plan (Free, or Pro bought), with the team named; a license that ended goes
 * back to Free. Someone's ask to upgrade is told only to a free team's admin, as the server makes those notices from the
 * team's own record when the plan is read.
 */
export function planWithTeam(plan: Plan, t: TeamWorld | null, email: string, now = Date.now()): Plan {
  const mine = t ? meOn(t, email) : undefined;
  const asks = (p: Plan, told: boolean): Plan => (told ? p : { ...p, notices: p.notices.filter((n) => n.kind !== 'upgrade-asked') });
  if (!t || !mine) return asks(plan.kind === 'team' ? onFree({ ...plan, team: null }, now) : { ...plan, team: null }, false);
  const licensed = isLive(mine, now);
  const tier = tierOf(t, now);
  const team: Plan['team'] = { id: t.id, name: t.name, role: mine.role, tier, licensed };
  if (!licensed || !mine.license) return asks(plan.kind === 'team' ? onFree({ ...plan, team }, now) : { ...plan, team }, tier === 'free' && mine.role === 'admin');
  const period = licensePeriod(mine.license, now);
  const fresh = plan.kind !== 'team' || plan.period.from !== period.from;
  return {
    ...asks(plan, false), team, kind: 'team', period,
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
 * A license replaces Pro at once (design 4.9), and what's left of Pro comes back by the day: the months that haven't started,
 * at what was paid for each, and the running month's price for each whole day of it not begun yet. It goes to the balance in
 * one line, and the notice says how much came back: nothing, for Pro Alcove gave.
 */
export function proReplaced(plan: Plan, now = Date.now()): Plan {
  if (!plan.pro.months.length) return plan;
  const later = plan.pro.months.filter((m) => Date.parse(m.from) > now);
  const running = plan.pro.months.find((m) => Date.parse(m.from) <= now && Date.parse(m.to) > now);
  const back = later.reduce((s, m) => s + m.microUsd, 0) + (running ? restOf(running, now) : 0);
  const at = new Date(now).toISOString();
  const history = back > 0
    ? [{ id: `sb-entry-replaced-${now}`, at, label: 'Refund: the rest of Pro, for a team license', microUsd: back }, ...plan.balance.history]
    : plan.balance.history;
  const said: PlanNotice = { id: `sb-notice-replaced-${now}`, kind: 'license-replaced-pro', at, until: null, count: null, microUsd: back, workspaceId: null, memberId: null };
  return { ...plan, pro: NO_PRO, balance: { microUsd: plan.balance.microUsd + back, history }, notices: [said, ...plan.notices] };
}
/** The running month's price for each whole day of it not begun yet, to the cent below. */
function restOf(m: ProMonth, now: number): number {
  const days = Math.round((Date.parse(m.to) - Date.parse(m.from)) / DAY_MS);
  const left = Math.floor((Date.parse(m.to) - now) / DAY_MS);
  if (days <= 0 || left <= 0) return 0;
  return Math.floor((m.microUsd * left) / days / 10_000) * 10_000;
}

/* ---------- Vandelay's team ---------- */

/** A license taken `daysAgo` days ago, running a period from then. */
const takenAgo = (daysAgo: number): LicenseWorld => ({ from: iso(-daysAgo, 9, 0), until: new Date(on(-daysAgo, 9, 0).getTime() + PERIOD_MS).toISOString() });
/** A license that ran out `daysAgo` days ago. */
const endedAgo = (daysAgo: number): LicenseWorld => ({ from: new Date(on(-daysAgo, 9, 0).getTime() - PERIOD_MS).toISOString(), until: iso(-daysAgo, 9, 0) });
/** Someone on a team since `joinedDaysAgo` days ago (at 10:00), their ID on it `tm-` and `id`. */
export const teamMember = (id: string, person: Person, role: TeamRole, license: TeamMemberWorld['license'], joinedDaysAgo: number, wanted: string | null = null): TeamMemberWorld =>
  ({ id: `tm-${id}`, person, role, license, wanted, joinedAt: iso(-joinedDaysAgo, 10, 0) });
/** A free team of these people: nothing bought for it, nothing visible to it, and nobody invited yet. */
export const freeTeamOf = (id: string, name: string, members: TeamMemberWorld[], usedBytes = 0): TeamWorld => ({
  id, name, members, unconsumed: [], autoPurchase: false, lowSaid: false, notes: [], usedBytes, invitations: [], sends: [], held: [], upgradeAsked: null
});

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
      teamMember('art', ART, 'admin', takenAgo(12), 60), teamMember('priya', PRIYA, 'member', takenAgo(10), 58), teamMember('kofi', KOFI, 'member', takenAgo(9), 58),
      teamMember('aiko', AIKO, 'member', takenAgo(4), 40), teamMember('ines', INES, 'member', takenAgo(2), 30), teamMember('maya', MAYA, 'member', endedAgo(6), 45)
    ],
    unconsumed: Array.from({ length: 3 }, (): UnconsumedLicense => ({ microUsd: LICENSE_PRICE, periods: 1 })), autoPurchase: false, lowSaid: true,
    notes: teamNotes(), usedBytes: Math.round(210 * GiB), invitations: [], sends: [], held: [], upgradeAsked: null
  };
}

/**
 * Vandelay's team as Art has just started it, free, from Start a team: Art alone as its admin, made today, with nothing
 * bought for it and nobody licensed. `usedBytes`: what Art stores, which counts against the team's storage once Art is licensed.
 */
export const startedTeam = (usedBytes = 0): TeamWorld => freeTeamOf('team-vandelay', COMPANY.name, [teamMember('art', ART, 'admin', null, 0)], usedBytes);

/**
 * Vandelay Industries' free team, as Art started it a month ago: Art its admin, Priya on it since two days after, and Kofi
 * since this morning at 09:30. Nobody is licensed and nothing was bought. `usedBytes`: what Art stores.
 */
export function freeTeam(usedBytes = Math.round(2.1 * GiB)): TeamWorld {
  return freeTeamOf('team-vandelay', COMPANY.name, [
    teamMember('art', ART, 'admin', null, 30), teamMember('priya', PRIYA, 'member', null, 28), { ...teamMember('kofi', KOFI, 'member', null, 0), joinedAt: iso(0, 9, 30) }
  ], usedBytes);
}
/**
 * Vandelay Industries' team a month after Art upgraded it, its licenses run out and none bought again: Art its admin, whose
 * license ended two days ago, and Priya and Kofi, whose ended yesterday. Nothing is left to take, so it's free; auto-purchase
 * is still on from the upgrade. What it shared stays (the notes Priya and Kofi made visible to it), closed until it's
 * upgraded again. `usedBytes`: what Art stores.
 */
export function endedTeam(usedBytes = Math.round(2.1 * GiB)): TeamWorld {
  return {
    ...freeTeamOf('team-vandelay', COMPANY.name, [
      teamMember('art', ART, 'admin', endedAgo(2), 40), teamMember('priya', PRIYA, 'member', endedAgo(1), 38), teamMember('kofi', KOFI, 'member', endedAgo(1), 33)
    ], usedBytes),
    autoPurchase: true, notes: teamNotes()
  };
}
/** Priya's free Vandelay Industries team, with Art on it: Priya its admin, Kofi, Aiko and Art. Nobody is licensed. */
export function priyasFreeTeam(): TeamWorld {
  return freeTeamOf('team-vandelay', COMPANY.name, [
    teamMember('priya', PRIYA, 'admin', null, 40), teamMember('kofi', KOFI, 'member', null, 34), teamMember('aiko', AIKO, 'member', null, 25), teamMember('art', ART, 'member', null, 20)
  ]);
}

/** The same team with Priya as its admin and Art a member, licensed since 12 days ago. */
export function priyasTeam(): TeamWorld {
  const t = vandelayTeam();
  return {
    ...t,
    members: t.members.map((m): TeamMemberWorld => (m.person === ART ? { ...m, role: 'member' } : m.person === PRIYA ? { ...m, role: 'admin', joinedAt: iso(-60, 10, 0) } : m))
  };
}
