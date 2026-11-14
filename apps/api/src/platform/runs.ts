/*
 * What this instance's background work has done, and what it last learned, for operators (GET /v1/operator/work and
 * /release: features/operator/work.ts and release.ts). Each loop records its runs as it goes (`runs`): when the last
 * one started and ended, how long it took, what it counted, whether one is running now, when one last succeeded, and
 * how runs, and the work inside them, failed in the last hour, by code. The facts (`facts`) are what start-up, the
 * attester, Google Cloud's clock and the edge's certificate said last. All of it is this instance's memory alone, gone
 * with a restart, and holds only names, times, durations, counts and codes.
 */
import { AppError } from './errors';

/** How a run ended: whether it did its work, what it counted, and if not, its failure's code (failureCode). */
export interface RunEnd { ok: boolean; counts?: Record<string, number> | undefined; code?: string | undefined }
export interface Run { end(o: RunEnd): void }

/** One loop, as the work report says it. Times are Unix ms. */
export interface RunSnapshot {
  name: string;
  /** Runs started and not ended yet: upkeep's can overlap, and the notes writer runs for several accounts at once. */
  running: number;
  lastStartedAt: number | null;
  lastEndedAt: number | null;
  lastMs: number | null;
  lastOk: boolean | null;
  lastCode: string | null;
  lastCounts: Record<string, number>;
  lastOkAt: number | null;
  /** How runs, and the work inside them, failed in the last hour: each code, and how many times. */
  failures: Record<string, number>;
}

const HOUR_MS = 3_600_000;
/** The most failures a loop keeps, the newest, within the hour. */
const FAILURES_KEPT = 1_000;

interface Loop {
  running: number;
  startedAt: number | null;
  endedAt: number | null;
  ms: number | null;
  ok: boolean | null;
  code: string | null;
  counts: Record<string, number>;
  okAt: number | null;
  failed: { at: number; code: string }[];
}
const loops = new Map<string, Loop>();
function loopOf(name: string): Loop {
  const known = loops.get(name);
  if (known) return known;
  const made: Loop = { running: 0, startedAt: null, endedAt: null, ms: null, ok: null, code: null, counts: {}, okAt: null, failed: [] };
  loops.set(name, made);
  return made;
}
/** Counts a failure, and forgets those over an hour old, and the oldest past the most kept. */
function fail(l: Loop, code: string, at: number): void {
  l.failed.push({ at, code });
  const old = l.failed.findIndex((f) => f.at >= at - HOUR_MS);
  const drop = Math.max(old, l.failed.length - FAILURES_KEPT);
  if (drop > 0) l.failed.splice(0, drop);
}

export const runs = {
  /** Starts one run of the loop `name`. Its `end` is said once; later calls change nothing. */
  begin(name: string): Run {
    const l = loopOf(name);
    const t0 = performance.now();
    l.running++;
    l.startedAt = Date.now();
    let open = true;
    return {
      end(o) {
        if (!open) return;
        open = false;
        const at = Date.now();
        l.running = Math.max(0, l.running - 1);
        l.endedAt = at;
        l.ms = Math.round(performance.now() - t0);
        l.ok = o.ok;
        l.code = o.ok ? null : o.code ?? 'failed';
        l.counts = { ...o.counts };
        if (o.ok) l.okAt = at;
        else fail(l, l.code ?? 'failed', at);
      }
    };
  },
  /** One piece of a loop's work failed while its run goes on (one note of several the writer took): counted by its code. */
  failed(name: string, code: string): void {
    fail(loopOf(name), code, Date.now());
  },
  /** Every loop this instance has run, by name. */
  snapshot(): RunSnapshot[] {
    const from = Date.now() - HOUR_MS;
    return [...loops].sort(([a], [b]) => a.localeCompare(b)).map(([name, l]) => {
      const failures: Record<string, number> = {};
      for (const f of l.failed) if (f.at >= from) failures[f.code] = (failures[f.code] ?? 0) + 1;
      return {
        name, running: l.running, lastStartedAt: l.startedAt, lastEndedAt: l.endedAt, lastMs: l.ms, lastOk: l.ok, lastCode: l.code,
        lastCounts: { ...l.counts }, lastOkAt: l.okAt, failures
      };
    });
  }
};

/** A code as an answer and the log may hold one: letters, digits and a few marks, never words. */
export const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
/** Another service's HTTP status, when the error's context names one (`upstreamStatus`). */
function upstreamOf(e: unknown): number | undefined {
  const s = e instanceof AppError ? e.context['upstreamStatus'] : undefined;
  return typeof s === 'number' && Number.isInteger(s) ? s : undefined;
}

/** A failure as one code: the error's class, with another service's status when its context names one (InternalError:403). */
export function failureCode(e: unknown): string {
  const name = e instanceof Error && CODE.test(e.name) ? e.name : 'unknown';
  const upstream = upstreamOf(e);
  return upstream === undefined ? name : `${name}:${upstream}`;
}

