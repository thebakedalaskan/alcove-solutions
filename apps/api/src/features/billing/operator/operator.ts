/*
 * What an operator may see and do about a top-up from outside the enclave (docs: Plans and usage › Support): what happened to
 * one payment, and its provider asked about it again now. A top-up is named by its reference, its deposit ID, which the person
 * sees in checkout, as support names one (support.ts › REFERENCE, topUpOwner). The answer says its account, provider and
 * state, when it was opened and its deadline, whether it's still watched, and from its sealed record, opened here: whether
 * anything arrived, whether it settled, a doubt's code, whether its provider has gone unanswered since the deadline, and what
 * it was to buy and how that went. Never an amount, its address or memo, the quote, the provider's reference (an intent hash,
 * which leads to the payer's wallet), or why a purchase was refused (kept in words). A payment's exact time, set against the
 * treasury's public transfers, could lead to the payer's wallet too, so times are to the hour, and the last check is said only
 * while it's watched: once nothing watches a top-up, its last check is when it settled or was closed.
 *
 * And a plan given to an account for a while, as Alcove, with no money involved (`givePlan`): months of Pro, or licenses for
 * the team it's the admin of, each bought as a purchase from the balance is, at nothing.
 */
import { TopUpStateSchema } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../../platform/context';
import { blindIndex } from '../../../keys/crypto';
import { indexKey } from '../../../keys/owners';
import { bytea, exec, maybeOne, timestamp, tx, type Db } from '../../../platform/db';
import { AppError, ConflictError, ForbiddenError, NotFoundError, UnavailableError, ValidationError, conflict } from '../../../platform/errors';
import { limitsNow } from '../../../platform/limits';
import { log, type LogContext } from '../../../platform/log';
import { accountOf, proOf, purchase, refusedError, type Refusal } from '../plans';
import { adminsTeam, licensesBought } from '../teams/teams';
import * as deposits from '../top-ups/deposits';
import type { DepositProviderName } from '../top-ups/provider';
import { ACCOUNT, REFERENCE, personAccount, topUpOwner, type Ticket } from '../support';

const slog = log.child({ component: 'billing-support' });

/** GET /v1/operator/topups/:reference. Times are ISO 8601, to the hour. */
export const TopUpAnswer = z.object({
  instance: z.string(), at: z.string(),
  reference: z.string(), accountId: z.string(), provider: z.enum(['oneclick']), state: TopUpStateSchema,
  /** When it was opened, and when Alcove stops waiting for its payment (a day after its address expires), to the hour. */
  opened: z.string(), deadline: z.string(), deadlinePassed: z.boolean(),
  /**
   * Whether anything still asks its provider about it, and while it does, when it's next asked and when it last was (seconds
   * from now). Added by support, given up on a record that won't open, and 30 days over all read alike: not watched.
   */
  watched: z.boolean(), nextCheckS: z.number().int().nullable(), lastCheckS: z.number().int().nullable(),
  /**
   * From its sealed record (null: it doesn't open): whether any money was seen arriving, whether it settled, why its provider's
   * answer couldn't be trusted (a code), whether its provider has gone unanswered since the deadline, and what it was to buy.
   */
  record: z.object({
    seen: z.boolean(), settled: z.boolean(), doubt: z.string().nullable(), unanswered: z.boolean(),
    purchase: z.object({ kind: z.enum(['pro', 'hours', 'licenses']), outcome: z.enum(['waiting', 'bought', 'refused']) }).nullable()
  }).nullable()
});
export type TopUpAnswer = z.infer<typeof TopUpAnswer>;
/** POST /v1/operator/topups/:reference/check: its state before and after, whether it's still watched, and whether its provider was asked. */
export const TopUpCheckAnswer = z.object({
  instance: z.string(), at: z.string(), before: TopUpStateSchema, after: TopUpStateSchema, watched: z.boolean(),
  /**
   * `answered`: its provider was asked now, and what it said was applied. Otherwise it wasn't asked, and this says why:
   * `recently`, it was asked less than 5 seconds ago (by its owner's checkout, the watcher or another check), so it's as that
   * answer left it; `unwatched`, nothing watches it any more, as it settled or was closed since it was looked up; `no-provider`,
   * its provider isn't one this server is set up with. A provider asked that didn't answer is a 503, never this answer.
   */
  asked: z.enum(['answered', 'recently', 'unwatched', 'no-provider'])
});
export type TopUpCheckAnswer = z.infer<typeof TopUpCheckAnswer>;

/** A doubt as its record keeps it, said only when it's a code. */
const CODE = /^[a-z0-9-]{1,64}$/;
const HOUR = 3_600_000;
const toHour = (at: Date) => new Date(Math.floor(at.getTime() / HOUR) * HOUR).toISOString();
/** Each provider by the name people know it by, as a refusal says it. */
const PROVIDER: Record<DepositProviderName, string> = { oneclick: '1Click' };

