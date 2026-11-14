/*
 * The operator CLI's support commands, each one operator route (operator-cli.ts lists them): an account's plan and money added
 * to it, a plan given to it for a while, what happened to a top-up and its provider asked again, why an account can't sign in,
 * finding one by its address, signing it out everywhere, and limits. Billing and limits print the lines their own command
 * lines print, and a plan given the lines the server says; a top-up and an account come back as JSON, printed as aligned
 * text, or as the server sent it with --json. An ID is checked here before anything is sent, so an address typed in its
 * place never leaves this machine, nor lands in a URL, which proxies log. An address is sent only by `account find`, in the
 * body, read from a hidden prompt when it isn't given so it needn't land in shell history. An action needs --reason, checked
 * here too, so nothing is sent without one.
 */
import { AccountAnswer, AccountFound, SignedOut } from '../../account/operator/operator';
import { TopUpAnswer, TopUpCheckAnswer } from '../../billing/operator/operator';
import { ACCOUNT, REFERENCE } from '../../billing/support';
import { aligned, answered, reasonOf, usage, type CliCommand } from './cli';
import { LinesAnswer } from '../../../http/operator';

const warn = (line: string) => { process.stderr.write(`${line}\n`); };
const NOT_A_REFERENCE = 'That isn’t a top-up’s reference: it’s 22 letters, digits, - and _, as checkout shows it.';
const NOT_AN_ACCOUNT = 'That isn’t an account’s ID: it’s 43 letters, digits, - and _. To find an account by its address: operator account find.';
const NOT_WHO = 'Name the account by a top-up’s reference or by its ID. To find an account by its address: operator account find.';

const lines = (body: unknown): string[] => LinesAnswer.parse(body).lines;
/** Why a top-up's provider wasn't asked again just now (TopUpCheckAnswer › asked), so its state is as it was. */
const NOT_ASKED: Record<Exclude<TopUpCheckAnswer['asked'], 'answered'>, string> = {
  recently: 'Its provider was asked less than 5 seconds ago, so it wasn’t asked again: that answer stands.',
  unwatched: 'Its provider wasn’t asked: nothing watches it any more.',
  'no-provider': 'Its provider wasn’t asked: this server isn’t set up with it.'
};
/** An hour as the answers give it (ISO 8601), as it's read: 2026-11-13 20:00 UTC. */
const hour = (iso: string) => `${iso.slice(0, 13).replace('T', ' ')}:00 UTC`;
const yes = (b: boolean) => (b ? 'yes' : 'no');

function topUpLines(body: unknown): string[] {
  const a = TopUpAnswer.parse(body);
  const rec = a.record;
  const rows: [string, string][] = [
    ['Top-up', a.reference], ['Account', a.accountId], ['Provider', a.provider], ['State', a.state],
    ['Opened', hour(a.opened)], ['Deadline', `${hour(a.deadline)}${a.deadlinePassed ? ', passed' : ''}`],
    ['Watched', a.watched ? `yes; asked again in ${a.nextCheckS ?? 0} s` : 'no'],
    ...(a.watched ? [['Last asked', a.lastCheckS === null ? 'not yet' : `${a.lastCheckS} s ago`] satisfies [string, string]] : []),
    ...(rec
      ? ([
        ['Anything seen', yes(rec.seen)], ['Settled', yes(rec.settled)], ['Doubt', rec.doubt ?? 'none'],
        ['Unanswered since the deadline', yes(rec.unanswered)], ['Buys', rec.purchase ? `${rec.purchase.kind}, ${rec.purchase.outcome}` : 'nothing']
      ] satisfies [string, string][])
      : [['Record', 'doesn’t open here'] satisfies [string, string]])
  ];
  return aligned(rows);
}

