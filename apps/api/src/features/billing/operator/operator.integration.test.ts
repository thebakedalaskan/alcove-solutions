/**
 * Billing's operator routes (features/billing/operator/routes.ts), through the real API over HTTP with requests signed as the
 * operator CLI signs them, against real Postgres: support's commands as `billing …` takes them, with an account named by an
 * ID alone and none made for one with no plan yet; credits held to $1,000 each and two a key a day (UTC), counted in the
 * database whichever instance answers; a ticket adding money once, even sent twice at once; a read key refused a credit;
 * what happened to a top-up, with nothing of its payment; and its provider asked again now, saying whether it was, and a 503
 * when it didn't answer. A plan given for a while, as Alcove: Pro back to back after the months bought, licenses for the team
 * an account is the admin of by the license purchase's own rules, nothing of either ever money (a refund gives nothing back
 * for it), a ticket giving once, each grant held to its most and a key to five a day. Then the operator CLI's billing, grant
 * and top-up commands end to end. People sign in through the real API, and pay through the 1Click stand-in.
 */
import { AlcoveApiError, type TopUp } from '@alcove/api';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openJson, serviceKey, unb64u } from '../../../keys/crypto';
import { makeKeyFile, parseOperatorKeys } from '../../../keys/operator-keys';
import { startHarness, type Harness } from '../../../testing/harness';
import { signedClient, makeOperatorKey, type SignedClient } from '../../../testing/operator';
import { DepositRecord } from '../top-ups/deposits';
import { TopUpAnswer, TopUpCheckAnswer } from './operator';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
type Account = Awaited<ReturnType<typeof account>>;
const balance = async (who: Pick<Account, 'api'>) => (await who.api.plans.plan()).balance;

/** `billing …` on the command line, in its own process, with only the settings production's job has bound: the database and KSERVICE. */
function billing(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const env = { PATH: process.env['PATH'] ?? '', DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? '', KSERVICE: h.deps.cfg.KSERVICE, LOG_FORMAT: 'json', LOG_LEVEL: 'info' };
    const run = spawn(process.execPath, ['--import', 'tsx', 'src/billing-cli.ts', ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    run.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    run.stderr.on('data', (b: Buffer) => { out += b.toString(); });
    run.on('error', reject);
    run.on('close', (code) => { resolve({ code, out }); });
  });
}
/** A top-up of `microUsd` for `who`, and the address 1Click quoted for it. */
async function topUp(who: Account, microUsd: number): Promise<TopUp & { address: string }> {
  const t = await who.api.plans.startTopUp(BASE_USDC, microUsd);
  if (!t.address) throw new Error('no address quoted');
  return { ...t, address: t.address };
}
/** What 1Click says once a top-up of `microUsd` has settled in full. */
const settled = (t: TopUp, microUsd: number) => ({ depositedAmount: String(microUsd), amountOut: String(microUsd), intentHashes: [`support-${t.id}`] });
/** That the deposit's next check is due, so reading it asks 1Click again, as the app's next look would after a while. */
const askAgain = (id: string) => h.pool.query('UPDATE deposits SET checked_at = NULL WHERE deposit_id = $1', [id]);
/** Makes this top-up the one the watcher's next pass takes on: every other one still watched waits an hour. */
const dueOnly = (id: string) => h.pool.query(
  "UPDATE deposits SET check_after = CASE WHEN deposit_id = $1 THEN now() ELSE now() + interval '1 hour' END WHERE state NOT IN ('credited', 'held') AND check_after < 'infinity'", [id]);
/** Whether nothing watches the top-up any more: no pass takes it on, and no look asks 1Click about it. */
const unwatched = async (id: string) => (await h.pool.query<{ closed: boolean }>("SELECT check_after = 'infinity' AS closed FROM deposits WHERE deposit_id = $1", [id])).rows[0]?.closed;
/** How many times the API logged `msg` since `from`. */
const logged = (from: number, msg: string) => h.logs.slice(from).filter((l) => l.includes(`"msg":"${msg}"`)).length;
const ADDED = (ownerId: string) => `Added to the balance of account ${ownerId}, as “Added by support”.`;
/** What the command line printed, without the JSON lines it logged. */
const printed = (out: string) => out.split('\n').filter((l) => l && !l.startsWith('{'));
const PRICE = 20_000_000;
const LICENSE = 40_000_000;

/** Every operator route's answer, as its text: none of them may hold an address. */
const answers: string[] = [];
const Lines = z.object({ lines: z.array(z.string()) });
const Refusal = z.object({ code: z.string(), message: z.string() });
/** A signed request as an operator's CLI sends it, its status and its answer. */
async function signed(client: SignedClient, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const res = method === 'GET' ? await client.get(path) : await client.post(path, body);
  const text = await res.text();
  answers.push(text);
  const parsed: unknown = JSON.parse(text);
  return { status: res.status, body: parsed };
}
/** `billing …` through the operator route, with a reason when it's given. */
const route = (client: SignedClient, words: string[], reason?: string) => signed(client, 'POST', '/v1/operator/billing', { words, ...(reason === undefined ? {} : { reason }) });
const linesOf = (r: { body: unknown }) => Lines.parse(r.body).lines;
const refusalOf = (r: { status: number; body: unknown }) => [r.status, Refusal.parse(r.body).message];
/** A top-up `who` opened, which 1Click then said failed, as the person has seen it. */
async function failedTopUp(who: Account, microUsd: number): Promise<TopUp & { address: string }> {
  const t = await topUp(who, microUsd);
  h.oneclick.set(t.address, 'FAILED');
  expect(await who.api.plans.topUp(t.id)).toMatchObject({ state: 'failed' });
  return t;
}
const stateOf = async (id: string) => (await h.pool.query<{ state: string }>('SELECT state FROM deposits WHERE deposit_id = $1', [id])).rows[0]?.state;
/** A whole hour, as ISO 8601: what an operator is told of a top-up's times. */
const HOUR = /T\d\d:00:00\.000Z$/;
const TICKET_USED = 'That ticket already added money to this account. Nothing was added.';
const A_DAYS_MOST = 'A key adds money at most twice a day (UTC), and this one has already today. Nothing was added.';
/** A refusal from the API as a person's browser gets it: its code and its words. */
const refusedFor = (p: Promise<unknown>) => p.then(() => 'succeeded', (e: unknown) => (e instanceof AlcoveApiError ? `${e.code}: ${e.message}` : String(e)));
const LogLine = z.looseObject({ msg: z.string() });
/** Each line the API logged as `msg` since `from`, with its fields. */
const loggedAs = (from: number, msg: string) => h.logs.slice(from).flatMap((l) => {
  const line = LogLine.safeParse(JSON.parse(l));
  return line.success && line.data.msg === msg ? [line.data] : [];
});
/** A period, and a month of Pro: 30 days, as the limits have it. */
const PERIOD = 30 * 86_400_000;
/**
 * A read key and a write key of their own, on an instance of their own sharing the database, as a second VM does: a key
 * changes at most 20 things a minute, and makes two credits a day, so each test starts afresh.
 */
async function ownOperators(): Promise<{ read: SignedClient; write: SignedClient; close(): Promise<void> }> {
  const read = makeOperatorKey('read');
  const write = makeOperatorKey('write');
  const server = await h.secondServer({ operatorKeys: [read.key, write.key] });
  return { read: signedClient(server.baseUrl, h.operator.audience, read), write: signedClient(server.baseUrl, h.operator.audience, write), close: () => server.close() };
}
/** One more write key of its own, on an instance of its own: credits of a day of their own. */
async function ownWriter(): Promise<{ client: SignedClient; close(): Promise<void> }> {
  const key = makeOperatorKey('write');
  const server = await h.secondServer({ operatorKeys: [key.key] });
  return { client: signedClient(server.baseUrl, h.operator.audience, key), close: () => server.close() };
}