const Row = z.object({
  owner_id: z.string(), deposit_id: z.string(), provider: z.enum(['oneclick']), state: TopUpStateSchema, record_ciphertext: bytea,
  created_at: timestamp, give_up_at: timestamp, deadline_passed: z.boolean(), watched: z.boolean(),
  next_check_s: z.number().int().nullable(), last_check_s: z.number().int().nullable()
});
type Row = z.infer<typeof Row>;

/** The top-up `reference` names, as its row has it, whoever's it is (support.ts › topUpOwner). Nothing typed is said back. */
async function rowOf(d: Deps, reference: string): Promise<Row> {
  if (!REFERENCE.test(reference)) throw new ValidationError('A top-up’s reference is 22 letters, digits, - and _, as checkout shows it.');
  const ownerId = await topUpOwner(d.pool, reference);
  // Times are reckoned by the database's clock, which wrote them; one in a state it never leaves is never asked about again.
  const r = await maybeOne(d.pool, Row, `
    SELECT owner_id, deposit_id, provider, state, record_ciphertext, created_at, give_up_at, give_up_at <= now() AS deadline_passed,
      (check_after < 'infinity' AND NOT state = ANY($3)) AS watched,
      CASE WHEN check_after < 'infinity' AND NOT state = ANY($3) THEN greatest(0, extract(epoch FROM check_after - now()))::int END AS next_check_s,
      CASE WHEN check_after < 'infinity' AND NOT state = ANY($3) THEN extract(epoch FROM now() - checked_at)::int END AS last_check_s
    FROM deposits WHERE owner_id = $1 AND deposit_id = $2`, [ownerId, reference, deposits.FINAL]);
  // Gone since it was found: its account was deleted a moment ago.
  if (!r) throw new NotFoundError('No top-up has that reference.');
  return r;
}

/** What its sealed record says, as counts and codes, or null when it doesn't open here. */
function openedFrom(d: Deps, r: Row): TopUpAnswer['record'] {
  let rec: deposits.DepositRecord;
  try {
    rec = deposits.record(d, r.owner_id, r);
  } catch (e) {
    slog.warn('top-up’s record doesn’t open', { depositId: r.deposit_id, err: e });
    return null;
  }
  const sent = rec.settled?.sentMicroUsd ?? rec.seenMicroUsd ?? '0';
  return {
    seen: BigInt(sent) > 0n,
    settled: rec.settled !== null,
    doubt: rec.doubt === null ? null : CODE.test(rec.doubt) ? rec.doubt : 'other',
    unanswered: rec.unanswered,
    purchase: rec.purchase ? { kind: rec.purchase.buys.kind, outcome: rec.purchase.outcome } : null
  };
}

/** What happened to the top-up `reference` names (TopUpAnswer, but for who answered and when). */
export async function topUpReport(d: Deps, reference: string): Promise<Omit<TopUpAnswer, 'instance' | 'at'>> {
  const r = await rowOf(d, reference);
  return {
    reference: r.deposit_id, accountId: r.owner_id, provider: r.provider, state: r.state,
    opened: toHour(r.created_at), deadline: toHour(r.give_up_at), deadlinePassed: r.deadline_passed,
    watched: r.watched, nextCheckS: r.next_check_s, lastCheckS: r.last_check_s,
    record: openedFrom(d, r)
  };
}

/**
 * Asks the provider about the top-up `reference` names now, as the person's own checkout does (deposits.ts › ask): under the
 * row lock the watcher takes, so it adds money and buys only as their own check would, and at most once in 5 seconds, so a
 * second check at once asks nothing, and says so (`asked`). What the provider returns holds its address and amounts, so it's
 * let go: the answer is its state before and after. A provider that didn't answer is a 503 with its HTTP status in the log
 * (`upstreamStatus`), never what it said, and the top-up is as it was. One nothing watches any more (added, settled with
 * nothing to add, added by support, given up on, or past its 30 days) is refused, and left alone. Never the watcher's pass,
 * which takes on anyone's due top-ups.
 */