function accountLines(body: unknown): string[] {
  const a = AccountAnswer.parse(body);
  const { v2, v1, opens, error } = a.keys;
  const envelopes = v2 && v1 ? 'v2 and v1 envelopes' : v2 ? 'v2 envelope' : v1 ? 'v1 envelope' : 'no envelope';
  const rows: [string, string][] = [
    ['Account', a.accountId], ['Made', a.madeOn],
    ['Keys', `${envelopes}; ${opens ? 'opens here' : `doesn’t open here (${error ? [error.errorClass, ...(error.code === null ? [] : [error.code])].join(', ') : 'gone'})`}`],
    ['Last sign-in', a.signIn.last === null ? 'never' : hour(a.signIn.last)],
    ...a.signIn.sessions.map((s): [string, string] => [
      `Sessions with ${s.provider}`,
      `${s.live} live${s.newestStarted ? `; newest started ${hour(s.newestStarted)}` : ''}${s.lastSeen ? `; last seen ${hour(s.lastSeen)}` : ''}`
    ]),
    ['Sessions ended, not swept', String(a.signIn.endedNotSwept)],
    ['Agents', `${a.agents.live} live of ${a.agents.most}`],
    ...a.agents.connections.map((g): [string, string] => [
      `Agent ${g.id}`,
      `${g.live ? 'live' : 'run out'}; made ${hour(g.made)}; until ${hour(g.expires)}; last used ${g.lastUsed ? hour(g.lastUsed) : 'never'}; refresh tokens ${g.liveRefreshTokens}; credentials kept ${g.tokenRows} of ${g.mostTokenRows}`
    ]),
    ['Plan', a.plan === null ? 'doesn’t open here' : a.plan.kind === 'none' ? 'none yet: it has had no plan of its own' : `${a.plan.kind}; operator billing show ${a.accountId} says the rest`]
  ];
  return aligned(rows);
}

function foundLines(body: unknown): string[] {
  const a = AccountFound.parse(body);
  if (a.accountId !== undefined) return [`Account ${a.accountId}`];
  return [a.found === 0 ? 'No account signs in with that address.' : `${a.found} accounts sign in with that address, one for each way of signing in. Neither is named.`];
}

/** Billing's commands, as `billing` takes them, with an account named by an ID alone. */
const billingShow: CliCommand = {
  words: ['billing', 'show'],
  usage: 'billing show <reference|account id>     where an account’s plan stands, as billing show says it',
  async run(ctx, args) {
    const [who, ...rest] = args;
    if (who === undefined || rest.length) return usage(billingShow);
    if (!REFERENCE.test(who) && !ACCOUNT.test(who)) { warn(NOT_WHO); return 2; }
    return answered(ctx, await ctx.call('POST', '/v1/operator/billing', { words: ['show', who] }), lines);
  }
};
const billingCredit: CliCommand = {
  words: ['billing', 'credit'],
  usage: 'billing credit <reference|account id> <usd> --reason <ref>   adds dollars as support, at most $1,000',
  async run(ctx, args) {
    const [who, usd, ...rest] = args;
    if (who === undefined || usd === undefined || rest.length) return usage(billingCredit);
    if (!REFERENCE.test(who) && !ACCOUNT.test(who)) { warn(NOT_WHO); return 2; }
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', '/v1/operator/billing', { words: ['credit', who, usd], ...reason }), lines);
  }
};

/** A plan given for a while, as Alcove: the account by its ID, then `pro <months>` or `team <licenses> <months>`. */
const planGrant: CliCommand = {
  words: ['plan', 'grant'],
  usage: 'plan grant <account id> pro <months> | team <licenses> <months> --reason <ref>   gives months of Pro, or licenses for the team it runs, as Alcove',
  async run(ctx, args) {
    const [id, kind, ...counts] = args;
    if (id === undefined || !((kind === 'pro' && counts.length === 1) || (kind === 'team' && counts.length === 2))) return usage(planGrant);
    if (!ACCOUNT.test(id)) { warn(NOT_AN_ACCOUNT); return 2; }
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', '/v1/operator/plans/grant', { words: [id, kind, ...counts], ...reason }), lines);
  }
};

