/*
 * What support does for an account's plan (docs: Plans and usage › Support), through the commands `pnpm billing`
 * (billing-cli.ts) and the operator route (operator/routes.ts) both run (support-commands.ts): say where it stands, and add
 * dollars to its balance, such as what a failed top-up or a stray payment brought the treasury. An account is named by a
 * top-up's reference (its deposit ID, which the person gives support) or by its ID: a person's, one that signs in, never a
 * workspace's or a team's, which are owners too. Only on the command line where KMASTER is set, which is locally, an address
 * finds it, as sign-in finds one (a blind index under the index key the API runs with), so no address is stored, logged, or
 * taken by an operator route. The rules for naming an account are here alone, for every operator route that takes one
 * (`REFERENCE`, `ACCOUNT`, `personAccount`, `accountsSigningInWith`, `topUpOwner`). What this says may be kept in a log, so it
 * says only what a log may hold: the plan, whether and why Pro renews, the license and the team, counts, states and the day a
 * license runs to; never an amount, a history or an address. Saying where a plan stands changes nothing: an account with no
 * plan yet is said to have none, and none is made.
 */
import { TopUpStateSchema, type PlanNoticeKind, type TopUpState } from '@alcove/api';
import { z } from 'zod';
import type { Config } from '../../platform/config';
import { blindIndex } from '../../keys/crypto';
import { exec, maybeOne, rows, timestamp, tx, type Db } from '../../platform/db';
import { conflict, ConflictError, ForbiddenError, InternalError, NotFoundError, ValidationError } from '../../platform/errors';
import { limitsNow } from '../../platform/limits';
import { log } from '../../platform/log';
import { indexKey } from '../../keys/owners';
import { closedBySupport } from './top-ups/deposits';
import { storageOf, storageState } from './meter/held';
import { standing } from './meter/meter';
import { credit, hasPlan, planNow, proOf, type Accounting } from './plans';

const slog = log.child({ component: 'billing-support' });
/**
 * What support reads: what plans do, and the key the blind indexes are keyed by where it's at hand: always in the API, and
 * on the command line where KMASTER is set, to find an account by an address there.
 */
export type Support = Accounting & { cfg: Partial<Pick<Config, 'INDEX_KEY'>> };
/** The account a support command is about, and the top-up it was named by, if it was. */
export interface Named { ownerId: string; depositId: string | null }
/**
 * How an account may be named: `ids`, by a top-up's reference or the account's ID, as the operator route takes it; or
 * `ids-and-addresses`, by those or, where the index key is at hand, an address it signs in with, as the command line does.
 */
export type Lookup = 'ids' | 'ids-and-addresses';
/** A credit through the operator route: the key that sent it, and the ticket it's for (a reference, never prose). */
export interface Ticket { keyId: string; reason: string }

/** A top-up's reference: an ID of 22 characters of base64url, as checkout shows it. */
export const REFERENCE = /^[A-Za-z0-9_-]{22}$/;
/** An account's ID: 43 characters of base64url. */
export const ACCOUNT = /^[A-Za-z0-9_-]{43}$/;
/** How many credits one operator key makes through the route in a day (UTC). Each is at most $1,000 (support-commands.ts). */
const CREDITS_A_DAY = 2;

/** The index key (owners.ts), where this has it. The caller zeroes it. */
function indexKeyOf(d: Support): Uint8Array | undefined {
  const known = d.cfg.INDEX_KEY;
  return known === undefined ? undefined : indexKey({ cfg: { INDEX_KEY: known } });
}

/**
 * The person's account `id` is, refused as nobody's when nobody signs in with it. A person's account is one that signs in:
 * a workspace and a team are owners too, with no identity of their own, so their IDs read as IDs nobody has.
 */
export async function personAccount(db: Db, id: string): Promise<string> {
  if (!(await maybeOne(db, z.object({ n: z.number() }), 'SELECT 1 AS n FROM identities WHERE owner_id = $1 LIMIT 1', [id]))) throw new NotFoundError('No account has that ID.');
  return id;
}

/**
 * The accounts that sign in with `email`, found by its blind index under `index` as sign-in finds them: none, one, or one for
 * each provider it signs in with. Neither the address nor its hash goes anywhere but this query.
 */
export async function accountsSigningInWith(db: Db, index: Uint8Array, email: string): Promise<string[]> {
  const found = await rows(db, z.object({ owner_id: z.string() }), 'SELECT DISTINCT owner_id FROM identities WHERE email_index = $1', [blindIndex(index, 'email', email)]);
  return found.map((r) => r.owner_id);
}

/** The account whose top-up `reference` is: refused when no top-up has it, or more than one account has one with it. */
export async function topUpOwner(db: Db, reference: string): Promise<string> {
  const found = await rows(db, z.object({ owner_id: z.string() }), 'SELECT owner_id FROM deposits WHERE deposit_id = $1', [reference]);
  const [one, ...more] = found;
  if (!one) throw new NotFoundError('No top-up has that reference.');
  if (more.length) throw conflict('More than one account has a top-up with that reference. Nothing was done.', { accounts: found.length });
  return one.owner_id;
}

