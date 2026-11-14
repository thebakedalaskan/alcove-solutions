/**
 * What an operator may see and do about an account (features/account/operator/operator.ts), through the real API over HTTP with
 * requests signed as the operator CLI signs them, against real Postgres: why an account can't sign in (its keys, its sessions
 * by provider) and what its agents hold, and when its key or plan doesn't open, why, by class and code, with the rest still
 * said; an account with no plan yet said to have none, and none made; finding an account by the address it signs in with, for
 * a write key alone, 20 an hour, and never logging it, hashed or not; signing an account out everywhere while its agents keep
 * working; and refusing whatever isn't a person's account, an address included, without saying it back. Then the operator
 * CLI's account commands end to end. People sign in through the real API.
 */
import { Client, SdkHttpError, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { blindIndex } from '../../../keys/crypto';
import { makeKeyFile, parseOperatorKeys } from '../../../keys/operator-keys';
import { indexKey } from '../../../keys/owners';
import { limitsNow } from '../../../platform/limits';
import { ORIGIN, startHarness, type Harness } from '../../../testing/harness';
import { signedClient, makeOperatorKey, type SignedClient } from '../../../testing/operator';
import { AccountAnswer, AccountFound, SignedOut } from './operator';

vi.setConfig({ testTimeout: 90_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

let seq = 0;
const unique = (who = 'person') => `${who}.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example`;
async function account(email = unique()) {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email });
  return { ...b, session: r.session, email };
}
/** Another account at the same address, through (the stand-in) Google: a provider of its own, so an account of its own. */
async function googleAccount(email: string) {
  const b = h.browser();
  h.google.next({ sub: `google-${Date.now().toString(36)}${(seq++).toString(36)}`, email, name: 'Kel Varnsen' });
  let url = new URL(`${h.baseUrl}/v1/auth/google`);
  for (let hop = 0; hop < 10 && url.origin !== new URL(ORIGIN).origin; hop++) {
    const res = url.origin === h.google.issuer ? await fetch(url, { redirect: 'manual' }) : await b.fetch(url, { redirect: 'manual' });
    url = new URL(res.headers.get('location') ?? '', url);
  }
  const session = await b.api.auth.getSession();
  if (!session) throw new Error('not signed in with Google');
  return { ...b, session };
}
/** An agent's MCP request with its token: whether it's let in. */
async function mcp(token: string): Promise<number> {
  const client = new Client({ name: 'operator-sign-out', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${h.baseUrl}/mcp`), { authProvider: { token: async () => token } }));
    await client.listTools();
    return 200;
  } catch (error) {
    if (error instanceof SdkHttpError) return error.status;
    if (error instanceof Error && error.name === 'UnauthorizedError') return 401;
    throw error;
  } finally { await client.close(); }
}

/** Every answer an operator got, as its text: none may hold an address or a name. */
const answers: string[] = [];
const Refusal = z.object({ code: z.string(), message: z.string() });
async function signed(client: SignedClient, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const res = method === 'GET' ? await client.get(path) : await client.post(path, body);
  const text = await res.text();
  answers.push(text);
  const parsed: unknown = JSON.parse(text);
  return { status: res.status, body: parsed };
}
const refusalOf = (r: { status: number; body: unknown }) => [r.status, Refusal.parse(r.body).message];
const lookup = (id: string, client: SignedClient = h.operator.read) => signed(client, 'GET', `/v1/operator/accounts/${id}`);
/** Finding an account by address; `reason` null sends none. */
const find = (email: string, client: SignedClient = h.operator.write, reason: string | null = 'SUP-1182') =>
  signed(client, 'POST', '/v1/operator/accounts/find', { email, ...(reason === null ? {} : { reason }) });
const signOut = (id: string, client: SignedClient = h.operator.write) => signed(client, 'POST', `/v1/operator/accounts/${id}/sessions/end`, { reason: 'SUP-1183' });
/** A whole hour, as ISO 8601: what an operator is told of an account's times. */
const HOUR = /T\d\d:00:00\.000Z$/;
/** An error's class or code, as an answer may say it. */
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const ownerOf = async (sql: string, id: string) => (await h.pool.query<{ owner_id: string }>(sql, [id])).rows[0]?.owner_id ?? '';

describe('an account, for an operator', () => {
  it('says why it can’t sign in: its keys, its sessions by provider, its agents and its plan, with times to the hour and nothing of another account', async () => {
    const ann = await account();
    // A second browser, and a third whose session has run out and isn't swept yet.
    const second = h.browser();
    await second.api.auth.signIn('sso', { email: ann.email });
    const third = h.browser();
    await third.api.auth.signIn('sso', { email: ann.email });
    await h.pool.query(`UPDATE sessions SET expires_at = now() - interval '1 minute'
      WHERE session_hash = (SELECT session_hash FROM sessions WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1)`, [ann.session.ownerId]);
    const agent = await ann.api.agents.createToken({ name: 'Vandelay assistant', scopes: ['notes:read'], expiresInDays: 1 });
    // Bob's account and agent, which nothing about Ann's names.
    const bob = await account();
    const bobAgent = await bob.api.agents.createToken({ name: 'Kramerica helper', scopes: ['notes:read'], expiresInDays: 1 });

    const r = await lookup(ann.session.ownerId);
    expect(r.status).toBe(200);
    const a = AccountAnswer.parse(r.body);
    expect(a).toMatchObject({
      accountId: ann.session.ownerId,
      madeOn: new Date().toISOString().slice(0, 10),
      // Outside a TEE: the old envelope alone, which opens.
      keys: { v2: false, v1: true, opens: true, error: null },
      signIn: { sessions: [{ provider: 'sso', live: 2 }], endedNotSwept: 1 },
      agents: {
        live: 1, most: 50,
        connections: [{ id: agent.connection.id, live: true, lastUsed: null, liveRefreshTokens: 0, tokenRows: 1, mostTokenRows: 4096 }]
      },
      plan: { kind: 'free' }
    });
    const [sessions] = a.signIn.sessions;
    const [connection] = a.agents.connections;
    for (const at of [a.signIn.last, sessions?.newestStarted, sessions?.lastSeen, connection?.made, connection?.expires]) expect(at).toMatch(HOUR);
    // Nothing of the person, and nothing of Bob's.
    const text = JSON.stringify(r.body);
    for (const never of [ann.email, ann.session.user.name, 'Vandelay assistant', bob.session.ownerId, bobAgent.connection.id, agent.token]) expect(text).not.toContain(never);
    expect(AccountAnswer.parse((await lookup(bob.session.ownerId)).body).agents.connections.map((c) => c.id)).toEqual([bobAgent.connection.id]);
  });

  it('says when an account’s key or its plan doesn’t open here, by class and code alone, and still answers the rest', async () => {
    const ann = await account(unique('kramer'));
    const agent = await ann.api.agents.createToken({ name: 'Vandelay assistant', scopes: ['notes:read'], expiresInDays: 1 });
    const id = ann.session.ownerId;
    const [envelopes] = (await h.pool.query<{ v1: Buffer | null; v2: Buffer | null }>('SELECT root_envelope AS v1, root_envelope_v2 AS v2 FROM owners WHERE owner_id = $1', [id])).rows;
    const [plan] = (await h.pool.query<{ state: Buffer }>('SELECT state_ciphertext AS state FROM plan_accounts WHERE owner_id = $1', [id])).rows;
    if (!envelopes || !plan) throw new Error('no key or plan to break');
    // Bytes that are no envelope and no record: 0xff never begins a character, so they aren't even text.
    const junk = Buffer.concat([Buffer.from([0xff]), randomBytes(63)]);
    const logsFrom = h.logs.length;
    const answersFrom = answers.length;
    try {
      // Its root key's envelopes, whichever it has, overwritten.
      await h.pool.query(`UPDATE owners SET root_envelope = CASE WHEN root_envelope IS NULL THEN NULL ELSE $2::bytea END,
        root_envelope_v2 = CASE WHEN root_envelope_v2 IS NULL THEN NULL ELSE $2::bytea END WHERE owner_id = $1`, [id, junk]);
      const broken = await lookup(id);
      expect(broken.status).toBe(200);
      const a = AccountAnswer.parse(broken.body);
      expect(a).toMatchObject({
        accountId: id,
        keys: { v2: false, v1: true, opens: false },
        signIn: { sessions: [{ provider: 'sso', live: 1 }], endedNotSwept: 0 },
        agents: { live: 1, connections: [{ id: agent.connection.id, live: true }] },
        plan: { kind: 'free' }
      });
      expect(a.keys.error?.errorClass).toMatch(CODE);
      expect(a.keys.error?.code ?? 'none').toMatch(CODE);
      // Its plan's record overwritten too: no plan to say, and the rest as it was.
      await h.pool.query('UPDATE plan_accounts SET state_ciphertext = $2 WHERE owner_id = $1', [id, junk]);
      const unplanned = await lookup(id);
      expect(unplanned.status).toBe(200);
      expect(AccountAnswer.parse(unplanned.body)).toMatchObject({
        keys: { opens: false }, signIn: { sessions: [{ provider: 'sso', live: 1 }] }, agents: { live: 1, connections: [{ id: agent.connection.id }] }, plan: null
      });
    } finally {
      await h.pool.query('UPDATE owners SET root_envelope = $2, root_envelope_v2 = $3 WHERE owner_id = $1', [id, envelopes.v1, envelopes.v2]);
      await h.pool.query('UPDATE plan_accounts SET state_ciphertext = $2 WHERE owner_id = $1', [id, plan.state]);
    }
    // Put back, both open again.
    expect(AccountAnswer.parse((await lookup(id)).body)).toMatchObject({ keys: { opens: true, error: null }, plan: { kind: 'free' } });
    // Its lines name the account and why, and nothing of the person, of their agent, or of the bytes found where a key was.
    const lines = h.logs.slice(logsFrom);
    expect(lines.filter((l) => l.includes('"msg":"account’s key doesn’t open"') && l.includes(`"ownerId":"${id}"`))).toHaveLength(2);
    expect(lines.filter((l) => l.includes('"msg":"account’s plan doesn’t open"') && l.includes(`"ownerId":"${id}"`))).toHaveLength(1);
    const said = [...lines, ...answers.slice(answersFrom)].join('\n');
    for (const never of [ann.email, ann.session.user.name, 'Vandelay assistant', agent.token, junk.toString('hex'), junk.toString('base64'), junk.toString('base64url')]) {
      expect(said).not.toContain(never);
    }
  });

  it('says an account from before plans has no plan yet, and makes none by looking', async () => {
    const ann = await account();
    const planned = async () => (await h.pool.query('SELECT owner_id FROM plan_accounts WHERE owner_id = $1', [ann.session.ownerId])).rowCount;
    // As an account from before plans has none until it's next used, or upkeep gives it its row.
    await h.pool.query('DELETE FROM plan_accounts WHERE owner_id = $1', [ann.session.ownerId]);
    expect(AccountAnswer.parse((await lookup(ann.session.ownerId)).body).plan).toEqual({ kind: 'none' });
    expect(await planned()).toBe(0);
    // Once it's used, it has one.
    expect((await ann.api.plans.plan()).kind).toBe('free');
    expect(await planned()).toBe(1);
    expect(AccountAnswer.parse((await lookup(ann.session.ownerId)).body).plan).toEqual({ kind: 'free' });
  });

  it('refuses a workspace’s ID, a team’s, an address and an ID nobody has, the same as nobody’s, saying back nothing typed', async () => {
    const ann = await account();
    const { id: workspaceId } = await ann.api.workspaces.create('Vandelay plans');
    const team = await ann.api.teams.create('Vandelay Industries');
    const workspaceOwner = await ownerOf('SELECT owner_id FROM workspaces WHERE workspace_id = $1', workspaceId);
    const teamOwner = await ownerOf('SELECT owner_id FROM teams WHERE team_id = $1', team.id);
    for (const id of [workspaceOwner, teamOwner]) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const sessions = async () => (await h.pool.query('SELECT session_hash FROM sessions')).rowCount;
    const before = await sessions();
    const logsFrom = h.logs.length;
    for (const id of [workspaceOwner, teamOwner, 'A'.repeat(43)]) {
      expect(refusalOf(await lookup(id))).toEqual([404, 'No account has that ID.']);
      expect(refusalOf(await signOut(id))).toEqual([404, 'No account has that ID.']);
    }
    for (const typed of [encodeURIComponent(ann.email), workspaceId]) {
      expect(refusalOf(await lookup(typed))).toEqual([400, 'An account’s ID is 43 letters, digits, - and _.']);
      expect(refusalOf(await signOut(typed))).toEqual([400, 'An account’s ID is 43 letters, digits, - and _.']);
    }
    // Nobody was signed out, and what was typed went nowhere.
    expect(await sessions()).toBe(before);
    for (const text of [...answers, ...h.logs.slice(logsFrom)]) {
      for (const typed of [ann.email, encodeURIComponent(ann.email)]) expect(text.toLowerCase()).not.toContain(typed.toLowerCase());
    }
  });

  it('finds an account by the address it signs in with, for a write key with a reason alone, and never logs the address, hashed or not', async () => {
    const ann = await account();
    const logsFrom = h.logs.length;
    const answersFrom = answers.length;
    // As sign-in finds it: whatever its case, and around spaces.
    const found = await find(` ${ann.email.toUpperCase()} `);
    expect(found.status).toBe(200);
    expect(AccountFound.parse(found.body)).toMatchObject({ found: 1, accountId: ann.session.ownerId });
    // Nobody signs in with it: says so, naming nobody.
    const nobody = AccountFound.parse((await find(unique('nobody'))).body);
    expect(nobody).toMatchObject({ found: 0 });
    expect(nobody.accountId).toBeUndefined();
    // Two accounts sign in with it, with different providers: how many, and neither named.
    const shared = unique('shared');
    const one = await account(shared);
    const two = await googleAccount(shared);
    const both = AccountFound.parse((await find(shared)).body);
    expect(both).toMatchObject({ found: 2 });
    expect(both.accountId).toBeUndefined();
    expect(JSON.stringify(both)).not.toContain(one.session.ownerId);
    expect(JSON.stringify(both)).not.toContain(two.session.ownerId);
    // A read key can't; nor can a write key without a reason, or with prose for one.
    expect((await find(ann.email, h.operator.read)).status).toBe(403);
    expect((await find(ann.email, h.operator.write, null)).status).toBe(400);
    expect((await find(ann.email, h.operator.write, 'Ann asked by phone')).status).toBe(400);
    // Its own line says how many were found, and nothing logged holds an address, or its keyed hash in any encoding.
    const lines = h.logs.slice(logsFrom);
    expect(lines.filter((l) => l.includes('"msg":"account found by address"')).map((l) => z.object({ found: z.number() }).passthrough().parse(JSON.parse(l)).found)).toEqual([1, 0, 2]);
    const key = indexKey(h.deps);
    const hashes = [ann.email, shared].flatMap((email) => {
      const index = Buffer.from(blindIndex(key, 'email', email));
      return [index.toString('hex'), index.toString('base64'), index.toString('base64url')];
    });
    key.fill(0);
    const said = [...lines, ...answers.slice(answersFrom)].join('\n').toLowerCase();
    for (const never of [ann.email.toLowerCase(), shared.toLowerCase(), '[email]', ...hashes.map((x) => x.toLowerCase())]) expect(said).not.toContain(never);
  });

  it('finds 20 accounts an hour with each key, and refuses the 21st', async () => {
    const ann = await account();
    // A key of its own, on a second instance, whose budgets are its own. The per-minute budget for writes is 20 too, so the
    // finds are spread over three minutes, as Date says them, to show the hour's.
    const key = makeOperatorKey('write');
    const second = await h.secondServer({ operatorKeys: [key.key] });
    const own = signedClient(second.baseUrl, h.operator.audience, key);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    try {
      for (const minute of [0, 1]) {
        if (minute) vi.setSystemTime(Date.now() + 61_000);
        for (let i = 0; i < 10; i++) expect((await find(ann.email, own, `SUP-${minute}${i}00`)).status).toBe(200);
      }
      vi.setSystemTime(Date.now() + 61_000);
      const logsFrom = h.logs.length;
      expect(refusalOf(await find(ann.email, own, 'SUP-2100'))).toEqual([503, 'Too many attempts. Wait a minute and try again.']);
      expect(h.logs.slice(logsFrom).some((l) => l.includes('"limit":"operator finds"'))).toBe(true);
      // An hour on, it finds again.
      vi.setSystemTime(Date.now() + 3_600_000);
      expect((await find(ann.email, own, 'SUP-2200')).status).toBe(200);
    } finally {
      vi.useRealTimers();
      await second.close();
    }
  });

  it('signs an account out everywhere at the person’s request: its browsers are signed out, and its agents keep working', async () => {
    const ann = await account();
    const second = h.browser();
    await second.api.auth.signIn('sso', { email: ann.email });
    const agent = await ann.api.agents.createToken({ name: 'Vandelay assistant', scopes: ['notes:read'], expiresInDays: 1 });
    expect(await mcp(agent.token)).toBe(200);
    // Bob stays signed in.
    const bob = await account();
    // A read key can't.
    expect((await signOut(ann.session.ownerId, h.operator.read)).status).toBe(403);
    const logsFrom = h.logs.length;
    const ended = await signOut(ann.session.ownerId);
    expect(ended.status).toBe(200);
    expect(SignedOut.parse(ended.body)).toMatchObject({ ended: 2 });
    expect(await ann.api.auth.getSession()).toBeNull();
    expect(await second.api.auth.getSession()).toBeNull();
    expect(await mcp(agent.token)).toBe(200);
    expect(await bob.api.auth.getSession()).toMatchObject({ ownerId: bob.session.ownerId });
    // Its own line names the account and how many ended. Again, nothing's left to end.
    expect(h.logs.slice(logsFrom).filter((l) => l.includes('"msg":"account signed out everywhere by support"') && l.includes(`"ownerId":"${ann.session.ownerId}"`) && l.includes('"ended":2'))).toHaveLength(1);
    expect(SignedOut.parse((await signOut(ann.session.ownerId)).body)).toMatchObject({ ended: 0 });
    // Signing in again works as ever.
    const back = h.browser();
    expect((await back.api.auth.signIn('sso', { email: ann.email })).session.ownerId).toBe(ann.session.ownerId);
  });
});

describe('an account on the operator CLI', () => {
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

  it('looks an account up, finds it by the address typed at its hidden prompt, signs it out everywhere, and lists limits', async () => {
    const ann = await account();
    const acct = await cli.run(['account', ann.session.ownerId]);
    expect(acct.code).toBe(0);
    expect(acct.out).toMatch(/^Keys:\s+v1 envelope; opens here$/m);
    expect(acct.out).toMatch(/^Sessions with sso:\s+1 live; newest started /m);
    expect(acct.out).toMatch(/^Plan:\s+free; /m);
    // An address where an account's ID goes is refused here: nothing is sent, and it's said back nowhere.
    const typed = await cli.run(['account', ann.email]);
    expect(typed.code).toBe(2);
    expect(typed.err).not.toMatch(/^Request /m);
    // The address typed at its hidden prompt, not given on the command line.
    expect(await cli.run(['account', 'find', '--reason', 'SUP-9003'], `${ann.email}\n`)).toMatchObject({ code: 0, out: `Account ${ann.session.ownerId}\n` });
    expect(await cli.run(['account', 'sign-out', ann.session.ownerId, '--reason', 'SUP-9004'])).toMatchObject({ code: 0, out: 'Ended 1 session: its browsers are signed out, and its agents keep working.\n' });
    expect(await ann.api.auth.getSession()).toBeNull();
    const limits = await cli.run(['limits', 'list']);
    expect(limits.code).toBe(0);
    expect(limits.out).toMatch(/^plan\.pro\.price_micro_usd /m);
    // Setting one takes a reason, checked before anything is sent; then it's set as `limits set` sets it, here to what it is.
    const unreasoned = await cli.run(['limits', 'set', 'call.max_people', '10']);
    expect([unreasoned.code, unreasoned.err.includes('That needs --reason <ref>'), /^Request /m.test(unreasoned.err)]).toEqual([2, true, false]);
    const most = String((await limitsNow(h.deps)).get('call.max_people'));
    expect(await cli.run(['limits', 'set', 'call.max_people', most, '--reason', 'SUP-9005'])).toMatchObject({ code: 0, out: expect.stringContaining(`call.max_people is ${most} now; it was ${most}.`) });
    saidNothingOf(ann.email);
  });
});