const topUp: CliCommand = {
  words: ['topup'],
  usage: 'topup <reference>                        what happened to a payment, with no amount or address',
  async run(ctx, args) {
    const [reference, ...rest] = args;
    if (reference === undefined || rest.length) return usage(topUp);
    if (!REFERENCE.test(reference)) { warn(NOT_A_REFERENCE); return 2; }
    return answered(ctx, await ctx.call('GET', `/v1/operator/topups/${reference}`), topUpLines);
  }
};
const topUpCheck: CliCommand = {
  words: ['topup', 'check'],
  usage: 'topup check <reference> --reason <ref>   asks its provider about it now, as the person’s own checkout does',
  async run(ctx, args) {
    const [reference, ...rest] = args;
    if (reference === undefined || rest.length) return usage(topUpCheck);
    if (!REFERENCE.test(reference)) { warn(NOT_A_REFERENCE); return 2; }
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', `/v1/operator/topups/${reference}/check`, reason), (body) => {
      const a = TopUpCheckAnswer.parse(body);
      return [`It was ${a.before}, and is ${a.after} now. ${a.watched ? 'It’s still watched.' : 'Nothing watches it any more.'}`, ...(a.asked === 'answered' ? [] : [NOT_ASKED[a.asked]])];
    });
  }
};

const account: CliCommand = {
  words: ['account'],
  usage: 'account <account id>                     its keys, sign-in sessions, agents and plan',
  async run(ctx, args) {
    const [id, ...rest] = args;
    if (id === undefined || rest.length) return usage(account);
    if (!ACCOUNT.test(id)) { warn(NOT_AN_ACCOUNT); return 2; }
    return answered(ctx, await ctx.call('GET', `/v1/operator/accounts/${id}`), accountLines);
  }
};
const accountFind: CliCommand = {
  words: ['account', 'find'],
  usage: 'account find [<email>] --reason <ref>    the account that signs in with an address, asked for hidden when not given; write keys only',
  async run(ctx, args) {
    if (args.length > 1) return usage(accountFind);
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    const email = (args[0] ?? await ctx.prompt('The address the account signs in with (it isn’t shown): ', true)).trim();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) { warn('That isn’t an address. Nothing was sent.'); return 2; }
    return answered(ctx, await ctx.call('POST', '/v1/operator/accounts/find', { email, ...reason }), foundLines);
  }
};
const accountSignOut: CliCommand = {
  words: ['account', 'sign-out'],
  usage: 'account sign-out <account id> --reason <ref>   ends all its sessions, at the person’s request; its agents keep working',
  async run(ctx, args) {
    const [id, ...rest] = args;
    if (id === undefined || rest.length) return usage(accountSignOut);
    if (!ACCOUNT.test(id)) { warn(NOT_AN_ACCOUNT); return 2; }
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', `/v1/operator/accounts/${id}/sessions/end`, reason), (body) => {
      const { ended } = SignedOut.parse(body);
      return [`Ended ${ended} ${ended === 1 ? 'session' : 'sessions'}: its browsers are signed out, and its agents keep working.`];
    });
  }
};

const limitsList: CliCommand = {
  words: ['limits', 'list'],
  usage: 'limits list                              the limits in force, their defaults and bounds',
  async run(ctx, args) {
    if (args.length) return usage(limitsList);
    return answered(ctx, await ctx.call('POST', '/v1/operator/limits', { words: ['list'] }), lines);
  }
};
const limitsSet: CliCommand = {
  words: ['limits', 'set'],
  usage: 'limits set <name> <value> --reason <ref>   changes a limit within its bounds, on every instance within LIMITS_CACHE_MS',
  async run(ctx, args) {
    const [name, value, ...rest] = args;
    if (name === undefined || value === undefined || rest.length) return usage(limitsSet);
    const reason = reasonOf(ctx);
    if (!reason) return 2;
    return answered(ctx, await ctx.call('POST', '/v1/operator/limits', { words: ['set', name, value], ...reason }), lines);
  }
};

/** Support's commands: billing, plans given, top-ups, accounts and limits. */
export const support: CliCommand[] = [billingShow, billingCredit, planGrant, topUp, topUpCheck, account, accountFind, accountSignOut, limitsList, limitsSet];
