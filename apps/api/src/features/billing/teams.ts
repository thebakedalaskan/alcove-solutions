/*
 * Teams (docs: Plans and usage › Team): one team for each account, made by its admin, who buys licenses for it from their
 * own balance, or with a payment that buys them once it's added (deposits.ts). A member without a live license takes one
 * when they visit (they sign in, or the app says it's being used:
 * `POST /v1/session/visit`); none is ever taken by a read. A live license puts its member on Team for `plan.period_seconds`
 * (features/billing/plans.ts › planNow), replacing any Pro they had, with storage from the team's pool:
 * `plan.team.storage_bytes` for each live license, counting what every licensed member stores.
 *
 * A team is an owner of its own, like a workspace: its key seals its name and who's on it. What it bought (its unconsumed
 * licenses and what each cost), auto-purchase, the alerts its admin has been given and its pool's grace are a
 * `team-billing` record under Kservice's accounting key. Every change is made with the team's row locked first, then
 * the plans of whoever it touches, so takes and purchases at once on any instance never spend a license or money twice.
 */
import type { MyTeam, Person, Purchase, TeamInvite, TeamInvitePeek, TeamLicense, TeamMember } from '@alcove/api';
import { z } from 'zod';
import type { Deps, Owner } from '../../context';
import { b64u, blindIndex, id128, openJson, random, sealJson, serviceKey, sha, stateKey, toJson, unb64u, utf8 } from '../../crypto';
import { bigintText, bytea, exec, maybeOne, rows, timestamp, tx, type Db } from '../../db';
import { ConflictError, ForbiddenError, NotFoundError, conflict } from '../../errors';
import { limitsNow, type Limits } from '../../limits';
import { log } from '../../log';
import { createOwner, lockOwner, masterKey, openRoot } from '../../owners';
import { publish } from '../../live/hub';
import { personOf } from '../account/portraits';
import { TREE_NOTICE } from '../workspaces/access';
import { accountOf, leftTeam, purchase, refusedError, replacedByLicense, save, told, withEntry, withNotice, type PlanAccount, type Purchased } from './plans';

const tlog = log.child({ component: 'teams' });
/** How many teams upkeep looks at each time. */
const BATCH = 100;

type Service = Pick<Deps, 'cfg' | 'pool'>;

/* ---------- records ---------- */

/** What a team bought and what its admin has been told, sealed under Kservice's accounting key. */
const Billing = z.object({
  /** Licenses bought and not yet taken, oldest first, with what each cost. */
  licenses: z.array(z.object({ id: z.string(), microUsd: z.number().int() })),
  /** Whether a license is bought from the admin's balance when a member needs one and none is left. */
  autoPurchase: z.boolean(),
  /** The admin was told licenses are low (until there are `team.low_licenses` or more again), and that none were left (until more are bought). */
  low: z.boolean(),
  none: z.boolean(),
  /**
   * The pool as last reckoned: its bytes then, and the grace it got when it shrank below what's stored (held to the pool
   * before it shrank, until `until`). A grace that has run out is kept until the team is within its pool again, so it's
   * only given once for each time it's over.
   */
  pool: z.object({ bytes: z.number().int().nonnegative(), grace: z.object({ until: z.string(), storageBytes: z.number().int() }).nullable() })
});
type Billing = z.infer<typeof Billing>;
const fresh = (): Billing => ({ licenses: [], autoPurchase: false, low: false, none: false, pool: { bytes: 0, grace: null } });

const billingKey = (d: Pick<Deps, 'cfg'>) => serviceKey(unb64u(d.cfg.KSERVICE, 32), 'accounting');
const billingHeader = (t: Pick<TeamRow, 'owner_id' | 'team_id'>) => ({ v: 1 as const, kind: 'team-billing', ownerId: t.owner_id, teamId: t.team_id, keyVersion: '1' });
const sealBilling = (d: Pick<Deps, 'cfg'>, t: Pick<TeamRow, 'owner_id' | 'team_id'>, b: Billing) => sealJson(billingKey(d), billingHeader(t), toJson(b));
const openBilling = (d: Pick<Deps, 'cfg'>, t: TeamRow) => openJson(billingKey(d), billingHeader(t), t.billing_ciphertext, Billing);

/** The team's own key: its name and who's on it. */
/** The key a team's own records are sealed under, derived from its root, for one request: zeroed when it's done. */
interface TeamKey { ownerId: string; key: Uint8Array }
const teamKeyFrom = (ownerId: string, root: Uint8Array): TeamKey => ({ ownerId, key: stateKey(root, ownerId, 'team') });
const Named = z.object({ name: z.string() });
const nameHeader = (team: TeamKey, teamId: string) => ({ v: 1 as const, kind: 'team-name', ownerId: team.ownerId, teamId });
const Who = z.object({ name: z.string(), email: z.string() });
const memberHeader = (team: TeamKey, teamId: string, memberId: string) => ({ v: 1 as const, kind: 'team-member', ownerId: team.ownerId, teamId, memberId });
const nameIn = (team: TeamKey, t: TeamRow) => openJson(team.key, nameHeader(team, t.team_id), t.name_ciphertext, Named).name;
const whoIn = (team: TeamKey, m: MemberRow) => openJson(team.key, memberHeader(team, m.team_id, m.member_id), m.person_ciphertext, Who);

