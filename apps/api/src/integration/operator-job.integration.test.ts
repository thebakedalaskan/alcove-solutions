/*
 * The checks job (operator-job.ts), as the image runs it in the server's place when its environment says ALCOVE_JOB=checks:
 * a process of its own, here with the harness's database, bucket and LiveKit, its stand-ins for NEAR AI, 1Click and Google,
 * and TEE=none. It takes each start step on its own, carrying on past one that fails, then runs the live checks, one log
 * line each and then how it ended, and its exit code says whether everything passed. It never writes: a migration the
 * database hasn't had stays unapplied, and a bucket that isn't there isn't made. Nothing it says holds a secret.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { b64u } from '../keys/crypto';
import { openObjectStore } from '../platform/objects';
import { ORIGIN, startHarness, type Harness } from '../testing/harness';

vi.setConfig({ testTimeout: 120_000 });

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h?.close(); });

/** A start's steps outside a TEE and without TLS_HOSTS, but listening, and every live check, in the order they're said. */
const STEPS = ['config', 'database', 'migrations', 'keys', 'objects'];
const CHECKS = ['database', 'objects', 'livekit', 'near-ai:speech', 'near-ai:notes', 'oneclick', 'google'];

const Line = z.object({ msg: z.string() }).passthrough();
const Detail = z.record(z.string(), z.unknown());
const Step = z.object({ step: z.string(), ok: z.boolean(), ms: z.number(), errorClass: z.string().nullable(), code: z.string().nullable(), detail: Detail });
const Check = z.object({ check: z.string(), ok: z.boolean(), ms: z.number(), code: z.string().nullable(), detail: Detail });
const Done = z.object({ ok: z.boolean(), failed: z.number(), stopped: z.string().nullable() });
interface Ran { code: number | null; out: string; steps: z.infer<typeof Step>[]; checks: z.infer<typeof Check>[]; done: z.infer<typeof Done>[] }

/** The environment a VM gives the job: what the harness starts its server with, but for `more`. */
const env = (more: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env,
  TEE: 'none', DATABASE_URL: process.env['TEST_DATABASE_URL'], OBJECTS_BUCKET: h.deps.cfg.OBJECTS_BUCKET, WEB_ORIGIN: ORIGIN, API_URL: h.baseUrl,
  GOOGLE_ISSUER: h.google.issuer, GOOGLE_API_URL: h.google.issuer, GOOGLE_CLIENT_ID: h.google.clientId, GOOGLE_CLIENT_SECRET: h.google.clientSecret,
  ...h.near.settings, ...h.oneclick.settings, TLS_HOSTS: '', OPERATOR_KEYS: '', LOG_FORMAT: 'json', LOG_LEVEL: 'info', ...more
});

