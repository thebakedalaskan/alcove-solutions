/*
 * Operators' diagnostics (features/operator/diagnostics.ts), read by signed requests as the CLI reads them: which release is
 * serving and how it started, from a server started as production starts one (start.ts); what failed, by route and by
 * line, from the app's own refusals and the notes writer's failures, and one request's lines, each by the route it matched
 * and never the path it sent; the background loops, the queues and the notes finished without a summary; all of it but what
 * needs the database with the database out of reach or holding every connection open; no line a browser sends reaching any
 * of it, nor more than one client's share of what refused requests say; and the CLI printing each. No answer holds a
 * secret, an address, a token or anything a terminal would act on.
 */
import { REQUEST_ID_HEADER, type TranscriptClip } from '@alcove/api';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { b64u } from '../../keys/crypto';
import { createPool } from '../../platform/db';
import { maintain } from '../../maintenance';
import { parseOperatorKeys } from '../../keys/operator-keys';
import { ChecksAnswer } from './checks';
import { ErrorsAnswer, ReleaseAnswer, RequestAnswer, WorkAnswer } from './wire';
import { OUTSIDE, startServer, type Running } from '../../start';
import { speechWav } from '../../testing/fakes/near';
import { startHarness, type Harness } from '../../testing/harness';
import { signedClient, type SignedClient } from '../../testing/operator';

let h: Harness;
/** A server started as production starts one, so it has start steps to show. */
let started: Running;
let operator: SignedClient;
const API = 'https://api.vandelay.test';

beforeAll(async () => {
  h = await startHarness();
  const cfg = h.deps.cfg;
  started = await startServer({
    TEE: 'none', DATABASE_URL: cfg.DATABASE_URL, OBJECTS_ENDPOINT: cfg.OBJECTS_ENDPOINT, OBJECTS_BUCKET: cfg.OBJECTS_BUCKET,
    OBJECTS_ACCESS_KEY: cfg.OBJECTS_ACCESS_KEY, OBJECTS_SECRET_KEY: cfg.OBJECTS_SECRET_KEY, KMASTER: cfg.KMASTER, KSERVICE: cfg.KSERVICE,
    LIVEKIT_URL: cfg.LIVEKIT_URL, LIVEKIT_API_KEY: cfg.LIVEKIT_API_KEY, LIVEKIT_API_SECRET: cfg.LIVEKIT_API_SECRET,
    WEB_ORIGIN: 'https://localhost:3000', API_URL: API, API_PORT: '0', API_HOST: '127.0.0.1', DEMO_AUTH_ENABLED: 'false',
    LIMITS_CACHE_MS: '0', FEATURE_FLAGS_CACHE_MS: '0', DOC_WORKERS: '1',
    OPERATOR_KEYS: [h.operator.keys.read, h.operator.keys.write].map((k) => `${k.key.scope}:${b64u(k.key.publicKey)}`).join(',')
  }, OUTSIDE);
  const port = 'api' in started.ports ? started.ports.api : 0;
  operator = signedClient(`http://127.0.0.1:${port}`, new URL(API).origin, h.operator.keys.read);
});
afterAll(async () => {
  h?.closeCalls();
  await started?.close();
  await h?.close();
});