const TeamRow = z.object({ team_id: z.string(), owner_id: z.string(), admin_owner_id: z.string(), name_ciphertext: bytea, billing_ciphertext: bytea });
export type TeamRow = z.infer<typeof TeamRow>;
const TEAM = 'team_id, owner_id, admin_owner_id, name_ciphertext, billing_ciphertext';
const MemberRow = z.object({
  member_id: z.string(), team_id: z.string(), account_owner_id: z.string(), role: z.enum(['admin', 'member']), person_ciphertext: bytea,
  licensed_from: timestamp.nullable(), licensed_until: timestamp.nullable(), wanted_at: timestamp.nullable(), created_at: timestamp
});
type MemberRow = z.infer<typeof MemberRow>;
const MEMBER = 'member_id, team_id, account_owner_id, role, person_ciphertext, licensed_from, licensed_until, wanted_at, created_at';

const membership = (db: Db, ownerId: string, lock = false) =>
  maybeOne(db, MemberRow, `SELECT ${MEMBER} FROM team_members WHERE account_owner_id = $1${lock ? ' FOR UPDATE' : ''}`, [ownerId]);
const teamRow = (db: Db, teamId: string, lock = false) =>
  maybeOne(db, TeamRow, `SELECT ${TEAM} FROM teams WHERE team_id = $1${lock ? ' FOR UPDATE' : ''}`, [teamId]);
const isLive = (m: Pick<MemberRow, 'licensed_from' | 'licensed_until'>, now: number) =>
  m.licensed_from !== null && m.licensed_until !== null && m.licensed_from.getTime() <= now && now < m.licensed_until.getTime();

/** A team's key, for one request. A team whose row was just read is there unless it was deleted since. */
async function teamKeyOf(d: Service, t: Pick<TeamRow, 'owner_id' | 'team_id'>): Promise<TeamKey> {
  const root = await openRoot(d, t.owner_id);
  if (!root) throw new NotFoundError('That team no longer exists.', { context: { teamId: t.team_id } });
  try { return teamKeyFrom(t.owner_id, root); } finally { root.fill(0); }
}
const close = (team: TeamKey) => { team.key.fill(0); };

/* ---------- the pool ---------- */

/** A team's storage at `now`: its live licenses, the pool they make, what the licensed store, and what it's held to. */
export interface Pool { licenses: number; bytes: number; usedBytes: number; heldBytes: number; graceUntil: number | null }

/** How many live licenses a team has at `now`, and what everyone holding one stores: their own, and the workspaces they pay for. */
async function licensedNow(db: Db, teamId: string, now: number): Promise<{ licenses: number; usedBytes: number }> {
  const r = await maybeOne(db, z.object({ licenses: z.number(), bytes: bigintText }), `
    SELECT count(*)::int AS licenses, coalesce(sum(
        (SELECT coalesce(stored_bytes, 0) FROM owners WHERE owner_id = m.account_owner_id)
      + (SELECT coalesce(sum(o.stored_bytes), 0) FROM workspaces w JOIN owners o ON o.owner_id = w.owner_id WHERE w.payer_owner_id = m.account_owner_id)
    ), 0) AS bytes
    FROM team_members m WHERE m.team_id = $1 AND m.licensed_from <= $2 AND m.licensed_until > $2`, [teamId, new Date(now)]);
  return { licenses: r?.licenses ?? 0, usedBytes: r?.bytes ?? 0 };
}

/**
 * The pool as it stands: held to the larger of it and its grace's while one runs; until a shrink is reckoned (a license
 * just ended, before upkeep), to the pool as last reckoned; once a grace has run out, to the pool alone.
 */
function poolView(b: Billing, live: { licenses: number; usedBytes: number }, l: Limits, now: number): Pool {
  const bytes = live.licenses * l.get('plan.team.storage_bytes');
  const g = b.pool.grace;
  const running = g && Date.parse(g.until) > now ? g : null;
  const heldBytes = running ? Math.max(bytes, running.storageBytes) : g === null ? Math.max(bytes, b.pool.bytes) : bytes;
  return { licenses: live.licenses, bytes, usedBytes: live.usedBytes, heldBytes, graceUntil: running ? Date.parse(running.until) : null };
}

