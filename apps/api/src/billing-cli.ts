import { loadConfig } from './config';
import { createPool } from './db';
import { AppError } from './errors';
import { accountByEmail, creditByEmail, standingOf } from './features/billing/support';
import { configureLogging, flushLogs, log } from './log';

/**
 * `pnpm --filter @alcove/server billing …` is support's way into an account's plan (docs: Plans and usage › Support), in
 * whichever database DATABASE_URL names. Like the API it needs KMASTER, to find an account by its address as sign-in does,
 * and KSERVICE, to open and seal the plan: locally from .env, and in production as a one-off job on the API's image with
 * both bound, so neither key reaches a laptop. It says the plan, the balance, the months of Pro and the notices, never
 * the address or anything else about the person; locally it gives an account money to buy Pro with, without 1Click.
 */
const cfg = await loadConfig();
configureLogging({ level: cfg.LOG_LEVEL, format: cfg.LOG_FORMAT, service: 'alcove-billing' });

const USAGE = `billing show <email>          the plan, balance, months of Pro and notices of the account signed in with <email>
billing credit <email> <usd>   adds <usd> dollars (20, 4.50) to its balance, as "Added by support"
`;
const say = (text: string) => { process.stdout.write(`${text}\n`); };
/** Dollars as typed, to micro-USD: up to 6 decimals, more than nothing and at most $10,000. */
function microUsdOf(typed: string): number | undefined {
  const m = /^\$?(\d{1,5})(?:\.(\d{1,6}))?$/.exec(typed.trim());
  if (!m) return undefined;
  const value = Number(m[1] ?? '') * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'));
  return value > 0 && value <= 10_000_000_000 ? value : undefined;
}

const [command, email, typed, ...rest] = process.argv.slice(2);
const pool = createPool(cfg.DATABASE_URL);
const d = { cfg, pool };
try {
  if (command === 'show' && email !== undefined && typed === undefined) {
    for (const line of await standingOf(d, await accountByEmail(d, email))) say(line);
  } else if (command === 'credit' && email !== undefined && typed !== undefined && !rest.length) {
    const microUsd = microUsdOf(typed);
    if (microUsd === undefined) {
      say('An amount is dollars, more than 0 and at most 10000, with up to 6 decimals: 20, 4.50.');
      process.exitCode = 1;
    } else {
      const ownerId = await creditByEmail(d, email, microUsd);
      say(`Added $${(microUsd / 1_000_000).toFixed(2)} to account ${ownerId}.`);
    }
  } else {
    say(USAGE);
    process.exitCode = 1;
  }
} catch (e) {
  // What was typed isn't repeated: it's an address.
  if (e instanceof AppError) say(e.message);
  else log.error('billing failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
