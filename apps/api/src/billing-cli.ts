import { z } from 'zod';
import { createPool } from './platform/db';
import { AppError } from './platform/errors';
import { creditBySupport, named, standingOf, type Support } from './features/billing/support';
import { configureLogging, flushLogs, log } from './platform/log';

/**
 * `pnpm --filter @alcove/server billing …` is support's way into an account's plan (docs: Plans and usage › Support), in
 * whichever database DATABASE_URL names. It opens and seals plans with KSERVICE, and needs nothing else of the API's settings,
 * so it runs where KSERVICE is at hand, as it is outside a TEE (locally, from .env). Inside Confidential Space KSERVICE is in
 * the API's sealed server keys (server-keys.ts), so no deploy runs this as a job. An account is named by a top-up's reference
 * or by its ID, never by an address where a run is recorded, as a job's arguments are kept with its execution and in Cloud
 * Audit Logs. Where KMASTER is set too, which is locally, an address finds one as sign-in does, by the index key derived from
 * it, so a developer can give an account money to buy with, without 1Click. What it prints and logs says only what a log may
 * hold (support.ts), and never repeats what was typed.
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

const USAGE = `billing show <who>           the account's plan, whether Pro renews, counts, and whether its balance covers a month of Pro
billing credit <who> <usd>   adds <usd> dollars (20, 4.50) to its balance, as "Added by support"

<who> is a top-up's reference or an account's ID. Credited by a top-up's reference, it's that top-up's money, in its place:
it can't add itself again, and one added already is refused. Anything else, such as a second payment to its address, goes
by the account's ID.
Where KMASTER is set, as it is locally, an address the account signs in with names it too.
`;
const say = (text: string) => { process.stdout.write(`${text}\n`); };
/** Dollars as typed, to micro-USD: up to 6 decimals, more than nothing and at most $10,000. */
function microUsdOf(typed: string): number | undefined {
  const m = /^\$?(\d{1,5})(?:\.(\d{1,6}))?$/.exec(typed.trim());
  if (!m) return undefined;
  const value = Number(m[1] ?? '') * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'));
  return value > 0 && value <= 10_000_000_000 ? value : undefined;
}

const [command, who, typed, ...rest] = process.argv.slice(2);
const pool = createPool(env.DATABASE_URL);
const d: Support = { pool, cfg: { KSERVICE: env.KSERVICE, LIMITS_CACHE_MS: env.LIMITS_CACHE_MS, ...(env.KMASTER === undefined ? {} : { KMASTER: env.KMASTER }) } };
try {
  if (command === 'show' && who !== undefined && typed === undefined) {
    for (const line of await standingOf(d, await named(d, who))) say(line);
  } else if (command === 'credit' && who !== undefined && typed !== undefined && !rest.length) {
    const microUsd = microUsdOf(typed);
    if (microUsd === undefined) {
      // What was typed isn't logged: it may be an address put in the wrong place.
      log.warn('billing refused', { why: 'not an amount' });
      say('An amount is dollars, more than 0 and at most 10000, with up to 6 decimals: 20, 4.50.');
      process.exitCode = 1;
    } else {
      const { ownerId, depositId, state } = await creditBySupport(d, who, microUsd);
      say(`Added to the balance of account ${ownerId}, as “Added by support”.`);
      if (depositId !== null && state !== null) say(`Top-up ${depositId} (${state}) is no longer watched, so it can’t add itself again.`);
    }
  } else {
    say(USAGE);
    process.exitCode = 1;
  }
} catch (e) {
  // A refusal (nothing found, more than one account, a top-up still watched or added already) says why, never what was
  // typed: it may be an address. Anything else failed.
  if (e instanceof AppError) { log.warn('billing refused', { code: e.code }); say(e.message); } else log.error('billing failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
