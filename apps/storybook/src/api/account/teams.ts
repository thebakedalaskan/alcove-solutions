/*
 * A team, in the stand-in: what `api.teams` and a visit do to the world (src/world/plans/teams.ts), with the server's refusals in
 * its own words. Inviting, the invitations to you, joining and invite links are team-invitations.ts. Only Art's side is kept:
 * notices go to Art's plan when they're Art's (an admin's when Art is the admin, a member's otherwise), and the admin's balance
 * is Art's own plan's when Art is the admin.
 */
import { TeamNameSchema, type MyTeam, type Note, type NoteSummary, type PlanNotice, type Purchase } from '@alcove/api';
import type { World } from '../../world/world';
import { summaryOf } from '../../world/build';
import { artsLink, madeAgain } from '../../world/invite-links';
import { boughtFromBalance, freshEntryId } from '../../world/plans/payments';
import { LICENSE_PRICE, PERIOD_MS } from '../../world/plans/plans';
import {
  adminOf, AUTO_BOUGHT_A_DAY, dropMember, freeTeamOf, isLive, LOW_LICENSES, meOn, planWithTeam, proReplaced, refundOf, spareLicenses, teamView, tierOf, type TeamMemberWorld,
  type TeamWorld, type UnconsumedLicense
} from '../../world/plans/teams';
import { refused } from '../answer';
import { refusalOf, shortOf } from './payments';
import { me, nextId } from '../state';

const licensesWord = (n: number) => `${n} ${n === 1 ? 'license' : 'licenses'}`;
/** How long a member's ask to upgrade stands before asking again tells the admin again: 7 days (`team.upgrade_ask_seconds`). */
const UPGRADE_ASK_MS = 7 * 86_400_000;

/** Your team as the world has it, and you on it; refused when you're on none. */
export function yours(w: World): { t: TeamWorld; mine: TeamMemberWorld } {
  const t = w.myTeam;
  const mine = t ? meOn(t, me().email) : undefined;
  if (!t || !mine) throw refused('not-found', 'You’re not on a team.');
  return { t, mine };
}
function asAdmin(w: World): TeamWorld {
  const { t, mine } = yours(w);
  if (mine.role !== 'admin') throw refused('forbidden', 'Only the team’s admin can do that.');
  return t;
}
/** The plan follows the team, and the team as you see it is the answer. */
export function settled(w: World): MyTeam {
  w.plan = planWithTeam(w.plan, w.myTeam ?? null, me().email);
  const view = w.myTeam ? teamView(w.myTeam, me().email) : null;
  if (!view) throw refused('not-found', 'You’re not on a team.');
  return view;
}
function tell(w: World, kind: PlanNotice['kind'], count: number | null): void {
  const at = new Date().toISOString();
  const said: PlanNotice = { id: nextId('sb-notice'), kind, at, until: null, count, microUsd: null, workspaceId: null, memberId: null };
  w.plan = { ...w.plan, notices: [said, ...w.plan.notices.filter((n) => n.kind !== kind)] };
}
/** The admin's balance pays for a license: Art's own, when Art is the admin. Someone else's is taken to cover it. */
function adminPays(w: World, t: TeamWorld, microUsd: number, label: string): boolean {
  if (adminOf(t)?.person.email !== me().email) return true;
  const { balance } = w.plan;
  if (balance.microUsd < microUsd) return false;
  const entry = { id: freshEntryId(w), at: new Date().toISOString(), label, microUsd: -microUsd };
  w.plan = { ...w.plan, balance: { microUsd: balance.microUsd - microUsd, history: [entry, ...balance.history] } };
  return true;
}
/** Art's link, the team's while Art runs it, made again: the one before leads nowhere now (invite-links.ts › madeAgain). */
const linkMadeAgain = (w: World): void => { w.inviteLink = madeAgain(w.inviteLink ?? artsLink(me())); };

/**
 * A visit: a member without a live license takes one, if one is there. On a team on Team with none left, one is bought with
 * auto-purchase (a period's: it stays monthly), at most 10 for the team in a UTC day, and otherwise they stay on their own
 * plan and are told to ask the admin, and the admin is told none were left. Taking one leaves fewer spare: under 5 not spoken
 * for by someone on the team without a license tells the admin, unless auto-purchase buys whatever's needed. On a free team
 * (nobody licensed, nothing bought) none is there, none is bought and nothing is said. A license taken runs as many periods
 * as it was bought for, from now.
 */