/** A team's pool at `now`, without changing anything. */
export async function poolOf(d: Service, db: Db, teamId: string, now = Date.now()): Promise<Pool> {
  const t = await teamRow(db, teamId);
  if (!t) return { licenses: 0, bytes: 0, usedBytes: 0, heldBytes: 0, graceUntil: null };
  return poolView(openBilling(d, t), await licensedNow(db, teamId, now), await limitsNow(d, db), now);
}

/**
 * Reckons the pool after its licenses changed, and saves the team with when upkeep should next look at it: the next license
 * to end, or the grace ending. A pool now smaller than what's stored gets `plan.grace_seconds`, held to what it was.
 */
async function settle(d: Service, c: Db, t: TeamRow, b: Billing, l: Limits, now: number): Promise<Billing> {
  const live = await licensedNow(c, t.team_id, now);
  const bytes = live.licenses * l.get('plan.team.storage_bytes');
  let grace = b.pool.grace;
  if (live.usedBytes <= bytes) grace = null;
  else if (grace === null) {
    grace = { until: new Date(now + l.get('plan.grace_seconds') * 1000).toISOString(), storageBytes: Math.max(b.pool.bytes, live.usedBytes) };
    tlog.info('team pool grace began', { teamId: t.team_id, licenses: live.licenses, poolBytes: bytes, storedBytes: live.usedBytes });
  }
  const next: Billing = { ...b, pool: { bytes, grace } };
  const ends = await maybeOne(c, z.object({ at: timestamp.nullable() }), 'SELECT min(licensed_until) AS at FROM team_members WHERE team_id = $1 AND licensed_until > $2', [t.team_id, new Date(now)]);
  const due = [ends?.at?.getTime(), grace && Date.parse(grace.until) > now ? Date.parse(grace.until) : undefined].filter((x): x is number => x !== undefined);
  await exec(c, 'UPDATE teams SET billing_ciphertext = $2, due_at = $3, version = version + 1 WHERE team_id = $1', [t.team_id, sealBilling(d, t, next), due.length ? new Date(Math.min(...due)) : null]);
  return next;
}
/** Saves what a team bought without touching its pool. */
const saveBilling = (d: Service, c: Db, t: TeamRow, b: Billing) =>
  exec(c, 'UPDATE teams SET billing_ciphertext = $2, version = version + 1 WHERE team_id = $1', [t.team_id, sealBilling(d, t, b)]);

/** Changes an account's plan, in the caller's transaction: its row locked after the team's. */
async function changePlan(d: Service, c: Db, ownerId: string, change: (a: PlanAccount) => PlanAccount): Promise<void> {
  const a = await accountOf(d, c, ownerId, true);
  await save(d, c, ownerId, change(a));
}

/* ---------- who may ---------- */

/** The caller's place on a team, refused when they're on none. */
async function mustBeOn(db: Db, ownerId: string, lock = false): Promise<MemberRow> {
  const m = await membership(db, ownerId, lock);
  if (!m) throw new NotFoundError('You’re not on a team.', { context: { ownerId } });
  return m;
}
/** The caller as their team's admin, with the team's row locked for the rest of the transaction. */
async function asAdmin(c: Db, ownerId: string): Promise<{ m: MemberRow; t: TeamRow }> {
  const was = await mustBeOn(c, ownerId);
  if (was.role !== 'admin') throw new ForbiddenError('Only the team’s admin can do that.', { context: { ownerId, teamId: was.team_id } });
  const t = await teamRow(c, was.team_id, true);
  const m = await membership(c, ownerId);
  if (!t || !m || m.team_id !== t.team_id) throw new NotFoundError('You’re not on a team.', { context: { ownerId } });
  return { m, t };
}

/* ---------- a license, taken on a visit ---------- */

/**
 * Someone is using Alcove (a sign-in, or the app loading or coming back after a while): a member of a team without a live
 * license takes one. One that's unconsumed; or, with auto-purchase on and the admin's balance enough, one bought then;
 * otherwise none, and they stay on their own plan, told to ask their admin, who's told none are left. Taking one replaces
 * any Pro the member had, and tells the admin when fewer than `team.low_licenses` are left. Nothing happens for anyone
 * on no team, or with a live license.
 */
