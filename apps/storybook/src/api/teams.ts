/*
 * A team, in the stand-in: what `api.teams` and a visit do to the world (src/world/teams.ts), with the server's refusals in
 * its own words. Only Art's side is kept: notices go to Art's plan when they're Art's (an admin's when Art is the admin, a
 * member's otherwise), and the admin's balance is Art's own plan's when Art is the admin.
 */
import { AlcoveApiError, TeamNameSchema, type MyTeam, type Note, type NoteSummary, type PlanNotice } from '@alcove/api';
import type { World } from '../world';
import { summaryOf } from '../world/build';
import { LICENSE_PRICE, licensesFor, PERIOD_MS } from '../world/plans';
import { addLicenses, adminOf, INVITE_MS, isLive, LOW_LICENSES, meOn, planWithTeam, proReplaced, refundOf, teamView, type TeamMemberWorld, type TeamWorld, type UnconsumedLicense } from '../world/teams';
import { refusalOf, shortOf } from './payments';
import { me, nextId } from './state';

const refused = (code: 'not-found' | 'forbidden' | 'conflict' | 'invalid', message: string) => new AlcoveApiError(code, message, { requestId: nextId('sb-req') });
const licensesWord = (n: number) => `${n} ${n === 1 ? 'license' : 'licenses'}`;
const LINK_GONE = 'This link to join a team has been used or has run out. Ask whoever sent it for a new one.';

/** Your team as the world has it, and you on it; refused when you're on none. */
function yours(w: World): { t: TeamWorld; mine: TeamMemberWorld } {
  const t = w.myTeam;
  const mine = t ? meOn(t, me().email) : undefined;
  if (!t || !mine) throw refused('not-found', 'You aren’t on a team.');
  return { t, mine };
}
function asAdmin(w: World): TeamWorld {
  const { t, mine } = yours(w);
  if (mine.role !== 'admin') throw refused('forbidden', 'Only the team’s admin can do that.');
  return t;
}
/** The plan follows the team, and the team as you see it is the answer. */
function settled(w: World): MyTeam {
  w.plan = planWithTeam(w.plan, w.myTeam ?? null, me().email);
  const view = w.myTeam ? teamView(w.myTeam, me().email) : null;
  if (!view) throw refused('not-found', 'You aren’t on a team.');
  return view;
}
function tell(w: World, kind: PlanNotice['kind'], count: number | null): void {
  const at = new Date().toISOString();
  w.plan = { ...w.plan, notices: [{ id: nextId('sb-notice'), kind, at, until: null, count, workspaceId: null }, ...w.plan.notices.filter((n) => n.kind !== kind)] };
}
/** The admin's balance pays for a license: Art's own, when Art is the admin. Someone else's is taken to cover it. */
function adminPays(w: World, t: TeamWorld, microUsd: number, label: string): boolean {
  if (adminOf(t)?.person.email !== me().email) return true;
  const { balance } = w.plan;
  if (balance.microUsd < microUsd) return false;
  const entry = { id: nextId('sb-entry'), at: new Date().toISOString(), label, microUsd: -microUsd };
  w.plan = { ...w.plan, balance: { microUsd: balance.microUsd - microUsd, history: [entry, ...balance.history] } };
  return true;
}

/**
 * A visit: a member without a live license takes one, if one is there, or one is bought with auto-purchase (a period's: it
 * stays monthly); otherwise they stay on their own plan and are told to ask the admin, and the admin is told none were
 * left. A license taken runs as many periods as it was bought for, from now. Few left tells the admin too.
 */
