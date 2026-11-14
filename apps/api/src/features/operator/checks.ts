/*
 * Live checks from inside the enclave (GET /v1/operator/checks): which dependency is failing, and how. Every check runs at
 * once, each with 10 seconds at most, and an instance runs them at most once every 20 seconds: a request in between gets
 * the last run, marked `cached`. Each says whether it passed, how long it took and, when it failed, a code: what an error's
 * context names it by, its class, another service's HTTP status, or an S3 error's name. Never a provider's message, which
 * can echo what was sent, and nothing of anyone's.
 *
 *  - database: SELECT 1, and the pool's connections;
 *  - objects: a HeadBucket (objects.ts › ping);
 *  - livekit: how many rooms are open, on a client of its own with 5 seconds and no failover (livekit.ts › livekitProbe);
 *  - near-ai:speech and near-ai:notes: the model's evidence fetched and checked afresh, apart from the verifications
 *    requests use (evidence.ts › verifyFresh), then one fixed request with nothing of anyone's in it, sealed to the key that
 *    evidence vouched for (inference.ts › probeSpeech, probeNotes). Alcove pays for it; no one's plan is metered;
 *  - oneclick: how many of the routes Alcove allows 1Click offers now (oneclick.ts › probeTokens), which says nothing about
 *    anyone;
 *  - google: Google's discovery document and key set, the client ID and secret checked by swapping a code Google never
 *    issued, and how far this clock is behind Google's (google.ts › checkGoogle).
 *
 * The answer's schemas are here too: the route's answer satisfies them, and the CLI parses it with them (cli/checks.ts).
 */
import type pg from 'pg';
import { z } from 'zod';
import type { Keyless } from '../../platform/config';
import type { Deps } from '../../platform/context';
import { exec } from '../../platform/db';
import { UnverifiedError } from '../../platform/errors';
import { codeOf } from '../../platform/runs';
import { verifyFresh, type Verified } from '../../inference/evidence';
import { probeTokens } from '../billing/top-ups/oneclick';
import { checkGoogle } from '../../providers/google';
import type { HttpRuntime } from '../../http/runtime';
import { defaultModel, lostOnceSent, probeNotes, probeSpeech, ready, type Probe } from '../../inference/inference';
import { livekitProbe } from '../../providers/livekit';
import { log } from '../../platform/log';

const olog = log.child({ component: 'operator' });

/** Each check's time limit, and how often an instance runs them all. */
const LIMIT_MS = 10_000;
const EVERY_MS = 20_000;
/**
 * The longest a probe waits for its model, and what's kept back of a check's ten seconds for it: a probe that runs out
 * says so itself (UnansweredError, timed out) before the limit does.
 */
const PROBE_MS = 5_000;
const SPARE_MS = 500;

const count = z.number().int().nonnegative();
const duration = z.number().int().nonnegative();
/** What every check says: whether it passed, how long it took, and the code of what failed. */
const said = { ok: z.boolean(), ms: duration, code: z.string().nullable() };
/** The database's pool: connections open, idle among them, requests waiting for one, and the most it opens. */
const PoolCounts = z.object({ total: count, idle: count, waiting: count, max: count });
/**
 * A private model: its name; its evidence, fetched and checked afresh (the check that failed, Intel's TCB status for its
 * machine, how many GPUs NVIDIA vouched for); and the probe sealed to the key it vouched for (the HTTP status inside the
 * sealed reply, or whether it timed out). Null where it didn't get that far.
 */
const NearAi = z.object({
  model: z.string(),
  evidence: z.object({ ok: z.boolean(), ms: duration, check: z.string().nullable(), tcb: z.string().nullable(), gpus: count.nullable() }).nullable(),
  probe: z.object({ ok: z.boolean(), ms: duration, status: z.number().int().nullable(), timedOut: z.boolean() }).nullable()
});
type NearAi = z.infer<typeof NearAi>;
/** 1Click: how many of the routes Alcove allows it offers, whether a partner key is set, and whether top-ups are on. */
const OneClick = z.object({ offered: count.nullable(), allowed: count.nullable(), partnerKey: z.boolean(), topUps: z.boolean() });
/**
 * Google: whether it takes the client ID and secret, the step that failed, how sign-up goes and how many testers there
 * are (never who), how many keys it signs with, and how far this clock is behind Google's.
 */