describe('through the operator route', () => {
  // Each test signs as operators of its own (ownOperators).
  let op: Awaited<ReturnType<typeof ownOperators>>;
  beforeEach(async () => { op = await ownOperators(); });
  afterEach(async () => { await op.close(); });

  it('shows an account by a top-up’s reference or its ID, as the command line does, with why Pro renews, its license and team, notes and storage', async () => {
    const ann = await account();
    // Ann runs a team, with one invite out, and is on a month of Pro from money support added, renewing it but short of the next.
    await ann.api.teams.create('Vandelay Industries');
    await ann.api.teams.invite();
    expect(linesOf(await route(op.write, ['credit', ann.session.ownerId, '20'], 'SUP-2001'))).toEqual([ADDED(ann.session.ownerId)]);
    await ann.api.plans.buyPro(1, PRICE);
    await ann.api.plans.setRenew(true);
    const failed = await failedTopUp(ann, 5_000_000);
    const want = [
      `Account ${ann.session.ownerId}`, `Top-up ${failed.id}: failed`, 'Plan: pro; renewing Pro on', 'Renewal: short', 'Months of Pro not over: 1', 'License: none',
      'Team: admin; members 1; licenses 0; open invites 1', 'Balance: doesn’t cover a month of Pro', 'Changes to the balance kept: 2', 'Notices waiting: none',
      'Notes: running', 'Storage: within', 'Top-ups: 1 failed'
    ];
    // A read key shows it, by the top-up's reference, and the command line prints the same where production's job runs it.
    expect(linesOf(await route(op.read, ['show', failed.id]))).toEqual(want);
    const cli = await billing(['show', failed.id]);
    expect(cli.code).toBe(0);
    expect(printed(cli.out)).toEqual(want);
    // By the account's ID: the same, but for the top-up it wasn't named by.
    expect(linesOf(await route(op.read, ['show', ann.session.ownerId]))).toEqual(want.filter((l) => !l.startsWith('Top-up ')));

    // Bob joins the team and takes the license Ann bought: a member, licensed until his period ends; Ann is told licenses are low.
    const bob = await account();
    expect(linesOf(await route(op.write, ['credit', ann.session.ownerId, '40'], 'SUP-2002'))).toEqual([ADDED(ann.session.ownerId)]);
    await ann.api.teams.buyLicenses(1, LICENSE);
    await bob.api.teams.join((await ann.api.teams.invite()).link.split('#')[1] ?? '');
    await bob.api.auth.visit();
    const until = (await bob.api.plans.plan()).period.to.slice(0, 10);
    expect(linesOf(await route(op.read, ['show', bob.session.ownerId]))).toEqual([
      `Account ${bob.session.ownerId}`, 'Plan: team; renewing Pro off', 'Renewal: none', 'Months of Pro not over: 0', `License: member until ${until}`,
      'Team: member; members 2; licenses 1; open invites 1', 'Balance: doesn’t cover a month of Pro', 'Changes to the balance kept: 0', 'Notices waiting: none',
      'Notes: running', 'Storage: within', 'Top-ups: none'
    ]);
    expect(linesOf(await route(op.read, ['show', ann.session.ownerId]))).toContain('Notices waiting: licenses-low 1');

    // With no notes left in the period, they've stopped.
    const carol = await account();
    await h.setLimit('plan.free.notes_minutes', 0);
    try {
      expect(linesOf(await route(op.read, ['show', carol.session.ownerId]))).toContain('Notes: stopped');
    } finally { await h.resetLimits(); }
  });

  it('shows an account with no plan yet as having none, and makes none: money support adds makes it, as using Alcove does', async () => {
    const ann = await account();
    // As an account from before plans has none until it's next used, or upkeep gives it its row.
    await h.pool.query('DELETE FROM plan_accounts WHERE owner_id = $1', [ann.session.ownerId]);
    const planned = async () => (await h.pool.query('SELECT owner_id FROM plan_accounts WHERE owner_id = $1', [ann.session.ownerId])).rowCount;
    expect(linesOf(await route(op.read, ['show', ann.session.ownerId]))).toEqual([
      `Account ${ann.session.ownerId}`, 'Plan: none yet; it’s made on Free when the account is next used, or by upkeep', 'License: none', 'Top-ups: none'
    ]);
    // Looking made nothing, so nothing started counting for it: no plan, and no grace.
    expect(await planned()).toBe(0);
    expect(linesOf(await route(op.write, ['credit', ann.session.ownerId, '5'], 'SUP-6200'))).toEqual([ADDED(ann.session.ownerId)]);
    expect(await planned()).toBe(1);
    expect(linesOf(await route(op.read, ['show', ann.session.ownerId]))).toEqual(expect.arrayContaining(['Plan: free; renewing Pro off', 'Changes to the balance kept: 1']));
  });

  it('refuses an address, a workspace’s ID and a team’s ID, the same as nobody’s, adding nothing and saying back nothing typed', async () => {
    const ann = await account();
    const { id: workspaceId } = await ann.api.workspaces.create('Vandelay plans');
    const team = await ann.api.teams.create('Vandelay Industries');
    const ownerOf = async (sql: string, id: string) => (await h.pool.query<{ owner_id: string }>(sql, [id])).rows[0]?.owner_id ?? '';
    const workspaceOwner = await ownerOf('SELECT owner_id FROM workspaces WHERE workspace_id = $1', workspaceId);
    const teamOwner = await ownerOf('SELECT owner_id FROM teams WHERE team_id = $1', team.id);
    for (const id of [workspaceOwner, teamOwner]) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const plans = async () => (await h.pool.query('SELECT owner_id FROM plan_accounts')).rowCount;
    const before = await plans();
    const logsFrom = h.logs.length;
    const answersFrom = answers.length;
    const NO_ID = 'Name the account by a top-up’s reference or by its ID.';
    expect(refusalOf(await route(op.read, ['show', ann.email]))).toEqual([400, NO_ID]);
    expect(refusalOf(await route(op.write, ['credit', ann.email, '5'], 'SUP-5001'))).toEqual([400, NO_ID]);
    for (const id of [workspaceOwner, teamOwner, 'A'.repeat(43)]) {
      expect(refusalOf(await route(op.read, ['show', id]))).toEqual([404, 'No account has that ID.']);
      expect(refusalOf(await route(op.write, ['credit', id, '5'], 'SUP-5002'))).toEqual([404, 'No account has that ID.']);
    }
    for (const id of [workspaceId, team.id]) expect(refusalOf(await route(op.read, ['show', id]))).toEqual([404, 'No top-up has that reference.']);
    // Words that aren't a command: how they go, with no word of addresses, which the route never takes.
    const words = await route(op.write, ['add', ann.session.ownerId, '5'], 'SUP-5003');
    expect(words.status).toBe(400);
    expect(Refusal.parse(words.body).message).toContain('billing credit <who> <usd>');
    expect(Refusal.parse(words.body).message).not.toContain('KMASTER');
    // Nothing added, and no plan made for anyone.
    expect((await balance(ann)).microUsd).toBe(0);
    expect(await plans()).toBe(before);
    for (const text of [...answers.slice(answersFrom), ...h.logs.slice(logsFrom)]) expect(text.toLowerCase()).not.toContain(ann.email.toLowerCase());
  });

  it('refuses a credit sent with a read key, by an account’s ID or by a top-up’s reference, and changes nothing', async () => {
    const ann = await account();
    const t = await failedTopUp(ann, 5_000_000);
    const kept = async () => (await h.pool.query('SELECT digest FROM operator_credits')).rowCount ?? 0;
    const before = await kept();
    for (const who of [ann.session.ownerId, t.id]) {
      const r = await route(op.read, ['credit', who, '5'], 'SUP-9100');
      expect(r.status).toBe(403);
      expect(Refusal.parse(r.body).code).toBe('forbidden');
    }
    // Nothing added and nothing kept, and the top-up is still watched: it adds itself once 1Click settles it after all.
    expect(await balance(ann)).toMatchObject({ microUsd: 0, history: [] });
    expect(await kept()).toBe(before);
    expect(await unwatched(t.id)).toBe(false);
    h.oneclick.set(t.address, 'SUCCESS', settled(t, 5_000_000));
    await askAgain(t.id);
    expect(await ann.api.plans.topUp(t.id)).toMatchObject({ state: 'credited' });
    expect((await balance(ann)).microUsd).toBe(5_000_000);
  });

  it('adds a failed top-up’s money by its reference once, and money by an account’s ID once for each ticket', async () => {
    const ann = await account();
    const t = await failedTopUp(ann, 25_000_000);
    // A key makes two credits a day, so another key, on an instance of its own, sends the rest.
    const other = await ownWriter();
    const kept = async () => (await h.pool.query('SELECT digest FROM operator_credits')).rowCount ?? 0;
    const before = await kept();
    const logsFrom = h.logs.length;
    try {
      expect(linesOf(await route(op.write, ['credit', t.id, '25'], 'SUP-6001'))).toEqual([
        ADDED(ann.session.ownerId), `Top-up ${t.id} (failed) is no longer watched, so it can’t add itself again.`
      ]);
      // Its reference adds its money once, whatever the ticket.
      expect(refusalOf(await route(op.write, ['credit', t.id, '25'], 'SUP-6002'))).toEqual([
        409, 'This top-up isn’t watched any more, so its reference adds nothing: support has added it already, or its 30 days are over. Add anything more by the account’s ID.'
      ]);
      // By the account's ID, a ticket adds once, however its reference is typed: sent again, as when its answer was lost, nothing is added.
      expect(linesOf(await route(op.write, ['credit', ann.session.ownerId, '5'], 'SUP-6003'))).toEqual([ADDED(ann.session.ownerId)]);
      for (const reason of ['SUP-6003', 'sup-6003']) expect(refusalOf(await route(op.write, ['credit', ann.session.ownerId, '5'], reason))).toEqual([409, TICKET_USED]);
      // A ticket is the account's, whichever key sends it: another ticket adds again, and the same ticket adds to another account.
      expect(refusalOf(await route(other.client, ['credit', ann.session.ownerId, '5'], 'SUP-6003'))).toEqual([409, TICKET_USED]);
      expect(linesOf(await route(other.client, ['credit', ann.session.ownerId, '5'], 'SUP-6004'))).toEqual([ADDED(ann.session.ownerId)]);
      const bob = await account();
      expect(linesOf(await route(other.client, ['credit', bob.session.ownerId, '5'], 'SUP-6003'))).toEqual([ADDED(bob.session.ownerId)]);
      expect(await balance(ann)).toMatchObject({
        microUsd: 35_000_000,
        history: [{ label: 'Added by support', microUsd: 5_000_000 }, { label: 'Added by support', microUsd: 5_000_000 }, { label: 'Added by support', microUsd: 25_000_000 }]
      });
      expect((await balance(bob)).microUsd).toBe(5_000_000);
      // Kept for each credit, by a reference or an ID: a keyed hash and the key that sent it, never the account's ID or an amount.
      expect(await kept()).toBe(before + 4);
      const rows = await h.pool.query<{ digest: Buffer; key_id: string }>('SELECT digest, key_id FROM operator_credits WHERE key_id = ANY($1)', [[op.write.keyId, other.client.keyId]]);
      expect(rows.rows.map((r) => r.key_id).sort()).toEqual([op.write.keyId, op.write.keyId, other.client.keyId, other.client.keyId].sort());
      for (const r of rows.rows) expect(r.digest).toHaveLength(32);
    } finally { await other.close(); }
    // Each credit is logged with the account and top-up it added to, never how much.
    expect(logged(logsFrom, 'balance added by support')).toBe(4);
    expect(h.logs.slice(logsFrom).join('\n')).not.toMatch(/25000000|5000000|"microUsd"/);
  });

  it('adds money once when one ticket’s credit is sent twice at once, as when it’s sent again while the first is on its way', async () => {
    const ann = await account();
    const kept = async () => (await h.pool.query('SELECT digest FROM operator_credits WHERE key_id = $1', [op.write.keyId])).rowCount ?? 0;
    const before = await kept();
    const send = () => route(op.write, ['credit', ann.session.ownerId, '5'], 'SUP-6100');
    const both = await Promise.all([send(), send()]);
    expect(both.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 409]);
    for (const r of both) {
      if (r.status === 200) expect(linesOf(r)).toEqual([ADDED(ann.session.ownerId)]);
      else expect(refusalOf(r)).toEqual([409, TICKET_USED]);
    }
    expect(await balance(ann)).toMatchObject({ microUsd: 5_000_000, history: [{ label: 'Added by support', microUsd: 5_000_000 }] });
    expect(await kept()).toBe(before + 1);
    // The one refused counts for nothing: the key's second credit of the day is taken, and only its third refused.
    expect(linesOf(await route(op.write, ['credit', ann.session.ownerId, '5'], 'SUP-6101'))).toEqual([ADDED(ann.session.ownerId)]);
    expect(refusalOf(await route(op.write, ['credit', ann.session.ownerId, '5'], 'SUP-6102'))).toEqual([403, A_DAYS_MOST]);
    expect((await balance(ann)).microUsd).toBe(10_000_000);
  });

  it('holds what the route adds to $1,000 a credit, and a key to two credits a day (UTC), whichever instance answers', async () => {
    const ann = await account();
    expect(refusalOf(await route(op.write, ['credit', ann.session.ownerId, '1000.01'], 'SUP-7001'))).toEqual([400, 'An amount is dollars, more than 0 and at most 1000, with up to 6 decimals: 20, 4.50.']);
    // A key of its own, listed by two instances sharing the database, as two VMs do during a rollout: its day is counted in the
    // database, so what it adds through either counts on both.
    const key = makeOperatorKey('write');
    const first = await h.secondServer({ operatorKeys: [key.key] });
    const second = await h.secondServer({ operatorKeys: [key.key] });
    const one = signedClient(first.baseUrl, h.operator.audience, key);
    const two = signedClient(second.baseUrl, h.operator.audience, key);
    const credit = (client: SignedClient, usd: string, reason: string) => route(client, ['credit', ann.session.ownerId, usd], reason);
    try {
      expect(linesOf(await credit(one, '1000', 'SUP-7002'))).toEqual([ADDED(ann.session.ownerId)]);
      expect(linesOf(await credit(two, '1000', 'SUP-7003'))).toEqual([ADDED(ann.session.ownerId)]);
      // A third is refused through either, however little it would add.
      expect(refusalOf(await credit(one, '0.01', 'SUP-7004'))).toEqual([403, A_DAYS_MOST]);
      expect(refusalOf(await credit(two, '5', 'SUP-7005'))).toEqual([403, A_DAYS_MOST]);
      // A ticket that has added already is said so first.
      expect(refusalOf(await credit(two, '5', 'SUP-7002'))).toEqual([409, TICKET_USED]);
      // Another key's day is its own.
      expect(linesOf(await credit(op.write, '5', 'SUP-7006'))).toEqual([ADDED(ann.session.ownerId)]);
      // A day on (UTC), the key adds again: what it added the day before no longer counts.
      await h.pool.query("UPDATE operator_credits SET created_at = created_at - interval '1 day' WHERE key_id = $1", [key.key.id]);
      expect(linesOf(await credit(one, '5', 'SUP-7007'))).toEqual([ADDED(ann.session.ownerId)]);
    } finally {
      await first.close();
      await second.close();
    }
    // $1,000 twice, $5 by another key and $5 a day on: what was refused added nothing.
    expect((await balance(ann)).microUsd).toBe(2_010_000_000);
  });

  it('says what happened to a top-up with no amount, address, memo, quote or provider reference, its times to the hour', async () => {
    const ann = await account();
    const microUsd = 23_456_789;
    const t = await topUp(ann, microUsd);
    const logsFrom = h.logs.length;
    const waiting = await signed(op.read, 'GET', `/v1/operator/topups/${t.id}`);
    expect(waiting.status).toBe(200);
    const before = TopUpAnswer.parse(waiting.body);
    expect(before).toMatchObject({
      reference: t.id, accountId: ann.session.ownerId, provider: 'oneclick', state: 'waiting', deadlinePassed: false, watched: true,
      record: { seen: false, settled: false, doubt: null, unanswered: false, purchase: null }
    });
    for (const at of [before.opened, before.deadline]) expect(at).toMatch(HOUR);
    expect(before.nextCheckS).toEqual(expect.any(Number));
    const lookupLogs = h.logs.slice(logsFrom);
    // Settled and added: nothing watches it now, so nothing says when it was last asked about, which is when it settled.
    const intent = `intent-canary-${randomBytes(8).toString('hex')}`;
    h.oneclick.set(t.address, 'SUCCESS', { depositedAmount: String(microUsd), amountOut: String(microUsd), intentHashes: [intent] });
    expect(await ann.api.plans.topUp(t.id)).toMatchObject({ state: 'credited' });
    const secondFrom = h.logs.length;
    const credited = await signed(op.read, 'GET', `/v1/operator/topups/${t.id}`);
    expect(TopUpAnswer.parse(credited.body)).toMatchObject({ state: 'credited', watched: false, nextCheckS: null, lastCheckS: null, record: { seen: true, settled: true, doubt: null } });
    // Nothing of what its sealed record holds is in either answer, or in what the lookups logged.
    const sealed = await h.pool.query<{ record_ciphertext: Buffer }>('SELECT record_ciphertext FROM deposits WHERE deposit_id = $1', [t.id]);
    const rec = openJson(serviceKey(unb64u(h.deps.cfg.KSERVICE, 32), 'accounting'), { v: 1 as const, kind: 'deposit', ownerId: ann.session.ownerId, depositId: t.id, keyVersion: '1' },
      sealed.rows[0]?.record_ciphertext ?? new Uint8Array(0), DepositRecord);
    const quote = z.object({ signature: z.string(), correlationId: z.string() }).passthrough().parse(rec.quote);
    const held = [rec.address, rec.memo, rec.asked, rec.minAmountIn, rec.settled?.sentMicroUsd, rec.settled?.outMicroUsd, rec.settled?.addedMicroUsd, rec.settled?.providerRef,
      quote.signature, quote.correlationId, intent, String(microUsd), '23.456789', '23.46'];
    const said = [JSON.stringify(waiting.body), JSON.stringify(credited.body), ...lookupLogs, ...h.logs.slice(secondFrom)].join('\n');
    for (const value of held) if (typeof value === 'string' && value.length >= 5) expect(said).not.toContain(value);
    // Nobody's, or not a reference at all: refused, and what was typed isn't logged.
    expect(refusalOf(await signed(op.read, 'GET', '/v1/operator/topups/AAAAAAAAAAAAAAAAAAAAAA'))).toEqual([404, 'No top-up has that reference.']);
    const typedFrom = h.logs.length;
    expect(refusalOf(await signed(op.read, 'GET', '/v1/operator/topups/ann.vandelay@tests.example'))).toEqual([400, 'A top-up’s reference is 22 letters, digits, - and _, as checkout shows it.']);
    expect(h.logs.slice(typedFrom).join('\n')).not.toContain('ann.vandelay');
  });

  it('asks 1Click about one top-up again now, as its checkout does: added once it has settled, a second check at once asks nothing and says so, one nobody watches is left alone', async () => {
    const ann = await account();
    const t = await topUp(ann, 10_000_000);
    // Someone else's, due for the watcher and settled at 1Click: checking Ann's asks nothing about it.
    const bob = await account();
    const theirs = await topUp(bob, 10_000_000);
    h.oneclick.set(theirs.address, 'SUCCESS', settled(theirs, 10_000_000));
    await dueOnly(theirs.id);
    const check = (client: SignedClient, reason: string) => signed(client, 'POST', `/v1/operator/topups/${t.id}/check`, { reason });
    const first = await check(op.write, 'SUP-3001');
    expect(first.status).toBe(200);
    expect(TopUpCheckAnswer.parse(first.body)).toMatchObject({ before: 'waiting', after: 'waiting', watched: true, asked: 'answered' });
    // A second at once asks 1Click nothing, and says it wasn't asked: the 5 seconds its owner's own checkout keeps to.
    const asked = h.oneclick.apiKeys.length;
    const again = await check(op.write, 'SUP-3002');
    expect(again.status).toBe(200);
    expect(TopUpCheckAnswer.parse(again.body)).toMatchObject({ before: 'waiting', after: 'waiting', watched: true, asked: 'recently' });
    expect(h.oneclick.apiKeys.length).toBe(asked);
    // Paid: the next check adds it, once.
    h.oneclick.set(t.address, 'SUCCESS', settled(t, 10_000_000));
    await askAgain(t.id);
    expect(TopUpCheckAnswer.parse((await check(op.write, 'SUP-3003')).body)).toMatchObject({ before: 'waiting', after: 'credited', watched: false, asked: 'answered' });
    expect(await balance(ann)).toMatchObject({ microUsd: 10_000_000 });
    // Nothing watches it now: left alone, and nothing more is added.
    expect(refusalOf(await check(op.write, 'SUP-3004'))).toEqual([409, 'That top-up isn’t watched any more.']);
    expect((await balance(ann)).microUsd).toBe(10_000_000);
    // A read key only looks.
    expect((await check(op.read, 'SUP-3005')).status).toBe(403);
    // Bob's is left to the watcher.
    expect(await stateOf(theirs.id)).toBe('waiting');
    expect((await balance(bob)).microUsd).toBe(0);
  });

  it('says when 1Click didn’t answer a check: a 503 with its HTTP status in the log and nothing it said, the top-up as it was', async () => {
    const ann = await account();
    const t = await topUp(ann, 10_000_000);
    const check = (reason: string) => signed(op.write, 'POST', `/v1/operator/topups/${t.id}/check`, { reason });
    const DOWN = '1Click didn’t answer, so the top-up is as it was. Try again in a minute.';
    const logsFrom = h.logs.length;
    h.oneclick.down(true);
    const down = await check('SUP-3101').finally(() => { h.oneclick.down(false); });
    expect(refusalOf(down)).toEqual([503, DOWN]);
    expect(Refusal.parse(down.body).code).toBe('unavailable');
    // What it logged says 1Click's status, and nothing 1Click said back.
    const lines = h.logs.slice(logsFrom);
    expect(lines.some((l) => l.includes('"upstreamStatus":503'))).toBe(true);
    expect(lines.join('\n')).not.toContain('Service Unavailable');
    // As it was, and still watched: once 1Click answers again, it's asked, and says so.
    expect(await stateOf(t.id)).toBe('waiting');
    await askAgain(t.id);
    expect(TopUpCheckAnswer.parse((await check('SUP-3102')).body)).toMatchObject({ before: 'waiting', after: 'waiting', watched: true, asked: 'answered' });
  });

  it('keeps a reference to its own account: it adds to that account alone, and what it says names nothing of another’s', async () => {
    const ann = await account();
    const bob = await account();
    const annT = await failedTopUp(ann, 7_000_000);
    const bobT = await failedTopUp(bob, 7_000_000);
    expect(linesOf(await route(op.write, ['credit', annT.id, '7'], 'SUP-4001'))).toEqual([
      ADDED(ann.session.ownerId), `Top-up ${annT.id} (failed) is no longer watched, so it can’t add itself again.`
    ]);
    expect((await balance(ann)).microUsd).toBe(7_000_000);
    expect((await balance(bob)).microUsd).toBe(0);
    expect(await stateOf(bobT.id)).toBe('failed');
    expect(await unwatched(bobT.id)).toBe(false);
    const said = [
      JSON.stringify((await signed(op.read, 'GET', `/v1/operator/topups/${annT.id}`)).body),
      ...linesOf(await route(op.read, ['show', annT.id])), ...linesOf(await route(op.read, ['show', ann.session.ownerId]))
    ].join('\n');
    expect(said).toContain(ann.session.ownerId);
    for (const other of [bob.session.ownerId, bobT.id]) expect(said).not.toContain(other);
  });
});

