import { loadConfig } from './config';
import { createPool } from './db';
import { configureLogging, flushLogs, log } from './log';
import { migrate } from './migrate';

/** `pnpm migrate` locally; a one-off Cloud Run job in production. */
const cfg = loadConfig();
configureLogging({ level: cfg.LOG_LEVEL, format: cfg.LOG_FORMAT, service: 'alcove-migrate' });
const pool = createPool(cfg.DATABASE_URL);
try {
  const applied = await migrate(pool);
  log.info(applied.length ? 'migrations applied' : 'database up to date', { applied });
} catch (e) {
  log.error('migration failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
