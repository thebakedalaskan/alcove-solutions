/*
 * Support's billing commands (docs: Plans and usage › Support): words in, the lines to say back out. Support's command line
 * (billing-cli.ts) prints them, and inside the API the operator route answers with them (operator/routes.ts), so both take the
 * same words and say the same lines (support.ts). Through the route an account is named only by a top-up's reference or its
 * ID, and what's added is bounded: at most $1,000 a credit, and two credits a key a day (UTC), so at most $2,000 a key a day.
 * Each credit through the route is kept in the database every instance shares (operator_credits: a keyed hash and the key,
 * never an amount), and the day is counted there, so it holds whichever instance answers and whatever restarts; and a ticket
 * adds money to an account, by its ID, once. On the command line, run where KSERVICE is at hand, a credit is at most $10,000,
 * and no day is counted. Nothing said repeats what was typed: it may be an address put in the wrong place.
 */
import { ValidationError } from '../../platform/errors';
import type { OperatorScope } from '../../keys/operator-keys';
import { creditBySupport, named, standingOf, type Lookup, type Support, type Ticket } from './support';

const usage = (lookup: Lookup) => new ValidationError(`billing show <who>           the account's plan, whether and why Pro renews, its license and team, counts and states
billing credit <who> <usd>   adds <usd> dollars (20, 4.50) to its balance, as "Added by support"

<who> is a top-up's reference or an account's ID. Credited by a top-up's reference, it's that top-up's money, in its place:
it can't add itself again, and one added already is refused. Anything else, such as a second payment to its address, goes
by the account's ID.${lookup === 'ids-and-addresses' ? '\nWhere KMASTER is set, as it is locally, an address the account signs in with names it too.' : ''}`, { context: { why: 'usage' } });

/** The most one credit adds, in micro-USD: on the command line (billing-cli.ts), and through the operator route. */
const MOST = 10_000_000_000;
const MOST_BY_ROUTE = 1_000_000_000;

/** What an operator's key needs to run the words through the operator route: `read` to show, `write` for anything else. */
export const supportScope = (words: string[]): OperatorScope => (words[0] === 'show' ? 'read' : 'write');

/** Dollars as typed, to micro-USD: up to 6 decimals, more than nothing and at most `most`. */
function microUsdOf(typed: string, most: number): number | undefined {
  const m = /^\$?(\d{1,5})(?:\.(\d{1,6}))?$/.exec(typed.trim());
  if (!m) return undefined;
  const value = Number(m[1] ?? '') * 1_000_000 + Number((m[2] ?? '').padEnd(6, '0'));
  return value > 0 && value <= most ? value : undefined;
}

/**
 * Runs one command, as the words of `billing …`, and returns what it says. `lookup` says how an account may be named; an
 * `operator` (the key, and the action's reason) says it came through the operator route, which bounds what it adds and keeps
 * each credit for its ticket and the key's day. Through the route, money is never added without a reason: operatorRoute takes
 * no action without one, and this adds nothing without one either.
 */
export async function runSupportCommand(d: Support, words: string[], o: { lookup: Lookup; operator?: { keyId: string; reason: string | undefined } | undefined }): Promise<string[]> {
  const [command, who, typed, ...rest] = words;
  if (command === 'show' && who !== undefined && typed === undefined) return standingOf(d, await named(d, who, o.lookup));
  if (command !== 'credit' || who === undefined || typed === undefined || rest.length) throw usage(o.lookup);
  const most = o.operator ? MOST_BY_ROUTE : MOST;
  const microUsd = microUsdOf(typed, most);
  if (microUsd === undefined) throw new ValidationError(`An amount is dollars, more than 0 and at most ${most / 1_000_000}, with up to 6 decimals: 20, 4.50.`, { context: { why: 'not an amount' } });
  let ticket: Ticket | undefined;
  if (o.operator) {
    if (o.operator.reason === undefined) throw new ValidationError('Adding money needs a reason: a ticket’s reference.', { context: { field: 'reason' } });
    ticket = { keyId: o.operator.keyId, reason: o.operator.reason };
  }
  const { ownerId, depositId, state } = await creditBySupport(d, who, microUsd, { lookup: o.lookup, ticket });
  return [
    `Added to the balance of account ${ownerId}, as “Added by support”.`,
    ...(depositId !== null && state !== null ? [`Top-up ${depositId} (${state}) is no longer watched, so it can’t add itself again.`] : [])
  ];
}
