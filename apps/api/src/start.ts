/*
 * Starting the API (docs: system-architecture): what server.ts runs, with what it reaches outside the environment made
 * explicit, so a test starts a server exactly as production does. Inside Confidential Space, the settings that are secrets,
 * the old keys and Cloud KMS come through the VM's attestation first (gcp.ts), never through the environment, which is part
 * of the attestation. Then the database, waited for until it can be reached (platform/db.ts), and its migrations, the keys
 * (keys/server-keys.ts), and the listener: the edge, where TLS ends in the process (edge/), or plain HTTP behind something else's TLS.
 * Each step says how it went as it happens (`boot step`), and `operator release` shows the steps of the start that's serving.
 */
import { productionLog, type ReleaseLog } from '@alcove/api-http/release';
import { serve, type ServerType } from '@hono/node-server';
import { Server } from 'node:http';
import { createApp } from './app';
import { loadBoot, loadConfig, loadEnv } from './platform/config';
import type { Deps } from './platform/context';
import { createPool, waitForDatabase } from './platform/db';
import { CLOUDFLARE, type DnsServices } from './edge/dns';
import { startEdge } from './edge/listen';
import { opensAccounting } from './features/billing/plans';
import { startWatching } from './features/billing/top-ups/deposits';
import { startEndingOverdue } from './features/calls/lifecycle';
import { GOOGLE_CLOUD, fromGoogleCloud, type GoogleCloud } from './tee/gcp';
import { inference } from './inference/inference';
import { createDocPool } from './live/doc-pool';
import { DOC_WORKER } from './features/workspaces/documents/pool';
import { createHub } from './live/hub';
import { createLiveKit } from './providers/livekit';
import { log } from './platform/log';
import { maintain } from './maintenance';
import { migrate } from './migrate';
import { createObjectStore } from './platform/objects';
import { facts, failureOf, tracked, type BootStep } from './platform/runs';
import { rewrapOwners } from './keys/server-keys';
import { LAUNCHER_SOCKET, createAttester } from './tee/tee';

const slog = log.child({ component: 'server' });
/** How long a new instance waits before its first upkeep (maintenance.ts). */
const FIRST_UPKEEP_MS = 60_000;

/**
 * Runs one start step, timed, and says how it went (`boot step`): how long it took, and its error's class and code if it
 * failed. Kept for `operator release`, so a slow start shows too.
 */
async function bootStep<T>(step: BootStep['step'], run: () => Promise<T> | T): Promise<T> {
  const t0 = performance.now();
  const said = (how: Pick<BootStep, 'ok' | 'errorClass' | 'code'>) => {
    const line: BootStep = { step, ms: Math.round(performance.now() - t0), ...how };
    facts.set('boot', [...(facts.get('boot') ?? []), line]);
    slog.at(line.ok ? 'info' : 'error', 'boot step', { ...line });
  };
  try {
    const out = await run();
    said({ ok: true, errorClass: null, code: null });
    return out;
  } catch (e) {
    said({ ok: false, ...failureOf(e) });
    throw e;
  }
}

/**
 * What the server reaches that isn't from the environment: Google Cloud, the launcher's socket, Cloudflare and a public
 * resolver, and Sigstore's public log with the keys its entries are checked with. Production's own, or a test's stand-ins,
 * chosen here and nowhere else. Never set from the environment, which whoever runs the VM controls.
 */
export interface Outside { google: GoogleCloud; launcher: string; dns: DnsServices; log: ReleaseLog }
export const OUTSIDE: Outside = { google: GOOGLE_CLOUD, launcher: LAUNCHER_SOCKET, dns: CLOUDFLARE, log: productionLog() };

export interface Running {
  deps: Deps;
  /** The ports it took: the edge's HTTPS and HTTP ports, or the API's own. */
  ports: { https: number; http: number } | { api: number };
  close(): Promise<void>;
}

