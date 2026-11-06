/*
 * Boots the real API against a clean test database and bucket, with a stand-in Google to sign in
 * through and a stand-in NEAR AI Cloud to transcribe and write notes (with stand-ins for the Intel and
 * NVIDIA services that vouch for it, under test roots), and gives tests "browsers":
 * each with its own cookie jar, sending the web app's Origin, talking through @alcove/api-http.
 */
import type { AlcoveApi, CallSession } from '@alcove/api';
import { createHttpApi, type ClientEvent } from '@alcove/api-http';
import { serve, type ServerType } from '@hono/node-server';
import { randomBytes } from 'node:crypto';
import { Server } from 'node:http';
import pg from 'pg';
import { createApp } from '../app';
import type { Deps } from '../context';
import { loadConfig, type Config } from '../config';
import { createPool } from '../db';
import { createDocPool } from '../live/docPool';
import { createHub } from '../live/hub';
import { createLiveKit } from '../livekit';
import { supervising } from '../features/calls/listening';
import { configureLogging } from '../log';
import { migrate } from '../migrate';
import { createObjectStore, type ObjectStore } from '../objects';
import { startFakeGoogle, type FakeGoogle } from './fake-google';
import { startFakeNear, type FakeNear } from './fake-near';

// An HTTPS web origin, so the API applies its production cookie rules (__Host- names, Secure) over the test transport.
export const ORIGIN = 'https://localhost:3000';

let clients = 0;
/**
 * A fetch with one cookie jar that sends the app's Origin, like a browser on the web app. Each jar
 * is also its own client address, as different people are, so per-client rate limits apply per test browser.
 */
export function cookieFetch(origin: string): typeof fetch {
  const jar = new Map<string, string>();
  const n = ++clients;
  const address = `10.1.${(n >> 8) & 255}.${n & 255}`;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (!headers.has('origin')) headers.set('origin', origin);
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', address);
    const res = await fetch(input, { ...init, headers });
    for (const s of res.headers.getSetCookie()) {
      const kv = s.split(';')[0] ?? '';
      const at = kv.indexOf('=');
      const name = kv.slice(0, at);
      const value = kv.slice(at + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(s) || !value) jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
}

export interface Browser { api: AlcoveApi; fetch: typeof fetch }
export interface Harness {
  baseUrl: string;
  pool: pg.Pool;
  objects: ObjectStore;
  deps: Deps;
  /** Every log line the API wrote (at debug level), raw JSON text, oldest first. */
  logs: string[];
  /** The Google the API signs in with. */
  google: FakeGoogle;
  /** The NEAR AI Cloud the API transcribes speech and writes notes with, and the stand-ins that vouch for it. */
  near: FakeNear;
  /** A fresh browser with its own cookie jar, or one around a fetch the test supplies. */
  browser(o?: { fetch?: typeof fetch | undefined; onEvent?: ((e: ClientEvent) => void) | undefined; callPollMs?: number | undefined; callNotesMs?: number | undefined; callRekeyMs?: number | undefined; ringSilenceMs?: number | undefined }): Browser;
  /** Stops every call session, workspace stream and document this harness's browsers opened from keeping up (nobody leaves). */
  closeCalls(): void;
  /**
   * Another API process on the same database and bucket, with its own hub, as after a restart, on a second instance, or
   * with other settings. `stopping`: says it's shutting down. `pool`: its own connections to the database. `hubUrl`: the
   * way its hub reaches Postgres, for a test to stand in the way.
   */
  secondServer(cfg?: Partial<Config>, stopping?: AbortSignal | undefined, pool?: pg.Pool | undefined, hubUrl?: string | undefined): Promise<{ baseUrl: string; close(): Promise<void> }>;
  close(): Promise<void>;
}

const docPoolFor = (cfg: Config) => createDocPool({ workers: cfg.DOC_WORKERS, timeoutMs: cfg.DOC_WORK_MS, heapMb: cfg.DOC_HEAP_MB, waitingPerPerson: cfg.DOC_WAITING_PER_PERSON });

async function listen(deps: Deps, stopping?: AbortSignal | undefined): Promise<{ server: ServerType; baseUrl: string }> {
  const app = createApp(deps, stopping);
  const server: ServerType = await new Promise((resolve) => { const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s)); });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}
/**
 * Stops a server at once. `close()` alone waits out every connection busy at that moment, and a call session
 * still polling keeps reusing its keep-alive connection, so the wait can last forever.
 */
const stop = (server: ServerType) => new Promise<void>((r) => {
  server.close(() => r());
  if (server instanceof Server) server.closeAllConnections();
});

