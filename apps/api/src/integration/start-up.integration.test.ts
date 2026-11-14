/*
 * Starting the API as production does (start.ts) while its database isn't answering yet, as on 13 Nov when Cloud SQL's
 * proxy came up beside it: the first connection is tried again with backoff, each try said, and the start goes on once
 * the database answers; a database that never answers is refused once the window is over. Each start step is said as it
 * happens (`boot step`), and `operator release` shows the steps of the start that's serving. A list of operators' keys it
 * can't trust stops the start at its configuration, saying which entry and never what it holds.
 */
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { b64u } from '../keys/crypto';
import { ReleaseAnswer } from '../features/operator/wire';
import { OUTSIDE, startServer } from '../start';
import { startHarness, type Harness } from '../testing/harness';
import { signedClient } from '../testing/operator';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

const API = 'https://api.vandelay.test';
/** The environment a server starts with: the harness's own settings, its database reached at `databaseUrl`. */
const env = (databaseUrl: string): NodeJS.ProcessEnv => {
  const cfg = h.deps.cfg;
  return {
    TEE: 'none', DATABASE_URL: databaseUrl, OBJECTS_ENDPOINT: cfg.OBJECTS_ENDPOINT, OBJECTS_BUCKET: cfg.OBJECTS_BUCKET,
    OBJECTS_ACCESS_KEY: cfg.OBJECTS_ACCESS_KEY, OBJECTS_SECRET_KEY: cfg.OBJECTS_SECRET_KEY, KMASTER: cfg.KMASTER, KSERVICE: cfg.KSERVICE,
    LIVEKIT_URL: cfg.LIVEKIT_URL, LIVEKIT_API_KEY: cfg.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: cfg.LIVEKIT_API_SECRET,
    WEB_ORIGIN: 'https://localhost:3000', API_URL: API, API_PORT: '0', API_HOST: '127.0.0.1', DEMO_AUTH_ENABLED: 'false', DOC_WORKERS: '1',
    OPERATOR_KEYS: `read:${b64u(h.operator.keys.read.key.publicKey)}`
  };
};

/**
 * A TCP proxy in front of the test database: it closes the first `drop` connections as they come and passes the rest
 * through, or, with `hold`, takes every connection and never passes anything on. Returns the database's URL through it.
 */
async function proxy(o: { drop: number } | { hold: true }): Promise<{ url: string; connections: () => number; close(): Promise<void> }> {
  const target = new URL(process.env['TEST_DATABASE_URL'] ?? '');
  const open = new Set<Socket>();
  let seen = 0;
  const server: Server = createServer((client) => {
    open.add(client);
    client.on('close', () => open.delete(client));
    client.on('error', () => client.destroy());
    seen++;
    if ('hold' in o) return;
    if (seen <= o.drop) { client.destroy(); return; }
    const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
    open.add(upstream);
    upstream.on('close', () => { open.delete(upstream); client.destroy(); });
    upstream.on('error', () => upstream.destroy());
    client.on('close', () => upstream.destroy());
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const at = server.address();
  const port = typeof at === 'object' && at ? at.port : 0;
  const url = new URL(target);
  url.host = `127.0.0.1:${port}`;
  return {
    url: url.toString(),
    connections: () => seen,
    close: () => new Promise<void>((resolve) => { for (const s of open) s.destroy(); server.close(() => resolve()); })
  };
}

const LogLine = z.object({ msg: z.string() }).passthrough();
const linesSince = (from: number, msg: string) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success && r.data.msg === msg ? [r.data] : []; });

describe('starting while the database isn’t answering', () => {
  it('tries the first connection again, and starts once the database answers', async () => {
    const db = await proxy({ drop: 3 });
    const from = h.logs.length;
    try {
      const t0 = Date.now();
      const running = await startServer(env(db.url), OUTSIDE);
      try {
        // Three refused, then waits of 1, 2 and 4 seconds before the fourth answered.
        expect(Date.now() - t0).toBeGreaterThanOrEqual(7_000);
        expect(linesSince(from, 'database not reachable yet; trying again').map((l) => [l['attempt'], l['retryInMs']])).toEqual([[1, 1_000], [2, 2_000], [3, 4_000]]);
        expect(linesSince(from, 'boot step').map((l) => [l['step'], l['ok']])).toEqual([
          ['config', true], ['database', true], ['migrations', true], ['keys', true], ['objects', true], ['listening', true]
        ]);
        // And the start that's serving says so to operators, step by step.
        const port = 'api' in running.ports ? running.ports.api : 0;
        const r = await signedClient(`http://127.0.0.1:${port}`, new URL(API).origin, h.operator.keys.read).get('/v1/operator/release');
        expect(r.status).toBe(200);
        const boot = ReleaseAnswer.parse(await r.json()).boot;
        expect(boot.map((s) => [s.step, s.ok])).toEqual([
          ['config', true], ['database', true], ['migrations', true], ['keys', true], ['objects', true], ['listening', true]
        ]);
        expect(boot.find((s) => s.step === 'database')?.ms).toBeGreaterThanOrEqual(7_000);
      } finally {
        await running.close();
      }
    } finally {
      await db.close();
    }
  });

  it('refuses to start once the window is over, saying which step and why', async () => {
    const db = await proxy({ hold: true });
    const from = h.logs.length;
    try {
      const t0 = Date.now();
      await expect(startServer({ ...env(db.url), DATABASE_WAIT_MS: '3000' }, OUTSIDE)).rejects.toThrow('The database couldn’t be reached');
      // It gave up once the wait was over, not before: one try can take as long as a connection may wait.
      expect(Date.now() - t0).toBeGreaterThanOrEqual(3_000);
      expect(Date.now() - t0).toBeLessThan(30_000);
      expect(db.connections()).toBeGreaterThanOrEqual(1);
      const steps = linesSince(from, 'boot step');
      expect(steps.map((l) => [l['step'], l['ok']])).toEqual([['config', true], ['database', false]]);
      expect(steps[1]).toEqual(expect.objectContaining({ errorClass: 'UnavailableError' }));
    } finally {
      await db.close();
    }
  });
});

describe('starting with a list of operators’ keys it can’t trust', () => {
  it('refuses an entry it can’t read, a key anyone can sign for, or a key listed twice, by the entry’s place and never its key', async () => {
    const key = b64u(h.operator.keys.read.key.publicKey);
    const cases: [string, string][] = [
      [`admin:${key}`, 'OPERATOR_KEYS: entry 1 isn’t read:<public key> or write:<public key>'],
      [`read:${key.slice(0, 42)}`, 'OPERATOR_KEYS: entry 1 isn’t read:<public key> or write:<public key>'],
      // The identity point, which a placeholder of A's can be: the same forged signature verifies for every request.
      [`read:${key},write:AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, 'OPERATOR_KEYS: entry 2 is a key anyone can sign for'],
      [`read:${key},write:${key}`, 'OPERATOR_KEYS: entry 2 is the key entry 1 lists']
    ];
    for (const [list, said] of cases) {
      const from = h.logs.length;
      await expect(startServer({ ...env(h.deps.cfg.DATABASE_URL), OPERATOR_KEYS: list }, OUTSIDE), list).rejects.toThrow(said);
      expect(linesSince(from, 'boot step').map((l) => [l['step'], l['ok']]), list).toEqual([['config', false]]);
      expect(h.logs.slice(from).join('\n'), list).not.toContain(key.slice(0, 42));
    }
  });
});