export async function visit(d: Service, ownerId: string): Promise<void> {
  const seen = await membership(d.pool, ownerId);
  if (!seen || isLive(seen, Date.now())) return;
  await tx(d.pool, async (c) => {
    const now = Date.now();
    const t = await teamRow(c, seen.team_id, true);
    const m = await membership(c, ownerId, true);
    if (!t || !m || m.team_id !== t.team_id || isLive(m, now)) return;
    const l = await limitsNow(d, c);
    let b = openBilling(d, t);
    const ctx = { teamId: t.team_id, memberId: m.member_id };
    let bought = false;
    const [first, ...rest] = b.licenses;
    if (first) b = { ...b, licenses: rest };
    else if (b.autoPurchase) {
      const price = l.get('plan.team.price_micro_usd');
      const admin = await accountOf(d, c, t.admin_owner_id, true);
      if (admin.balanceMicroUsd >= price) {
        await save(d, c, t.admin_owner_id, withEntry(admin, -price, 'Team license, bought for a member'));
        bought = true;
      }
    }
    if (!first && !bought) {
      await exec(c, 'UPDATE team_members SET wanted_at = $2 WHERE member_id = $1', [m.member_id, new Date(now)]);
      // The admin manages the team whatever: they're told none are left, not to ask themselves.
      if (m.role !== 'admin') await changePlan(d, c, ownerId, (a) => (told(a, 'license-needed') ? a : withNotice(a, 'license-needed', now)));
      if (!b.none) {
        await changePlan(d, c, t.admin_owner_id, (a) => withNotice(a, 'licenses-none', now));
        b = { ...b, none: true };
        await saveBilling(d, c, t, b);
      }
      tlog.info('team license wanted, none left', { ...ctx, buying: b.autoPurchase });
      return;
    }
    const until = now + l.get('plan.period_seconds') * 1000;
    await exec(c, 'UPDATE team_members SET licensed_from = $2, licensed_until = $3, wanted_at = NULL WHERE member_id = $1', [m.member_id, new Date(now), new Date(until)]);
    let refunded: number | null = null;
    await changePlan(d, c, ownerId, (a) => {
      const r = replacedByLicense(a, now);
      refunded = r.refunded;
      return r.refunded === null ? r.a : withNotice(r.a, 'license-replaced-pro', now, { count: r.refunded });
    });
    const left = b.licenses.length;
    if (left < l.get('team.low_licenses') && !b.low) {
      await changePlan(d, c, t.admin_owner_id, (a) => withNotice(a, 'licenses-low', now, { count: left }));
      b = { ...b, low: true };
    }
    await settle(d, c, t, b, l, now);
    tlog.info('team license taken', { ...ctx, bought, left, proReplaced: refunded !== null, monthsRefunded: refunded ?? 0 });
  });
}

/* ---------- making, joining and leaving ---------- */

/** Someone on a team, sealed under its key: their name and address. */
async function addMember(d: Service, c: Db, team: TeamKey, teamId: string, accountId: string, who: { name: string; email: string }, role: 'admin' | 'member'): Promise<string> {
  const memberId = id128();
  await exec(c, 'INSERT INTO team_members (member_id, team_id, account_owner_id, email_index, role, person_ciphertext) VALUES ($1,$2,$3,$4,$5,$6)', [
    memberId, teamId, accountId, blindIndex(masterKey(d), 'email', who.email), role, sealJson(team.key, memberHeader(team, teamId, memberId), toJson({ name: who.name, email: who.email }))
  ]);
  return memberId;
}

/** Makes a team with its maker as the admin. Refused while they're on one. */
export async function create(o: Owner, me: Pick<Person, 'name' | 'email'>, name: string): Promise<MyTeam> {
  const teamId = id128();
  await tx(o.pool, async (c) => {
    // One at a time for an account, so two at once can't both make it a team.
    await lockOwner(o, c);
    if (await membership(c, o.ownerId)) throw conflict('You’re on a team already. Leave it before making one.', { ownerId: o.ownerId });
    const { ownerId, root } = await createOwner(o, c);
    const team = teamKeyFrom(ownerId, root);
    root.fill(0);
    try {
      await exec(c, 'INSERT INTO teams (team_id, owner_id, admin_owner_id, name_ciphertext, billing_ciphertext) VALUES ($1,$2,$3,$4,$5)', [
        teamId, ownerId, o.ownerId, sealJson(team.key, nameHeader(team, teamId), toJson({ name })), sealBilling(o, { owner_id: ownerId, team_id: teamId }, fresh())
      ]);
      await addMember(o, c, team, teamId, o.ownerId, me, 'admin');
    } finally { close(team); }
  });
  tlog.info('team created', { ownerId: o.ownerId, teamId });
  return requireTeam(o, o.ownerId);
}

/** Admin only: a one-time link to join, for `team.invite_seconds`. Only a hash of its secret is kept. */
export async function invite(o: Owner): Promise<TeamInvite> {
  const m = await mustBeOn(o.pool, o.ownerId);
  if (m.role !== 'admin') throw new ForbiddenError('Only the team’s admin can do that.', { context: { ownerId: o.ownerId, teamId: m.team_id } });
  const secret = b64u(random(32));
  const expiresAt = new Date(Date.now() + (await limitsNow(o)).get('team.invite_seconds') * 1000);
  await exec(o.pool, 'INSERT INTO team_invites (secret_sha256, team_id, expires_at) VALUES ($1,$2,$3)', [sha(utf8(secret)), m.team_id, expiresAt]);
  tlog.info('team invite made', { ownerId: o.ownerId, teamId: m.team_id });
  return { link: `${o.cfg.WEB_ORIGIN}/team/join#${secret}`, expiresAt: expiresAt.toISOString() };
}

