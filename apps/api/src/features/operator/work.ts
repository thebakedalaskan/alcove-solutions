/*
 * What's behind and what's failing, for `operator work` (GET /v1/operator/work). Three parts: the loops, from this
 * instance's memory (platform/runs.ts); the queues, counted from the database and nothing else, never a sealed column, and
 * LiveKit asked once which rooms are up; and the finals, from the ring (platform/recent.ts): work given up for good in the
 * last day on this instance, as the lines that say so name it (`final`). The queues are read within a time limit, one
 * statement at a time, and stop once it's up; while an instance counts them, a second request waits for that count rather
 * than starting another beside it, so retrying a slow report never stacks counts on a slow database. The rest answers
 * without them when the database is out of reach.
 */
import { z } from 'zod';
import type { Deps } from '../../platform/context';
import { bigintText, maybeOne, type Db } from '../../platform/db';
import { DatabaseError } from '../../platform/errors';
import type { HttpRuntime } from '../../http/runtime';
import { sessionEnded } from '../../keys/sessions';
import { AGENT_ROWS } from '../agents/service';
import { OPEN, WATCHED } from '../billing/top-ups/deposits';
import { callsWork } from '../calls/operator/operator';
import { claimableExports } from '../notes/drive-exports/worker';
import { claimableNotes } from '../notes/writing/writer';
import { recent } from '../../platform/recent';
import { runs } from '../../platform/runs';
import { FinalKind, type WorkAnswer } from './wire';
import { within, type Within } from './within';

/** How long the queues are counted for, LiveKit's one question included, before the answer goes without them. */
const QUEUES_MS = 10_000;
const DAY_MS = 86_400_000;

type Queues = Extract<WorkAnswer['queues'], { ok: true }>;
const n = z.number().int();
const age = z.number().int().nullable();
/** A whole number of seconds since a moment, in SQL, or null when there's no such moment. */
const secondsSince = (moment: string) => `floor(extract(epoch FROM now() - ${moment}))::int`;

async function one<S extends z.ZodType>(db: Db, schema: S, sql: string, params: unknown[] = []): Promise<z.infer<S>> {
  const row = await maybeOne(db, schema, sql, params);
  if (row === undefined) throw new DatabaseError(undefined, { context: { why: 'no-row' } });
  return row;
}

/**
 * Notes jobs by state, those due now (as the writer claims them: writer.ts › claimableNotes) and how long the oldest of them
 * has waited, and writers whose lease ran out.
 */
const notes = (db: Db) => one(db, z.object({ queued: n, writing: n, waiting: n, claimable: n, oldest_claimable_s: age, leases_run_out: n }), `
  SELECT count(*) FILTER (WHERE j.state = 'queued')::int AS queued, count(*) FILTER (WHERE j.state = 'writing')::int AS writing,
    count(*) FILTER (WHERE j.state = 'waiting')::int AS waiting,
    count(*) FILTER (WHERE ${claimableNotes('j')})::int AS claimable,
    ${secondsSince(`min(r.created_at) FILTER (WHERE ${claimableNotes('j')})`)} AS oldest_claimable_s,
    count(*) FILTER (WHERE j.state = 'writing' AND j.lease_until < now())::int AS leases_run_out
  FROM content_jobs j LEFT JOIN revisions r USING (owner_id, revision_id) WHERE j.kind = 'notes'`);

/** Drive exports by state, those due now (as the exporter claims them: worker.ts › claimableExports), and the most attempts any has had. */
const driveExports = (db: Db) => one(db, z.object({ pending: n, uploading: n, uploaded: n, failed: n, reconnect: n, claimable: n, highest_attempt: n }), `
  SELECT count(*) FILTER (WHERE x.state = 'pending')::int AS pending, count(*) FILTER (WHERE x.state = 'uploading')::int AS uploading,
    count(*) FILTER (WHERE x.state = 'uploaded')::int AS uploaded, count(*) FILTER (WHERE x.state = 'failed')::int AS failed,
    count(*) FILTER (WHERE x.state = 'reconnect')::int AS reconnect,
    count(*) FILTER (WHERE ${claimableExports('x')})::int AS claimable,
    coalesce(max(x.attempt), 0)::int AS highest_attempt
  FROM drive_export_jobs x`);