/** The account signed in with `email` (`accountsSigningInWith`), refused when there's none, or more than one (signed in with different providers). */
async function accountByEmail(db: Db, index: Uint8Array, email: string): Promise<string> {
  const found = await accountsSigningInWith(db, index, email);
  const [one, ...more] = found;
  if (one === undefined) throw new NotFoundError('No account has signed in with that address.');
  if (more.length) throw conflict(`${found.length} accounts signed in with that address. Nothing was done.`, { accounts: found.length });
  return one;
}

/**
 * The account `who` names, as support types it: a top-up's reference, a person's account ID, or by `ids-and-addresses` where
 * the index key is at hand, an address it signs in with. Anything else, or nothing there, is refused; a workspace's or a
 * team's ID reads as nobody's, the same as an ID nobody has. Nothing typed is said back.
 */
export async function named(d: Support, who: string, lookup: Lookup): Promise<Named> {
  const typed = who.trim();
  if (REFERENCE.test(typed)) return { ownerId: await topUpOwner(d.pool, typed), depositId: typed };
  if (ACCOUNT.test(typed)) return { ownerId: await personAccount(d.pool, typed), depositId: null };
  if (lookup === 'ids' || !typed.includes('@')) throw new ValidationError('Name the account by a top-up’s reference or by its ID.');
  const index = indexKeyOf(d);
  if (!index) throw new ValidationError('An address finds an account only where KMASTER is set, as it is locally. Name it by a top-up’s reference or by its ID.');
  try { return { ownerId: await accountByEmail(d.pool, index, typed), depositId: null }; } finally { index.fill(0); }
}

/**
 * Records a credit made through the operator route, in the credit's own transaction, or refuses it with nothing added. Each
 * is kept as a keyed hash and the key that sent it, never an amount or an account's ID. By an account's ID it's a hash of
 * the account and the ticket's reference, whatever its case (SUP-1182 and sup-1182 are one ticket), so the same credit sent
 * again, its answer lost on the way back, adds nothing. By a top-up's reference it's a hash of the top-up under a label of
 * its own (`top-up`, where an account's ID of 43 characters goes), so the two never meet: `closedBySupport` has seen to it
 * that the top-up adds its money once, and the row is there to count. Then the key's credits today (UTC) are counted, this
 * one with them, in the database every instance shares, so a key's third credit of the day is refused whichever instance
 * answers and whatever restarted. The caller holds the key's lock (`creditBySupport`), so its credits are counted one at a time.
 */