const gone = (context: Record<string, string>) => new NotFoundError('That link to join a team has been used or has expired. Ask the team’s admin for a new one.', { context });
const InviteRow = z.object({ team_id: z.string(), expires_at: timestamp });

/** Whose team an invite's link joins. A used, expired or made-up link is the same `not-found`. */
export async function peek(d: Service, secret: string): Promise<TeamInvitePeek> {
  const i = await maybeOne(d.pool, InviteRow, 'SELECT team_id, expires_at FROM team_invites WHERE secret_sha256 = $1', [sha(utf8(secret))]);
  if (!i || i.expires_at.getTime() <= Date.now()) throw gone({ why: i ? 'expired' : 'unknown' });
  const t = await teamRow(d.pool, i.team_id);
  const admin = t && await maybeOne(d.pool, MemberRow, `SELECT ${MEMBER} FROM team_members WHERE team_id = $1 AND role = 'admin'`, [t.team_id]);
  if (!t || !admin) throw gone({ why: 'team-gone' });
  const team = await teamKeyOf(d, t);
  try {
    const who = whoIn(team, admin);
    return { name: nameIn(team, t), admin: personOf(who.email, who.name), expiresAt: i.expires_at.toISOString() };
  } finally { close(team); }
}

/** Joins the team an invite is for, using it up, and takes a license if there's one (joining is a visit). */
export async function join(o: Owner, me: Pick<Person, 'name' | 'email'>, secret: string): Promise<MyTeam> {
  const teamId = await tx(o.pool, async (c) => {
    await lockOwner(o, c);
    // Someone on a team already leaves the link as it was, for whoever it was meant for.
    if (await membership(c, o.ownerId)) throw conflict('You’re on a team already. Leave it before joining another.', { ownerId: o.ownerId });
    const i = await maybeOne(c, InviteRow, 'SELECT team_id, expires_at FROM team_invites WHERE secret_sha256 = $1 FOR UPDATE', [sha(utf8(secret))]);
    if (!i || i.expires_at.getTime() <= Date.now()) throw gone({ ownerId: o.ownerId, why: i ? 'expired' : 'unknown' });
    await exec(c, 'DELETE FROM team_invites WHERE secret_sha256 = $1', [sha(utf8(secret))]);
    const t = await teamRow(c, i.team_id);
    if (!t) throw gone({ ownerId: o.ownerId, why: 'team-gone' });
    const team = await teamKeyOf(o, t);
    try { await addMember(o, c, team, t.team_id, o.ownerId, me, 'member'); } finally { close(team); }
    return t.team_id;
  });
  tlog.info('team joined', { ownerId: o.ownerId, teamId });
  await visit(o, o.ownerId);
  return requireTeam(o, o.ownerId);
}

/**
 * Takes someone off their team, in the caller's transaction with the team's row locked. A live license isn't refunded:
 * they're on Free from now, with `plan.grace_seconds` held to a team's storage for a person. Notes they made visible to
 * the team stay so. The pool is reckoned without them.
 */
async function drop(d: Service, c: Db, t: TeamRow, m: MemberRow, why: 'removed' | 'left'): Promise<void> {
  const now = Date.now();
  const l = await limitsNow(d, c);
  await exec(c, 'DELETE FROM team_members WHERE member_id = $1', [m.member_id]);
  const licensed = isLive(m, now);
  if (licensed) await changePlan(d, c, m.account_owner_id, (a) => leftTeam(a, l, now));
  await settle(d, c, t, openBilling(d, t), l, now);
  await teamWorkspacesMoved(c, t.team_id);
  tlog.info(why === 'removed' ? 'team member removed' : 'team member left', { teamId: t.team_id, memberId: m.member_id, licensed });
}

/** Admin only: takes someone off the team. The admin can't take themselves off. */
export async function remove(o: Owner, memberId: string): Promise<MyTeam> {
  await tx(o.pool, async (c) => {
    const { t } = await asAdmin(c, o.ownerId);
    const m = await maybeOne(c, MemberRow, `SELECT ${MEMBER} FROM team_members WHERE member_id = $1 AND team_id = $2 FOR UPDATE`, [memberId, t.team_id]);
    if (!m) throw new NotFoundError('That person isn’t on your team.', { context: { ownerId: o.ownerId, teamId: t.team_id } });
    if (m.role === 'admin') throw conflict('You can’t take yourself off your own team. Delete the team once nobody else is on it.', { ownerId: o.ownerId, teamId: t.team_id });
    await drop(o, c, t, m, 'removed');
  });
  return requireTeam(o, o.ownerId);
}