export function visit(w: World): void {
  const t = w.myTeam;
  const mine = t ? meOn(t, me().email) : undefined;
  if (!t || !mine || isLive(mine)) return;
  const admin = mine.role === 'admin';
  const now = Date.now();
  let paid: UnconsumedLicense | undefined = t.unconsumed.shift();
  if (paid === undefined && t.autoPurchase && adminPays(w, t, LICENSE_PRICE, 'Team, 1 license, bought automatically')) paid = { microUsd: LICENSE_PRICE, periods: 1 };
  if (paid === undefined) {
    mine.wanted = new Date(now).toISOString();
    if (admin) tell(w, 'licenses-none', null);
    else tell(w, 'license-needed', null);
    w.plan = planWithTeam(w.plan, t, me().email, now);
    return;
  }
  mine.license = { from: new Date(now).toISOString(), until: new Date(now + paid.periods * PERIOD_MS).toISOString() };
  mine.wanted = null;
  w.plan = planWithTeam(proReplaced(w.plan, now), t, me().email, now);
  if (admin && t.unconsumed.length < LOW_LICENSES && !t.lowSaid) { t.lowSaid = true; tell(w, 'licenses-low', t.unconsumed.length); }
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
  create: (w: World, name: string): MyTeam => {
    if (w.myTeam && meOn(w.myTeam, me().email)) throw refused('conflict', 'You’re on a team already. Leave it to start another.');
    const parsed = TeamNameSchema.safeParse(name);
    if (!parsed.success) throw refused('invalid', 'Give the team a name.');
    const now = new Date().toISOString();
    w.myTeam = {
      id: nextId('team'), name: parsed.data, unconsumed: [], autoPurchase: false, lowSaid: false, notes: [], usedBytes: w.plan.storage.usedBytes,
      members: [{ id: nextId('tm'), person: me(), role: 'admin', license: null, wanted: null, joinedAt: now }]
    };
    return settled(w);
  },
  invite: (w: World) => {
    const t = asAdmin(w);
    const secret = `Vandelay${String(Date.now()).slice(-8)}${nextId('j').replace(/\D/g, '')}`.padEnd(24, 'x');
    const expiresAt = new Date(Date.now() + INVITE_MS).toISOString();
    w.teamInvites = [...(w.teamInvites ?? []), { secret, expiresAt, team: t, admin: me() }];
    return { link: new URL(`/team/join#${secret}`, location.origin).href, expiresAt };
  },
  peek: (w: World, secret: string) => {
    const found = (w.teamInvites ?? []).find((x) => x.secret === secret && Date.parse(x.expiresAt) > Date.now());
    if (!found) throw refused('not-found', LINK_GONE);
    return { name: found.team.name, admin: found.admin, expiresAt: found.expiresAt };
  },
  join: (w: World, secret: string): MyTeam => {
    const found = (w.teamInvites ?? []).find((x) => x.secret === secret && Date.parse(x.expiresAt) > Date.now());
    if (!found) throw refused('not-found', LINK_GONE);
    if (w.myTeam && meOn(w.myTeam, me().email)) throw refused('conflict', 'You’re on a team already. Leave it before joining another.');
    w.teamInvites = (w.teamInvites ?? []).filter((x) => x.secret !== secret);
    const t = found.team;
    t.members = [...t.members, { id: nextId('tm'), person: me(), role: 'member', license: null, wanted: null, joinedAt: new Date().toISOString() }];
    w.myTeam = t;
    // Joining is a visit: it takes a license if one is there.
    visit(w);
    return settled(w);
  },
  remove: (w: World, memberId: string): MyTeam => {
    const t = asAdmin(w);
    const who = t.members.find((m) => m.id === memberId);
    if (!who) throw refused('not-found', 'They aren’t on the team any more.');
    if (who.role === 'admin') throw refused('forbidden', 'The admin can’t be taken off the team.');
    t.members = t.members.filter((m) => m.id !== memberId);
    return settled(w);
  },
  leave: (w: World): void => {
    const { t, mine } = yours(w);
    if (mine.role === 'admin') throw refused('forbidden', 'The admin can’t leave the team. Delete it once nobody else is on it.');
    t.members = t.members.filter((m) => m.id !== mine.id);
    w.myTeam = null;
    w.plan = planWithTeam(w.plan, null, me().email);
  },
  delete: (w: World): void => {
    const t = asAdmin(w);
    if (t.members.length > 1) throw refused('conflict', 'Remove everyone else from the team before deleting it.');
    const back = refundOf(t);
    if (back > 0) {
      const entry = { id: nextId('sb-entry'), at: new Date().toISOString(), label: `Refund: ${licensesWord(t.unconsumed.length)}, team deleted`, microUsd: back };
      w.plan = { ...w.plan, balance: { microUsd: w.plan.balance.microUsd + back, history: [entry, ...w.plan.balance.history] } };
    }
    w.myTeam = null;
    w.plan = planWithTeam(w.plan, null, me().email);
  },
  /** `count` licenses at `microUsdPerLicense` a period, each for `periods`: a period's at a license's price, or a year's at its lower one. */
  buyLicenses: (w: World, count: number, microUsdPerLicense: number, periods = 1): MyTeam => {
    const t = asAdmin(w);
    const buys = { kind: 'licenses', count, microUsdPerLicense, periods } as const;
    const why = refusalOf(w, buys);
    if (why) throw refused(why.code, why.asked);
    const short = shortOf(w, buys);
    if (short) throw refused('conflict', short);
    // Each costs its price a period for every period it runs, and that's what refunding it gives back.
    const each = microUsdPerLicense * periods;
    adminPays(w, t, count * each, `Team, ${licensesFor(count, periods)}`);
    addLicenses(t, count, each, periods);
    return settled(w);
  },
  refundLicenses: (w: World): MyTeam => {
    const t = asAdmin(w);
    if (!t.unconsumed.length) throw refused('conflict', 'There’s no license to refund that nobody has taken. A license someone has taken isn’t refunded.');
    const back = refundOf(t);
    const entry = { id: nextId('sb-entry'), at: new Date().toISOString(), label: `Refund: ${licensesWord(t.unconsumed.length)}`, microUsd: back };
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
