import { z } from 'zod';
import { createPool } from './platform/db';
import { AppError } from './platform/errors';
import { runLimitCommand } from './platform/limit-commands';
import { configureLogging, flushLogs, log } from './platform/log';

/**
 * `pnpm --filter @alcove/server limits list` says which limits are in force, and `limits set <name> <value>` changes one,
 * in whichever database DATABASE_URL names, as `migrate` does: locally from .env, and against production through Cloud
 * SQL's proxy or as a one-off job, or through the operator route, which runs the same commands (platform/limit-commands.ts). Like
 * `migrate`, it needs the database and nothing else. Every instance takes a change within LIMITS_CACHE_MS, with no restart,
 * and logs it.
 */
const env = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
}).parse(process.env);
configureLogging({ level: env.LOG_LEVEL, format: env.LOG_FORMAT, service: 'alcove-limits' });

const say = (text: string) => { process.stdout.write(`${text}\n`); };

const pool = createPool(env.DATABASE_URL);
try {
  for (const line of await runLimitCommand(pool, process.argv.slice(2))) say(line);
} catch (e) {
  // A refusal (words that aren't a command, a name that isn't a limit, a value its bounds don't allow) says why, and logs
  // its code and context, never what was typed; anything else failed.
  if (e instanceof AppError) { log.warn('limit not set', { code: e.code, ...e.context }); say(e.message); } else log.error('limits failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