/** Starts the API from `env`, and its background work. Refuses (rejects) whatever it can't start safely. */
export async function startServer(env: NodeJS.ProcessEnv, outside: Outside = OUTSIDE): Promise<Running> {
  facts.set('startedAt', Date.now());
  facts.set('boot', []);
  const boot = loadBoot(env);
  const teeBoot = boot.tee;
  const tee = teeBoot ? await bootStep('google-cloud', () => fromGoogleCloud(teeBoot, outside.google)) : undefined;
  // The settings that are secrets go to the configuration beside the environment, and never into it.
  const e = await bootStep('config', () => loadEnv(env, tee?.secrets ?? {}));
  const pool = createPool(e.DATABASE_URL);
  const opened: { close(): Promise<void> }[] = [];
  try {
    // A new VM's first connection can take longer than any later one may: it's tried until DATABASE_WAIT_MS has gone.
    await bootStep('database', () => waitForDatabase(pool, e.DATABASE_WAIT_MS));
    const applied = await bootStep('migrations', () => migrate(pool));
    slog.info(applied.length ? 'migrations applied' : 'database up to date', { applied });
    // The keys come after the migrations: inside a TEE, the master and the server keys are in the database.
    const cfg = await bootStep('keys', () => loadConfig(e, pool, tee && { wrapper: tee.wrapper, legacy: tee.legacy, opensAccounting }));
    const objects = await bootStep('objects', () => createObjectStore(cfg));
    const hub = createHub(cfg.DATABASE_URL, { checkMs: cfg.HUB_CHECK_MS, timeoutMs: cfg.HUB_TIMEOUT_MS, maxStreams: cfg.LIVE_STREAMS_MAX, maxPerAddress: cfg.LIVE_STREAMS_PER_ADDRESS, makeRoomAfterMs: cfg.LIVE_MAKE_ROOM_MS });
    opened.push(hub);
    const docs = createDocPool({ workers: cfg.DOC_WORKERS, timeoutMs: cfg.DOC_WORK_MS, heapMb: cfg.DOC_HEAP_MB, waitingPerPerson: cfg.DOC_WAITING_PER_PERSON, worker: DOC_WORKER });
    opened.push(docs);
    const deps: Deps = { cfg, pool, objects, livekit: createLiveKit(cfg), hub, docs };
    const stopping = new AbortController();
    const app = createApp(deps, stopping.signal, createAttester(deps, { socket: outside.launcher, log: outside.log }));

    let ports: Running['ports'];
    let stopListening: () => Promise<void>;
    const edgeSettings = cfg.edge;
    if (edgeSettings) {
      // The certificate, stored or ordered now, then the listeners.
      const edge = await bootStep('edge', () => startEdge({ cfg, edge: edgeSettings, pool, api: app.fetch, dns: outside.dns }));
      ports = { https: edge.https, http: edge.http };
      stopListening = () => edge.close();
    } else {
      const server = await bootStep('listening', () => new Promise<ServerType>((resolve, reject) => {
        const s = serve({ fetch: app.fetch, port: cfg.API_PORT, hostname: cfg.API_HOST }, () => resolve(s));
        s.once('error', reject);
      }));
      const at = server.address();
      ports = { api: typeof at === 'object' && at ? at.port : cfg.API_PORT };
      stopListening = () => new Promise<void>((r) => { server.close(() => r()); if (server instanceof Server) server.closeIdleConnections(); });
    }
    slog.info('listening', { ...ports, inference: inference(cfg).configured ? 'configured' : 'not configured' });
    // HACKATHON PATCH: remove after the NEAR AI hackathon submission.
    if (cfg.HACKATHON_WRITING_SHOWN_PRIVATE) {
      slog.warn('HACKATHON_WRITING_SHOWN_PRIVATE is on: notes written after a call record no unencrypted use of the writing model', { writingModel: cfg.NEAR_AI_WRITING_MODEL ?? cfg.NEAR_AI_NOTES_MODEL });
    }

    // Work in the background, which closing waits for before the pool goes.
    const background = new Set<Promise<void>>();
    const inBackground = (work: Promise<void>) => { background.add(work); void work.finally(() => background.delete(work)); };
    // Inside a TEE, while the old master is held, every account the master doesn't open yet is wrapped again under it.
    if (cfg.TEE === 'confidential-space' && cfg.LEGACY_KMASTER !== undefined) {
      const klog = log.child({ component: 'server-keys' });
      inBackground(tracked('owners-rewrap', () => rewrapOwners(deps), (r) => r)
        .then((r) => klog.at(r.failed ? 'warn' : 'info', 'owners rewrapped', r))
        .catch((err: unknown) => klog.error('owners not rewrapped', { err })));
    }
    const mlog = log.child({ component: 'maintenance' });
    const upkeep = () => inBackground(mlog.timed('maintenance run', {}, () => maintain(deps), 30_000)
      .then((r) => (r.sessions || r.retried || r.orphans || r.receipts || r.videos || r.notes ? mlog.info('maintenance done', r) : mlog.debug('maintenance done', r)))
      .catch((err: unknown) => mlog.error('maintenance failed', { err })));
    // The first run waits a minute: while a new instance starts, its pool is still opening connections and the instance
    // it replaces is still serving, and upkeep's sweeps there held every connection until they timed out (14 Nov, at two
    // deploys), so requests had none. Every five minutes after that.
    const first = setTimeout(upkeep, FIRST_UPKEEP_MS);
    first.unref();
    const timer = setInterval(upkeep, 5 * 60_000);
    timer.unref();
    const stopWatchingDeposits = startWatching(deps);
    // A call ends by itself at its longest (docs: Plans and usage).
    const stopEndingOverdue = startEndingOverdue(deps);

    return {
      deps, ports,
      async close() {
        clearTimeout(first);
        clearInterval(timer);
        stopWatchingDeposits();
        stopEndingOverdue();
        stopping.abort();
        // Live streams go first: they'd hold the server open, and their browsers open them again on another instance.
        await Promise.all([hub.close(), docs.close()]);
        await stopListening();
        await Promise.all([...background]);
        await pool.end();
      }
    };
  } catch (err) {
    await Promise.all(opened.map((o) => o.close().catch(() => undefined)));
    await pool.end().catch(() => undefined);
    throw err;
  }
}