const Google = z.object({
  client: z.enum(['ok', 'refused', 'not-set', 'unchecked']), step: z.enum(['discovery', 'keys', 'client']).nullable(),
  signup: z.enum(['open', 'testers', 'public']), testers: count, keys: count.nullable(), behindGoogleS: z.number().int().nullable(), roundTripMs: duration.nullable()
});

/** One check's answer, and what it found besides passing. */
export const LiveCheck = z.discriminatedUnion('name', [
  z.object({ name: z.literal('database'), ...said, detail: z.object({ pool: PoolCounts }) }),
  z.object({ name: z.literal('objects'), ...said, detail: z.object({}) }),
  z.object({ name: z.literal('livekit'), ...said, detail: z.object({ rooms: count.nullable() }) }),
  z.object({ name: z.literal('near-ai:speech'), ...said, detail: NearAi }),
  z.object({ name: z.literal('near-ai:notes'), ...said, detail: NearAi }),
  z.object({ name: z.literal('oneclick'), ...said, detail: OneClick }),
  z.object({ name: z.literal('google'), ...said, detail: Google })
]);
export type LiveCheck = z.infer<typeof LiveCheck>;
/**
 * GET /v1/operator/checks: the instance that answered and when (ISO 8601), when the run it gives began, whether that run is
 * an earlier request's, whether every check passed, and each check.
 */
export const ChecksAnswer = z.object({ instance: z.string(), at: z.string(), ranAt: z.string(), cached: z.boolean(), ok: z.boolean(), checks: z.array(LiveCheck) });
export type ChecksAnswer = z.infer<typeof ChecksAnswer>;

const since = (t0: number) => Math.round(performance.now() - t0);

/**
 * Runs one check against the time limit. `run` fills in `detail` as it finds things out and resolves to the code of what
 * failed, or null when all of it passed; what it throws is coded as every failure is (platform/runs.ts › codeOf). If the
 * limit comes first, the check failed with `timeout`, says what it had found by then, and its signal is aborted, which stops
 * whatever it was waiting on that takes one, and any step it hasn't begun.
 */
async function timed<N extends LiveCheck['name'], D>(name: N, detail: D, run: (signal: AbortSignal) => Promise<string | null>): Promise<{ name: N; ok: boolean; ms: number; code: string | null; detail: D }> {
  const t0 = performance.now();
  const signal = AbortSignal.timeout(LIMIT_MS);
  const limit = new Promise<string>((resolve) => { signal.addEventListener('abort', () => resolve('timeout'), { once: true }); });
  let code: string | null;
  try {
    code = await Promise.race([run(signal), limit]);
  } catch (e) {
    code = codeOf(e);
  }
  const ms = since(t0);
  if (code !== null) olog.warn('operator check failed', { check: name, code, ms });
  return { name, ok: code === null, ms, code, detail: structuredClone(detail) };
}

const poolOf = (pool: pg.Pool): z.infer<typeof PoolCounts> => ({ total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount, max: pool.options.max ?? 10 });

function database(pool: pg.Pool) {
  const detail = { pool: poolOf(pool) };
  return timed('database', detail, async () => {
    try {
      await exec(pool, 'SELECT 1');
      return null;
    } finally {
      detail.pool = poolOf(pool);
    }
  });
}

function livekit(cfg: Keyless) {
  const detail: { rooms: number | null } = { rooms: null };
  return timed('livekit', detail, async () => {
    detail.rooms = (await livekitProbe(cfg)).rooms;
    return null;
  });
}