/** A member leaves their team. The admin can't. */
export async function leave(o: Owner): Promise<void> {
  await tx(o.pool, async (c) => {
    const was = await mustBeOn(c, o.ownerId);
    if (was.role === 'admin') throw conflict('You’re the team’s admin, so you can’t leave it. Delete the team once nobody else is on it.', { ownerId: o.ownerId, teamId: was.team_id });
    const t = await teamRow(c, was.team_id, true);
    const m = await membership(c, o.ownerId, true);
    if (!t || !m || m.team_id !== t.team_id) throw new NotFoundError('You’re not on a team.', { context: { ownerId: o.ownerId } });
    await drop(o, c, t, m, 'left');
  });
}

/**
 * Someone's place on a team ended before their license did: the team's workspaces for the whole team move on, so nothing
 * remembered of their access there (features/workspaces/access.ts) outlasts it, and every stream of them looks again.
 */
async function teamWorkspacesMoved(c: Db, teamId: string): Promise<void> {
  const moved = await rows(c, z.object({ workspace_id: z.string() }), "UPDATE workspaces SET version = version + 1 WHERE team_id = $1 AND team_access = 'team' RETURNING workspace_id", [teamId]);
  for (const w of moved) await publish(c, w.workspace_id, TREE_NOTICE);
}

/**
 * Deletes a team, in the caller's transaction with its row locked: its workspaces stop being the team's (whoever was in one
 * only through the team isn't any more), and its row, members, invites and notes made visible to it go with its owner row.
 */
async function deleteTeamIn(c: Db, t: TeamRow): Promise<void> {
  await teamWorkspacesMoved(c, t.team_id);
  await exec(c, 'UPDATE workspaces SET team_id = NULL, team_access = NULL WHERE team_id = $1', [t.team_id]);
  await exec(c, 'DELETE FROM owners WHERE owner_id = $1', [t.owner_id]);
}

/** Admin only, once nobody else is on it: deletes the team, refunding its unconsumed licenses to the admin's balance. */
export async function deleteTeam(o: Owner): Promise<void> {
  await tx(o.pool, async (c) => {
    const { m, t } = await asAdmin(c, o.ownerId);
    const others = await maybeOne(c, z.object({ n: z.number() }), 'SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND member_id <> $2', [t.team_id, m.member_id]);
    if ((others?.n ?? 0) > 0) throw conflict('Take everyone else off the team first: a team can be deleted once nobody else is on it.', { ownerId: o.ownerId, teamId: t.team_id, members: others?.n ?? 0 });
    const b = openBilling(o, t);
    const now = Date.now();
    const l = await limitsNow(o, c);
    const microUsd = b.licenses.reduce((n, x) => n + x.microUsd, 0);
    await changePlan(o, c, o.ownerId, (a) => {
      const refunded = b.licenses.length ? withEntry(a, microUsd, `Team licenses refunded, ${b.licenses.length}`) : a;
      return isLive(m, now) ? leftTeam(refunded, l, now) : refunded;
    });
    await deleteTeamIn(c, t);
    tlog.info('team deleted', { ownerId: o.ownerId, teamId: t.team_id, licensesRefunded: b.licenses.length, microUsd });
  });
}

/* ---------- licenses ---------- */

/**
 * The team `ownerId` is the admin of, its row locked for the rest of the caller's transaction (null: they're no team's
 * admin). Every change to a team locks its row before any plan's, so a payment that buys licenses takes this before its
 * money is added to their balance (deposits.ts › apply): a team's row is never locked after a plan's.
 */
export async function adminsTeam(c: Db, ownerId: string): Promise<TeamRow | null> {
  return (await maybeOne(c, TeamRow, `SELECT ${TEAM} FROM teams WHERE admin_owner_id = $1 FOR UPDATE`, [ownerId])) ?? null;
}

/**
 * Buys licenses for `t`, the team `ownerId` is the admin of, from their balance, in the caller's transaction: the team's
 * row locked first, by the caller (`asAdmin`, `adminsTeam`), then their plan's, here (plans.ts › purchase), so buys and
 * takes at once never spend the same money or license twice. Refused with nothing changed as anything bought from the
 * balance is, and when `t` is null: they're no team's admin. What POST /v1/team/licenses does, and what a payment opened to
 * buy licenses does once its money is added (deposits.ts). They wait unconsumed, oldest first, for members to take on a
 * visit, are refunded until then, and let the admin be told again when few or none are left.
 */
export async function licensesBought(d: Service, c: Db, t: TeamRow | null, ownerId: string, buys: Extract<Purchase, { kind: 'licenses' }>): Promise<Purchased> {
  const r = await purchase(d, c, ownerId, buys, { admin: t !== null });
  if (!r.bought || !t) return r;
  const b = openBilling(d, t);
  const licenses = [...b.licenses, ...Array.from({ length: buys.count }, () => ({ id: id128(), microUsd: buys.microUsdPerLicense }))];
  const low = (await limitsNow(d, c)).get('team.low_licenses');
  await saveBilling(d, c, t, { ...b, licenses, none: false, low: b.low && licenses.length < low });
  tlog.info('team licenses bought', { ownerId, teamId: t.team_id, count: buys.count });
  return r;
}

