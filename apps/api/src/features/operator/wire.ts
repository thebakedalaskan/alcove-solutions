/*
 * What operator routes answer, as schemas the server's answers satisfy and the CLI parses them with
 * (features/operator/cli/cli.ts), so both read the same shape. Every answer holds only IDs, states, codes, counts,
 * sizes, times and durations.
 */
import { z } from 'zod';
import { CallsWorkAnswer } from '../calls/operator/operator';

/** GET /v1/operator/whoami: the key as the server sees it, the instance that answered, and its time (ISO 8601). */
export const WhoamiAnswer = z.object({ keyId: z.string(), scope: z.enum(['read', 'write']), instance: z.string(), at: z.string() });
export type WhoamiAnswer = z.infer<typeof WhoamiAnswer>;

/** A moment, ISO 8601 in UTC, as every answer says one. */
const At = z.string();
const Count = z.number().int().nonnegative();
/** A part of an answer that couldn't be worked out, and why, as a code: the database or LiveKit out of reach, say. */
const Failed = z.object({ ok: z.literal(false), code: z.string() });

/** One start step (start.ts), as its `boot step` line says it. */
const BootStepAnswer = z.object({ step: z.string(), ms: Count, ok: z.boolean(), errorClass: z.string().nullable(), code: z.string().nullable() });
/** How an instance's copy of something it reads every so often (limits, feature flags) was last read; null before it first is. */
const CacheAnswer = z.object({ readAt: At.nullable(), okAt: At.nullable(), failures: Count }).nullable();

/**
 * GET /v1/operator/release: which release is serving and how its start went. `settings.values`: settings that change
 * behaviour and are public anyway; `settings.others`: every other setting the server runs with, secrets included, as set
 * or not set, never its value.
 */
export const ReleaseAnswer = z.object({
  instance: z.string(),
  at: At,
  build: z.object({ commit: z.string(), imageDigest: z.string().nullable(), rekorLogIndex: z.number().int().nullable() }),
  running: z.object({ startedAt: At, uptimeS: Count }),
  boot: z.array(BootStepAnswer),
  migrations: z.discriminatedUnion('ok', [
    z.object({
      ok: z.literal(true),
      applied: z.object({ count: Count, newest: z.string().nullable() }),
      inImage: z.object({ count: Count, newest: z.string().nullable() }),
      notApplied: z.array(z.string()),
      unknown: z.array(z.string()),
      /** Applied, then changed in the image since: their checksums differ. */
      changed: z.array(z.string()),
      /** Why a start would refuse this database, as migrate.ts says it: `untracked`, `removed` or `changed`; null when it wouldn't. */
      refused: z.enum(['untracked', 'removed', 'changed']).nullable()
    }),
    Failed
  ]),
  settings: z.object({
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    others: z.record(z.string(), z.enum(['set', 'not set'])),
    operatorKeys: z.array(z.object({ keyId: z.string(), scope: z.enum(['read', 'write']) }))
  }),
  clock: z.object({ behindGoogleS: z.number().int(), roundTripMs: Count, at: At }).nullable(),
  attestation: z.object({
    issuedAt: At.nullable(), expiresAt: At.nullable(), ageS: Count.nullable(), imageDigest: z.string().nullable(), rekorLogIndex: z.number().int().nullable(),
    lastFailure: z.object({ code: z.string(), at: At }).nullable(), nextAskAt: At.nullable()
  }).nullable(),
  certificate: z.object({
    notAfter: At, daysLeft: z.number().int(), renewal: z.enum(['not due', 'due', 'past due']), hosts: Count, storedAt: At, spkiMatches: z.boolean(),
    lastCheck: z.object({ at: At, ok: z.boolean(), code: z.string().nullable() }).nullable()
  }).nullable(),
  caches: z.object({ limits: CacheAnswer, featureFlags: CacheAnswer })
});
export type ReleaseAnswer = z.infer<typeof ReleaseAnswer>;

/** One loop of background work, from this instance's memory: its last run, whether one runs now, and its failures in the hour by code. */
const LoopAnswer = z.object({
  name: z.string(), running: Count, lastStartedAt: At.nullable(), lastEndedAt: At.nullable(), lastMs: Count.nullable(), lastOk: z.boolean().nullable(),
  lastCode: z.string().nullable(), lastCounts: z.record(z.string(), z.number()), lastOkAt: At.nullable(), failures: z.record(z.string(), Count)
});
/** An age or a lag, in whole seconds, or null when there's nothing to be late. */
const Lag = Count.nullable();
/**
 * The kinds of work given up for good, as the line that says so names it (`final`): a note finished without a summary
 * (features/notes/writing/writer.ts), and a Drive export that won't be tried again (drive-exports/worker.ts).
 */
