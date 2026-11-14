/*
 * The limits commands (docs: Deployment and acceptance › Changing a limit): words in, the lines to say back out. The
 * command line (limits-cli.ts) prints them, and inside the API the operator route answers with them
 * (features/operator/routes.ts), so both take the same words and say the same lines. Every instance takes a change
 * within LIMITS_CACHE_MS, with no restart, and a value is held to its limit's bounds: anything outside them is refused
 * rather than held to them. Nothing typed is logged or said back but a limit's name: a value is said as the limit shows
 * it.
 */
import type { Db } from './db';
import { ValidationError } from './errors';
import { LIMITS, LIMIT_NAMES, isLimitName, limitRows, parseValue, readRows, refusedValue, setLimit, shown } from './limits';
import type { OperatorScope } from '../keys/operator-keys';

const USAGE = `limits list
limits set <name> <value>   a whole number; bytes can have a unit (512MiB), time too (30d), money is in dollars ($0.50)

${LIMIT_NAMES.map((name) => `  ${name}`).join('\n')}`;
/** Words that aren't a command: how the commands go. */
const usage = () => new ValidationError(USAGE, { context: { why: 'usage' } });

/** What an operator's key needs to run the words through the operator route: `read` to list, `write` for anything else. */
export const limitScope = (words: string[]): OperatorScope => (words[0] === 'list' ? 'read' : 'write');

/** Each limit: what's in force and since when, its default, its bounds and what it measures, and any row that changes nothing. */
async function list(db: Db): Promise<string[]> {
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
  return lines;
}

/**
 * Sets one, and says what it was and what it is now, or refuses what its bounds don't allow, with why in the refusal's
 * context: a typo is an ordinary refusal, which whoever ran the words logs (limits-cli.ts, or the operator route's own
 * lines). A name that isn't a limit isn't in the context: it may be anything at all.
 */
async function set(db: Db, name: string, typed: string): Promise<string[]> {
  if (!isLimitName(name)) throw new ValidationError(`That isn’t a limit. The limits are: ${LIMIT_NAMES.join(', ')}.`, { context: { why: 'not a limit' } });
  const value = parseValue(name, typed);
  const why = refusedValue(name, value);
  if (why !== undefined || value === undefined) throw new ValidationError(`Not set: ${why ?? 'that isn’t a value'}.`, { context: { limit: name, why: why ?? 'not a value' } });
  const changed = await setLimit(db, name, value);
  return [`${name} is ${shown(name, changed.new)} now; it was ${shown(name, changed.old)}. Every instance has it within LIMITS_CACHE_MS.`];
}

/** Runs one command, as the words of `limits …`, and returns what it says. */
export async function runLimitCommand(db: Db, words: string[]): Promise<string[]> {
  const [command, name, typed, ...rest] = words;
  if (command === 'list' && name === undefined) return list(db);
  if (command === 'set' && name !== undefined && typed !== undefined && !rest.length) return set(db, name, typed);
  throw usage();
}