/** A line of what the job wrote, as its log's JSON, or null for one that isn't. */
function parsed(line: string): z.infer<typeof Line> | null {
  try {
    const r = Line.safeParse(JSON.parse(line));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Runs `operator-job.ts checks` as a process of its own: how it exited, all it wrote, and its log's lines. */
function job(e: NodeJS.ProcessEnv): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const run = spawn(process.execPath, ['--import', 'tsx', 'src/operator-job.ts', 'checks'], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    run.stdout.on('data', (b: Buffer) => { stdout += b.toString(); });
    run.stderr.on('data', (b: Buffer) => { stderr += b.toString(); });
    run.on('error', reject);
    run.on('close', (code) => {
      const lines = stdout.split('\n').flatMap((l) => parsed(l) ?? []);
      const said = (msg: string) => lines.filter((l) => l.msg === msg);
      try {
        resolve({
          code, out: stdout + stderr,
          steps: said('operator job step').map((l) => Step.parse(l)),
          checks: said('operator job check').map((l) => Check.parse(l)),
          done: said('operator job done').map((l) => Done.parse(l))
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/** A port nothing listens on: a database there refuses every connection. */
const closedPort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => {
    const at = s.address();
    s.close(() => resolve(typeof at === 'object' && at ? at.port : 9));
  });
});

describe('the checks job', () => {
  it('takes every start step and runs every check, compares the migrations without applying any, and passes', async () => {
    // The newest migration, as if the database hadn't had it yet: a start would apply it, and the job only says so.
    const Applied = z.object({ name: z.string(), checksum: z.string(), applied_at: z.date() });
    const newest = Applied.parse((await h.pool.query('SELECT name, checksum, applied_at FROM schema_migrations ORDER BY name DESC LIMIT 1')).rows[0]);
    await h.pool.query('DELETE FROM schema_migrations WHERE name = $1', [newest.name]);
    try {
      const r = await job(env());
      // Any failure, with its class and code, shows in the diff.
      expect(r.steps.filter((s) => !s.ok)).toEqual([]);
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.steps.map((s) => s.step)).toEqual(STEPS);
      expect(r.checks.map((c) => c.check)).toEqual(CHECKS);
      expect(r.done).toEqual([{ ok: true, failed: 0, stopped: null }]);
      expect(r.code).toBe(0);

      expect(r.steps.find((s) => s.step === 'config')?.detail).toEqual({ tee: 'none', commit: 'dev', tls: false });
      expect(r.steps.find((s) => s.step === 'migrations')?.detail).toEqual({ applied: expect.any(Number), inImage: expect.any(Number), notApplied: [newest.name], unknown: [], changed: [] });
      // Compared, never applied.
      expect((await h.pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [newest.name])).rowCount).toBe(0);
      // What the checks found, as operator checks says it.
      expect(r.checks.find((c) => c.check === 'oneclick')?.detail).toEqual({ offered: 9, allowed: 9, partnerKey: true, topUps: true });
      expect(r.checks.find((c) => c.check === 'google')?.detail).toMatchObject({ client: 'ok', step: null });

      // Nothing it said holds a secret it read.
      const cfg = h.deps.cfg;
      const secrets = [cfg.KMASTER, cfg.KSERVICE, cfg.INDEX_KEY, cfg.PHOTO_KEY, cfg.OBJECTS_SECRET_KEY, cfg.LIVEKIT_API_SECRET, h.near.settings.NEAR_AI_API_KEY,
        h.google.clientSecret, h.oneclick.settings.ONECLICK_API_KEY];
      for (const secret of secrets.filter((s) => s.length >= 16)) expect(r.out).not.toContain(secret);
    } finally {
      await h.pool.query('INSERT INTO schema_migrations (name, checksum, applied_at) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING', [newest.name, newest.checksum, newest.applied_at]);
    }
  });

  it('fails the migrations as a start would refuse them, when one changed after it was applied', async () => {
    const Applied = z.object({ name: z.string(), checksum: z.string() });
    const oldest = Applied.parse((await h.pool.query('SELECT name, checksum FROM schema_migrations ORDER BY name LIMIT 1')).rows[0]);
    await h.pool.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [oldest.name, 'changed-since']);
    try {
      const r = await job(env());
      expect(r.steps.filter((s) => !s.ok)).toEqual([
        { step: 'migrations', ok: false, ms: expect.any(Number), errorClass: null, code: 'changed', detail: expect.objectContaining({ notApplied: [], unknown: [], changed: [oldest.name] }) }
      ]);
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.done).toEqual([{ ok: false, failed: 1, stopped: null }]);
      expect(r.code).toBe(1);
    } finally {
      await h.pool.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [oldest.name, oldest.checksum]);
    }
  });

  it('fails the migrations as a start would refuse them, when the database applied one the image doesn’t have', async () => {
    // As after a rollback onto an older image: a later release's migration, applied.
    const later = '9999_from_a_later_release.sql';
    await h.pool.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [later, 'from-a-later-release']);
    try {
      const r = await job(env());
      expect(r.steps.filter((s) => !s.ok)).toEqual([
        { step: 'migrations', ok: false, ms: expect.any(Number), errorClass: null, code: 'removed', detail: expect.objectContaining({ notApplied: [], unknown: [later], changed: [] }) }
      ]);
      expect(r.done).toEqual([{ ok: false, failed: 1, stopped: null }]);
      expect(r.code).toBe(1);
    } finally {
      await h.pool.query('DELETE FROM schema_migrations WHERE name = $1', [later]);
    }
  });

  it('judges the stored certificate as a start would, and with none stored, says so', async () => {
    const r = await job(env({ TLS_HOSTS: 'alcove.test,api.alcove.test', CLOUDFLARE_ZONE: 'vandelay-zone', CLOUDFLARE_API_TOKEN: `token-${randomBytes(12).toString('hex')}` }));
    expect(r.steps.map((s) => [s.step, s.ok])).toEqual([...STEPS.map((s) => [s, true]), ['edge', false]]);
    expect(r.steps.find((s) => s.step === 'edge')).toMatchObject({ code: 'none-stored', detail: { stored: false } });
    expect(r.done).toEqual([{ ok: false, failed: 1, stopped: null }]);
    expect(r.code).toBe(1);
  });

  it('stops at the configuration when a setting can’t be read, as a start would, and takes no step after it', async () => {
    const key = b64u(h.operator.keys.read.key.publicKey);
    const r = await job(env({ OPERATOR_KEYS: `read:${key},read:${key}` }));
    expect(r.steps.map((s) => [s.step, s.ok, s.errorClass])).toEqual([['config', false, 'Error']]);
    expect(r.checks).toEqual([]);
    expect(r.done).toEqual([{ ok: false, failed: 1, stopped: 'config' }]);
    expect(r.code).toBe(1);
    // Which entry, never the key it holds.
    expect(r.out).not.toContain(key.slice(0, 42));
  });

  it('carries on past a database it can’t reach and a bucket that isn’t there, makes no bucket, and fails', async () => {
    const database = new URL(process.env['TEST_DATABASE_URL'] ?? '');
    database.hostname = '127.0.0.1';
    database.port = String(await closedPort());
    const missing = `${h.deps.cfg.OBJECTS_BUCKET}-missing-${randomBytes(4).toString('hex')}`;
    const r = await job(env({ DATABASE_URL: database.href, DATABASE_WAIT_MS: '0', OBJECTS_BUCKET: missing }));

    expect(r.steps.map((s) => [s.step, s.ok])).toEqual([['config', true], ['database', false], ['migrations', false], ['keys', false], ['objects', false]]);
    expect(r.steps.find((s) => s.step === 'database')).toMatchObject({ errorClass: 'UnavailableError', code: 'ECONNREFUSED' });
    expect(r.steps.find((s) => s.step === 'objects')).toMatchObject({ errorClass: 'ObjectStoreError' });
    // The checks still ran: the database's and the bucket's fail, and those that need neither pass.
    expect(r.checks.map((c) => c.check)).toEqual(CHECKS);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(['database', 'objects']);
    expect(r.done).toEqual([{ ok: false, failed: 6, stopped: null }]);
    expect(r.code).toBe(1);
    // Asked about, never made, as a start would have made it.
    await expect(openObjectStore({ ...h.deps.cfg, OBJECTS_BUCKET: missing }).ping()).rejects.toThrow();
  });
});