export async function checkTopUp(d: Deps, reference: string): Promise<Omit<TopUpCheckAnswer, 'instance' | 'at'>> {
  const was = await rowOf(d, reference);
  if (!was.watched) throw new ConflictError('That top-up isn’t watched any more.', { context: { depositId: was.deposit_id, state: was.state } });
  const r = await deposits.ask(d, was.owner_id, was.deposit_id);
  if (r.asked === 'failed') {
    const upstream = r.error instanceof AppError ? r.error.context['upstreamStatus'] : undefined;
    throw new UnavailableError(`${PROVIDER[r.provider]} didn’t answer, so the top-up is as it was. Try again in a minute.`, {
      cause: r.error, context: { depositId: was.deposit_id, provider: r.provider, ...(typeof upstream === 'number' ? { upstreamStatus: upstream } : {}) }
    });
  }
  const now = await rowOf(d, reference);
  slog.info('top-up checked by support', { ownerId: was.owner_id, depositId: was.deposit_id, was: was.state, state: now.state, asked: r.asked });
  return { before: was.state, after: now.state, watched: now.watched, asked: r.asked };
}

/* ---------- a plan given by Alcove ---------- */

/** What one grant gives: months of Pro, or licenses for the team its account is the admin of, each for some months. */
type Grant = { kind: 'pro'; months: number } | { kind: 'team'; licenses: number; months: number };
/**
 * The most one grant gives, 12 months of Pro or 25 licenses each for 12 months, and the most grants one key gives through the
 * route in a day (UTC): so what a write key, stolen or misused, can give away is bounded, and each grant is on record under its
 * key and its ticket.
 */
const MOST_MONTHS = 12;
const MOST_LICENSES = 25;
const GRANTS_A_DAY = 5;
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const grantUsage = () => new ValidationError(`A grant is an account's ID, then what Alcove gives it:
<account id> pro <months>               months of Pro, 1 to ${MOST_MONTHS}, after any it has
<account id> team <licenses> <months>   licenses, 1 to ${MOST_LICENSES}, each for 1 to ${MOST_MONTHS} months, for the team the account is the admin of`, { context: { why: 'usage' } });
const notACount = () => new ValidationError('Months and licenses are whole numbers from 1: pro 3, or team 5 3.', { context: { why: 'not a count' } });

/** A count as it's typed: a whole number from 1, or undefined for anything else. */
function countOf(typed: string | undefined): number | undefined {
  const n = typed !== undefined && /^\d{1,4}$/.test(typed) ? Number(typed) : 0;
  return n >= 1 ? n : undefined;
}

/**
 * The account a grant's words name, by its ID alone, and what it gives, held to the most one grant gives. An address, or a
 * top-up's reference, never names one here. Nothing typed is said back: it may be an address put in the wrong place.
 */
function grantOf(words: string[]): { who: string; grant: Grant } {
  const [typed, kind, ...counts] = words;
  if (typed === undefined || !((kind === 'pro' && counts.length === 1) || (kind === 'team' && counts.length === 2))) throw grantUsage();
  const who = typed.trim();
  if (!ACCOUNT.test(who)) throw new ValidationError('Name the account by its ID.', { context: { why: 'not an ID' } });
  const [first, second] = counts.map(countOf);
  if (kind === 'pro') {
    if (first === undefined) throw notACount();
    if (first > MOST_MONTHS) throw new ValidationError(`One grant gives at most ${MOST_MONTHS} months of Pro.`, { context: { why: 'a grant’s most', months: first } });
    return { who, grant: { kind: 'pro', months: first } };
  }
  if (first === undefined || second === undefined) throw notACount();
  if (first > MOST_LICENSES || second > MOST_MONTHS) {
    throw new ValidationError(`One grant gives at most ${MOST_LICENSES} licenses, each for at most ${MOST_MONTHS} months.`, { context: { why: 'a grant’s most', licenses: first, months: second } });
  }
  return { who, grant: { kind: 'team', licenses: first, months: second } };
}

/**
 * Records a grant, in the grant's own transaction, or refuses it with nothing given. It's kept as a keyed hash of the account
 * and the ticket's reference, whatever its case (SUP-1182 and sup-1182 are one ticket), and the key that gave it: never the
 * account's ID or what was given. So a ticket gives an account a plan once, and the same grant sent again, its answer lost on
 * the way back, gives nothing more. Then the key's grants today (UTC) are counted, this one with them, in the database every
 * instance shares, so a key's sixth of the day is refused whichever instance answers and whatever restarted. The caller holds
 * the key's lock (`givePlan`), so its grants are counted one at a time.
 */