export async function startHarness(): Promise<Harness> {
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL is not set');
  const name = new URL(url).pathname.slice(1);
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  await admin.end();

  // Capture every line at debug level, so tests can check what the logs explain and that they leak nothing.
  const logs: string[] = [];
  configureLogging({ level: 'debug', destination: { write: (line: string) => { logs.push(line); if (process.env['TEST_LOGS']) process.stdout.write(line); } } });
  const google = await startFakeGoogle();
  const near = await startFakeNear();
  // The bucket follows the test database (alcove_test → alcove-test), so runs against different test
  // databases, as from parallel worktrees, never sweep each other's objects.
  const bucket = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const cfg = await loadConfig(process.env, {
    DATABASE_URL: url, OBJECTS_BUCKET: bucket, WEB_ORIGIN: ORIGIN, API_URL: 'http://127.0.0.1',
    GOOGLE_ISSUER: google.issuer, GOOGLE_API_URL: google.issuer, GOOGLE_CLIENT_ID: google.clientId, GOOGLE_CLIENT_SECRET: google.clientSecret,
    // NEAR AI, and the stand-in Intel and NVIDIA roots its evidence is checked against.
    ...near.settings,
    // Sign-in photos come from the stand-in Google here, as they come from lh3.googleusercontent.com in production.
    PHOTO_HOSTS: 'googleusercontent.com,127.0.0.1',
    // A limit a test sets is in force on its next request, and gone once the test is: tests that look at the window set their own.
    LIMITS_CACHE_MS: '0',
    // The listener service's key, for listener processes the tests run, and a name of this run's own for them to
    // register under, so a worker on the shared LiveKit never takes another run's (or worktree's) dispatches.
    LISTENER_KEY: randomBytes(24).toString('base64url'),
    LISTENER_AGENT: `test-listener-${randomBytes(4).toString('hex')}`
  });
  const pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const objects = await createObjectStore(cfg);
  const deps: Deps = { cfg, pool, objects, livekit: createLiveKit(cfg), hub: createHub(url, { checkMs: cfg.HUB_CHECK_MS, timeoutMs: cfg.HUB_TIMEOUT_MS, maxStreams: cfg.LIVE_STREAMS_MAX, maxPerAddress: cfg.LIVE_STREAMS_PER_ADDRESS }), docs: docPoolFor(cfg) };
  const { server, baseUrl } = await listen(deps);
  // As the server does: every part of a call with notes on gets a listener sent.
  const stopSupervising = supervising(deps);
  // Only now is the API's address known: it's where Google sends people back to.
  deps.cfg = { ...cfg, API_URL: baseUrl };
  google.register(`${baseUrl}/v1/auth/google/callback`);
  // Every call session a browser joins, so a test's sessions can be stopped once it's done instead of polling on.
  const calls: CallSession[] = [];
  const streams: { close(): void }[] = [];
  const closeCalls = () => { for (const s of [...calls.splice(0), ...streams.splice(0)]) s.close(); };
  return {
    baseUrl, pool, objects, deps, logs, google, near,
    browser(o = {}) {
      const f = o.fetch ?? cookieFetch(ORIGIN);
      // Calls keep up with their keys and notes quickly here; browsers wait 1.5 s between checks while nothing nudges them, and 5 s between looks at the notes.
      const api = createHttpApi({ baseUrl, fetch: f, callPollMs: o.callPollMs ?? 50, callNotesMs: o.callNotesMs ?? 250, ...(o.callRekeyMs ? { callRekeyMs: o.callRekeyMs } : {}), ...(o.ringSilenceMs ? { ringSilenceMs: o.ringSilenceMs } : {}), ...(o.onEvent ? { onEvent: o.onEvent } : {}) });
      const join: AlcoveApi['calls']['join'] = async (code, opts) => { const s = await api.calls.join(code, opts); calls.push(s); return s; };
      const live: AlcoveApi['workspaces']['live'] = (id, opts) => { const s = api.workspaces.live(id, opts); streams.push(s); return s; };
      const document: AlcoveApi['workspaces']['document'] = async (id, documentId, opts) => { const s = await api.workspaces.document(id, documentId, opts); streams.push(s); return s; };
      return { api: { ...api, calls: { ...api.calls, join }, workspaces: { ...api.workspaces, live, document } }, fetch: f };
    },
    closeCalls,
    async secondServer(more = {}, stopping = undefined, own = undefined, hubUrl = undefined) {
      const settings = { ...deps.cfg, ...more };
      const hub = createHub(hubUrl ?? url, { checkMs: settings.HUB_CHECK_MS, timeoutMs: settings.HUB_TIMEOUT_MS, maxStreams: settings.LIVE_STREAMS_MAX, maxPerAddress: settings.LIVE_STREAMS_PER_ADDRESS });
      // Workers take a moment to start, so instances share them, unless a test wants them to behave differently.
      const docs = more.DOC_WORK_MS || more.DOC_HEAP_MB || more.DOC_WORKERS || more.DOC_WAITING_PER_PERSON ? docPoolFor(settings) : deps.docs;
      const second = await listen({ ...deps, hub, docs, cfg: settings, ...(own ? { pool: own } : {}) }, stopping);
      return { baseUrl: second.baseUrl, close: async () => { await hub.close(); await stop(second.server); if (docs !== deps.docs) await docs.close(); } };
    },
    async close() {
      stopSupervising();
      closeCalls();
      await deps.hub.close();
      await deps.docs.close();
      await stop(server);
      await google.close();
      await near.close();
      await pool.end();
    }
  };
}
