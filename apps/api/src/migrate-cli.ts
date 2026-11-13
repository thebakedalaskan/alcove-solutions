import { z } from 'zod';
import { createPool } from './platform/db';
import { configureLogging, flushLogs, log } from './platform/log';
import { migrate } from './migrate';

/**
 * `pnpm migrate` locally; a one-off job in production. Migrations only shape tables, so this needs the
 * database and nothing else: no keys, no provider secrets.
 */
const env = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
}).parse(process.env);
configureLogging({ level: env.LOG_LEVEL, format: env.LOG_FORMAT, service: 'alcove-migrate' });
const pool = createPool(env.DATABASE_URL);
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