describe('a plan given through the operator route', () => {
  // Each test signs as operators of its own (ownOperators): a key gives five plans a day, and makes two credits.
  let op: Awaited<ReturnType<typeof ownOperators>>;
  beforeEach(async () => { op = await ownOperators(); });
  afterEach(async () => { await op.close(); });
  /** A grant through the route, as `operator plan grant …` sends its words, with a reason when it's given. */
  const grant = (client: SignedClient, words: string[], reason?: string) => signed(client, 'POST', '/v1/operator/plans/grant', { words, ...(reason === undefined ? {} : { reason }) });
  /** Dollars support adds to an account, for it to buy with. */
  const funded = async (who: Account, usd: string, reason: string) => {
    expect(linesOf(await route(op.write, ['credit', who.session.ownerId, usd], reason))).toEqual([ADDED(who.session.ownerId)]);
  };
  const GAVE_PRO = (ownerId: string, months: string, until: string | null) =>
    `Gave account ${ownerId} ${months} of Pro, after any it had, as “given by Alcove”: Pro runs to ${until?.slice(0, 10) ?? ''} now.`;
  const ON_TEAM = 'That account is on its team’s plan while its license lasts, so Pro can’t be given now. Nothing was given.';
  const NO_TEAM = 'That account isn’t a team’s admin, so there’s no team to give licenses to. They start a team first, then licenses can be given to it. Nothing was given.';
  const TICKET_GAVE = 'That ticket already gave this account a plan. Nothing was given.';
  const A_DAYS_GRANTS = 'A key gives plans at most 5 times a day (UTC), and this one has already today. Nothing was given.';
  const joinTeam = async (who: Account, admin: Account) => { await who.api.teams.join((await admin.api.teams.invite()).link.split('#')[1] ?? ''); };

  it('gives Pro after the months bought, back to back as a purchase’s go, for nothing: given by Alcove in the history, nothing added, and renewing still buying after it', async () => {
    const ann = await account();
    // Two months bought with $40 support added: the month running and one after it.
    await funded(ann, '40', 'SUP-1001');
    const bought = (await ann.api.plans.buyPro(2, PRICE)).pro.months;
    expect(bought).toHaveLength(2);
    const logsFrom = h.logs.length;
    const given = await grant(op.write, [ann.session.ownerId, 'pro', '3'], 'SUP-1002');
    expect(given.status).toBe(200);
    const plan = await ann.api.plans.plan();
    // Three more after the last one bought, each a period long and back to back with it, each paid nothing.
    const after = Date.parse(bought[1]?.to ?? '');
    expect(plan.pro.months).toEqual([...bought, ...[0, 1, 2].map((i) => ({ from: new Date(after + i * PERIOD).toISOString(), to: new Date(after + (i + 1) * PERIOD).toISOString(), microUsd: 0 }))]);
    expect(linesOf(given)).toEqual([GAVE_PRO(ann.session.ownerId, '3 months', plan.pro.until)]);
    // Nothing was paid, nothing added: its line says Alcove gave it, and a refund would give back the month bought alone.
    expect(plan).toMatchObject({
      kind: 'pro',
      balance: { microUsd: 0, history: [{ label: 'Pro, 3 months, given by Alcove', microUsd: 0 }, { label: 'Pro, 2 months', microUsd: -2 * PRICE }, { label: 'Added by support', microUsd: 2 * PRICE }] },
      pro: { refundableMicroUsd: PRICE }
    });
    // Renewing goes by a month's price as it was when the last month came, not by the nothing it was given for: on, with a
    // month's money in the balance, it buys the next.
    await funded(ann, '20', 'SUP-1003');
    expect((await ann.api.plans.setRenew(true)).pro.renewal).toBe('buys');
    // Logged with the account, the kind and how much it gave, never an amount.
    const lines = loggedAs(logsFrom, 'plan given by support');
    expect(lines).toEqual([expect.objectContaining({ component: 'billing-support', ownerId: ann.session.ownerId, kind: 'pro', months: 3, licenses: null, teamId: null })]);
    expect(Object.keys(lines[0] ?? {})).not.toContain('microUsd');

    // Bob, on Free, has his from now: on Pro at once, with all of Pro's notes for the period.
    const bob = await account();
    const asked = Date.now();
    expect(linesOf(await grant(op.write, [bob.session.ownerId, 'pro', '1'], 'SUP-1004'))).toHaveLength(1);
    const his = await bob.api.plans.plan();
    expect(his).toMatchObject({ kind: 'pro', notes: { minutesPerPeriod: 3000 }, balance: { microUsd: 0, history: [{ label: 'Pro, 1 month, given by Alcove', microUsd: 0 }] } });
    expect(his.pro.months).toHaveLength(1);
    expect(Date.parse(his.pro.months[0]?.from ?? '')).toBeGreaterThanOrEqual(asked - 1000);
    expect(Date.parse(his.pro.months[0]?.from ?? '')).toBeLessThanOrEqual(Date.now());
  });

  it('gives back nothing for what it gave when it’s refunded: a refund returns what was paid, and is refused when that’s nothing', async () => {
    // Bob paid nothing for his three months: there's nothing to refund, and asking changes nothing.
    const bob = await account();
    expect((await grant(op.write, [bob.session.ownerId, 'pro', '3'], 'SUP-1101')).status).toBe(200);
    const given = await bob.api.plans.plan();
    expect(given.pro.refundableMicroUsd).toBe(0);
    expect(await refusedFor(bob.api.plans.refundPro())).toBe('conflict: Refunding now would give nothing back: nothing was paid for the months that haven’t started.');
    expect(await bob.api.plans.plan()).toMatchObject({ balance: { microUsd: 0, history: [{ label: 'Pro, 3 months, given by Alcove', microUsd: 0 }] }, pro: { months: given.pro.months } });

    // Ann bought two months and was given three after them: the refund gives back the month bought that hasn't started, and
    // nothing for the three given, which go with it.
    const ann = await account();
    await funded(ann, '40', 'SUP-1102');
    await ann.api.plans.buyPro(2, PRICE);
    expect((await grant(op.write, [ann.session.ownerId, 'pro', '3'], 'SUP-1103')).status).toBe(200);
    expect((await ann.api.plans.plan()).pro.refundableMicroUsd).toBe(PRICE);
    const refunded = await ann.api.plans.refundPro();
    expect(refunded).toMatchObject({ kind: 'pro', balance: { microUsd: PRICE, history: [{ label: 'Pro refunded, 4 months', microUsd: PRICE }, {}, {}, {}] }, pro: { refundableMicroUsd: 0 } });
    expect(refunded.pro.months).toHaveLength(1);

    // A team's licenses given go back for nothing too. With only those to refund, nothing would come back, so nothing is done;
    // with one bought beside them, the refund gives back what that one cost, and they all go.
    const carol = await account();
    await carol.api.teams.create('Vandelay Industries');
    expect((await grant(op.write, [carol.session.ownerId, 'team', '2', '3'], 'SUP-1104')).status).toBe(200);
    expect((await carol.api.teams.mine())?.licenses).toEqual({ unconsumed: 2, refundableMicroUsd: 0, autoPurchase: false });
    expect(await refusedFor(carol.api.teams.refundLicenses())).toBe('conflict: Refunding now would give nothing back: nothing was paid for the licenses nobody has taken.');
    expect((await carol.api.teams.mine())?.licenses).toMatchObject({ unconsumed: 2 });
    await funded(carol, '40', 'SUP-1105');
    expect((await carol.api.teams.buyLicenses(1, LICENSE)).licenses).toEqual({ unconsumed: 3, refundableMicroUsd: LICENSE, autoPurchase: false });
    expect((await carol.api.teams.refundLicenses()).licenses).toEqual({ unconsumed: 0, refundableMicroUsd: 0, autoPurchase: false });
    expect((await carol.api.plans.plan()).balance).toMatchObject({
      microUsd: LICENSE,
      history: [{ label: 'Team licenses refunded, 3', microUsd: LICENSE }, { label: 'Team, 1 license', microUsd: -LICENSE }, { label: 'Added by support' }, { label: 'Team, 2 licenses for 3 months, given by Alcove', microUsd: 0 }]
    });
  });

  it('gives licenses to the team the account is the admin of, by the license purchase’s own rules: each taken on a visit for its months, auto-purchase still buying at what a license last cost, and no Pro over a live license', async () => {
    const ann = await account();
    await ann.api.teams.create('Vandelay Industries');
    // Buying one for a member when none is left, at a license's price now: what it goes by, since none has been bought yet.
    await ann.api.teams.setAutoPurchase(true);
    const logsFrom = h.logs.length;
    const given = await grant(op.write, [ann.session.ownerId, 'team', '1', '2'], 'SUP-1201');
    const team = await ann.api.teams.mine();
    expect(linesOf(given)).toEqual([
      `Gave team ${team?.id ?? ''}, whose admin is account ${ann.session.ownerId}, 1 license for 2 months, as “given by Alcove”: each is taken by someone on it without one as they next open Alcove.`
    ]);
    expect(team?.licenses).toEqual({ unconsumed: 1, refundableMicroUsd: 0, autoPurchase: true });
    // And one for a single month: a license bought for one period is what auto-purchase goes by, but nothing, for one given, isn't.
    expect((await grant(op.write, [ann.session.ownerId, 'team', '1', '1'], 'SUP-1202')).status).toBe(200);
    expect((await ann.api.teams.mine())?.licenses).toEqual({ unconsumed: 2, refundableMicroUsd: 0, autoPurchase: true });
    expect((await ann.api.plans.plan()).balance).toMatchObject({
      microUsd: 0, history: [{ label: 'Team, 1 license, given by Alcove', microUsd: 0 }, { label: 'Team, 1 license for 2 months, given by Alcove', microUsd: 0 }]
    });
    expect(loggedAs(logsFrom, 'plan given by support')).toEqual([
      expect.objectContaining({ ownerId: ann.session.ownerId, teamId: team?.id, kind: 'team', licenses: 1, months: 2 }),
      expect.objectContaining({ ownerId: ann.session.ownerId, teamId: team?.id, kind: 'team', licenses: 1, months: 1 })
    ]);
    // Given for nothing, they weren't bought: nothing says they were.
    expect(loggedAs(logsFrom, 'team licenses bought')).toEqual([]);

    // Ann takes the oldest as she next opens Alcove: Team, live for its two months from then. Bob, joining, takes the other.
    const visited = Date.now();
    await ann.api.auth.visit();
    expect((await ann.api.plans.plan()).kind).toBe('team');
    const hers = (await ann.api.teams.mine())?.members.find((m) => m.you)?.license;
    expect(hers?.state).toBe('live');
    expect(Date.parse(hers?.until ?? '') - visited).toBeGreaterThanOrEqual(2 * PERIOD);
    expect(Date.parse(hers?.until ?? '') - Date.now()).toBeLessThanOrEqual(2 * PERIOD);
    const bob = await account();
    await joinTeam(bob, ann);
    expect((await bob.api.plans.plan()).kind).toBe('team');
    expect((await ann.api.teams.mine())?.licenses).toMatchObject({ unconsumed: 0 });

    // Carol joins with none left: auto-purchase buys her one from Ann's balance at a license's price, as it would have before
    // the grants. What was given for nothing didn't become what a license last cost the team.
    await funded(ann, '40', 'SUP-1203');
    const carol = await account();
    await joinTeam(carol, ann);
    expect((await carol.api.plans.plan()).kind).toBe('team');
    expect((await ann.api.plans.plan()).balance).toMatchObject({ microUsd: 0, history: [{ label: 'Team license, bought for a member', microUsd: -LICENSE }, {}, {}, {}] });

    // On her team's plan, Ann isn't given Pro: its months would run unused. Nothing is given.
    expect(refusalOf(await grant(op.write, [ann.session.ownerId, 'pro', '2'], 'SUP-1204'))).toEqual([409, ON_TEAM]);
    expect((await ann.api.plans.plan()).pro.months).toEqual([]);
  });

  it('refuses licenses for an account that’s no team’s admin, giving nothing: they start a team first, and then the same ticket gives them', async () => {
    const carol = await account();
    expect(refusalOf(await grant(op.write, [carol.session.ownerId, 'team', '5', '3'], 'SUP-1301'))).toEqual([409, NO_TEAM]);
    // Someone on another's team isn't its admin either.
    const ann = await account();
    await ann.api.teams.create('Vandelay Industries');
    const dave = await account();
    await joinTeam(dave, ann);
    expect(refusalOf(await grant(op.write, [dave.session.ownerId, 'team', '1', '1'], 'SUP-1302'))).toEqual([409, NO_TEAM]);
    expect((await ann.api.teams.mine())?.licenses).toMatchObject({ unconsumed: 0 });
    expect((await carol.api.plans.plan()).balance.history).toEqual([]);
    // Nothing was kept for the ticket: once Carol starts a team, it gives the team its licenses.
    await carol.api.teams.create('Vandelay Industries');
    expect((await grant(op.write, [carol.session.ownerId, 'team', '5', '3'], 'SUP-1301')).status).toBe(200);
    expect((await carol.api.teams.mine())?.licenses).toEqual({ unconsumed: 5, refundableMicroUsd: 0, autoPurchase: false });
  });

  it('gives a ticket’s plan to an account once, whatever its case or what it gives, even sent twice at once; a read key, or none, gives nothing', async () => {
    const ann = await account();
    await ann.api.teams.create('Vandelay Industries');
    const both = await Promise.all([0, 1].map(() => grant(op.write, [ann.session.ownerId, 'pro', '1'], 'SUP-1401')));
    expect(both.map((r) => r.status).sort((x, y) => x - y)).toEqual([200, 409]);
    for (const r of both) if (r.status === 409) expect(refusalOf(r)).toEqual([409, TICKET_GAVE]);
    // However its reference is typed, and whatever it gives this time.
    for (const words of [['pro', '1'], ['team', '1', '1']]) {
      for (const reason of ['SUP-1401', 'sup-1401']) expect(refusalOf(await grant(op.write, [ann.session.ownerId, ...words], reason))).toEqual([409, TICKET_GAVE]);
    }
    // A ticket is the account's, whichever key sends it; the same ticket gives another account its own.
    const other = await ownWriter();
    try {
      expect(refusalOf(await grant(other.client, [ann.session.ownerId, 'pro', '1'], 'SUP-1401'))).toEqual([409, TICKET_GAVE]);
    } finally { await other.close(); }
    const bob = await account();
    expect((await grant(op.write, [bob.session.ownerId, 'pro', '1'], 'SUP-1401')).status).toBe(200);

    // A read key is refused for its scope, and a request with no key isn't an operator's: neither gives anything.
    const read = await grant(op.read, [ann.session.ownerId, 'pro', '1'], 'SUP-1402');
    expect(read.status).toBe(403);
    expect(Refusal.parse(read.body).code).toBe('forbidden');
    const unsigned = await fetch(`${h.baseUrl}/v1/operator/plans/grant`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ words: [ann.session.ownerId, 'pro', '1'], reason: 'SUP-1403' })
    });
    expect(unsigned.status).toBe(401);
    expect(Refusal.parse(await unsigned.json()).message).toBe('That isn’t a signed operator request.');

    // Ann has the one month the one grant gave; and each grant is kept as a keyed hash with the key that gave it, nothing more.
    expect((await ann.api.plans.plan()).pro.months).toHaveLength(1);
    expect((await ann.api.teams.mine())?.licenses).toMatchObject({ unconsumed: 0 });
    const kept = await h.pool.query<{ digest: Buffer }>('SELECT digest FROM operator_grants WHERE key_id = $1', [op.write.keyId]);
    expect(kept.rows).toHaveLength(2);
    for (const r of kept.rows) expect(r.digest).toHaveLength(32);
  });

  it('holds a grant to 12 months of Pro, or 25 licenses each for 12 months, and a key to five grants a day (UTC), whichever instance answers', async () => {
    const ann = await account();
    await ann.api.teams.create('Vandelay Industries');
    const MOST_PRO = 'One grant gives at most 12 months of Pro.';
    const MOST_TEAM = 'One grant gives at most 25 licenses, each for at most 12 months.';
    const NOT_A_COUNT = 'Months and licenses are whole numbers from 1: pro 3, or team 5 3.';
    const over: [string[], string][] = [
      [['pro', '13'], MOST_PRO], [['team', '26', '1'], MOST_TEAM], [['team', '1', '13'], MOST_TEAM],
      [['pro', '0'], NOT_A_COUNT], [['pro', '1.5'], NOT_A_COUNT], [['pro', '-1'], NOT_A_COUNT], [['team', '2', 'year'], NOT_A_COUNT]
    ];
    for (const [words, message] of over) expect(refusalOf(await grant(op.write, [ann.session.ownerId, ...words], 'SUP-1501')), words.join(' ')).toEqual([400, message]);
    // Words that aren't a grant say how one goes.
    for (const words of [['gift', '1'], ['pro'], ['pro', '1', '2'], ['team', '1']]) {
      const r = await grant(op.write, [ann.session.ownerId, ...words], 'SUP-1501');
      expect(r.status, words.join(' ')).toBe(400);
      expect(Refusal.parse(r.body).message).toContain('<account id> team <licenses> <months>');
    }
    // A key of its own, listed by two instances sharing the database, as two VMs are during a rollout: its day is counted in
    // the database, so what it gives through either counts on both. The most one grant gives, it gives.
    const key = makeOperatorKey('write');
    const first = await h.secondServer({ operatorKeys: [key.key] });
    const second = await h.secondServer({ operatorKeys: [key.key] });
    const one = signedClient(first.baseUrl, h.operator.audience, key);
    const two = signedClient(second.baseUrl, h.operator.audience, key);
    try {
      expect((await grant(one, [ann.session.ownerId, 'pro', '12'], 'SUP-1502')).status).toBe(200);
      expect((await grant(two, [ann.session.ownerId, 'team', '25', '12'], 'SUP-1503')).status).toBe(200);
      for (const [client, reason] of [[one, 'SUP-1504'], [two, 'SUP-1505'], [one, 'SUP-1506']] as const) {
        expect((await grant(client, [ann.session.ownerId, 'team', '1', '1'], reason)).status, reason).toBe(200);
      }
      // A sixth is refused through either, however little it gives; one whose ticket has given already is said so first.
      expect(refusalOf(await grant(one, [ann.session.ownerId, 'team', '1', '1'], 'SUP-1507'))).toEqual([403, A_DAYS_GRANTS]);
      expect(refusalOf(await grant(two, [ann.session.ownerId, 'pro', '1'], 'SUP-1508'))).toEqual([403, A_DAYS_GRANTS]);
      expect(refusalOf(await grant(two, [ann.session.ownerId, 'pro', '1'], 'SUP-1502'))).toEqual([409, TICKET_GAVE]);
      // Another key's day is its own; and a day on (UTC), this one gives again.
      expect((await grant(op.write, [ann.session.ownerId, 'team', '1', '1'], 'SUP-1509')).status).toBe(200);
      await h.pool.query("UPDATE operator_grants SET created_at = created_at - interval '1 day' WHERE key_id = $1", [key.key.id]);
      expect((await grant(one, [ann.session.ownerId, 'team', '1', '1'], 'SUP-1510')).status).toBe(200);
    } finally {
      await first.close();
      await second.close();
    }
    // What was refused gave nothing: 12 months of Pro, and 25, three of 1 and two more of 1 licenses.
    expect((await ann.api.plans.plan()).pro.months).toHaveLength(12);
    expect((await ann.api.teams.mine())?.licenses).toEqual({ unconsumed: 30, refundableMicroUsd: 0, autoPurchase: false });
  });

  it('refuses an ID nobody has, a workspace’s or a team’s, an address and a top-up’s reference, giving nothing to anyone and saying back nothing typed', async () => {
    const ann = await account();
    const { id: workspaceId } = await ann.api.workspaces.create('Vandelay plans');
    const team = await ann.api.teams.create('Vandelay Industries');
    const ownerOf = async (sql: string, id: string) => (await h.pool.query<{ owner_id: string }>(sql, [id])).rows[0]?.owner_id ?? '';
    const workspaceOwner = await ownerOf('SELECT owner_id FROM workspaces WHERE workspace_id = $1', workspaceId);
    const teamOwner = await ownerOf('SELECT owner_id FROM teams WHERE team_id = $1', team.id);
    for (const id of [workspaceOwner, teamOwner]) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const t = await topUp(ann, 5_000_000);
    const plans = async () => (await h.pool.query('SELECT owner_id FROM plan_accounts')).rowCount;
    const before = await plans();
    const logsFrom = h.logs.length;
    const answersFrom = answers.length;
    for (const id of [workspaceOwner, teamOwner, 'A'.repeat(43)]) {
      for (const words of [['pro', '1'], ['team', '1', '1']]) expect(refusalOf(await grant(op.write, [id, ...words], 'SUP-1601'))).toEqual([404, 'No account has that ID.']);
    }
    for (const who of [ann.email, t.id]) expect(refusalOf(await grant(op.write, [who, 'pro', '1'], 'SUP-1602'))).toEqual([400, 'Name the account by its ID.']);
    // Nothing given to anyone, no plan made, nothing kept for the tickets, and nothing typed said back or logged.
    expect(await plans()).toBe(before);
    expect((await ann.api.plans.plan()).pro.months).toEqual([]);
    expect((await ann.api.teams.mine())?.licenses).toMatchObject({ unconsumed: 0 });
    expect((await h.pool.query('SELECT digest FROM operator_grants WHERE key_id = $1', [op.write.keyId])).rowCount).toBe(0);
    for (const text of [...answers.slice(answersFrom), ...h.logs.slice(logsFrom)]) expect(text.toLowerCase()).not.toContain(ann.email.toLowerCase());
    // A grant to Ann gives Bob nothing, and says nothing of him.
    const bob = await account();
    const given = await grant(op.write, [ann.session.ownerId, 'pro', '1'], 'SUP-1603');
    expect(given.status).toBe(200);
    expect(JSON.stringify(given.body)).not.toContain(bob.session.ownerId);
    expect((await ann.api.plans.plan()).pro.months).toHaveLength(1);
    expect(await bob.api.plans.plan()).toMatchObject({ kind: 'free', pro: { months: [] }, balance: { microUsd: 0, history: [] } });
  });
});