/** Admin only: buys `count` licenses from their balance at `microUsdPerLicense`, the price they were shown. */
export async function buyLicenses(o: Owner, count: number, microUsdPerLicense: number): Promise<MyTeam> {
  await tx(o.pool, async (c) => {
    const { t } = await asAdmin(c, o.ownerId);
    const r = await licensesBought(o, c, t, o.ownerId, { kind: 'licenses', count, microUsdPerLicense });
    if (!r.bought) throw refusedError(r.refusal, { ownerId: o.ownerId, teamId: t.team_id, kind: 'licenses', count });
  });
  return requireTeam(o, o.ownerId);
}

/** Admin only: every unconsumed license back to their balance, at what was paid for it. One someone has taken isn't refunded. */
export async function refundLicenses(o: Owner): Promise<MyTeam> {
  await tx(o.pool, async (c) => {
    const { t } = await asAdmin(c, o.ownerId);
    const b = openBilling(o, t);
    if (!b.licenses.length) throw conflict('There’s no license to refund that nobody has taken. A license someone has taken isn’t refunded.', { ownerId: o.ownerId, teamId: t.team_id });
    const microUsd = b.licenses.reduce((n, x) => n + x.microUsd, 0);
    await changePlan(o, c, o.ownerId, (a) => withEntry(a, microUsd, `Team licenses refunded, ${b.licenses.length}`));
    await saveBilling(o, c, t, { ...b, licenses: [] });
    tlog.info('team licenses refunded', { ownerId: o.ownerId, teamId: t.team_id, count: b.licenses.length, microUsd });
  });
  return requireTeam(o, o.ownerId);
}

/** Admin only: whether a license is bought from their balance when a member needs one and none is left. */
export async function setAutoPurchase(o: Owner, on: boolean): Promise<MyTeam> {
  await tx(o.pool, async (c) => {
    const { t } = await asAdmin(c, o.ownerId);
    await saveBilling(o, c, t, { ...openBilling(o, t), autoPurchase: on });
    tlog.info('team auto-purchase set', { ownerId: o.ownerId, teamId: t.team_id, on });
  });
  return requireTeam(o, o.ownerId);
}

/* ---------- reading ---------- */

const licenseOf = (m: MemberRow, now: number): TeamLicense => ({
  state: isLive(m, now) ? 'live' : m.licensed_until !== null && m.licensed_until.getTime() <= now ? 'ended' : 'none',
  until: m.licensed_until?.toISOString() ?? null,
  wanted: m.wanted_at?.toISOString() ?? null
});

/** The team an account is on, as it sees it: licenses and money only for its admin. Null on none. */
export async function mine(d: Service, ownerId: string): Promise<MyTeam | null> {
  const me = await membership(d.pool, ownerId);
  if (!me) return null;
  const t = await teamRow(d.pool, me.team_id);
  if (!t) return null;
  const now = Date.now();
  const l = await limitsNow(d);
  const b = openBilling(d, t);
  const everyone = await rows(d.pool, MemberRow, `SELECT ${MEMBER} FROM team_members WHERE team_id = $1 ORDER BY created_at, member_id`, [t.team_id]);
  const team = await teamKeyOf(d, t);
  try {
    const members = everyone.map((m): TeamMember => {
      const who = whoIn(team, m);
      return { id: m.member_id, person: personOf(who.email, who.name), role: m.role, license: licenseOf(m, now), joinedAt: m.created_at.toISOString(), you: m.account_owner_id === ownerId };
    });
    const pool = poolView(b, await licensedNow(d.pool, t.team_id, now), l, now);
    return {
      id: t.team_id, name: nameIn(team, t), role: me.role, licensed: isLive(me, now), members,
      storage: { usedBytes: pool.usedBytes, limitBytes: pool.heldBytes },
      licenses: me.role === 'admin' ? { unconsumed: b.licenses.length, refundableMicroUsd: b.licenses.reduce((n, x) => n + x.microUsd, 0), autoPurchase: b.autoPurchase } : null
    };
  } finally { close(team); }
}
async function requireTeam(d: Service, ownerId: string): Promise<MyTeam> {
  const t = await mine(d, ownerId);
  if (!t) throw new NotFoundError('You’re not on a team.', { context: { ownerId } });
  return t;
}

