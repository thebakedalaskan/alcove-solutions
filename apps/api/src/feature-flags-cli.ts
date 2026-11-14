import { z } from 'zod';
import { deriveIndexKey, unb64u } from './keys/crypto';
import { createPool } from './platform/db';
import { AppError } from './platform/errors';
import { runFeatureFlagCommand } from './platform/feature-flag-commands';
import { configureLogging, flushLogs, log } from './platform/log';

/**
 * `pnpm --filter @alcove/server feature-flags …` switches feature flags on and off, for everyone, for groups and for people, in
 * whichever database DATABASE_URL names (docs: engineering/feature-flags.md). It runs the same commands the API's operator route
 * does (feature-flag-commands.ts) and prints what they say. Unlike `limits` it needs KMASTER, to hash the addresses it's given as
 * the API does, so it's for a database whose KMASTER is at hand: a local one, from .env. Inside the TEE, flags are switched
 * through the operator route instead. Every instance takes a change within FEATURE_FLAGS_CACHE_MS, with no restart. Nothing it
 * says, here or in its log, repeats an address or anything else typed that isn't a flag or a group. It says flags, groups and
 * counts.
 */
const env = z.object({
  DATABASE_URL: z.string().url(),
  KMASTER: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
}).parse(process.env);
configureLogging({ level: env.LOG_LEVEL, format: env.LOG_FORMAT, service: 'alcove-feature-flags' });
// The key the blind indexes were made with, which the TEE carries over from the KMASTER of before it.
const index = deriveIndexKey(unb64u(env.KMASTER, 32));
const say = (text: string) => { process.stdout.write(`${text}\n`); };

const pool = createPool(env.DATABASE_URL);
try {
  for (const line of await runFeatureFlagCommand(pool, index, process.argv.slice(2))) say(line);
  process.exitCode = 0;
} catch (e) {
  // A refusal (words that aren't a command, no such group, a name that can't be one) says why; anything else failed.
  if (e instanceof AppError) { log.warn('feature flags refused', { code: e.code }); say(e.message); } else log.error('feature flags failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