async function grantRecorded(d: Pick<Deps, 'cfg'>, c: Db, ownerId: string, ticket: Ticket): Promise<void> {
  const index = indexKey(d);
  let digest: Uint8Array;
  try {
    digest = blindIndex(index, 'operator-grant', `${ownerId}\n${ticket.reason.toLowerCase()}`);
  } finally { index.fill(0); }
  const kept = await exec(c, 'INSERT INTO operator_grants (digest, key_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [digest, ticket.keyId]);
  if (!kept) throw new ConflictError('That ticket already gave this account a plan. Nothing was given.', { context: { ownerId, why: 'ticket used' } });
  const today = await maybeOne(c, z.object({ n: z.number().int() }), `
    SELECT count(*)::int AS n FROM operator_grants
    WHERE key_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`, [ticket.keyId]);
  if ((today?.n ?? 0) > GRANTS_A_DAY) {
    throw new ForbiddenError(`A key gives plans at most ${GRANTS_A_DAY} times a day (UTC), and this one has already today. Nothing was given.`, { context: { why: 'a day’s most' } });
  }
}

/**
 * A grant the purchase's own rules refused, as its operator is told it: Pro for an account on its team's plan, whose months
 * would run unused; otherwise as its buyer would be told (more than one purchase buys, where a limit holds it below a grant's
 * most).
 */
function refusedGrant(r: Refusal, context: LogContext): AppError {
  if (r.why === 'team') return conflict('That account is on its team’s plan while its license lasts, so Pro can’t be given now. Nothing was given.', { ...context, why: r.why });
  return refusedError(r, context);
}

/**
 * Gives an account a plan for a while, as Alcove, with no money involved (docs: Operating Alcove › Give someone a plan for a
 * while), from a grant's words: `<account id> pro <months>`, or `<account id> team <licenses> <months>`. Months of Pro are
 * bought as any are (plans.ts › purchase), at nothing, after the last one bought that hasn't ended, or from now. Licenses are
 * bought as a team's are (teams.ts › licensesBought), at nothing, for the team the account is the admin of, each for that many
 * months from when someone on it takes one; auto-purchase goes by what a license last cost the team, as before. Either is
 * refused, with nothing given, where the purchase would be (Pro while a team license is live), and licenses for an account
 * that's no team's admin. Its line in the history says it was given by Alcove, and nothing of it is ever money: it adds
 * nothing to the balance, and a refund gives nothing back for it. Each grant is kept for its ticket and counted for its key's
 * day (`grantRecorded`), and logged with the IDs and how much it gave, never an amount. One key's grants wait on each other,
 * by a lock on its ID held to the end of the transaction and taken before any row's, so two at once can't both pass the
 * day's count. Says what was given, as lines.
 */
export async function givePlan(d: Pick<Deps, 'cfg' | 'pool'>, words: string[], op: { keyId: string; reason: string | undefined }): Promise<string[]> {
  const { who, grant } = grantOf(words);
  // operatorRoute takes no action without a reason, and nothing is given without one either.
  if (op.reason === undefined) throw new ValidationError('Giving a plan needs a reason: a ticket’s reference.', { context: { field: 'reason' } });
  const ticket: Ticket = { keyId: op.keyId, reason: op.reason };
  const ownerId = await personAccount(d.pool, who);
  const said = { ownerId, kind: grant.kind, months: grant.months, licenses: grant.kind === 'team' ? grant.licenses : null };
  const given = await tx(d.pool, async (c) => {
    await exec(c, "SELECT pg_advisory_xact_lock(hashtext('alcove/operator-grants'), hashtext($1))", [ticket.keyId]);
    await grantRecorded(d, c, ownerId, ticket);
    if (grant.kind === 'pro') {
      const r = await purchase(d, c, ownerId, { kind: 'pro', months: grant.months, microUsdPerMonth: 0 }, { admin: false }, 'alcove');
      if (!r.bought) throw refusedGrant(r.refusal, said);
      const until = proOf(await accountOf(d, c, ownerId), await limitsNow(d, c)).until;
      const runs = until === null ? '' : `: Pro runs to ${until.slice(0, 10)} now`;
      return { teamId: null, lines: [`Gave account ${ownerId} ${counted(grant.months, 'month', 'months')} of Pro, after any it had, as “given by Alcove”${runs}.`] };
    }
    // The team's row is locked before the plan's, as every change to a team takes them (teams.ts).
    const t = await adminsTeam(c, ownerId);
    if (!t) {
      throw conflict('That account isn’t a team’s admin, so there’s no team to give licenses to. They start a team first, then licenses can be given to it. Nothing was given.', { ...said, why: 'no team' });
    }
    const r = await licensesBought(d, c, t, ownerId, { kind: 'licenses', count: grant.licenses, microUsdPerLicense: 0, periods: grant.months }, 'alcove');
    if (!r.bought) throw refusedGrant(r.refusal, said);
    return {
      teamId: t.team_id,
      lines: [`Gave team ${t.team_id}, whose admin is account ${ownerId}, ${counted(grant.licenses, 'license', 'licenses')} for ${counted(grant.months, 'month', 'months')}, as “given by Alcove”: each is taken by someone on it without one as they next open Alcove.`]
    };
  });
  slog.info('plan given by support', { ...said, teamId: given.teamId });
  return given.lines;
}