/** The team an account is on, as its plan says it: which, its name, their role, and whether they're licensed. */
export async function teamOf(d: Service, ownerId: string, now = Date.now()): Promise<{ id: string; name: string; role: 'admin' | 'member'; licensed: boolean } | null> {
  const me = await membership(d.pool, ownerId);
  const t = me && await teamRow(d.pool, me.team_id);
  if (!me || !t) return null;
  const team = await teamKeyOf(d, t);
  try { return { id: t.team_id, name: nameIn(team, t), role: me.role, licensed: isLive(me, now) }; }
  finally { close(team); }
}

/**
 * The team an account is live-licensed on at `now`, and when that license ends: what a team's notes and workspaces open
 * for (docs: Plans and usage › Team). Null on no team, and on a team without a live license.
 */
export async function licensedOn(db: Db, ownerId: string, now = Date.now()): Promise<{ teamId: string; until: number } | null> {
  const r = await maybeOne(db, z.object({ team_id: z.string(), licensed_until: timestamp }),
    'SELECT team_id, licensed_until FROM team_members WHERE account_owner_id = $1 AND licensed_from <= $2 AND licensed_until > $2', [ownerId, new Date(now)]);
  return r ? { teamId: r.team_id, until: r.licensed_until.getTime() } : null;
}

/**
 * The same, for whoever signs in with these addresses (keyed hashes, as workspace access knows people): each address that
 * signs in to an account live-licensed on a team at `now`, which team, and when that license ends.
 */
export async function licensedBy(db: Db, emailIndexes: Uint8Array[], now = Date.now()): Promise<{ index: Uint8Array; teamId: string; until: number }[]> {
  if (!emailIndexes.length) return [];
  const found = await rows(db, z.object({ email_index: bytea, team_id: z.string(), licensed_until: timestamp }), `
    SELECT DISTINCT i.email_index, m.team_id, m.licensed_until FROM identities i JOIN team_members m ON m.account_owner_id = i.owner_id
    WHERE i.email_index = ANY($1::bytea[]) AND m.licensed_from <= $2 AND m.licensed_until > $2`, [emailIndexes, new Date(now)]);
  return found.map((r) => ({ index: r.email_index, teamId: r.team_id, until: r.licensed_until.getTime() }));
}

/* ---------- an account going ---------- */

/** The admin of a team with other people on it can't delete their account until it has none. */
export async function refuseDeletingAdmin(db: Db, ownerId: string): Promise<void> {
  const r = await maybeOne(db, z.object({ team_id: z.string(), others: z.number() }), `
    SELECT m.team_id, (SELECT count(*)::int FROM team_members x WHERE x.team_id = m.team_id AND x.member_id <> m.member_id) AS others
    FROM team_members m WHERE m.account_owner_id = $1 AND m.role = 'admin'`, [ownerId]);
  if (r && r.others > 0) {
    throw new ConflictError('You’re the admin of a team with other people on it. Take them off the team and delete it before deleting your account.', { context: { ownerId, teamId: r.team_id, members: r.others }, level: 'info' });
  }
}

/**
 * An account being deleted, in its deletion's transaction: the admin's empty team goes with it (refused while anyone else
 * is on it); a member's place goes, and their team's pool is reckoned without them by upkeep. Says what went.
 */
export async function forgetMembership(c: Db, ownerId: string): Promise<{ left: boolean; teamDeleted: boolean }> {
  const m = await membership(c, ownerId, true);
  if (!m) return { left: false, teamDeleted: false };
  if (m.role === 'admin') {
    await refuseDeletingAdmin(c, ownerId);
    const t = await teamRow(c, m.team_id, true);
    if (t) await deleteTeamIn(c, t);
    return { left: true, teamDeleted: t !== undefined };
  }
  await exec(c, 'DELETE FROM team_members WHERE member_id = $1', [m.member_id]);
  await exec(c, 'UPDATE teams SET due_at = $2 WHERE team_id = $1', [m.team_id, new Date()]);
  await teamWorkspacesMoved(c, m.team_id);
  return { left: true, teamDeleted: false };
}

/* ---------- upkeep ---------- */

/**
 * Upkeep for teams: deletes invites that have expired, and looks at every team that's due (a license ended, so its pool
 * shrank; a grace ending): reckons its pool and when it's next due. Says how many invites went and teams it looked at.
 */
export async function upkeep(d: Service): Promise<{ invites: number; teams: number }> {
  const invites = await exec(d.pool, 'DELETE FROM team_invites WHERE expires_at <= $1', [new Date()]);
  let teams = 0;
  for (;;) {
    const one = await tx(d.pool, async (c) => {
      const now = Date.now();
      const t = await maybeOne(c, TeamRow, `SELECT ${TEAM} FROM teams WHERE due_at <= $1 ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [new Date(now)]);
      if (!t) return false;
      await settle(d, c, t, openBilling(d, t), await limitsNow(d, c), now);
      return true;
    });
    if (!one) break;
    if (++teams >= BATCH) break;
  }
  return { invites, teams };
}