export function visit(w: World): void {
  const t = w.myTeam;
  const mine = t ? meOn(t, me().email) : undefined;
  if (!t || !mine || isLive(mine)) return;
  const admin = mine.role === 'admin';
  const now = Date.now();
  const free = tierOf(t, now) === 'free';
  let paid: UnconsumedLicense | undefined = t.unconsumed.shift();
  const day = new Date(now).toISOString().slice(0, 10);
  const boughtToday = t.autoBought?.day === day ? t.autoBought.count : 0;
  if (paid === undefined && !free && t.autoPurchase && boughtToday < AUTO_BOUGHT_A_DAY && adminPays(w, t, LICENSE_PRICE, 'Team, 1 license, bought automatically')) {
    paid = { microUsd: LICENSE_PRICE, periods: 1 };
    t.autoBought = { day, count: boughtToday + 1 };
  }
  if (paid === undefined) {
    if (!free) {
      mine.wanted = new Date(now).toISOString();
      if (admin) tell(w, 'licenses-none', null);
      else tell(w, 'license-needed', null);
    }
    w.plan = planWithTeam(w.plan, t, me().email, now);
    return;
  }
  mine.license = { from: new Date(now).toISOString(), until: new Date(now + paid.periods * PERIOD_MS).toISOString() };
  mine.wanted = null;
  w.plan = planWithTeam(proReplaced(w.plan, now), t, me().email, now);
  const spare = spareLicenses(t, now);
  if (admin && !t.autoPurchase && spare < LOW_LICENSES && !t.lowSaid) { t.lowSaid = true; tell(w, 'licenses-low', spare); }
}

/**
 * Art, a member, off `t`, leaving it or taken off it: what Art asked goes with Art (design 3.3), and the team carries on
 * without Art, among the other teams, where its link still leads. A live license isn't refunded, and stays Art's for its
 * period: back on the team before it runs out, by an invitation or a link, Art has it again (no other is taken).
 */
export function leaveTeam(w: World, t: TeamWorld, mine: TeamMemberWorld): void {
  dropMember(t, mine);
  w.otherTeams = [...(w.otherTeams ?? []).filter((x) => x !== t), t];
  w.myTeam = null;
  w.plan = planWithTeam(w.plan, null, me().email);
}
/**
 * Art's team, deleted by its admin alone on it: its invitations go with it, its unconsumed licenses go back to the balance, and
 * Art's link is made again, so the team's link leads nowhere.
 */
export function deleteTeam(w: World, t: TeamWorld): void {
  const back = refundOf(t);
  if (back > 0) {
    const entry = { id: freshEntryId(w), at: new Date().toISOString(), label: `Refund: ${licensesWord(t.unconsumed.length)}, team deleted`, microUsd: back };
    w.plan = { ...w.plan, balance: { microUsd: w.plan.balance.microUsd + back, history: [entry, ...w.plan.balance.history] } };
  }
  if (w.myTeam === t) w.myTeam = null;
  linkMadeAgain(w);
  w.plan = planWithTeam(w.plan, null, me().email);
}

