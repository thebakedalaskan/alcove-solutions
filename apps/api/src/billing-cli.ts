import { z } from 'zod';
import { createPool } from './platform/db';
import { AppError } from './platform/errors';
import type { Support } from './features/billing/support';
import { runSupportCommand } from './features/billing/support-commands';
import { configureLogging, flushLogs, log } from './platform/log';
import { resolveKeys } from './keys/server-keys';

/**
 * `pnpm --filter @alcove/server billing …` is support's way into an account's plan (docs: Plans and usage › Support), in
 * whichever database DATABASE_URL names. It opens and seals plans with KSERVICE, and needs nothing else of the API's settings,
 * so it runs where KSERVICE is at hand, as it is outside a TEE (locally, from .env). Inside Confidential Space KSERVICE is in
 * the API's sealed server keys (server-keys.ts), and support reaches production through the operator route instead, which runs
 * the same commands (features/billing/support-commands.ts). An account is named by a top-up's reference or by its ID, never by
 * an address where a run is recorded. Where KMASTER is set too, which is locally, an address finds one as sign-in does, under
 * the index key the API resolves from it, so a developer can give an account money to buy with, without 1Click. What it prints
 * and logs says only what a log may hold (support.ts), and never repeats what was typed.
 */
const Key = (name: string) => z.string().regex(/^[A-Za-z0-9_-]{43}$/, `${name} must be 32 bytes, base64url`);
const env = z.object({
  DATABASE_URL: z.string().url(),
  KSERVICE: Key('KSERVICE'),
  KMASTER: z.preprocess((v) => (v === '' ? undefined : v), Key('KMASTER').optional()),
  LIMITS_CACHE_MS: z.coerce.number().int().min(0).max(300_000).default(30_000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
}).parse(process.env);
configureLogging({ level: env.LOG_LEVEL, format: env.LOG_FORMAT, service: 'alcove-billing' });

const say = (text: string) => { process.stdout.write(`${text}\n`); };

const pool = createPool(env.DATABASE_URL);
try {
  // The index key, where KMASTER is set: as the API resolves its keys outside a TEE, which refuses a database a TEE has
  // carried over, whose indexes are under a key KMASTER doesn't give.
  const keys = env.KMASTER === undefined ? undefined : await resolveKeys(pool, { tee: 'none', kmaster: env.KMASTER, kservice: env.KSERVICE });
  const d: Support = { pool, cfg: { KSERVICE: env.KSERVICE, LIMITS_CACHE_MS: env.LIMITS_CACHE_MS, ...(keys ? { INDEX_KEY: keys.INDEX_KEY } : {}) } };
  for (const line of await runSupportCommand(d, process.argv.slice(2), { lookup: 'ids-and-addresses' })) say(line);
} catch (e) {
  // A refusal (words that aren't a command, an amount that isn't one, nobody found, more than one account, a top-up still
  // watched or added already) says why, and logs its code and context, never what was typed: it may be an address.
  if (e instanceof AppError) { log.warn('billing refused', { code: e.code, ...e.context }); say(e.message); } else log.error('billing failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
