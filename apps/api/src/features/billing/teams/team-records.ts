/*
 * A team's rows and its own sealed records (docs: Plans and usage › Team): the `teams` row and who's on it, the key its name
 * and people are sealed under, worked out from the team's root for one request, whether anyone on it holds a live license,
 * and the glimpse of it an invitation shows someone not on it. Everything a team does is in ./teams.ts, ./joining.ts, ./invitations.ts and
 * ./invite-links.ts; this is what they share.
 */
import type { Person, TeamGlimpse } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../../platform/context';
import { id128, openJson, sealJson, stateKey, toJson } from '../../../keys/crypto';
import { bytea, exec, maybeOne, rows, timestamp, type Db } from '../../../platform/db';
import { conflict, DatabaseError, NotFoundError } from '../../../platform/errors';
import { createOwner, openRootKey } from '../../../keys/owners';
import { portraitFor } from '../../profile/portraits';

export type Service = Pick<Deps, 'cfg' | 'pool'>;

export const TeamRow = z.object({ team_id: z.string(), owner_id: z.string(), admin_owner_id: z.string(), name_ciphertext: bytea, billing_ciphertext: bytea });
export type TeamRow = z.infer<typeof TeamRow>;
export const TEAM = 'team_id, owner_id, admin_owner_id, name_ciphertext, billing_ciphertext';
export const MemberRow = z.object({
  member_id: z.string(), team_id: z.string(), account_owner_id: z.string(), role: z.enum(['admin', 'member']), person_ciphertext: bytea,
  licensed_from: timestamp.nullable(), licensed_until: timestamp.nullable(), wanted_at: timestamp.nullable(), created_at: timestamp
});
export type MemberRow = z.infer<typeof MemberRow>;
export const MEMBER = 'member_id, team_id, account_owner_id, role, person_ciphertext, licensed_from, licensed_until, wanted_at, created_at';

/** An account's place on a team (undefined: it's on none). `lock` holds it for the rest of the caller's transaction. */
export const membership = (db: Db, ownerId: string, lock = false) =>
  maybeOne(db, MemberRow, `SELECT ${MEMBER} FROM team_members WHERE account_owner_id = $1${lock ? ' FOR UPDATE' : ''}`, [ownerId]);
export const teamRow = (db: Db, teamId: string, lock = false) =>
  maybeOne(db, TeamRow, `SELECT ${TEAM} FROM teams WHERE team_id = $1${lock ? ' FOR UPDATE' : ''}`, [teamId]);
/** Everyone on a team, in the order they joined: its admin first of those who joined as it was made (a link's join makes both). */
export const membersOf = (db: Db, teamId: string) => rows(db, MemberRow, `SELECT ${MEMBER} FROM team_members WHERE team_id = $1 ORDER BY created_at, role = 'member', member_id`, [teamId]);
export const isLive = (m: Pick<MemberRow, 'licensed_from' | 'licensed_until'>, now: number) =>
  m.licensed_from !== null && m.licensed_until !== null && m.licensed_from.getTime() <= now && now < m.licensed_until.getTime();

/** Whether anyone on a team holds a live license at `now`: half of what its tier is (teams.ts › tierOf). */
export async function anyLive(db: Db, teamId: string, now = Date.now()): Promise<boolean> {
  const live = await maybeOne(db, z.object({ one: z.number() }), 'SELECT 1 AS one FROM team_members WHERE team_id = $1 AND licensed_from <= $2 AND licensed_until > $2 LIMIT 1', [teamId, new Date(now)]);
  return live !== undefined;
}

/**
 * Runs a change to a team that holds the rows it touches, saying as a conflict to try again, never as Alcove failing, what two
 * changes at once can still run into past them: a row made just before it (Postgres's 23505) or gone from under it (23503).
 */
export async function raced<T>(context: Record<string, string>, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const pgCode = e instanceof DatabaseError ? e.context['pgCode'] : undefined;
    if (pgCode === '23505' || pgCode === '23503') throw conflict('Someone changed the team at the same moment. Try again.', { ...context, why: 'race', pgCode });
    throw e;
  }
}

/* ---------- the team's own keys ---------- */

/**
 * A team's root and the key its own records are sealed under, worked out from it, for one request: zeroed when it's done
 * (`close`). The root is only for what's worked out from it each time, as an invitation's link is.
 */
export interface TeamKey { ownerId: string; key: Uint8Array; root: Uint8Array }
const keyFrom = (ownerId: string, root: Uint8Array): TeamKey => ({ ownerId, key: stateKey(root, ownerId, 'team'), root });
/** A team's keys, for one request. A team whose row was just read is there unless it was deleted since. */
export async function teamKeyOf(d: Service, t: Pick<TeamRow, 'owner_id' | 'team_id'>, db: Db = d.pool): Promise<TeamKey> {
  const root = await openRootKey(d, t.owner_id, db);
  if (!root) throw new NotFoundError('That team no longer exists.', { context: { teamId: t.team_id } });
  return keyFrom(t.owner_id, root);
}
export const close = (team: TeamKey): void => { team.key.fill(0); team.root.fill(0); };
/** Runs `fn` with a team's keys, closing them after, however it ends. */
export async function withTeam<T>(d: Service, t: Pick<TeamRow, 'owner_id' | 'team_id'>, fn: (team: TeamKey) => Promise<T> | T, db: Db = d.pool): Promise<T> {
  const team = await teamKeyOf(d, t, db);
  try { return await fn(team); } finally { close(team); }
}