describe('billing on the operator CLI', () => {
  /** What the CLI printed in this block: none of it may hold an address or an amount. */
  const outputs: string[] = [];
  /**
   * The CLI as an operator runs it, with no .env and no terminal, signing with a write key of its own that a second instance
   * lists; `input` is what's typed at its prompt.
   */
  let cli: { run(args: string[], input?: string): Promise<{ code: number | null; out: string; err: string }>; close(): Promise<void> };
  beforeEach(async () => {
    const home = await mkdtemp(join(tmpdir(), 'alcove-support-'));
    const keyPath = join(home, 'operator-key.json');
    const { file } = makeKeyFile(null);
    await writeFile(keyPath, JSON.stringify(file), { mode: 0o600 });
    const second = await h.secondServer({ operatorKeys: parseOperatorKeys(`write:${file.publicKey}`) });
    cli = {
      run: (args, input) => new Promise((resolve, reject) => {
        const run = spawn(process.execPath, ['--import', 'tsx', 'src/operator-cli.ts', ...args, '--api', second.baseUrl, '--audience', h.operator.audience, '--key', keyPath], {
          env: { PATH: process.env['PATH'] ?? '', HOME: home }, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
        });
        let out = '';
        let err = '';
        run.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
        run.stderr?.on('data', (b: Buffer) => { err += b.toString(); });
        run.on('error', reject);
        run.on('close', (code) => { outputs.push(out, err); resolve({ code, out, err }); });
        if (input !== undefined) run.stdin?.end(input);
      }),
      close: async () => {
        await second.close();
        await rm(home, { recursive: true, force: true });
      }
    };
  });
  afterEach(async () => { await cli.close(); });
  /** Nothing the CLI printed holds `email`, nor an amount. */
  const saidNothingOf = (email: string) => {
    for (const text of outputs) {
      expect(text.toLowerCase()).not.toContain(email.toLowerCase());
      expect(text).not.toMatch(/10000000|5000000/);
    }
  };

  it('shows and adds as support, looks a top-up up and asks 1Click about it again, refusing an address or no reason before sending anything', async () => {
    const ann = await account();
    const t = await topUp(ann, 10_000_000);
    const show = await cli.run(['billing', 'show', ann.session.ownerId]);
    expect(show.code).toBe(0);
    expect(show.out.split('\n')).toEqual(expect.arrayContaining([`Account ${ann.session.ownerId}`, 'Top-ups: 1 waiting']));
    expect(show.err).toMatch(/^Request [A-Za-z0-9_-]{8,64} on \S+$/m);
    expect(await cli.run(['billing', 'credit', ann.session.ownerId, '5', '--reason', 'SUP-9001'])).toMatchObject({ code: 0, out: `${ADDED(ann.session.ownerId)}\n` });
    // An action without a reason, and an address where an ID goes, are refused here: nothing is sent.
    for (const args of [['billing', 'credit', ann.session.ownerId, '5'], ['billing', 'show', ann.email]]) {
      const refused = await cli.run(args);
      expect(refused.code).toBe(2);
      expect(refused.err).not.toMatch(/^Request /m);
    }
    const looked = await cli.run(['topup', t.id]);
    expect(looked.code).toBe(0);
    expect(looked.out).toMatch(new RegExp(`^Top-up:\\s+${t.id}$`, 'm'));
    expect(looked.out).toMatch(/^State:\s+waiting$/m);
    expect(looked.out).toMatch(/^Opened:\s+\d{4}-\d\d-\d\d \d\d:00 UTC$/m);
    const json = await cli.run(['topup', t.id, '--json']);
    expect(TopUpAnswer.parse(JSON.parse(json.out))).toMatchObject({ reference: t.id, accountId: ann.session.ownerId, state: 'waiting' });
    h.oneclick.set(t.address, 'SUCCESS', settled(t, 10_000_000));
    await askAgain(t.id);
    expect(await cli.run(['topup', 'check', t.id, '--reason', 'SUP-9002'])).toMatchObject({ code: 0, out: 'It was waiting, and is credited now. Nothing watches it any more.\n' });
    saidNothingOf(ann.email);
  });

  it('gives a plan as Alcove, refusing an address, no reason or words that aren’t a grant before sending anything', async () => {
    const ann = await account();
    const given = await cli.run(['plan', 'grant', ann.session.ownerId, 'pro', '2', '--reason', 'SUP-9101']);
    expect(given.code).toBe(0);
    const plan = await ann.api.plans.plan();
    expect(given.out).toBe(`Gave account ${ann.session.ownerId} 2 months of Pro, after any it had, as “given by Alcove”: Pro runs to ${plan.pro.until?.slice(0, 10) ?? ''} now.\n`);
    expect(given.err).toMatch(/^Request [A-Za-z0-9_-]{8,64} on \S+$/m);
    for (const args of [
      ['plan', 'grant', ann.session.ownerId, 'pro', '2'],
      ['plan', 'grant', ann.email, 'pro', '2', '--reason', 'SUP-9102'],
      ['plan', 'grant', ann.session.ownerId, 'gift', '2', '--reason', 'SUP-9102'],
      ['plan', 'grant', ann.session.ownerId, 'team', '2', '--reason', 'SUP-9102']
    ]) {
      const refused = await cli.run(args);
      expect(refused.code, args.join(' ')).toBe(2);
      expect(refused.err).not.toMatch(/^Request /m);
    }
    // What the server refuses, the CLI says, and exits 1.
    const over = await cli.run(['plan', 'grant', ann.session.ownerId, 'team', '26', '1', '--reason', 'SUP-9103']);
    expect(over.code).toBe(1);
    expect(over.err).toContain('One grant gives at most 25 licenses, each for at most 12 months.');
    expect((await ann.api.plans.plan()).pro.months).toHaveLength(2);
    saidNothingOf(ann.email);
  });
});