/** Shared screens kept for the notes and still in pieces once their recording stopped: recordings, pieces, bytes, the oldest stop. */
const sharedScreens = (db: Db) => one(db, z.object({ recordings: n, pieces: n, bytes: bigintText, oldest_stop_s: age }), `
  SELECT count(DISTINCT (p.owner_id, p.recording_id))::int AS recordings, count(*)::int AS pieces, coalesce(sum(p.cipher_bytes), 0)::text AS bytes,
    ${secondsSince('min(r.ended_at)')} AS oldest_stop_s
  FROM screen_pieces p JOIN screen_shares s USING (owner_id, recording_id, share_id) JOIN recordings r USING (owner_id, recording_id)
  WHERE s.keep AND r.state = 'stopped'`);

/** Object deletes waiting to be tried again: how many, how many have failed, the most attempts and the oldest. */
const objectDeletes = (db: Db) => one(db, z.object({ queued: n, failing: n, highest_attempt: n, oldest_s: age }), `
  SELECT count(*)::int AS queued, count(*) FILTER (WHERE attempts > 0)::int AS failing, coalesce(max(attempts), 0)::int AS highest_attempt,
    ${secondsSince('min(queued_at)')} AS oldest_s
  FROM object_gc`);

/**
 * Top-ups, by the states deposits.ts names (WATCHED, OPEN): due a look now, as the watcher takes them, and how late the
 * oldest is; open; open, with no answer, past their deadline; and credited but not carried yet.
 */
const deposits = (db: Db) => one(db, z.object({ due: n, lag_s: age, open: n, unanswered: n, credited_not_carried: n }), `
  SELECT count(*) FILTER (WHERE state = ANY($1) AND check_after <= now())::int AS due,
    ${secondsSince('min(check_after) FILTER (WHERE state = ANY($1) AND check_after <= now())')} AS lag_s,
    count(*) FILTER (WHERE state = ANY($2) AND give_up_at > now())::int AS open,
    count(*) FILTER (WHERE state = ANY($2) AND give_up_at < now() - interval '10 minutes')::int AS unanswered,
    count(*) FILTER (WHERE state = 'credited')::int AS credited_not_carried
  FROM deposits WHERE check_after < 'infinity'`, [[...WATCHED], [...OPEN]]);

/** Plans due a look by upkeep and how late the oldest is, and accounts with no plan yet. */
const plans = (db: Db) => one(db, z.object({ due: n, lag_s: age, accounts_without: n }), `
  SELECT count(*) FILTER (WHERE due_at <= now())::int AS due, ${secondsSince('min(due_at) FILTER (WHERE due_at <= now())')} AS lag_s,
    (SELECT count(DISTINCT i.owner_id)::int FROM identities i WHERE NOT EXISTS (SELECT 1 FROM plan_accounts p WHERE p.owner_id = i.owner_id)) AS accounts_without
  FROM plan_accounts`);

/** Teams due a look by upkeep, and how late the oldest is. */
const teams = (db: Db) => one(db, z.object({ due: n, lag_s: age }), `
  SELECT count(*) FILTER (WHERE due_at <= now())::int AS due, ${secondsSince('min(due_at) FILTER (WHERE due_at <= now())')} AS lag_s FROM teams`);

/**
 * What upkeep's sweeps will remove, by what each sweep removes: sessions ended (keys/sessions.ts › sessionEnded), agents' rows
 * run out (agents/service.ts › AGENT_ROWS), and team invites expired.
 */