/** A private model: its evidence, fetched and checked afresh, then a probe sealed to the key it vouched for. */
function nearAi(cfg: Keyless, name: 'near-ai:speech' | 'near-ai:notes') {
  const task = name === 'near-ai:notes' ? 'notes' : 'transcript';
  const detail: NearAi = { model: task === 'notes' ? cfg.NEAR_AI_NOTES_MODEL : cfg.NEAR_AI_STT_MODEL, evidence: null, probe: null };
  return timed(name, detail, async (signal) => {
    if (!ready(cfg)) return 'not-connected';
    const t0 = performance.now();
    let v: Verified;
    try {
      v = await verifyFresh(cfg, detail.model, task);
    } catch (e) {
      const check = e instanceof UnverifiedError ? e.context['check'] : undefined;
      detail.evidence = { ok: false, ms: since(t0), check: typeof check === 'string' ? check : null, tcb: null, gpus: null };
      throw e;
    }
    // The check's time ran out while the evidence was fetched (its own fetches have their own limits): its answer has gone
    // already, and a probe sent now would be paid for and read by nobody.
    if (signal.aborted) return 'timeout';
    detail.evidence = { ok: true, ms: since(t0), check: null, tcb: v.evidence.tdx.status, gpus: v.evidence.gpu.count };
    // What's left of the check's ten seconds, less a little, so the probe says itself if it runs out.
    const t1 = performance.now();
    const timeoutMs = Math.max(SPARE_MS, Math.min(PROBE_MS, Math.round(t0 + LIMIT_MS - t1 - SPARE_MS)));
    let probe: Probe;
    try {
      probe = task === 'notes' ? await probeNotes(cfg, defaultModel(cfg), v, timeoutMs) : await probeSpeech(cfg, v, timeoutMs);
    } catch (e) {
      detail.probe = { ok: false, ms: since(t1), status: null, timedOut: lostOnceSent(e) };
      throw e;
    }
    detail.probe = { ok: probe.readable, ms: probe.ms, status: probe.status, timedOut: false };
    return probe.readable ? null : probe.status === 200 ? 'unreadable-reply' : String(probe.status);
  });
}

function oneclick(cfg: Keyless) {
  const detail: z.infer<typeof OneClick> = { offered: null, allowed: null, partnerKey: !!cfg.ONECLICK_API_KEY, topUps: !!cfg.TREASURY_INTENTS_ACCOUNT };
  return timed('oneclick', detail, async (signal) => {
    const { offered, allowed } = await probeTokens(cfg, signal);
    detail.offered = offered;
    detail.allowed = allowed;
    return offered > 0 ? null : 'no-routes';
  });
}

function google(cfg: Keyless) {
  const detail: z.infer<typeof Google> = {
    client: 'unchecked', step: null, signup: cfg.GOOGLE_SIGNUP_MODE, testers: cfg.GOOGLE_SIGNUP_TESTERS.length, keys: null, behindGoogleS: null, roundTripMs: null
  };
  return timed('google', detail, async (signal) => {
    const found = await checkGoogle(cfg, signal);
    detail.client = found.client;
    detail.step = found.failed?.step ?? null;
    detail.keys = found.keys;
    detail.behindGoogleS = found.behindGoogleS;
    detail.roundTripMs = found.roundTripMs;
    return found.failed?.code ?? null;
  });
}

/**
 * What the checks need: the settings without a key, which they never use, the database's pool and the object store. LiveKit,
 * NEAR AI, 1Click and Google are asked afresh.
 */
export type CheckDeps = Pick<Deps, 'pool' | 'objects'> & { cfg: Keyless };

/** Runs every check at once, each against its time limit. It never throws: whatever fails is in its check. */
export async function runChecks(d: CheckDeps): Promise<LiveCheck[]> {
  const t0 = performance.now();
  const checks: LiveCheck[] = await Promise.all([
    database(d.pool),
    timed('objects', {}, async (signal) => { await d.objects.ping(signal); return null; }),
    livekit(d.cfg),
    nearAi(d.cfg, 'near-ai:speech'),
    nearAi(d.cfg, 'near-ai:notes'),
    oneclick(d.cfg),
    google(d.cfg)
  ]);
  olog.info('operator checks', { failed: checks.filter((c) => !c.ok).length, ms: since(t0) });
  return checks;
}

interface Run { at: number; checks: Promise<LiveCheck[]> }
/** Each instance's last run (one app is one instance), and when it began. */
const runs = new WeakMap<HttpRuntime, Run>();

/**
 * The checks' answer from `runtime`'s instance (`instance` names it): a new run, or the last one if it began less than 20
 * seconds ago, marked `cached` and waited for if it's still going.
 */
export async function checksAnswer(runtime: HttpRuntime, instance: string): Promise<ChecksAnswer> {
  const last = runs.get(runtime);
  const cached = last !== undefined && Date.now() - last.at < EVERY_MS;
  const run: Run = last !== undefined && cached ? last : { at: Date.now(), checks: runChecks(runtime.d) };
  if (!cached) runs.set(runtime, run);
  const checks = await run.checks;
  return { instance, at: new Date().toISOString(), ranAt: new Date(run.at).toISOString(), cached, ok: checks.every((c) => c.ok), checks };
}