async function recorded(d: Support, c: Db, n: Named, ticket: Ticket): Promise<void> {
  const index = indexKeyOf(d);
  if (!index) throw new InternalError('A credit through the operator route needs the index key.', { context: { ownerId: n.ownerId } });
  let digest: Uint8Array;
  try {
    digest = blindIndex(index, 'operator-credit', n.depositId === null ? `${n.ownerId}\n${ticket.reason.toLowerCase()}` : `top-up\n${n.ownerId}\n${n.depositId}`);
  } finally { index.fill(0); }
  const kept = await exec(c, 'INSERT INTO operator_credits (digest, key_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [digest, ticket.keyId]);
  if (!kept && n.depositId === null) throw new ConflictError('That ticket already added money to this account. Nothing was added.', { context: { ownerId: n.ownerId, why: 'ticket used' } });
  if (!kept) throw new ConflictError('This top-up’s money was added already. Nothing was added.', { context: { ownerId: n.ownerId, depositId: n.depositId, why: 'top-up used' } });
  const today = await maybeOne(c, z.object({ n: z.number().int() }), `
    SELECT count(*)::int AS n FROM operator_credits
    WHERE key_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [ticket.keyId]);
  if ((today?.n ?? 0) > CREDITS_A_DAY) {
    throw new ForbiddenError('A key adds money at most twice a day (UTC), and this one has already today. Nothing was added.', { context: { why: 'a day’s most' } });
  }
}

/**
 * Adds `microUsd` to the balance of the account `who` names (`named`, by `lookup`), as "Added by support", in one transaction.
 * Named by a top-up's reference, it's that top-up's money, added in its place: it stops adding itself, even by a check already
 * on its way to 1Click, and one Alcove still watches, or added already, is refused with nothing added (`closedBySupport`), so
 * a top-up's money is added once. Named by the account's ID, it's money of its own. With a `ticket` (the operator route) the
 * credit is recorded and counted for the key's day (`recorded`), and one ticket adds money to an account once. One key's
 * credits through the route wait on each other, by a lock on its ID held to the end of the transaction, taken before any
 * row's, so two at once can't both pass the day's count. Says which account, and the top-up's state now.
 */
export async function creditBySupport(d: Support, who: string, microUsd: number, o: { lookup: Lookup; ticket?: Ticket | undefined }): Promise<Named & { state: TopUpState | null }> {
  const n = await named(d, who, o.lookup);
  const { ticket } = o;
  const state = await tx(d.pool, async (c) => {
    if (ticket) await exec(c, "SELECT pg_advisory_xact_lock(hashtext('alcove/operator-credits'), hashtext($1))", [ticket.keyId]);
    const was = n.depositId === null ? null : await closedBySupport(c, n.ownerId, n.depositId);
    if (ticket) await recorded(d, c, n, ticket);
    await credit(d, c, n.ownerId, microUsd, 'Added by support');
    return was;
  });
  slog.info('balance added by support', { ownerId: n.ownerId, depositId: n.depositId });
  return { ...n, state };
}

const TopUps = z.object({ state: TopUpStateSchema, n: z.number().int() });
/** An account's place on a team, and its team's counts: everyone on it, live licenses, and invites that haven't expired. */
const Place = z.object({ role: z.enum(['admin', 'member']), licensed_until: timestamp.nullable(), members: z.number().int(), licenses: z.number().int(), invites: z.number().int() });
/** The day a time falls on (UTC), as a log may hold it: 2026-11-13. */
const dayOf = (at: Date) => at.toISOString().slice(0, 10);

/**
 * Where an account's plan stands, as lines a log may hold: the account, the top-up it was named by and its state, its plan,
 * whether Pro renews and why it will or won't (`buys`, `off`, `price`, `short`, or `none` with no month left to renew), how
 * many months of Pro aren't over, its team license (the role it holds it in, and the day it runs to) and its team (its role,
 * and how many are on it, hold a live license or are invited), whether the balance covers a month of Pro at its price now,
 * how many changes to the balance are kept, the notices waiting by kind, whether notes have stopped for the period, whether
 * storage is within its limit, over it in a grace or over it, and how many top-ups it has in each state. Nothing else about
 * the person: no amount, no history, no address, and no time but the day a license runs to. An account with no plan yet
 * (from before plans) is said to have none, with its license, team and top-ups: reading it never makes one, which would
 * start a grace for storage already over Free's from this moment.
 */
export async function standingOf(d: Accounting, n: Named): Promise<string[]> {
  const now = Date.now();
  const topUps = await rows(d.pool, TopUps, 'SELECT state, count(*)::int AS n FROM deposits WHERE owner_id = $1 GROUP BY state ORDER BY state', [n.ownerId]);
  const topUp = n.depositId === null ? null : await maybeOne(d.pool, z.object({ state: TopUpStateSchema }), 'SELECT state FROM deposits WHERE owner_id = $1 AND deposit_id = $2', [n.ownerId, n.depositId]);
  const place = await maybeOne(d.pool, Place, `
    SELECT m.role, m.licensed_until,
      (SELECT count(*)::int FROM team_members x WHERE x.team_id = m.team_id) AS members,
      (SELECT count(*)::int FROM team_members x WHERE x.team_id = m.team_id AND x.licensed_from <= now() AND x.licensed_until > now()) AS licenses,
      (SELECT count(*)::int FROM team_invites i WHERE i.team_id = m.team_id AND i.expires_at > now()) AS invites
    FROM team_members m WHERE m.account_owner_id = $1`, [n.ownerId]);
  const account = [`Account ${n.ownerId}`, ...(topUp && n.depositId !== null ? [`Top-up ${n.depositId}: ${topUp.state}`] : [])];
  const license = `License: ${place?.licensed_until ? `${place.role} until ${dayOf(place.licensed_until)}` : 'none'}`;
  const team = place ? [`Team: ${place.role}; members ${place.members}; licenses ${place.licenses}; open invites ${place.invites}`] : [];
  const held = `Top-ups: ${topUps.length ? topUps.map((t) => `${t.n} ${t.state}`).join(', ') : 'none'}`;
  if (!(await hasPlan(d.pool, n.ownerId))) return [...account, 'Plan: none yet; it’s made on Free when the account is next used, or by upkeep', license, ...team, held];
  const l = await limitsNow(d);
  const { a, p } = await planNow(d, d.pool, n.ownerId, now);
  const notes = await standing(d, d.pool, n.ownerId);
  const storage = storageState(await storageOf(d, d.pool, n.ownerId, now));
  const waiting = new Map<PlanNoticeKind, number>();
  for (const x of a.notices) if (!x.dismissed) waiting.set(x.kind, (waiting.get(x.kind) ?? 0) + 1);
  return [
    ...account,
    `Plan: ${p.kind}; renewing Pro ${a.renew ? 'on' : 'off'}`,
    `Renewal: ${proOf(a, l, now).renewal ?? 'none'}`,
    `Months of Pro not over: ${a.pro.filter((m) => Date.parse(m.to) > now).length}`,
    license,
    ...team,
    `Balance: ${a.balanceMicroUsd >= l.get('plan.pro.price_micro_usd') ? 'covers' : 'doesn’t cover'} a month of Pro`,
    `Changes to the balance kept: ${a.history.length}`,
    `Notices waiting: ${waiting.size ? [...waiting].map(([kind, count]) => `${kind} ${count}`).join(', ') : 'none'}`,
    `Notes: ${notes.ranOut ? 'stopped' : 'running'}`,
    `Storage: ${storage === 'grace' ? 'in grace' : storage}`,
    held
  ];
}
