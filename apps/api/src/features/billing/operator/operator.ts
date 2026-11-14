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
 */
import { TopUpStateSchema } from '@alcove/api';
import { z } from 'zod';
import type { Deps } from '../../../platform/context';
import { bytea, maybeOne, timestamp } from '../../../platform/db';
import { AppError, ConflictError, NotFoundError, UnavailableError, ValidationError } from '../../../platform/errors';
import { log } from '../../../platform/log';
import * as deposits from '../top-ups/deposits';
import type { DepositProviderName } from '../top-ups/provider';
import { REFERENCE, topUpOwner } from '../support';

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
