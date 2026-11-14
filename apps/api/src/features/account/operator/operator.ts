/*
 * What an operator may see and do about an account from outside the enclave: why it can't sign in, and what its agents hold.
 * Its keys (which envelopes its root key has, and whether it opens here), its sign-in sessions by provider, its agents'
 * connections, and its plan's kind, as a pointer to `billing show` for the rest. Then the two actions on it: finding it by the
 * address it signs in with, hashed here as sign-in hashes it and never logged, hashed or not; and signing it out everywhere,
 * at the person's request. An account is a person's: one with a sign-in identity, never a workspace's or a team's, which are
 * owners too and read here as nobody's, as support names one (billing/support.ts › ACCOUNT, personAccount). Times are to the
 * hour, and the day it was made is a day. Nothing sealed is opened but the account's root key, to say whether it opens (or
 * why not, by the error's class and code), and its plan, to say its kind. A look changes nothing: an account with no plan yet
 * (from before plans) is said to have none, and none is made.
 */
import { PlanKindSchema, SignInProviderSchema, type PlanKind } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../../platform/context';
import { exec, maybeOne, rows, timestamp } from '../../../platform/db';
import { NotFoundError, ValidationError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import { failureOf } from '../../../platform/runs';
import { indexKey, openRootKey } from '../../../keys/owners';
import { sessionEnded } from '../../../keys/sessions';
import { MAX_CONNECTIONS, MAX_TOKEN_HISTORY } from '../../agents/service';
import { hasPlan, planNow } from '../../billing/plans';
import { ACCOUNT, accountsSigningInWith, personAccount } from '../../billing/support';

const alog = log.child({ component: 'account' });

/** GET /v1/operator/accounts/:accountId. Times are ISO 8601, to the hour. */
export const AccountAnswer = z.object({
  instance: z.string(), at: z.string(),
  accountId: z.string(),
  /** The day it was made (UTC). */
  madeOn: z.string(),
  /**
   * Its root key's envelopes, under the master now (`v2`, inside a TEE) and under the one from before (`v1`), and whether it
   * opens here: when it doesn't, the error's class and its most specific code (platform/runs.ts › failureOf; null when it has
   * none).
   */
  keys: z.object({ v2: z.boolean(), v1: z.boolean(), opens: z.boolean(), error: z.object({ errorClass: z.string(), code: z.string().nullable() }).nullable() }),
  signIn: z.object({
    /** When it last signed in, with any provider. */
    last: z.string().nullable(),
    /** For each provider it has sessions with: how many are live, when the newest of those started, and when one was last seen. */
    sessions: z.array(z.object({ provider: SignInProviderSchema, live: z.number().int(), newestStarted: z.string().nullable(), lastSeen: z.string().nullable() })),
    /** Sessions that have ended (run out, or idle too long) and are still to be swept. */
    endedNotSwept: z.number().int()
  }),
  agents: z.object({
    /** Connections live now, and the most it can have. */
    live: z.number().int(), most: z.number().int(),
    /** Every connection still kept: whether it's live, its times, its refresh tokens still usable, and its credentials kept against their most. */
    connections: z.array(z.object({
      id: z.string(), live: z.boolean(), made: z.string(), expires: z.string(), lastUsed: z.string().nullable(),
      liveRefreshTokens: z.number().int(), tokenRows: z.number().int(), mostTokenRows: z.number().int()
    }))
  }),
  /**
   * The plan it's on now, `billing show` saying the rest: `none` while it has none yet (from before plans, until it's next used
   * or upkeep gives it one), and null when its plan doesn't open here.
   */
  plan: z.object({ kind: z.union([PlanKindSchema, z.literal('none')]) }).nullable()
});
export type AccountAnswer = z.infer<typeof AccountAnswer>;
/** POST /v1/operator/accounts/find: how many accounts sign in with the address, and the account's ID when exactly one does. */
export const AccountFound = z.object({ instance: z.string(), at: z.string(), found: z.number().int().nonnegative(), accountId: z.string().optional() });
export type AccountFound = z.infer<typeof AccountFound>;
/** POST /v1/operator/accounts/:accountId/sessions/end: how many sessions it ended. */
export const SignedOut = z.object({ instance: z.string(), at: z.string(), ended: z.number().int().nonnegative() });
export type SignedOut = z.infer<typeof SignedOut>;

const HOUR = 3_600_000;
const toHour = (at: Date) => new Date(Math.floor(at.getTime() / HOUR) * HOUR).toISOString();
const orNull = (at: Date | null) => (at === null ? null : toHour(at));
/** A session that's live: not one the sweep removes (keys/sessions.ts › sessionEnded), whatever it was opened with. */
const LIVE = `NOT ${sessionEnded('s')}`;

/**
 * The person's account `typed` names, refused as nobody's when it isn't an account's ID, when nobody has that ID, and when it's
 * a workspace's or a team's. What was typed is never said back.
 */
async function personOf(d: Deps, typed: string): Promise<string> {
  if (!ACCOUNT.test(typed)) throw new ValidationError('An account’s ID is 43 letters, digits, - and _.');
  return personAccount(d.pool, typed);
}

const OwnerRow = z.object({ created_at: timestamp, v2: z.boolean(), v1: z.boolean(), last_sign_in: timestamp.nullable() });
const SessionRow = z.object({ provider: SignInProviderSchema, live: z.number().int(), newest: timestamp.nullable(), seen: timestamp.nullable(), ended: z.number().int() });
const GrantRow = z.object({ id: z.string(), live: z.boolean(), created_at: timestamp, expires_at: timestamp, last_used_at: timestamp.nullable(), refresh: z.number().int(), tokens: z.number().int() });

/**
 * The plan the account is on now; `none` while it has none yet, which looking never makes, so a look starts no grace; or null
 * when its plan doesn't open here: the rest of the lookup still answers.
 */
async function planKind(d: Deps, ownerId: string): Promise<{ kind: PlanKind | 'none' } | null> {
  try {
    if (!(await hasPlan(d.pool, ownerId))) return { kind: 'none' };
    return { kind: (await planNow(d, d.pool, ownerId)).p.kind };
  } catch (e) {
    alog.warn('account’s plan doesn’t open', { ownerId, err: e });
    return null;
  }
}

/** Whether the account's root key opens here, and if not, why, as the error's class and code (failureOf). */
async function keysOpen(d: Deps, ownerId: string): Promise<{ opens: boolean; error: { errorClass: string; code: string | null } | null }> {
  try {
    const root = await openRootKey(d, ownerId);
    root?.fill(0);
    return { opens: root !== undefined, error: null };
  } catch (e) {
    alog.warn('account’s key doesn’t open', { ownerId, err: e });
    return { opens: false, error: failureOf(e) };
  }
}

/** Why an account can't sign in, and what its agents hold (AccountAnswer, but for who answered and when). */
export async function accountReport(d: Deps, typed: string): Promise<Omit<AccountAnswer, 'instance' | 'at'>> {
  const ownerId = await personOf(d, typed);
  const owner = await maybeOne(d.pool, OwnerRow, `
    SELECT created_at, root_envelope_v2 IS NOT NULL AS v2, root_envelope IS NOT NULL AS v1,
      (SELECT max(last_used_at) FROM identities WHERE owner_id = $1) AS last_sign_in
    FROM owners WHERE owner_id = $1`, [ownerId]);
  if (!owner) throw new NotFoundError('No account has that ID.');
  const sessions = await rows(d.pool, SessionRow, `
    SELECT provider, count(*) FILTER (WHERE ${LIVE})::int AS live, max(created_at) FILTER (WHERE ${LIVE}) AS newest,
      max(last_seen_at) FILTER (WHERE ${LIVE}) AS seen, count(*) FILTER (WHERE NOT (${LIVE}))::int AS ended
    FROM sessions s WHERE s.owner_id = $1 GROUP BY s.provider ORDER BY s.provider`, [ownerId]);
  const grants = await rows(d.pool, GrantRow, `
    SELECT g.id, g.expires_at > now() AS live, g.created_at, g.expires_at, g.last_used_at,
      (SELECT count(*)::int FROM agent_tokens t WHERE t.owner_id = g.owner_id AND t.grant_id = g.id AND t.kind = 'refresh' AND NOT t.consumed AND t.expires_at > now()) AS refresh,
      (SELECT count(*)::int FROM agent_tokens t WHERE t.owner_id = g.owner_id AND t.grant_id = g.id) AS tokens
    FROM agent_grants g WHERE g.owner_id = $1 ORDER BY g.created_at DESC, g.id`, [ownerId]);
  return {
    accountId: ownerId,
    madeOn: owner.created_at.toISOString().slice(0, 10),
    keys: { v2: owner.v2, v1: owner.v1, ...(await keysOpen(d, ownerId)) },
    signIn: {
      last: orNull(owner.last_sign_in),
      sessions: sessions.map((s) => ({ provider: s.provider, live: s.live, newestStarted: orNull(s.newest), lastSeen: orNull(s.seen) })),
      endedNotSwept: sessions.reduce((n, s) => n + s.ended, 0)
    },
    agents: {
      live: grants.filter((g) => g.live).length,
      most: MAX_CONNECTIONS,
      connections: grants.map((g) => ({
        id: g.id, live: g.live, made: toHour(g.created_at), expires: toHour(g.expires_at), lastUsed: orNull(g.last_used_at),
        liveRefreshTokens: g.refresh, tokenRows: g.tokens, mostTokenRows: MAX_TOKEN_HISTORY
      }))
    },
    plan: await planKind(d, ownerId)
  };
}

/**
 * The accounts that sign in with `email`, found as sign-in finds them (billing/support.ts › accountsSigningInWith): its blind
 * index under the index key, under sign-in's own purpose. How many, and the account's ID when exactly one does. Neither the
 * address nor its hash is logged: only how many.
 */
export async function findAccount(d: Deps, email: string): Promise<{ found: number; accountId?: string }> {
  const key = indexKey(d);
  let found: string[];
  try { found = await accountsSigningInWith(d.pool, key, email); } finally { key.fill(0); }
  alog.info('account found by address', { found: found.length });
  const [one, ...more] = found;
  return one !== undefined && !more.length ? { found: 1, accountId: one } : { found: found.length };
}

/**
 * Ends every session the account has, at the person's request (a lost laptop): its browsers are signed out, and a Calendar or
 * Drive consent one of them had begun is refused once it comes back, as its session is gone. Its agents keep working: their
 * credentials are their own. Says how many it ended; none, a second time.
 */
export async function signOutEverywhere(d: Deps, typed: string): Promise<number> {
  const ownerId = await personOf(d, typed);
  const ended = await exec(d.pool, 'DELETE FROM sessions WHERE owner_id = $1', [ownerId]);
  alog.info('account signed out everywhere by support', { ownerId, ended });
  return ended;
}
