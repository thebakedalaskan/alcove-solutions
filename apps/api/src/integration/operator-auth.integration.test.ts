/*
 * Signed operator requests (http/operator.ts, keys/operator-keys.ts): each operator's own key; a signed time within a minute of
 * the server's either way; the audience, method, path and body bound by the signature; a nonce used once, on any instance,
 * even when two copies arrive at once; scopes, every write route refusing a read key, reasons that are a ticket's and
 * nothing else, and limits per key; one audit line a call; reads that go on, checked in memory, while the database can't
 * be reached; every operator route refusing whatever isn't signed, and not there at all without keys; and the CLI end to
 * end, from making a key, sealed with a passphrase or not, to the commands it signs.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../app';
import { createPool } from '../platform/db';
import { maintain } from '../maintenance';
import { signRequest } from '../features/operator/cli/cli';
import { makeKeyFile, parseOperatorKeys } from '../keys/operator-keys';
import { WhoamiAnswer } from '../features/operator/wire';
import { LinesAnswer } from '../http/operator';
import { startHarness, type Harness } from '../testing/harness';
import { signedClient, makeOperatorKey } from '../testing/operator';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const REFUSED = 'That isn’t a signed operator request.';
const WHOAMI = '/v1/operator/whoami';
const FLAGS = '/v1/operator/feature-flags';
/** A change that changes nothing: the flag is off for everyone, and stays off. */
const NO_CHANGE = { words: ['everyone', 'call.bandwidth_reduction', 'off'], reason: 'SUP-1182' };
const LogLine = z.object({ level: z.number(), msg: z.string() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).map((l) => LogLine.parse(JSON.parse(l)));
const auditSince = (from: number) => logsSince(from).filter((l) => l.msg === 'operator call');
const Refusal = z.object({ code: z.string(), message: z.string(), requestId: z.string() });
const refusalOf = async (r: Response) => Refusal.parse(await r.json());
const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Every operator route the app registers, with a stand-in for each parameter in its path: later ones are covered too. */
function operatorRoutes(): { method: 'GET' | 'POST'; path: string }[] {
  const seen = new Set<string>();
  const out: { method: 'GET' | 'POST'; path: string }[] = [];
  for (const r of createApp(h.deps).routes) {
    if (!r.path.startsWith('/v1/operator/') || (r.method !== 'GET' && r.method !== 'POST') || seen.has(`${r.method} ${r.path}`)) continue;
    seen.add(`${r.method} ${r.path}`);
    out.push({ method: r.method, path: r.path.replace(/:[A-Za-z]+/g, 'AAAAAAAAAAAAAAAAAAAAAA') });
  }
  return out;
}
/**
 * What a change says to each command route, whose words decide its scope; every other POST changes something whatever its
 * body says. Asking whether an address is in a flag's group is among them: it finds something out about a person.
 */
const CHANGES: Record<string, string[][]> = {
  '/v1/operator/feature-flags': [['everyone', 'call.bandwidth_reduction', 'on'], ['group', 'create', 'staff'], ['group', 'members', 'staff', 'kramer@vandelay.test']],
  '/v1/operator/limits': [['set', 'call.max_people', '10']],
  '/v1/operator/billing': [['credit', 'A'.repeat(43), '5'], ['credit', 'A'.repeat(22), '5']]
};

/**
 * The CLI as an operator runs it, in `home`, with no .env and nothing in its environment but a PATH and a home. Without
 * `typed` it has no terminal; with it, it runs in a terminal of its own (script's pseudo-terminal), and each line of `typed`
 * is typed at the next prompt that asks for a passphrase. What it said, stdout and stderr, comes back with its exit code;
 * in a terminal they're one.
 */
function runCli(home: string, args: string[], typed?: string[]): Promise<{ code: number | null; out: string; err: string }> {
  const env = { PATH: process.env['PATH'] ?? '', HOME: home };
  const command = [process.execPath, '--import', 'tsx', 'src/operator-cli.ts', ...args];
  const quoted = command.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  // util-linux's script runs a command string, and says its exit code with -e; BSD's (macOS) runs the words after its file.
  const [file, argv] = typed === undefined ? [process.execPath, command.slice(1)] : ['script', process.platform === 'darwin' ? ['-q', '/dev/null', ...command] : ['-q', '-e', '-c', quoted, '/dev/null']];
  return new Promise((resolve, reject) => {
    const run = spawn(file, argv, { env: typed === undefined ? env : { ...env, SHELL: '/bin/sh', TERM: 'dumb' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let prompts = 0;
    run.stdout.on('data', (b: Buffer) => {
      out += b.toString();
      // A prompt is answered once it has been asked: keygen asks twice, a sealed key once.
      const asked = (out.match(/passphrase[^:\r\n]*: /gi) ?? []).length;
      for (; prompts < asked; prompts++) run.stdin.write(`${typed?.[prompts] ?? ''}\r`);
    });
    run.stderr.on('data', (b: Buffer) => { err += b.toString(); });
    run.on('error', reject);
    run.on('close', (code) => { resolve({ code, out, err }); });
    if (typed === undefined) run.stdin.end();
  });
}

/** A request with no signature at all, as anything but the CLI sends one. */
const unsigned = (baseUrl: string, r: { method: 'GET' | 'POST'; path: string }, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${r.path}`, r.method === 'POST' ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(NO_CHANGE) } : { headers });

/** A port nothing listens on: a database there refuses every connection. */
const closedPort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const at = s.address();
    s.close(() => resolve(typeof at === 'object' && at ? at.port : 9));
  });
});

describe('signed operator requests', () => {
  it('answers whoami for a read and a write key', async () => {
    for (const [client, key] of [[h.operator.read, h.operator.keys.read], [h.operator.write, h.operator.keys.write]] as const) {
      const r = await client.get(WHOAMI);
      expect(r.status).toBe(200);
      const answer = WhoamiAnswer.parse(await r.json());
      expect(answer).toEqual({ keyId: key.key.id, scope: key.key.scope, instance: expect.stringMatching(/\S/), at: expect.any(String) });
      expect(r.headers.get('x-alcove-instance')).toBe(answer.instance);
      expect(Math.abs(Date.parse(answer.at) - Date.now())).toBeLessThan(10_000);
    }
  });

  it('refuses every unsigned or broken request with one message', async () => {
    const from = h.logs.length;
    const read = h.operator.read;
    const now = () => Date.now();
    const cases: [string, () => Promise<Response>][] = [
      ['no header', () => fetch(`${h.baseUrl}${WHOAMI}`)],
      ['a header that won’t parse', () => fetch(`${h.baseUrl}${WHOAMI}`, { headers: { authorization: `Alcove-Operator key=${read.keyId}, time=soon` } })],
      ['an unknown key', () => signedClient(h.baseUrl, h.operator.audience, makeOperatorKey('write')).get(WHOAMI)],
      ['a time a minute and a second stale', () => read.raw({ method: 'GET', path: WHOAMI, time: now() - 61_000 })],
      ['a time a minute and a second ahead', () => read.raw({ method: 'GET', path: WHOAMI, time: now() + 61_000 })],
      ['another audience', () => read.raw({ method: 'GET', path: WHOAMI, audience: 'https://api.staging.alcove.solutions' })],
      ['another method', async () => fetch(`${h.baseUrl}${WHOAMI}`, {
        headers: { authorization: signRequest({ keyId: h.operator.keys.read.key.id, privateKey: h.operator.keys.read.privateKey }, { audience: h.operator.audience, method: 'POST', path: WHOAMI, body: new Uint8Array(0) }) }
      })],
      ['the path changed after signing', () => read.raw({ method: 'GET', path: WHOAMI, tamper: 'path' })],
      ['the body changed after signing', () => h.operator.write.raw({ method: 'POST', path: FLAGS, body: { words: ['list'] }, tamper: 'body' })],
      ['a signature from another key', () => read.raw({ method: 'GET', path: WHOAMI, tamper: 'signature' })]
    ];
    for (const [what, send] of cases) {
      const r = await send();
      expect(r.status, what).toBe(401);
      expect(await refusalOf(r), what).toEqual({ code: 'unauthenticated', message: REFUSED, requestId: expect.any(String) });
      // The server's time, for the CLI to say when it's the operator's clock that's off.
      expect(Math.abs(Date.parse(r.headers.get('date') ?? '') - Date.now()), what).toBeLessThan(5_000);
      expect(r.headers.get('x-alcove-instance'), what).toBeNull();
    }
    // Within the minute, either way, it's taken: VMs' clocks have run seconds behind.
    expect((await read.raw({ method: 'GET', path: WHOAMI, time: now() - 59_000 })).status).toBe(200);
    expect((await read.raw({ method: 'GET', path: WHOAMI, time: now() + 59_000 })).status).toBe(200);
    // Only the log says which step refused each.
    expect(auditSince(from).map((l) => l['why'] ?? null)).toEqual([
      'no-key', 'no-key', 'unknown-key', 'stale', 'stale', 'bad-signature', 'bad-signature', 'bad-signature', 'bad-signature', 'bad-signature', null, null
    ]);
  });

  it('refuses a replayed nonce on this and another instance', async () => {
    const nonce = randomBytes(16).toString('base64url');
    const from = h.logs.length;
    expect((await h.operator.read.raw({ method: 'GET', path: WHOAMI, nonce })).status).toBe(200);
    const again = await h.operator.read.raw({ method: 'GET', path: WHOAMI, nonce });
    expect(again.status).toBe(401);
    expect((await refusalOf(again)).message).toBe(REFUSED);
    // Another instance on the same database refuses it too: its own memory has never seen it, but the database has.
    const second = await h.secondServer();
    try {
      const there = signedClient(second.baseUrl, h.operator.audience, h.operator.keys.read);
      expect((await there.raw({ method: 'GET', path: WHOAMI, nonce })).status).toBe(401);
      expect((await there.get(WHOAMI)).status).toBe(200);
    } finally { await second.close(); }
    expect(auditSince(from).map((l) => [l['why'] ?? null, l['nonceIn'] ?? null])).toEqual([[null, 'database'], ['replayed', null], ['replayed', null], [null, 'database']]);
    const kept = z.array(z.object({ key_id: z.string() })).parse((await h.pool.query('SELECT key_id FROM operator_nonces WHERE nonce = $1', [nonce])).rows);
    expect(kept).toEqual([{ key_id: h.operator.keys.read.key.id }]);
  });

  it('forgets nonces after 10 minutes, long after a signed request has run out', async () => {
    await h.pool.query("INSERT INTO operator_nonces (nonce, key_id, seen_at) VALUES ('OldOldOldOldOldOldOld0', $1, now() - interval '11 minutes'), ('NewNewNewNewNewNewNew0', $1, now() - interval '9 minutes')", [h.operator.keys.read.key.id]);
    expect((await maintain(h.deps)).operatorNonces).toBeGreaterThanOrEqual(1);
    const left = z.array(z.object({ nonce: z.string() })).parse((await h.pool.query("SELECT nonce FROM operator_nonces WHERE nonce IN ('OldOldOldOldOldOldOld0', 'NewNewNewNewNewNewNew0')")).rows);
    expect(left).toEqual([{ nonce: 'NewNewNewNewNewNewNew0' }]);
  });

  it('takes a body of 64 KiB at most', async () => {
    const r = await h.operator.write.post(FLAGS, { ...NO_CHANGE, padding: 'x'.repeat(65 * 1024) });
    expect(r.status).toBe(400);
    expect((await refusalOf(r)).message).toBe('That request is too large.');
    expect((await h.operator.write.post(FLAGS, { ...NO_CHANGE, padding: 'x'.repeat(60 * 1024) })).status).toBe(200);
  });

  it('refuses a read key on every write route', async () => {
    const from = h.logs.length;
    const posts = operatorRoutes().filter((r) => r.method === 'POST');
    expect(posts.length).toBeGreaterThanOrEqual(10);
    let sent = 0;
    for (const route of posts) {
      // A command route's words that change something, and a body with no words at all; any other POST, with a reason.
      const template = Object.keys(CHANGES).find((p) => p === route.path);
      const bodies: unknown[] = template === undefined ? [{ reason: 'SUP-1182' }] : [...(CHANGES[template] ?? []).map((words) => ({ words, reason: 'SUP-1182' })), { reason: 'SUP-1182' }];
      for (const body of bodies) {
        const r = await h.operator.read.post(route.path, body);
        expect(r.status, `${route.path} ${JSON.stringify(body)}`).toBe(403);
        expect((await refusalOf(r)).code).toBe('forbidden');
        sent++;
      }
    }
    // Each refused for its scope, before anything was looked up or changed: the flag stays off for everyone, no limit was set.
    expect(auditSince(from).map((l) => [l['why'], l['status']])).toEqual(Array.from({ length: sent }, () => ['scope', 403]));
    const listed = LinesAnswer.parse(await (await h.operator.read.post(FLAGS, { words: ['list'] })).json()).lines;
    expect(listed[listed.findIndex((l) => l.startsWith('call.bandwidth_reduction: ')) + 1]).toMatch(/^ {2}everyone: off;/);
    expect(z.object({ n: z.number() }).parse((await h.pool.query("SELECT count(*)::int AS n FROM service_limits WHERE name = 'call.max_people'")).rows[0]).n).toBe(0);
  });

  it('takes one of two requests sent at once with the same nonce, with its database or without', async () => {
    const nonce = randomBytes(16).toString('base64url');
    const both = await Promise.all([0, 1].map(() => h.operator.read.raw({ method: 'GET', path: WHOAMI, nonce })));
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
    // With the database out of reach the nonce is held in memory the moment it's seen, so the copy beside it is refused too.
    const dead = createPool(`postgres://alcove:alcove@127.0.0.1:${await closedPort()}/alcove`, 2);
    const second = await h.secondServer({}, undefined, dead);
    try {
      const from = h.logs.length;
      const client = signedClient(second.baseUrl, h.operator.audience, h.operator.keys.read);
      const again = randomBytes(16).toString('base64url');
      const sent = await Promise.all([0, 1].map(() => client.raw({ method: 'GET', path: WHOAMI, nonce: again })));
      expect(sent.map((r) => r.status).sort()).toEqual([200, 401]);
      expect(auditSince(from).map((l) => [l['status'], l['nonceIn'] ?? null, l['why'] ?? null]).sort()).toEqual([[200, 'memory', null], [401, null, 'replayed']]);
    } finally {
      await second.close();
      await dead.end();
    }
  });

  it('keeps write routes from read keys', async () => {
    const from = h.logs.length;
    const r = await h.operator.read.post(FLAGS, { words: ['everyone', 'x', 'on'], reason: 'SUP-1182' });
    expect(r.status).toBe(403);
    expect((await refusalOf(r)).code).toBe('forbidden');
    // What only reads, it may.
    expect((await h.operator.read.post(FLAGS, { words: ['list'] })).status).toBe(200);
    expect((await h.operator.read.post(FLAGS, { words: ['groups'] })).status).toBe(200);
    expect(auditSince(from).map((l) => [l['why'] ?? null, l['status']])).toEqual([['scope', 403], [null, 200], [null, 200]]);
  });

  it('needs a reason on writes, and only a ticket’s reference is one', async () => {
    const from = h.logs.length;
    const { reason: _reason, ...without } = NO_CHANGE;
    const none = await h.operator.write.post(FLAGS, without);
    expect(none.status).toBe(400);
    // Prose, a name with dots or dashes, a NEAR account, a wallet's address, a ticket with someone's name after it: none is a
    // ticket's reference, and none is said back or logged, since each could name someone or lead to their wallet.
    const notTickets = ['Ann Smith’s refund', 'ann.vandelay', 'ann-vandelay.near', '0x52908400098527886E0F7030069857D2E4169EE7', 'SUP-1182/annv', 'SUP-1182 annv'];
    for (const reason of notTickets) {
      const r = await h.operator.write.post(FLAGS, { ...without, reason });
      expect(r.status, reason).toBe(400);
      expect(JSON.stringify(await refusalOf(r)), reason).not.toContain(reason);
    }
    const given = await h.operator.write.post(FLAGS, NO_CHANGE);
    expect(given.status).toBe(200);
    expect(LinesAnswer.parse(await given.json()).lines).toEqual(['call.bandwidth_reduction was already off for everyone.']);
    // Of any case, and any prefix of a few letters and digits.
    for (const reason of ['inc-77', 'OPS2-9']) expect((await h.operator.write.post(FLAGS, { ...NO_CHANGE, reason })).status, reason).toBe(200);
    const said = h.logs.slice(from).join('\n');
    for (const reason of notTickets) expect(said, reason).not.toContain(reason);
    expect(auditSince(from).map((l) => [l['status'], l['reason'] ?? null])).toEqual([
      [400, null], ...notTickets.map(() => [400, null]), [200, 'SUP-1182'], [200, 'inc-77'], [200, 'OPS2-9']
    ]);
  });

  it('is not there without keys', async () => {
    const off = await h.secondServer({ operatorKeys: [] });
    try {
      const routes = operatorRoutes();
      expect(routes.length).toBeGreaterThanOrEqual(2);
      const signed = signedClient(off.baseUrl, h.operator.audience, h.operator.keys.write);
      for (const route of routes) {
        expect((await unsigned(off.baseUrl, route)).status, route.path).toBe(404);
        const r = await signed.raw({ method: route.method, path: route.path, ...(route.method === 'POST' ? { body: NO_CHANGE } : {}) });
        expect(r.status, route.path).toBe(404);
        expect((await refusalOf(r)).message).toBe('That isn’t here.');
      }
    } finally { await off.close(); }
  });

  it('refuses an app session alone', async () => {
    const b = h.browser();
    await b.api.auth.signIn('sso', { email: 'kramer@vandelay.test' });
    // Signed in, with the app's own Origin and cookie, and no signature: not an operator.
    for (const r of [await b.fetch(`${h.baseUrl}${WHOAMI}`), await b.fetch(`${h.baseUrl}${FLAGS}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ words: ['list'] }) })]) {
      expect(r.status).toBe(401);
      expect((await refusalOf(r)).message).toBe(REFUSED);
    }
  });

  it('limits each key', async () => {
    // A server of its own, so its budgets are this test's alone.
    const k = makeOperatorKey('write');
    const second = await h.secondServer({ operatorKeys: [k.key] });
    try {
      const from = h.logs.length;
      const client = signedClient(second.baseUrl, h.operator.audience, k);
      for (let i = 0; i < 20; i++) expect((await client.post(FLAGS, NO_CHANGE)).status).toBe(200);
      const over = await client.post(FLAGS, NO_CHANGE);
      expect(over.status).toBe(503);
      expect((await refusalOf(over)).code).toBe('unavailable');
      // Reading has a budget of its own, which changes haven't touched.
      expect((await client.get(WHOAMI)).status).toBe(200);
      expect(auditSince(from).slice(-2).map((l) => [l['why'] ?? null, l['status']])).toEqual([['limit', 503], [null, 200]]);
      // And an address has its own, before anything is checked: the 61st request in a minute from one is refused unread.
      const address = { 'x-forwarded-for': '10.200.0.1' };
      for (let i = 0; i < 60; i++) expect((await unsigned(second.baseUrl, { method: 'GET', path: WHOAMI }, address)).status).toBe(401);
      expect((await unsigned(second.baseUrl, { method: 'GET', path: WHOAMI }, address)).status).toBe(503);
      expect(auditSince(from).at(-1)?.['why']).toBe('limit');
    } finally { await second.close(); }
  });

  it('limits each key’s reads to 120 a minute, whichever addresses they come from', async () => {
    // A server and a key of its own, so the budgets are this test's alone.
    const k = makeOperatorKey('write');
    const second = await h.secondServer({ operatorKeys: [k.key] });
    try {
      const from = h.logs.length;
      // Three addresses, 40 reads from each: within each one's 60 a minute, and all 120 the key may read in one.
      for (const client of [0, 1, 2].map(() => signedClient(second.baseUrl, h.operator.audience, k))) {
        for (let i = 0; i < 40; i++) expect((await client.get(WHOAMI)).status).toBe(200);
      }
      const over = await signedClient(second.baseUrl, h.operator.audience, k).get(WHOAMI);
      expect(over.status).toBe(503);
      expect((await refusalOf(over)).code).toBe('unavailable');
      expect(auditSince(from).at(-1)).toEqual(expect.objectContaining({ keyId: k.key.id, why: 'limit', status: 503 }));
      // Changing has a budget of its own, which the reads haven't touched.
      expect((await signedClient(second.baseUrl, h.operator.audience, k).post(FLAGS, NO_CHANGE)).status).toBe(200);
    } finally { await second.close(); }
  });

  it('logs one audit line per call', async () => {
    const from = h.logs.length;
    // Allowed: signed by hand, so its nonce and signature are known, with words in its body that no route reads.
    const k = h.operator.keys.write;
    const nonce = randomBytes(16).toString('base64url');
    const body = new TextEncoder().encode(JSON.stringify({ words: ['list'], reason: 'INC-77', note: 'vandelay-canary-words' }));
    const authorization = signRequest({ keyId: k.key.id, privateKey: k.privateKey }, { audience: h.operator.audience, method: 'POST', path: FLAGS, body, nonce });
    const signature = authorization.slice(authorization.indexOf('signature=') + 'signature='.length);
    const allowed = await fetch(`${h.baseUrl}${FLAGS}`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body });
    expect(allowed.status).toBe(200);
    // Refused, unsigned.
    const refused = await fetch(`${h.baseUrl}${WHOAMI}`);
    expect(refused.status).toBe(401);
    // Failed: what it reads isn't there.
    await h.pool.query('ALTER TABLE feature_flag_groups RENAME TO flag_groups_away');
    let failed: Response;
    try { failed = await h.operator.read.post(FLAGS, { words: ['groups'] }); } finally { await h.pool.query('ALTER TABLE flag_groups_away RENAME TO feature_flag_groups'); }
    expect(failed.status).toBe(500);

    const lines = auditSince(from);
    expect(lines).toEqual([
      expect.objectContaining({ level: 30, keyId: k.key.id, scope: 'write', route: `POST ${FLAGS}`, outcome: 'ok', status: 200, reason: 'INC-77', nonceIn: 'database', ms: expect.any(Number), requestId: allowed.headers.get('x-request-id'), component: 'operator' }),
      expect.objectContaining({ level: 40, route: `GET ${WHOAMI}`, outcome: 'refused', status: 401, code: 'unauthenticated', why: 'no-key', requestId: refused.headers.get('x-request-id') }),
      // A warning when the check itself refused it; an error when it failed.
      expect.objectContaining({ level: 50, keyId: h.operator.keys.read.key.id, scope: 'read', route: `POST ${FLAGS}`, outcome: 'failed', status: 500, code: 'unknown', requestId: failed.headers.get('x-request-id') })
    ]);
    expect(lines[1]?.['keyId']).toBeUndefined();
    // One a request, and nothing of the request but its route: no words, nonce, signature or header.
    for (const r of [allowed, refused, failed]) expect(lines.filter((l) => l['requestId'] === r.headers.get('x-request-id'))).toHaveLength(1);
    const said = h.logs.slice(from).join('\n');
    for (const secret of ['vandelay-canary-words', nonce, signature, 'Alcove-Operator']) expect(said).not.toContain(secret);
  });

  it('falls back to memory for reads when the database is down', async () => {
    const dead = createPool(`postgres://alcove:alcove@127.0.0.1:${await closedPort()}/alcove`, 2);
    const second = await h.secondServer({}, undefined, dead);
    try {
      const from = h.logs.length;
      const client = signedClient(second.baseUrl, h.operator.audience, h.operator.keys.write);
      const who = await client.get(WHOAMI);
      expect(who.status).toBe(200);
      expect(WhoamiAnswer.parse(await who.json()).keyId).toBe(h.operator.keys.write.key.id);
      // Checked against this instance's memory alone, which still refuses a nonce it has seen.
      const nonce = randomBytes(16).toString('base64url');
      expect((await client.raw({ method: 'GET', path: WHOAMI, nonce })).status).toBe(200);
      expect((await client.raw({ method: 'GET', path: WHOAMI, nonce })).status).toBe(401);
      // A change needs the database anyway: refused, and nothing changed.
      const change = await client.post(FLAGS, NO_CHANGE);
      expect(change.status).toBe(503);
      expect((await refusalOf(change)).code).toBe('unavailable');
      expect(auditSince(from).map((l) => [l['status'], l['nonceIn'] ?? null, l['why'] ?? null])).toEqual([
        [200, 'memory', null], [200, 'memory', null], [401, null, 'replayed'], [503, null, null]
      ]);
    } finally {
      await second.close();
      await dead.end();
    }
  });

  it('refuses every registered operator route unsigned', async () => {
    const routes = operatorRoutes();
    expect(routes).toEqual(expect.arrayContaining([{ method: 'GET', path: WHOAMI }, { method: 'POST', path: FLAGS }]));
    for (const route of routes) {
      const r = await unsigned(h.baseUrl, route);
      expect(r.status, `${route.method} ${route.path}`).toBe(401);
      expect((await refusalOf(r)).message).toBe(REFUSED);
    }
  });

  it('opens a key sealed with a passphrase in a terminal, and sends nothing for a key that doesn’t open', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alcove-operator-'));
    try {
      const path = join(home, '.config', 'alcove', 'operator-key.json');
      const passphrase = `vandelay-${randomBytes(6).toString('hex')}`;
      // keygen in a terminal: asked twice, and the key written sealed, with no seed in the file.
      const made = await runCli(home, ['keygen'], [passphrase, passphrase]);
      const keyId = /Key ID: ([A-Za-z0-9_-]{16})/.exec(made.out)?.[1] ?? '';
      const publicKey = /Public key: ([A-Za-z0-9_-]{43})/.exec(made.out)?.[1] ?? '';
      expect(keyId, made.out).toMatch(/^[A-Za-z0-9_-]{16}$/);
      const file = z.object({ keyId: z.literal(keyId), sealed: z.object({ ciphertext: z.string() }), seed: z.null() }).parse(JSON.parse(await readFile(path, 'utf8')));
      expect(file.sealed.ciphertext.length).toBeGreaterThan(0);
      const second = await h.secondServer({ operatorKeys: parseOperatorKeys(`read:${publicKey}`) });
      try {
        const api = ['--api', second.baseUrl, '--audience', h.operator.audience];
        const from = h.logs.length;
        // The right passphrase opens it, and whoami is signed with it.
        const opened = await runCli(home, ['whoami', ...api], [passphrase]);
        expect(opened.out).toMatch(new RegExp(`Key:\\s+${keyId}`));
        expect(auditSince(from).map((l) => [l['keyId'], l['status']])).toEqual([[keyId, 200]]);
        // Another doesn't, and nothing is sent.
        const wrong = await runCli(home, ['whoami', ...api], ['not-the-passphrase']);
        expect(wrong.out).toContain('That passphrase doesn');
        // Without a terminal to ask in, a sealed key isn't opened at all.
        const untyped = await runCli(home, ['whoami', ...api]);
        expect([untyped.code, untyped.err.includes('there’s no terminal to ask for it in')]).toEqual([1, true]);
        // A file that names a key other than the one it holds, a file that isn't one, and none at all: each said, nothing sent.
        const bare = makeKeyFile(null).file;
        const other = makeKeyFile(null).file;
        const named = join(home, 'named-wrong.json');
        await writeFile(named, JSON.stringify({ ...bare, keyId: other.keyId, publicKey: other.publicKey }));
        const notJson = join(home, 'not-json.json');
        await writeFile(notJson, 'vandelay industries');
        for (const [key, said] of [[named, 'doesn’t hold the key it names'], [notJson, 'isn’t an operator key file'], [join(home, 'none.json'), 'There’s no operator key at']] as const) {
          const r = await runCli(home, ['whoami', ...api, '--key', key]);
          expect([r.code, r.err.includes(said)], `${key}: ${r.err}`).toEqual([1, true]);
        }
        expect(auditSince(from)).toHaveLength(1);
        // The passphrase went nowhere: not in anything the CLI said, nor in any log line.
        for (const text of [made.out, opened.out, wrong.out, untyped.err, h.logs.slice(from).join('\n')]) expect(text).not.toContain(passphrase);
      } finally { await second.close(); }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 90_000);

  it('shows whatever a server says without the terminal acting on it, as text and as JSON', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alcove-operator-'));
    // A server that isn't Alcove's, or a proxy in front of it: escape sequences (clear the screen, set the clipboard, retitle,
    // one-byte CSI) and a line break to forge a line, wherever an answer has text.
    const evil = 'a\u001b[2J\u001b]52;c;ZXZpbA==\u0007\u009b31m\u202e\nForged: line';
    const standIn = createHttpServer((req, res) => {
      const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', 'x-request-id': 'StandInRequest0001' }); res.end(JSON.stringify(body)); };
      if (req.url === '/v1/operator/whoami') send(200, { keyId: evil, scope: 'read', instance: evil, at: evil });
      else send(403, { code: 'forbidden', message: evil, requestId: 'StandInRequest0001', issues: [evil] });
    });
    await new Promise<void>((resolve) => standIn.listen(0, '127.0.0.1', resolve));
    const at = standIn.address();
    const api = ['--api', `http://127.0.0.1:${typeof at === 'object' && at ? at.port : 0}`];
    try {
      expect((await runCli(home, ['keygen', '--no-passphrase'])).code).toBe(0);
      const text = await runCli(home, ['whoami', ...api]);
      const refused = await runCli(home, ['feature-flags', 'list', ...api]);
      const json = await runCli(home, ['whoami', '--json', ...api]);
      expect([text.code, refused.code, json.code]).toEqual([0, 1, 0]);
      for (const said of [text.out, text.err, refused.out, refused.err, json.out]) {
        for (const c of ['\u001b', '\u0007', '\u009b', '\u202e']) expect(said).not.toContain(c);
        expect(said).not.toMatch(/^Forged: line/m);
      }
      // Shown, with what it would have done replaced; and as JSON, every one of them escaped, the server's words otherwise as sent.
      expect(text.out).toMatch(/^Key: +a\uFFFD\[2J\uFFFD\]52;c;ZXZpbA==\uFFFD\uFFFD31m\uFFFD\uFFFDForged: line$/m);
      expect(refused.err).toContain('a\uFFFD[2J');
      expect(z.object({ keyId: z.string() }).parse(JSON.parse(json.out)).keyId).toBe(evil);
      expect(json.out).toContain('\\u009b31m\\u202e\\nForged');
    } finally {
      await new Promise<void>((resolve) => standIn.close(() => resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it('runs the CLI end to end', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alcove-operator-'));
    const outputs: string[] = [];
    /** The CLI as an operator runs it: no .env, nothing in its environment but a PATH and a home, and no terminal. */
    const cli = (args: string[], preload: string[] = []) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const run = spawn(process.execPath, [...preload, '--import', 'tsx', 'src/operator-cli.ts', ...args], { env: { PATH: process.env['PATH'] ?? '', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      run.stdout.on('data', (b: Buffer) => { out += b.toString(); });
      run.stderr.on('data', (b: Buffer) => { err += b.toString(); });
      run.on('error', reject);
      run.on('close', (code) => { outputs.push(out, err); resolve({ code, out, err }); });
    });
    try {
      const path = join(home, '.config', 'alcove', 'operator-key.json');
      // Without a terminal to ask for a passphrase in, it makes no key.
      const asked = await cli(['keygen']);
      expect(asked.code).toBe(1);
      expect(asked.err).toContain('no terminal');
      await expect(stat(path)).rejects.toThrow();

      const made = await cli(['keygen', '--no-passphrase']);
      expect(made.code).toBe(0);
      const said = made.out.trim().split('\n');
      expect(said).toHaveLength(3);
      const keyId = /^Key ID: ([A-Za-z0-9_-]{16})$/.exec(said[0] ?? '')?.[1] ?? '';
      const publicKey = /^Public key: ([A-Za-z0-9_-]{43})$/.exec(said[1] ?? '')?.[1] ?? '';
      expect(said[2]).toBe(`For env.sh: read:${publicKey}  (or write:${publicKey})`);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect((await stat(dirname(path))).mode & 0o777).toBe(0o700);
      const stored = await readFile(path, 'utf8');
      const { seed } = z.object({ keyId: z.literal(keyId), publicKey: z.literal(publicKey), sealed: z.null(), seed: z.string().length(43) }).parse(JSON.parse(stored));
      // It never writes over a key.
      const twice = await cli(['keygen', '--no-passphrase']);
      expect(twice.code).toBe(1);
      expect(twice.err).toContain('already');
      expect(await readFile(path, 'utf8')).toBe(stored);

      // The line it said is what a server lists, under the ID it said.
      const listed = parseOperatorKeys(`read:${publicKey}`);
      expect(listed.map((k) => k.id)).toEqual([keyId]);
      const second = await h.secondServer({ operatorKeys: listed });
      try {
        const api = ['--api', second.baseUrl, '--audience', h.operator.audience];
        const who = await cli(['whoami', ...api]);
        expect(who.code).toBe(0);
        expect(who.out).toMatch(new RegExp(`^Key:\\s+${keyId}$`, 'm'));
        expect(who.out).toMatch(/^Scope:\s+read$/m);
        expect(who.err).toMatch(/^Request [A-Za-z0-9_-]{8,64} on \S+$/m);
        const json = await cli(['whoami', '--json', ...api]);
        expect(json.code).toBe(0);
        expect(WhoamiAnswer.parse(JSON.parse(json.out))).toEqual(expect.objectContaining({ keyId, scope: 'read' }));

        const flags = await cli(['feature-flags', 'list', ...api]);
        expect(flags.code).toBe(0);
        expect(flags.out).toContain('call.bandwidth_reduction: ');
        // A change with a read key: the server's refusal, said with the request's ID, and exit 1.
        const refused = await cli(['feature-flags', 'everyone', 'call.bandwidth_reduction', 'on', '--reason', 'SUP-1182', ...api]);
        expect(refused.code).toBe(1);
        expect(refused.err).toContain('That key only reads');
        expect(refused.err).toMatch(/^Request [A-Za-z0-9_-]{8,64}/m);
        // Its clock two minutes fast: refused, and it says the clock is why.
        const fast = await cli(['whoami', ...api], ['--import', 'data:text/javascript,const now=Date.now;Date.now=()=>now()+120000;']);
        expect(fast.code).toBe(1);
        expect(fast.err).toContain(REFUSED);
        expect(fast.err).toMatch(/Your clock is 1(19|20|21) s off the server's\./);
      } finally { await second.close(); }

      // Words that aren't a command.
      const unknown = await cli(['frobnicate']);
      expect(unknown.code).toBe(2);
      expect(unknown.err).toContain('usage: operator');
      // Its private key went nowhere: not in anything it said, nor in any log line.
      await pause(50);
      for (const text of [...outputs, h.logs.join('\n')]) expect(text).not.toContain(seed);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
