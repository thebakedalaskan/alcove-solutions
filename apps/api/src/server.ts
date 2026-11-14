import { loadBoot, type Boot } from './platform/config';
import { configureLogging, flushLogs, log } from './platform/log';
import { startServer } from './start';

const slog = log.child({ component: 'server' });
process.on('unhandledRejection', (e) => slog.error('unhandled promise rejection', { err: e }));
process.on('uncaughtException', (e) => { slog.error('uncaught exception, exiting', { err: e }); flushLogs(); process.exit(1); });

// Settings it can't start with, as inside a TEE a secret SECRETS may not name, are refused here, with the reason.
let boot: Boot;
try {
  boot = loadBoot(process.env);
} catch (e) {
  slog.error('refused to start', { err: e });
  flushLogs();
  process.exit(1);
}
const { LOG_LEVEL, LOG_FORMAT, WEB_ORIGIN, TEE, ALCOVE_COMMIT } = boot;
configureLogging({ level: LOG_LEVEL, format: LOG_FORMAT });
slog.info('starting', { node: process.version, logLevel: LOG_LEVEL, webOrigin: WEB_ORIGIN, tee: TEE, commit: ALCOVE_COMMIT });

// Inside a TEE, a key that won't open, a secret that can't be read or a refused attestation stops it here, with the reason.
const running = await startServer(process.env).catch((e: unknown) => {
  slog.error('refused to start', { err: e });
  flushLogs();
  process.exit(1);
});

function shutdown(signal: string) {
  slog.info('shutting down', { signal });
  void running.close().then(
    () => { slog.info('stopped'); flushLogs(); process.exit(0); },
    (e: unknown) => { slog.error('stopping failed', { err: e }); flushLogs(); process.exit(1); }
  );
  setTimeout(() => { slog.warn('forced exit after 10s'); flushLogs(); process.exit(1); }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