const LogLine = z.object({ msg: z.string() }).passthrough();
const logsSince = (from: number) => h.logs.slice(from).flatMap((l) => { const r = LogLine.safeParse(JSON.parse(l)); return r.success ? [r.data] : []; });
/** Another service's status, as a logged line's error names it (inference.ts: upstreamStatus), or null. */
const UpstreamOf = z.object({ err: z.object({ context: z.object({ upstreamStatus: z.number() }) }) });
const upstreamOf = (line: unknown): number | null => { const r = UpstreamOf.safeParse(line); return r.success ? r.data.err.context.upstreamStatus : null; };
const speech = (words: string): TranscriptClip => ({ data: new Blob([speechWav(words, 4000, 'en')], { type: 'audio/wav' }), segment: 0, at: 0, durationMs: 4000 });
let seq = 0;
/** A fresh account, signed in through the API: single sign-on signs in whoever's work email is typed. */
async function account() {
  const b = h.browser();
  const r = await b.api.auth.signIn('sso', { email: `vandelay.${Date.now().toString(36)}${(seq++).toString(36)}@tests.example` });
  return { ...b, ownerId: r.session.ownerId };
}
async function until(ok: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`Timed out waiting for ${what}`);
}
const Job = z.object({ state: z.string(), attempt: z.number() });
const jobOf = async (ownerId: string) => z.array(Job).parse((await h.pool.query('SELECT state, attempt FROM content_jobs WHERE owner_id = $1', [ownerId])).rows)[0];
/** A port nothing listens on: a database there refuses every connection. */
const closedPort = () => new Promise<number>((resolve) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const at = s.address(); s.close(() => resolve(typeof at === 'object' && at ? at.port : 9)); });
});
const json = async (r: Response): Promise<unknown> => { const parsed: unknown = JSON.parse(await r.text()); return parsed; };
/** What a terminal would act on: the escape and bell that start and end its sequences, and the one-byte CSI. */
const ESCAPES = ['\u001b', '\u0007', '\u009b'];
/** A request from `address`, with no session, as anyone on the internet can send one. */
const anonymous = (path: string, address: string) => fetch(`${h.baseUrl}${path}`, { headers: { 'x-forwarded-for': address } });
/** A database that takes every connection and never answers on it, as the Cloud SQL Auth Proxy held new VMs' (2026-11-13). */
async function holdingDatabase() {
  const held = new Set<Socket>();
  const server = createServer((s) => { held.add(s); s.on('close', () => held.delete(s)); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const at = server.address();
  return {
    url: `postgres://alcove:alcove@127.0.0.1:${typeof at === 'object' && at ? at.port : 0}/alcove`,
    close: () => new Promise<void>((resolve) => { for (const s of held) s.destroy(); server.close(() => resolve()); })
  };
}

describe('operator diagnostics', () => {
  it('says which release is serving, how its start went, and never a secret’s value', async () => {
    const r = await operator.get('/v1/operator/release');
    expect(r.status).toBe(200);
    const text = await r.text();
    const a = ReleaseAnswer.parse(JSON.parse(text));
    expect(a.instance).toBe(r.headers.get('x-alcove-instance'));
    expect(a.build).toEqual({ commit: 'dev', imageDigest: null, rekorLogIndex: null });
    // Every start step, each ok, and said as it happened.
    expect(a.boot.map((s) => [s.step, s.ok, s.code])).toEqual([
      ['config', true, null], ['database', true, null], ['migrations', true, null], ['keys', true, null], ['objects', true, null], ['listening', true, null]
    ]);
    expect(logsSince(0).filter((l) => l.msg === 'boot step').map((l) => l['step'])).toEqual(expect.arrayContaining(['config', 'database', 'migrations', 'keys', 'objects', 'listening']));
    expect(Date.parse(a.running.startedAt)).toBeLessThanOrEqual(Date.now());
    // The database has every migration the image has, and none it doesn't.
    const inImage = readdirSync(new URL('../../../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
    expect(a.migrations).toEqual({
      ok: true, applied: { count: inImage.length, newest: inImage.at(-1) }, inImage: { count: inImage.length, newest: inImage.at(-1) }, notApplied: [], unknown: [], changed: [], refused: null
    });
    // Public settings by their values; every other one only as set or not set.
    expect(a.settings.values).toMatchObject({ TEE: 'none', API_URL: API, WEB_ORIGIN: 'https://localhost:3000', DEMO_AUTH_ENABLED: false, LIMITS_CACHE_MS: 0, TLS_HOSTS: null });
    expect(a.settings.others).toMatchObject({
      KMASTER: 'set', KSERVICE: 'set', INDEX_KEY: 'set', DATABASE_URL: 'set', OBJECTS_SECRET_KEY: 'set', LIVEKIT_API_SECRET: 'set', OPERATOR_KEYS: 'set',
      NEAR_AI_API_KEY: 'not set', GOOGLE_CLIENT_SECRET: 'not set', CLOUDFLARE_API_TOKEN: 'not set', TREASURY_INTENTS_ACCOUNT: 'not set'
    });
    expect(a.settings.operatorKeys).toEqual([{ keyId: h.operator.keys.read.key.id, scope: 'read' }, { keyId: h.operator.keys.write.key.id, scope: 'write' }]);
    // Outside a TEE, and behind someone else's TLS: no token, no certificate, and no clock measured against Google's.
    expect([a.attestation, a.certificate, a.clock]).toEqual([null, null, null]);
    const cfg = started.deps.cfg;
    for (const secret of [cfg.KMASTER, cfg.KSERVICE, cfg.INDEX_KEY, cfg.PHOTO_KEY, cfg.DATABASE_URL, cfg.OBJECTS_SECRET_KEY, cfg.LIVEKIT_API_SECRET]) expect(text).not.toContain(secret);
  });

  it('counts what failed by route and by line, and gives one request’s lines', async () => {
    const b = await account();
    // A 404: a note that isn't there.
    const noNote = `Missing0${randomBytes(16).toString('base64url')}`.slice(0, 22);
    const missing = await b.fetch(`${h.baseUrl}/v1/notes/${noNote}`);
    expect(missing.status).toBe(404);
    const missingId = missing.headers.get(REQUEST_ID_HEADER) ?? '';
    // A note whose notes model won't answer, then a 409: pausing its recording once it's stopped.
    h.near.failNext(1, 'down', 'notes');
    const rec = await b.api.recordings.start({ title: 'Latex samples for Vandelay Industries' });
    await rec.transcribe(speech('We agreed to send the latex samples on Monday.'));
    const recordingId = rec.getSnapshot().id;
    const { pendingNoteId } = await rec.stop();
    const late = await b.fetch(`${h.baseUrl}/v1/recordings/${recordingId}/actions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'pause' }) });
    expect(late.status).toBe(409);
    const lateId = late.headers.get(REQUEST_ID_HEADER) ?? '';
    // NEAR AI didn't answer, so the note waits: nothing about it was wrong.
    await until(async () => (await jobOf(b.ownerId))?.state === 'waiting', 'the notes to wait for the notes model');

    const errors = ErrorsAnswer.parse(await json(await operator.get('/v1/operator/errors?minutes=5')));
    expect(errors.minutes).toBe(5);
    expect(errors.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: 'GET /v1/notes/:id', status: 404, code: 'not-found', count: 1, requestId: missingId }),
      expect.objectContaining({ route: 'POST /v1/recordings/:id/actions', status: 409, code: 'conflict', count: 1, requestId: lateId })
    ]));
    const waiting = errors.groups.find((g) => g.component === 'writer' && g.msg === 'notes waiting for the notes model to answer');
    expect(waiting).toEqual(expect.objectContaining({ code: 'unavailable', count: 1 }));
    // What NEAR AI answered, as the log line's error names it: the ring holds what the log holds, and no more.
    const logged = logsSince(0).find((l) => l.msg === 'notes waiting for the notes model to answer' && l['noteId'] === pendingNoteId);
    expect(logged).toBeDefined();
    expect(waiting?.upstreamStatus).toBe(upstreamOf(logged));

    // One request: its line, with the route it matched, why it was refused and the IDs it was about.
    const one = RequestAnswer.parse(await json(await operator.get(`/v1/operator/requests/${lateId}`)));
    expect(one.lines).toEqual([expect.objectContaining({
      level: 'info', component: 'http', msg: 'request refused', route: 'POST /v1/recordings/:id/actions', status: 409,
      errorClass: 'ConflictError', code: 'conflict', ids: { ownerId: b.ownerId, recordingId }
    })]);
    // A request this instance holds nothing of, and something that isn't a request's ID.
    const unknown = await operator.get('/v1/operator/requests/NoSuchRequestHere0000');
    expect(unknown.status).toBe(404);
    expect((await operator.get('/v1/operator/requests/x')).status).toBe(400);
    expect((await operator.get('/v1/operator/errors?minutes=241')).status).toBe(400);
  });

  it('shows background work: each loop’s runs, the queues, and notes finished without a summary', async () => {
    const { api, ownerId } = await account();
    const retryNow = async () => {
      await h.pool.query(`UPDATE content_jobs SET lease_until = now() - interval '1 second' WHERE owner_id = $1`, [ownerId]);
      await maintain(h.deps);
    };
    // The notes model never answers usably: after three attempts the note is finished without a summary.
    h.near.failNext(3, 'prose', 'notes');
    const rec = await api.recordings.start({ title: 'The Penske file' });
    await rec.transcribe(speech('Nobody will read this summary.'));
    const { pendingNoteId } = await rec.stop();
    await until(async () => { const j = await jobOf(ownerId); return j?.state === 'queued' && j.attempt === 1; }, 'the first attempt to fail');
    await retryNow();
    await retryNow();
    expect(await jobOf(ownerId)).toBeUndefined();
    // A call going on.
    const call = await api.calls.join((await api.calls.startNow()).code, { mic: true, cam: false });

    const w = WorkAnswer.parse(await json(await operator.get('/v1/operator/work')));
    const loop = (name: string) => w.loops.find((l) => l.name === name);
    expect(loop('upkeep')).toEqual(expect.objectContaining({ lastOk: true, lastCode: null, lastOkAt: expect.any(String) }));
    expect(loop('upkeep')?.lastCounts).toEqual(expect.objectContaining({ sessions: expect.any(Number), notes: expect.any(Number) }));
    for (const step of ['sessions', 'object deletes', 'notes', 'drive exports', 'plans', 'operator nonces']) expect(loop(`upkeep:${step}`)?.lastOk, step).toBe(true);
    // The writer: a run each time it worked, and each failed attempt by its code.
    expect(loop('notes-writer')).toEqual(expect.objectContaining({ lastOk: true, lastCounts: { jobs: expect.any(Number) } }));
    expect(loop('notes-writer')?.failures['UnavailableError']).toBeGreaterThanOrEqual(3);
    // The queues, counted as the database has them.
    const counts = z.object({ queued: z.number(), writing: z.number(), waiting: z.number() })
      .parse((await h.pool.query(`SELECT count(*) FILTER (WHERE state = 'queued')::int AS queued, count(*) FILTER (WHERE state = 'writing')::int AS writing, count(*) FILTER (WHERE state = 'waiting')::int AS waiting FROM content_jobs`)).rows[0]);
    if (!w.queues.ok) throw new Error(`The queues weren’t counted: ${w.queues.code}`);
    expect(w.queues.notes).toEqual(expect.objectContaining(counts));
    expect(w.queues.calls).toEqual(expect.objectContaining({ noRoom: 0, roomGone: 0, livekit: null }));
    expect(w.queues.calls.live).toBeGreaterThanOrEqual(1);
    expect(w.queues.objectDeletes).toEqual(expect.objectContaining({ queued: expect.any(Number), failing: expect.any(Number) }));
    // The note finished without a summary, by its ID, with its error's class and code.
    expect(w.finals).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'notes-without-summary', noteId: pendingNoteId, errorClass: 'UnavailableError', code: 'unavailable', jobId: expect.any(String) })
    ]));
    await call.leave();
  });

  it('answers release, work, errors and requests with the database out of reach', async () => {
    const dead = createPool(`postgres://alcove@127.0.0.1:${await closedPort()}/alcove`, 2);
    const second = await h.secondServer({}, undefined, dead);
    try {
      // A request this process refused just now, for the second instance to find: the ring is the process's own.
      const refused = await fetch(`${h.baseUrl}/v1/operator/whoami`);
      expect(refused.status).toBe(401);
      const there = signedClient(second.baseUrl, h.operator.audience, h.operator.keys.read);
      const release = await there.get('/v1/operator/release');
      expect(release.status).toBe(200);
      expect(ReleaseAnswer.parse(await json(release)).migrations).toEqual({ ok: false, code: expect.stringMatching(/\S/) });
      const work = await there.get('/v1/operator/work');
      expect(work.status).toBe(200);
      const w = WorkAnswer.parse(await json(work));
      expect(w.queues).toEqual({ ok: false, code: expect.stringMatching(/\S/) });
      expect(w.loops.length).toBeGreaterThan(0);
      expect((await there.get('/v1/operator/errors?minutes=1')).status).toBe(200);
      const one = await there.get(`/v1/operator/requests/${refused.headers.get(REQUEST_ID_HEADER) ?? ''}`);
      expect(one.status).toBe(200);
      // Its own line, saying why it was refused: its audit line is in the log alone, since anyone can send one.
      expect(RequestAnswer.parse(await json(one)).lines).toEqual([
        expect.objectContaining({ component: 'http', msg: 'request refused', status: 401, code: 'unauthenticated', errorClass: 'AuthError', route: 'GET /v1/operator/whoami' })
      ]);
    } finally {
      await second.close();
      await dead.end();
    }
  });

  it('answers release, work and checks while the database holds every connection open', async () => {
    const database = await holdingDatabase();
    const held = createPool(database.url, 4);
    const second = await h.secondServer({}, undefined, held);
    try {
      const from = h.logs.length;
      const there = signedClient(second.baseUrl, h.operator.audience, h.operator.keys.read);
      // Each waits out the pool's ten seconds for a connection to check its nonce, then reads on, checked in memory.
      const [release, work, checks] = await Promise.all(['/v1/operator/release', '/v1/operator/work', '/v1/operator/checks'].map((path) => there.get(path)));
      expect([release?.status, work?.status, checks?.status]).toEqual([200, 200, 200]);
      if (!release || !work || !checks) throw new Error('An answer is missing.');
      expect(ReleaseAnswer.parse(await json(release)).migrations).toEqual({ ok: false, code: 'timeout' });
      const w = WorkAnswer.parse(await json(work));
      expect(w.queues).toEqual({ ok: false, code: expect.stringMatching(/\S/) });
      expect(w.loops.length).toBeGreaterThan(0);
      const db = ChecksAnswer.parse(await json(checks)).checks.find((c) => c.name === 'database');
      expect(db).toMatchObject({ ok: false, code: expect.stringMatching(/\S/) });
      expect(logsSince(from).filter((l) => l.msg === 'operator call').map((l) => l['nonceIn'])).toEqual(['memory', 'memory', 'memory']);
    } finally {
      await second.close();
      // Its connections given up on first, so the pool has none left to wait for.
      await database.close();
      await held.end();
    }
  }, 60_000);

  it('keeps the route a request matched, never the path it sent: no token and nothing a terminal would act on', async () => {
    const from = h.logs.length;
    // Someone's sign-in photo, by its token, asked for once their session has ended: refused, as photos routinely are.
    const token = `Ph${randomBytes(132).toString('base64url')}`;
    const photo = await anonymous(`/v1/photos/${token}`, '10.66.0.1');
    expect(photo.status).toBe(401);
    // Escape sequences in a path: one that matches a route, and one that matches none (outside /v1, where signing in comes first).
    const escaped = await anonymous('/v1/notes/%1B%5B2J%1B%5D52%3Bc%3BZXZpbA%3D%3D%07', '10.66.0.1');
    expect(escaped.status).toBe(401);
    const nowhere = await anonymous('/%1B%5D0%3Bvandelay%07nowhere', '10.66.0.1');
    expect(nowhere.status).toBe(404);
    const photoLines = RequestAnswer.parse(await json(await operator.get(`/v1/operator/requests/${photo.headers.get(REQUEST_ID_HEADER) ?? ''}`)));
    expect(photoLines.lines).toEqual([expect.objectContaining({ msg: 'request refused', route: 'GET /v1/photos/:token', status: 401, code: 'unauthenticated' })]);
    const escapedLines = RequestAnswer.parse(await json(await operator.get(`/v1/operator/requests/${escaped.headers.get(REQUEST_ID_HEADER) ?? ''}`)));
    expect(escapedLines.lines).toEqual([expect.objectContaining({ route: 'GET /v1/notes/:id', status: 401 })]);
    // A request for no route isn't kept, only counted.
    expect((await operator.get(`/v1/operator/requests/${nowhere.headers.get(REQUEST_ID_HEADER) ?? ''}`)).status).toBe(404);
    const errors = await (await operator.get('/v1/operator/errors?minutes=5')).text();
    expect(ErrorsAnswer.parse(JSON.parse(errors)).notKept.unrouted).toBeGreaterThanOrEqual(1);
    for (const text of [errors, JSON.stringify(photoLines), JSON.stringify(escapedLines)]) {
      expect(text).not.toContain(token.slice(0, 40));
      for (const c of ESCAPES) expect(text).not.toContain(c);
      expect(text).not.toContain('\\u001b');
    }
    // Nor does the log say the token: the access line says the route's shape there too.
    const said = h.logs.slice(from).join('\n');
    expect(said).not.toContain(token.slice(0, 40));
    expect(said).toContain('/v1/photos/:token');
  });

  it('keeps no more than one client’s share of what its requests say, and what others say still', async () => {
    // One address asks 130 times in a minute, with no session: the ring keeps 120 of its lines and counts the rest.
    const meeting = () => `/v1/meetings/Vandelay${randomBytes(12).toString('base64url')}`.slice(0, '/v1/meetings/'.length + 22);
    for (let i = 0; i < 130; i++) expect((await anonymous(meeting(), '10.77.0.1')).status).toBe(401);
    // Another client's refusal of the same kind is kept all the same.
    const other = await anonymous(meeting(), '10.77.0.2');
    expect(other.status).toBe(401);
    const a = ErrorsAnswer.parse(await json(await operator.get('/v1/operator/errors?minutes=5')));
    expect(a.requests.find((g) => g.route === 'GET /v1/meetings/:id' && g.status === 401)).toEqual(expect.objectContaining({ count: 121, code: 'unauthenticated' }));
    expect(a.notKept.overShare).toBeGreaterThanOrEqual(10);
    expect((await operator.get(`/v1/operator/requests/${other.headers.get(REQUEST_ID_HEADER) ?? ''}`)).status).toBe(200);
  });

  it('keeps every line a browser sends out of what operators read', async () => {
    const from = h.logs.length;
    const noteId = 'BrowserNote00000000000';
    const requestId = 'BrowserRequest00000000';
    const at = new Date().toISOString();
    // Lines that say they're the writer's, the server's, a request's: whatever the browser chooses.
    const sent = await h.browser().fetch(`${h.baseUrl}/v1/telemetry`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: [
        { level: 'error', msg: 'notes could not be written after three attempts; finishing the note without a summary', at,
          context: { component: 'writer', source: 'server', noteId, jobId: noteId, requestId, status: 500, errorClass: 'InternalError', code: 'unknown' } },
        { level: 'error', msg: 'kramer@vandelay.test was refused', at, context: { component: 'http', source: 'server', requestId, status: 503, upstreamStatus: 502 } }
      ] })
    });
    expect(sent.status).toBe(200);
    // The log keeps them, as it always has.
    expect(h.logs.slice(from).join('\n')).toContain(noteId);
    // What operators read doesn't.
    expect((await operator.get(`/v1/operator/requests/${requestId}`)).status).toBe(404);
    const errors = await (await operator.get('/v1/operator/errors?minutes=1')).text();
    const work = await (await operator.get('/v1/operator/work')).text();
    for (const text of [errors, work]) for (const planted of [noteId, requestId, 'vandelay.test', '[email]']) expect(text).not.toContain(planted);
    expect(ErrorsAnswer.parse(JSON.parse(errors)).groups.filter((g) => g.code === 'unknown' && g.component === 'writer')).toEqual([]);
  });

  it('prints each diagnostic from the CLI', async () => {
    const home = await mkdtemp(join(tmpdir(), 'alcove-operator-'));
    const cli = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
      const run = spawn(process.execPath, ['--import', 'tsx', 'src/operator-cli.ts', ...args], { env: { PATH: process.env['PATH'] ?? '', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      run.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
      run.stderr.on('data', (chunk: Buffer) => { err += chunk.toString(); });
      run.on('error', reject);
      run.on('close', (code) => resolve({ code, out, err }));
    });
    try {
      const made = await cli(['keygen', '--no-passphrase']);
      expect(made.code).toBe(0);
      const publicKey = /^Public key: ([A-Za-z0-9_-]{43})$/m.exec(made.out)?.[1] ?? '';
      const second = await h.secondServer({ operatorKeys: parseOperatorKeys(`read:${publicKey}`) });
      try {
        const api = ['--api', second.baseUrl, '--audience', h.operator.audience];
        const missing = await (await account()).fetch(`${h.baseUrl}/v1/notes/Missing000000000000000`);
        expect(missing.status).toBe(404);
        const missingId = missing.headers.get(REQUEST_ID_HEADER) ?? '';

        const release = await cli(['release', ...api]);
        expect(release.code).toBe(0);
        expect(release.out).toMatch(/^Commit:\s+dev$/m);
        expect(release.out).toMatch(/^Not applied:\s+none$/m);
        expect(release.out).toMatch(/^Set:\s+.*\bKMASTER\b/m);
        expect(release.out).not.toContain(h.deps.cfg.KMASTER);
        expect(release.err).toMatch(/^Request [A-Za-z0-9_-]{8,64} on \S+$/m);

        const work = await cli(['work', ...api]);
        expect(work.code).toBe(0);
        expect(work.out).toMatch(/^Loop upkeep:\s+last ended /m);
        expect(work.out).toMatch(/^Notes:\s+\d+ queued, \d+ writing, \d+ waiting;/m);

        const errors = await cli(['errors', '--minutes', '5', ...api]);
        expect(errors.code).toBe(0);
        expect(errors.out).toMatch(/lines in the last 5 minutes/);
        expect(errors.out).toMatch(/GET \/v1\/notes\/:id {2}404 not-found/);

        const request = await cli(['request', missingId, ...api]);
        expect(request.code).toBe(0);
        expect(request.out).toContain(`Request ${missingId}`);
        expect(request.out).toMatch(/request refused {2}GET \/v1\/notes\/:id {2}status 404 {2}NotFoundError {2}not-found/);

        // Words that aren't a command: refused before anything is sent.
        const wrong = await cli(['errors', '--minutes', '999', ...api]);
        expect(wrong.code).toBe(2);
        expect(wrong.err).toContain('usage: operator errors');
      } finally {
        await second.close();
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