const sweeps = (db: Db) => one(db, z.object({ sessions: n, agent_rows: n, invites: n }), `
  SELECT (SELECT count(*)::int FROM sessions s WHERE ${sessionEnded('s')}) AS sessions,
    ${AGENT_ROWS.map((table) => `(SELECT count(*)::int FROM ${table} WHERE expires_at <= now())`).join(' + ')} AS agent_rows,
    (SELECT count(*)::int FROM team_invites WHERE expires_at <= now()) AS invites`);

/**
 * Every queue, one count at a time, so a report takes one of the pool's connections at most, and none after `signal` says
 * its time is up.
 */
async function queues(d: Deps, signal: AbortSignal): Promise<Queues> {
  const db = d.pool;
  const next = <T>(count: (db: Db) => Promise<T>): Promise<T> => { signal.throwIfAborted(); return count(db); };
  const nj = await next(notes);
  const dx = await next(driveExports);
  const ss = await next(sharedScreens);
  const og = await next(objectDeletes);
  const dp = await next(deposits);
  const pl = await next(plans);
  const tm = await next(teams);
  const sw = await next(sweeps);
  signal.throwIfAborted();
  return {
    ok: true,
    notes: { queued: nj.queued, writing: nj.writing, waiting: nj.waiting, claimable: nj.claimable, oldestClaimableS: nj.oldest_claimable_s, leasesRunOut: nj.leases_run_out },
    driveExports: { pending: dx.pending, uploading: dx.uploading, uploaded: dx.uploaded, failed: dx.failed, reconnect: dx.reconnect, claimable: dx.claimable, highestAttempt: dx.highest_attempt },
    sharedScreens: { recordings: ss.recordings, pieces: ss.pieces, bytes: ss.bytes, oldestStopS: ss.oldest_stop_s },
    objectDeletes: { queued: og.queued, failing: og.failing, highestAttempt: og.highest_attempt, oldestS: og.oldest_s },
    deposits: { due: dp.due, lagS: dp.lag_s, open: dp.open, unanswered: dp.unanswered, creditedNotCarried: dp.credited_not_carried },
    plans: { due: pl.due, lagS: pl.lag_s, accountsWithout: pl.accounts_without },
    teams: { due: tm.due, lagS: tm.lag_s },
    calls: await callsWork(d),
    sweeps: { sessions: sw.sessions, agentRows: sw.agent_rows, invites: sw.invites }
  };
}

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

/** Each instance's count of the queues while it runs: one app is one instance. */
const counting = new WeakMap<HttpRuntime, Promise<Within<Queues>>>();
/** The queues of `runtime`'s instance: the count running now, if one is, or a new one. */
function queuesOf(runtime: HttpRuntime): Promise<Within<Queues>> {
  const running = counting.get(runtime);
  if (running) return running;
  const count = within('queues', QUEUES_MS, (signal) => queues(runtime.d, signal));
  counting.set(runtime, count);
  void count.finally(() => { if (counting.get(runtime) === count) counting.delete(runtime); });
  return count;
}

/** This instance's work report, as `operator work` prints it. */
export async function workOf(runtime: HttpRuntime, instance: string): Promise<WorkAnswer> {
  const counted = await queuesOf(runtime);
  // Newest first. A line whose kind this build doesn't know isn't one of its finals.
  const finals = recent.finalsSince(DAY_MS).flatMap((l) => {
    const kind = FinalKind.safeParse(l.final);
    return kind.success ? [{ at: iso(l.at), kind: kind.data, noteId: l.ids.noteId ?? null, jobId: l.ids.jobId ?? null, errorClass: l.errorClass, code: l.code }] : [];
  }).reverse();
  return {
    instance,
    at: iso(Date.now()),
    loops: runs.snapshot().map((r) => ({
      name: r.name, running: r.running, lastStartedAt: isoOrNull(r.lastStartedAt), lastEndedAt: isoOrNull(r.lastEndedAt), lastMs: r.lastMs, lastOk: r.lastOk,
      lastCode: r.lastCode, lastCounts: r.lastCounts, lastOkAt: isoOrNull(r.lastOkAt), failures: r.failures
    })),
    queues: counted.ok ? counted.value : counted,
    finals
  };
}