export const FinalKind = z.enum(['notes-without-summary', 'drive-export-failed']);
/** A piece of work given up for good, in the last day on this instance (the ring's finals). */
const FinalAnswer = z.object({
  at: At, kind: FinalKind, noteId: z.string().nullable(), jobId: z.string().nullable(), errorClass: z.string().nullable(), code: z.string().nullable()
});

/** The queues, counted from the database (ages and lags in seconds), or why they couldn't be. */
const QueuesAnswer = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    notes: z.object({ queued: Count, writing: Count, waiting: Count, claimable: Count, oldestClaimableS: Lag, leasesRunOut: Count }),
    driveExports: z.object({ pending: Count, uploading: Count, uploaded: Count, failed: Count, reconnect: Count, claimable: Count, highestAttempt: Count }),
    sharedScreens: z.object({ recordings: Count, pieces: Count, bytes: Count, oldestStopS: Lag }),
    objectDeletes: z.object({ queued: Count, failing: Count, highestAttempt: Count, oldestS: Lag }),
    deposits: z.object({ due: Count, lagS: Lag, open: Count, unanswered: Count, creditedNotCarried: Count }),
    plans: z.object({ due: Count, lagS: Lag, accountsWithout: Count }),
    teams: z.object({ due: Count, lagS: Lag }),
    /** The calls feature's own count (features/calls/operator/operator.ts › callsWork). */
    calls: CallsWorkAnswer,
    sweeps: z.object({ sessions: Count, agentRows: Count, invites: Count })
  }),
  Failed
]);

/** GET /v1/operator/work: what's behind, and what's failing. */
export const WorkAnswer = z.object({
  instance: z.string(),
  at: At,
  loops: z.array(LoopAnswer),
  queues: QueuesAnswer,
  finals: z.array(FinalAnswer)
});
export type WorkAnswer = z.infer<typeof WorkAnswer>;

/**
 * A line from the ring (platform/recent.ts), as answers say it: no free text, only these fields. `route` is the method and
 * template of the route its request matched (`GET /v1/notes/:id`), never the path that was sent.
 */
const RingLineAnswer = z.object({
  at: At, level: z.enum(['info', 'warn', 'error']), component: z.string().nullable(), msg: z.string(), requestId: z.string().nullable(),
  route: z.string().nullable(), status: z.number().int().nullable(), code: z.string().nullable(),
  errorClass: z.string().nullable(), upstreamStatus: z.number().int().nullable(), what: z.string().nullable(), final: z.string().nullable(),
  ids: z.object({
    ownerId: z.string().optional(), callId: z.string().optional(), noteId: z.string().optional(), jobId: z.string().optional(),
    depositId: z.string().optional(), recordingId: z.string().optional(), grantId: z.string().optional()
  })
});

/**
 * GET /v1/operator/errors?minutes=: what's failing, and how often, in the last `minutes` on this instance. `requests`:
 * refused and failed requests by route, status and code; `groups`: every line by component, message, code and upstream
 * status. Each with its newest time and one request ID to follow. `notKept`: what the ring counted in the window and didn't
 * keep, requests that matched no route and lines past their client's share. `heldFrom`: the oldest line each part still
 * holds, once it has had to push older ones out to keep the newest (null while it hasn't), so a window reaching further
 * back than that is said to be cut short.
 */
export const ErrorsAnswer = z.object({
  instance: z.string(),
  at: At,
  minutes: Count,
  lines: Count,
  notKept: z.object({ unrouted: Count, overShare: Count }),
  heldFrom: z.object({ requests: At.nullable(), failures: At.nullable() }),
  requests: z.array(z.object({ route: z.string(), status: z.number().int().nullable(), code: z.string().nullable(), count: Count, lastAt: At, requestId: z.string().nullable() })),
  groups: z.array(z.object({
    component: z.string().nullable(), msg: z.string(), code: z.string().nullable(), upstreamStatus: z.number().int().nullable(), count: Count, lastAt: At,
    requestId: z.string().nullable()
  }))
});
export type ErrorsAnswer = z.infer<typeof ErrorsAnswer>;

/** GET /v1/operator/requests/:requestId: every line this instance holds for one request, oldest first. */
export const RequestAnswer = z.object({ instance: z.string(), at: At, requestId: z.string(), lines: z.array(RingLineAnswer) });
export type RequestAnswer = z.infer<typeof RequestAnswer>;
