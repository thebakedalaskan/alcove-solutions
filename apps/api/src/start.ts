/*
 * Starting the API (docs: system-architecture): what server.ts runs, with what it reaches outside the environment made
 * explicit, so a test starts a server exactly as production does. Inside Confidential Space, the settings that are secrets,
 * the old keys and Cloud KMS come through the VM's attestation first (gcp.ts), never through the environment, which is part
 * of the attestation. Then the database and its migrations, the keys (serverKeys.ts), and the listener: the edge, where TLS
 * ends in the process (edge/), or plain HTTP behind something else's TLS.
 */
import { productionLog, type ReleaseLog } from '@alcove/api-http/release';
import { serve, type ServerType } from '@hono/node-server';
import { Server } from 'node:http';
import { createApp } from './app';
import { loadBoot, loadConfig, loadEnv } from './config';
import type { Deps } from './context';
import { createPool } from './db';
import { CLOUDFLARE, type DnsServices } from './edge/dns';
import { startEdge } from './edge/listen';
import { startWatching } from './features/billing/deposits';
import { GOOGLE_CLOUD, fromGoogleCloud, type GoogleCloud } from './gcp';
import { inference } from './inference';
import { createDocPool } from './live/docPool';
import { createHub } from './live/hub';
import { createLiveKit } from './livekit';
import { log } from './log';
import { maintain } from './maintenance';
import { migrate } from './migrate';
import { createObjectStore } from './objects';
import { rewrapOwners } from './serverKeys';
import { LAUNCHER_SOCKET, createAttester } from './tee';

const slog = log.child({ component: 'server' });

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
  const boot = loadBoot(env);
  const tee = boot.tee ? await fromGoogleCloud(boot.tee, outside.google) : undefined;
  // The settings that are secrets go to the configuration beside the environment, and never into it.
  const e = loadEnv(env, tee?.secrets ?? {});
  const pool = createPool(e.DATABASE_URL);
  const opened: { close(): Promise<void> }[] = [];
  try {
    const applied = await migrate(pool);
    slog.info(applied.length ? 'migrations applied' : 'database up to date', { applied });
    // The keys come after the migrations: inside a TEE, the master and the server keys are in the database.
    const cfg = await loadConfig(e, pool, tee);
    const objects = await createObjectStore(cfg);
    const hub = createHub(cfg.DATABASE_URL, { checkMs: cfg.HUB_CHECK_MS, timeoutMs: cfg.HUB_TIMEOUT_MS, maxStreams: cfg.LIVE_STREAMS_MAX, maxPerAddress: cfg.LIVE_STREAMS_PER_ADDRESS, makeRoomAfterMs: cfg.LIVE_MAKE_ROOM_MS });
    opened.push(hub);
    const docs = createDocPool({ workers: cfg.DOC_WORKERS, timeoutMs: cfg.DOC_WORK_MS, heapMb: cfg.DOC_HEAP_MB, waitingPerPerson: cfg.DOC_WAITING_PER_PERSON });
    opened.push(docs);
    const deps: Deps = { cfg, pool, objects, livekit: createLiveKit(cfg), hub, docs };
    const stopping = new AbortController();
    const app = createApp(deps, stopping.signal, createAttester(deps, { socket: outside.launcher, log: outside.log }));

    let ports: Running['ports'];
    let stopListening: () => Promise<void>;
    if (cfg.edge) {
      const edge = await startEdge({ cfg, edge: cfg.edge, pool, api: app.fetch, dns: outside.dns });
      ports = { https: edge.https, http: edge.http };
      stopListening = () => edge.close();
    } else {
      const server: ServerType = await new Promise((resolve, reject) => {
        const s = serve({ fetch: app.fetch, port: cfg.API_PORT, hostname: cfg.API_HOST }, () => resolve(s));
        s.once('error', reject);
      });
      const at = server.address();
      ports = { api: typeof at === 'object' && at ? at.port : cfg.API_PORT };
      stopListening = () => new Promise<void>((r) => { server.close(() => r()); if (server instanceof Server) server.closeIdleConnections(); });
    }
    slog.info('listening', { ...ports, inference: inference(cfg).configured ? 'configured' : 'not configured' });

    // Work in the background, which closing waits for before the pool goes.
    const background = new Set<Promise<void>>();
    const inBackground = (work: Promise<void>) => { background.add(work); void work.finally(() => background.delete(work)); };
    // Inside a TEE, while the old master is held, every account the master doesn't open yet is wrapped again under it.
    if (cfg.TEE === 'confidential-space' && cfg.LEGACY_KMASTER !== undefined) {
      const klog = log.child({ component: 'server-keys' });
      inBackground(rewrapOwners(deps)
        .then((r) => klog.at(r.failed ? 'warn' : 'info', 'owners rewrapped', r))
        .catch((err: unknown) => klog.error('owners not rewrapped', { err })));
    }
    const mlog = log.child({ component: 'maintenance' });
    const upkeep = () => inBackground(mlog.timed('maintenance run', {}, () => maintain(deps), 30_000)
      .then((r) => (r.sessions || r.retried || r.orphans || r.receipts || r.videos || r.notes ? mlog.info('maintenance done', r) : mlog.debug('maintenance done', r)))
      .catch((err: unknown) => mlog.error('maintenance failed', { err })));
    upkeep();
    const timer = setInterval(upkeep, 5 * 60_000);
    timer.unref();
    const stopWatchingDeposits = startWatching(deps);

    return {
      deps, ports,
      async close() {
        clearInterval(timer);
        stopWatchingDeposits();
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
