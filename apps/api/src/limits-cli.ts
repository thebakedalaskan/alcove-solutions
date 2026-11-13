import { z } from 'zod';
import { createPool, type Db } from './db';
import { LIMITS, LIMIT_NAMES, isLimitName, limitRows, parseValue, readRows, refusedValue, setLimit, shown } from './limits';
import { configureLogging, flushLogs, log } from './log';

/**
 * `pnpm --filter @alcove/server limits list` says which limits are in force, and `limits set <name> <value>` changes one,
 * in whichever database DATABASE_URL names, as `migrate` does: locally from .env, and against production through Cloud
 * SQL's proxy or as a one-off job. Like `migrate`, it needs the database and nothing else. Every instance takes a change
 * within LIMITS_CACHE_MS, with no restart, and logs it.
 */
const env = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('pretty')
}).parse(process.env);
configureLogging({ level: env.LOG_LEVEL, format: env.LOG_FORMAT, service: 'alcove-limits' });

const USAGE = `limits list
limits set <name> <value>   a whole number; bytes can have a unit (512MiB), time too (30d), money is in dollars ($0.50)

${LIMIT_NAMES.map((name) => `  ${name}`).join('\n')}
`;
const say = (text: string) => { process.stdout.write(text); };

/** Each limit: what's in force and since when, its default, its bounds and what it measures, and any row that changes nothing. */
async function list(db: Db): Promise<void> {
  const found = await limitRows(db);
  const { values, ignored, clamped } = readRows(found);
  const width = Math.max(...LIMIT_NAMES.map((name) => name.length));
  const lines = LIMIT_NAMES.map((name) => {
    const spec = LIMITS[name];
    const row = ignored.some((x) => x.name === name) ? undefined : found.find((r) => r.name === name);
    const since = row ? `set ${row.updated_at.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'the default';
    return `${name.padEnd(width)}  ${shown(name, values.get(name) ?? spec.default).padEnd(9)}  ${since}; default ${shown(name, spec.default)}, from ${shown(name, spec.floor)} to ${shown(name, spec.ceiling)}. ${spec.measures}`;
  });
  for (const x of ignored) lines.push(`Ignored: ${x.name} = ${x.value}, ${x.why}.`);
  for (const x of clamped) lines.push(`Held to its bounds: ${x.name} = ${x.value}, so ${shown(x.name, x.used)}.`);
  say(`${lines.join('\n')}\n`);
}

/** Sets one, or says why it can't: anything a limit's bounds don't allow is refused here rather than held to them. */
async function set(db: Db, name: string, typed: string): Promise<boolean> {
  if (!isLimitName(name)) {
    log.warn('limit not set', { limit: name, why: 'not a limit' });
    say(USAGE);
    return false;
  }
  const value = parseValue(name, typed);
  const why = refusedValue(name, value);
  if (why !== undefined || value === undefined) {
    log.warn('limit not set', { limit: name, typed, why: why ?? 'not a value' });
    return false;
  }
  await setLimit(db, name, value);
  return true;
}

const [command, name, typed, ...rest] = process.argv.slice(2);
const pool = createPool(env.DATABASE_URL);
try {
  if (command === 'list' && name === undefined) await list(pool);
  else if (command === 'set' && name !== undefined && typed !== undefined && !rest.length) process.exitCode = (await set(pool, name, typed)) ? 0 : 1;
  else {
    say(USAGE);
    process.exitCode = 1;
  }
} catch (e) {
  log.error('limits failed', { err: e });
  process.exitCode = 1;
} finally {
  await pool.end();
  flushLogs();
}