/** The team's notes you can open: the ones others made visible, and your own, while you're licensed. */
export function teamNotesFor(w: World): Note[] {
  const t = w.myTeam;
  const mine = t ? meOn(t, me().email) : undefined;
  if (!t || !mine || !isLive(mine)) return [];
  return [...t.notes, ...w.notes.filter((n) => n.teamVisible && !n.received)].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
/** A note you can open through your team: read and ask only. */
export const teamNoteIn = (w: World, id: string): Note | undefined => teamNotesFor(w).find((n) => n.id === id && n.received?.role === 'team');
/** Whether you're licensed on a team now. */
export const licensed = (w: World): boolean => { const t = w.myTeam; const mine = t ? meOn(t, me().email) : undefined; return !!mine && isLive(mine); };
/** Everyone licensed on your team now. */
export const licensedCount = (w: World): number => w.myTeam?.members.filter((m) => isLive(m)).length ?? 0;

export const teamsApi = {
  mine: (w: World): MyTeam | null => (w.myTeam ? teamView(w.myTeam, me().email) : null),
  /** A team, free, with you its admin: nothing is bought for it. */
  create: (w: World, name: string): MyTeam => {
    if (w.myTeam && meOn(w.myTeam, me().email)) throw refused('conflict', 'You’re on a team already. Leave it before making one.');
    const parsed = TeamNameSchema.safeParse(name);
    if (!parsed.success) throw refused('invalid', 'Give the team a name.');
    const you: TeamMemberWorld = { id: nextId('tm'), person: me(), role: 'admin', license: null, wanted: null, joinedAt: new Date().toISOString() };
    w.myTeam = freeTeamOf(nextId('team'), parsed.data, [you], w.plan.storage.usedBytes);
    return settled(w);
  },
  rename: (w: World, name: string): MyTeam => {
    const t = asAdmin(w);
    const parsed = TeamNameSchema.safeParse(name);
    if (!parsed.success) throw refused('invalid', 'Give the team a name.');
    t.name = parsed.data;
    return settled(w);
  },
  /** Ask to upgrade: the admin is told (their notice is theirs, so only when Art asked is kept), once in 7 days for each member. */
  askToUpgrade: (w: World): void => {
    const { t, mine } = yours(w);
    if (mine.role === 'admin') throw refused('conflict', 'You’re the team’s admin: upgrade it from its page.');
    if (tierOf(t) === 'team') throw refused('conflict', 'Your team is on Team already.');
    const now = Date.now();
    if (t.upgradeAsked === null || Date.parse(t.upgradeAsked) <= now - UPGRADE_ASK_MS) t.upgradeAsked = new Date(now).toISOString();
  },
  /**
   * Someone taken off the team, and what they asked with them; a live license of theirs stays theirs for its period. The team's
   * link, Art's, is made again, so the one they had leads nowhere.
   */
  remove: (w: World, memberId: string): MyTeam => {
    const t = asAdmin(w);
    const who = t.members.find((m) => m.id === memberId);
    if (!who) throw refused('not-found', 'That person isn’t on your team.');
    if (who.role === 'admin') throw refused('conflict', 'You can’t take yourself off your own team. Delete the team once nobody else is on it.');
    dropMember(t, who);
    linkMadeAgain(w);
    return settled(w);
  },
  leave: (w: World): void => {
    const { t, mine } = yours(w);
    if (mine.role === 'admin') throw refused('conflict', 'You’re the team’s admin, so you can’t leave it. Delete the team once nobody else is on it.');
    leaveTeam(w, t, mine);
  },
  delete: (w: World): void => {
    const t = asAdmin(w);
    if (t.members.length > 1) throw refused('conflict', 'Take everyone else off the team first: a team can be deleted once nobody else is on it.');
    deleteTeam(w, t);
  },
  /**
   * `count` licenses at `microUsdPerLicense` a period, each for `periods`: a period's at a license's price, or a year's at its
   * lower one. `autoPurchase`, when it's said (not null), sets auto-purchase as they're bought, in the same go; refused, nothing
   * changes.
   */
  buyLicenses: (w: World, count: number, microUsdPerLicense: number, periods = 1, autoPurchase: boolean | null = null): MyTeam => {
    asAdmin(w);
    const buys: Purchase = { kind: 'licenses', count, microUsdPerLicense, periods, autoPurchase };
    const why = refusalOf(w, buys);
    if (why) throw refused(why.code, why.asked);
    const short = shortOf(w, buys);
    if (short) throw refused('conflict', short);
    // Each costs its price a period for every period it runs, and that's what refunding it gives back.
    boughtFromBalance(w, buys, freshEntryId(w));
    return settled(w);
  },
  refundLicenses: (w: World): MyTeam => {
    const t = asAdmin(w);
    if (!t.unconsumed.length) throw refused('conflict', 'There’s no license to refund that nobody has taken. A license someone has taken isn’t refunded.');
    const back = refundOf(t);
    if (back <= 0) throw refused('conflict', 'Refunding now would give nothing back: nothing was paid for the licenses nobody has taken.');
    const entry = { id: freshEntryId(w), at: new Date().toISOString(), label: `Refund: ${licensesWord(t.unconsumed.length)}`, microUsd: back };
    w.plan = { ...w.plan, balance: { microUsd: w.plan.balance.microUsd + back, history: [entry, ...w.plan.balance.history] } };
    t.unconsumed = [];
    return settled(w);
  },
  setAutoPurchase: (w: World, on: boolean): MyTeam => {
    asAdmin(w).autoPurchase = on;
    return settled(w);
  },
  notes: (w: World): NoteSummary[] => teamNotesFor(w).map(summaryOf)
};