const isCode = (v: unknown): v is string => typeof v === 'string' && CODE.test(v);
/**
 * The most specific code in an error and its causes. Ours: what its context names it by (a failed first connection's
 * `code`, the evidence `check` that failed, Postgres's `pgCode`, a refusal's `reason`, or another service's `error`, as the
 * Security Token Service's unauthorized_client), else the HTTP status another service answered (`upstreamStatus`), else
 * its cause's. Another's: the HTTP status its server answered (LiveKit's), a system's code (ECONNREFUSED), its cause's, or
 * its name where that says more than that it failed or stopped (S3's NoSuchBucket).
 */
function codeIn(e: unknown, depth = 0): string | undefined {
  if (!(e instanceof Error) || depth > 4) return undefined;
  if (e instanceof AppError) {
    const named = [e.context['code'], e.context['check'], e.context['pgCode'], e.context['reason'], e.context['error']].find(isCode);
    const upstream = upstreamOf(e);
    return named ?? (upstream === undefined ? undefined : String(upstream)) ?? codeIn(e.cause, depth + 1);
  }
  const status = 'status' in e && typeof e.status === 'number' && Number.isInteger(e.status) ? String(e.status) : undefined;
  const own = 'code' in e ? e.code : undefined;
  if (status !== undefined) return status;
  if (isCode(own)) return own;
  return codeIn(e.cause, depth + 1) ?? (!SAYS_LITTLE.has(e.name) && CODE.test(e.name) ? e.name : undefined);
}
/** Names that say only that something failed or stopped: one of ours that wraps such an error says more by its own class. */
const SAYS_LITTLE = new Set(['Error', 'TypeError', 'AbortError', 'TimeoutError', 'DOMException']);

/**
 * A failure as one code, as a live check says it (features/operator/checks.ts) and Google's check (providers/google.ts): the
 * most specific code in it or its causes, else its class (UnansweredError, TimeoutError). Never a message.
 */
export function codeOf(e: unknown): string {
  return codeIn(e) ?? (e instanceof Error && CODE.test(e.name) ? e.name : 'unknown');
}

/**
 * An error's class and code, as a start step says them: the most specific code in it or its causes (Cloud KMS's
 * PERMISSION_DENIED under the KeyError that says the master didn't unwrap), else its own, an AppError's.
 */
export function failureOf(e: unknown): { errorClass: string; code: string | null } {
  const errorClass = e instanceof Error && CODE.test(e.name) ? e.name : 'unknown';
  return { errorClass, code: codeIn(e) ?? (e instanceof AppError ? e.code : null) };
}

/**
 * Runs `work` as one run of the loop `name`, ending it as `work` ends: with what `counts` makes of its result, or with its
 * failure's code, which goes on up.
 */
export async function tracked<T>(name: string, work: () => Promise<T>, counts: (result: T) => Record<string, number> = () => ({})): Promise<T> {
  const run = runs.begin(name);
  try {
    const result = await work();
    run.end({ ok: true, counts: counts(result) });
    return result;
  } catch (e) {
    run.end({ ok: false, code: failureCode(e) });
    throw e;
  }
}

/** One start step (start.ts), as its `boot step` line says it. */
export interface BootStep {
  step: 'config' | 'google-cloud' | 'database' | 'migrations' | 'keys' | 'objects' | 'edge' | 'listening';
  ms: number;
  ok: boolean;
  errorClass: string | null;
  code: string | null;
}

/** What this instance last learned, each part set where it's learned. Times are Unix ms. */
export interface Facts {
  /** The start that's serving, step by step (start.ts). */
  boot: BootStep[];
  startedAt: number;
  /** How far this VM's clock is behind Google's, from the last answer Google dated (gcp.ts). */
  clock: { behindGoogleS: number; roundTripMs: number; at: number };
  /** Inside a TEE: the launcher's token this instance holds, and how asking for one last failed (tee.ts). */
  attestation: {
    issuedAt: number | null;
    expiresAt: number | null;
    /** The image the token says runs, by its digest, and the release's entry in Sigstore's public log, when it was found. */
    imageDigest: string | null;
    rekorLogIndex: number | null;
    lastFailure: { code: string; at: number } | null;
    /** When the launcher is asked next: once the token is 5 minutes old, or once it may be asked again after failing. */
    nextAskAt: number | null;
  };
  /** With TLS_HOSTS: the certificate this instance serves, and its last look at whether a newer one is due (edge/certificates.ts). */
  certificate: {
    notAfter: number;
    storedAt: number;
    /** How many host names it names. */
    hosts: number;
    /** Whether its key is the TLS key the master makes, which the attestation names. */
    spkiMatches: boolean;
    lastCheck: { at: number; ok: boolean; code: string | null } | null;
  };
}
const known: Partial<Facts> = {};
export const facts = {
  set<K extends keyof Facts>(k: K, v: Facts[K]): void { known[k] = v; },
  get<K extends keyof Facts>(k: K): Facts[K] | undefined { return known[k]; }
};