const Named = z.object({ name: z.string() });
const nameHeader = (team: TeamKey, teamId: string) => ({ v: 1 as const, kind: 'team-name', ownerId: team.ownerId, teamId });
/** Someone on a team as its key seals them: their name and address, as their account has them. */
export const Who = z.object({ name: z.string(), email: z.string() });
export type Who = z.infer<typeof Who>;
const memberHeader = (team: TeamKey, teamId: string, memberId: string) => ({ v: 1 as const, kind: 'team-member', ownerId: team.ownerId, teamId, memberId });
export const nameIn = (team: TeamKey, t: TeamRow): string => openJson(team.key, nameHeader(team, t.team_id), t.name_ciphertext, Named).name;
export const sealedName = (team: TeamKey, teamId: string, name: string): Uint8Array => sealJson(team.key, nameHeader(team, teamId), toJson({ name }));
export const whoIn = (team: TeamKey, m: MemberRow): Who => openJson(team.key, memberHeader(team, m.team_id, m.member_id), m.person_ciphertext, Who);
export const sealedWho = (team: TeamKey, teamId: string, memberId: string, who: Who): Uint8Array =>
  sealJson(team.key, memberHeader(team, teamId, memberId), toJson({ name: who.name, email: who.email }));

/** Someone on a team, sealed under its key: their name and address, and nothing in the clear but IDs and their role. Says their member ID. */
export async function addMember(c: Db, team: TeamKey, teamId: string, accountId: string, who: Who, role: 'admin' | 'member'): Promise<string> {
  const memberId = id128();
  await exec(c, 'INSERT INTO team_members (member_id, team_id, account_owner_id, role, person_ciphertext) VALUES ($1,$2,$3,$4,$5)', [
    memberId, teamId, accountId, role, sealedWho(team, teamId, memberId, who)
  ]);
  return memberId;
}

/**
 * Makes a team, free, in the caller's transaction, which holds its admin's account: an owner of its own, named `name`, with
 * `admin` (their account and who they are) as its admin and only member. `billing`: what it starts having bought, sealed
 * by the caller (nothing). Says its ID and its admin's member ID.
 */
export async function makeTeam(d: Deps, c: Db, admin: { ownerId: string; who: Who }, name: string, billing: (t: Pick<TeamRow, 'owner_id' | 'team_id'>) => Uint8Array): Promise<{ teamId: string; memberId: string }> {
  const teamId = id128();
  const { ownerId, root } = await createOwner(d, c);
  const team = keyFrom(ownerId, root);
  try {
    await exec(c, 'INSERT INTO teams (team_id, owner_id, admin_owner_id, name_ciphertext, billing_ciphertext) VALUES ($1,$2,$3,$4,$5)', [
      teamId, ownerId, admin.ownerId, sealedName(team, teamId, name), billing({ owner_id: ownerId, team_id: teamId })
    ]);
    return { teamId, memberId: await addMember(c, team, teamId, admin.ownerId, admin.who, 'admin') };
  } finally { close(team); }
}

/* ---------- a glimpse, for someone not on it ---------- */

/** How many of a team's people a glimpse shows. */
const FACES = 4;
/**
 * Someone on a team as a glimpse shows them to someone who isn't: their name and portrait, by their member ID, and never their
 * address. The portrait Alcove draws for someone without a photo follows from their address, which anyone can work out from
 * a guess at it, so here it follows from their member ID instead, which names nobody; but for who sent the invitation or the
 * link (`sender`), whose address it shows anyway, who looks as they do everywhere.
 */
const faceOf = (m: MemberRow, who: Who, sender: boolean): Person => ({ id: m.member_id, name: who.name, email: '', portrait: portraitFor(sender ? who.email : m.member_id) });

/**
 * A team as an invitation or a team's link shows it to someone not on it (`TeamGlimpse`): its name, how many are on it, and
 * up to FACES of them, `sender` (the account whose invitation or link it is) first, then in the order they joined. Opened
 * with the team's keys, which the caller holds.
 */
export async function glimpseOf(db: Db, team: TeamKey, t: TeamRow, sender?: string | undefined): Promise<TeamGlimpse> {
  const everyone = await membersOf(db, t.team_id);
  const ordered = [...everyone.filter((m) => m.account_owner_id === sender), ...everyone.filter((m) => m.account_owner_id !== sender)];
  return { name: nameIn(team, t), people: everyone.length, faces: ordered.slice(0, FACES).map((m) => faceOf(m, whoIn(team, m), m.account_owner_id === sender)) };
}
