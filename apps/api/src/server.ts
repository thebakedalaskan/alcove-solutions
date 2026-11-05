import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { inference } from './inference';
import { configureLogging, flushLogs, log } from './log';
import { maintain } from './maintenance';
import { watch } from './modules/deposits';
import { depositProviders } from './payments/provider';
import { createLiveKit } from './livekit';
import { migrate } from './migrate';
import { createObjectStore } from './objects';

const slog = log.child({ component: 'server' });
process.on('unhandledRejection', (e) => slog.error('unhandled promise rejection', { err: e }));
process.on('uncaughtException', (e) => { slog.error('uncaught exception, exiting', { err: e }); flushLogs(); process.exit(1); });

const cfg = await loadConfig();
configureLogging({ level: cfg.LOG_LEVEL, format: cfg.LOG_FORMAT });
slog.info('starting', { node: process.version, logLevel: cfg.LOG_LEVEL, webOrigin: cfg.WEB_ORIGIN, tee: cfg.TEE, commit: cfg.ALCOVE_COMMIT });

const pool = createPool(cfg.DATABASE_URL);
const applied = await migrate(pool);
slog.info(applied.length ? 'migrations applied' : 'database up to date', { applied });
const objects = await createObjectStore(cfg);
const deps = { cfg, pool, objects, livekit: createLiveKit(cfg) };
const app = createApp(deps);

const mlog = log.child({ component: 'maintenance' });
const upkeep = () => mlog.timed('maintenance run', {}, () => maintain(deps), 30_000)
  .then((r) => (r.sessions || r.retried || r.orphans || r.receipts || r.notes ? mlog.info('maintenance done', r) : mlog.debug('maintenance done', r)))
  .catch((e: unknown) => mlog.error('maintenance failed', { err: e }));
void upkeep();
const timer = setInterval(() => void upkeep(), 5 * 60_000);
timer.unref();

// Open credit top-ups, checked with their provider every 5 seconds while top-ups are on. One pass at a time here;
// other instances' passes skip the deposits this one has claimed.
const dlog = log.child({ component: 'deposits' });
let watching = false;
const watchDeposits = async () => {
  if (watching) return;
  watching = true;
  const t0 = performance.now();
  try {
    const r = await watch(deps);
    if (r.checked) dlog.info('deposits watched', { ...r, ms: Math.round(performance.now() - t0) });
  } catch (e) {
    dlog.error('watching deposits failed', { err: e });
  } finally {
    watching = false;
  }
};
const depositTimer = depositProviders(cfg) ? setInterval(() => void watchDeposits(), 5_000) : undefined;
depositTimer?.unref();

const server = serve({ fetch: app.fetch, port: cfg.API_PORT, hostname: cfg.API_HOST }, (info) => {
  slog.info('listening', { url: `http://${cfg.API_HOST}:${info.port}`, inference: inference(cfg).configured ? 'configured' : 'not configured' });
});

function shutdown(signal: string) {
  slog.info('shutting down', { signal });
  clearInterval(timer);
  clearInterval(depositTimer);
  server.close(() => { void pool.end().finally(() => { slog.info('stopped'); flushLogs(); process.exit(0); }); });
  setTimeout(() => { slog.warn('forced exit after 10s'); flushLogs(); process.exit(1); }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
