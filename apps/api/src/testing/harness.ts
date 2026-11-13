/*
 * Boots the real API against a clean test database and bucket, with a stand-in Google to sign in
 * through, a stand-in NEAR AI Cloud to transcribe and write notes (with stand-ins for the Intel and
 * NVIDIA services that vouch for it, under test roots) and a stand-in 1Click to add money with,
 * and gives tests "browsers":
 * each with its own cookie jar, sending the web app's Origin, talking through @alcove/api-http.
 */
import type { AlcoveApi, CallSession } from '@alcove/api';
import { createHttpApi, type ClientEvent } from '@alcove/api-http';
import { serve, type ServerType } from '@hono/node-server';
import { Server } from 'node:http';
import pg from 'pg';
import { createApp } from '../app';
import type { Deps } from '../context';
import { loadConfig, loadEnv, type Config } from '../config';
import { createPool } from '../db';
import { createDocPool } from '../live/docPool';
import { createHub } from '../live/hub';
import type { LimitName } from '../limits';
import { createLiveKit } from '../livekit';
import { configureLogging } from '../log';
import { migrate } from '../migrate';
import { createObjectStore, type ObjectStore } from '../objects';
import { resolveKeys, type LegacyKeys } from '../serverKeys';
import { startFakeGoogle, type FakeGoogle, type GoogleUser, type Spoil } from './fake-google';
import { fakeKms } from './fake-kms';
import { startFakeNear, type FakeNear } from './fake-near';
import { startFakeOneClick, type FakeOneClick } from './fake-oneclick';

// An HTTPS web origin, so the API applies its production cookie rules (__Host- names, Secure) over the test transport.
export const ORIGIN = 'https://localhost:3000';

let clients = 0;
/**
 * A fetch with one cookie jar that sends the app's Origin, like a browser on the web app. Each jar
 * is also its own client address, as different people are, so per-client rate limits apply per test browser.
 * `base`: how its requests go, if not the global fetch (through the edge's TLS, say).
 */
export function cookieFetch(origin: string, base: typeof fetch = fetch): typeof fetch {
  const jar = new Map<string, string>();
  const n = ++clients;
  const address = `10.1.${(n >> 8) & 255}.${n & 255}`;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    if (!headers.has('origin')) headers.set('origin', origin);
    if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', address);
    const res = await base(input, { ...init, headers });
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

/** Follows the explicit Calendar connection from an already signed-in test browser. */
export async function connectGoogleCalendar(h: Harness, b: Browser, user: GoogleUser, spoil?: Spoil): Promise<string> {
  h.google.next(user, spoil);
  const start = await b.fetch(b.api.calendar.connectUrl(), { redirect: 'manual' });
  const google = await fetch(start.headers.get('location') ?? '', { redirect: 'manual' });
  const end = await b.fetch(google.headers.get('location') ?? '', { redirect: 'manual' });
  return end.headers.get('location') ?? '';
}

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
  /**
   * The NEAR Intents 1Click that quotes deposit addresses for top-ups, with NEAR's RPC for the salt a sign-in carries. It
   * made the treasury's key the API signs in with: a test key, registered for the treasury there and nowhere else.
   */
  oneclick: FakeOneClick;
  /** A fresh browser with its own cookie jar, or one around a fetch the test supplies. */
  browser(o?: { fetch?: typeof fetch | undefined; onEvent?: ((e: ClientEvent) => void) | undefined; callPollMs?: number | undefined; callNotesMs?: number | undefined; callRekeyMs?: number | undefined; ringSilenceMs?: number | undefined }): Browser;
  /** Stops every call session, workspace stream and document this harness's browsers opened from keeping up (nobody leaves). */
  closeCalls(): void;
  /** Puts the limits back to what tests start with: the defaults. */
  resetLimits(): Promise<void>;
  /**
   * Sets a limit as someone at the database's console would: in force on the next request (LIMITS_CACHE_MS is 0 here), and
   * never checked against its bounds, so a test can set one past them.
   */
  setLimit(name: LimitName, value: number): Promise<void>;
  /**
   * Another API process on the same database and bucket, with its own hub, as after a restart, on a second instance, or
   * with other settings. `stopping`: says it's shutting down. `pool`: its own connections to the database. `hubUrl`: the
   * way its hub reaches Postgres, for a test to stand in the way. With `TEE: 'confidential-space'` its keys are resolved as
   * the server resolves them at start: its master as the stand-in Cloud KMS (`fakeKms()`) unwraps it from the database, the
   * server keys sealed under it, and the old keys it's started with (`legacy`, as LEGACY_SECRETS gives them), or retiring the
   * old master (`retire`). `cfg` is what it runs with.
   */
  secondServer(cfg?: ServerSettings, stopping?: AbortSignal | undefined, pool?: pg.Pool | undefined, hubUrl?: string | undefined): Promise<{ baseUrl: string; cfg: Config; close(): Promise<void> }>;
  close(): Promise<void>;
}
/** A second server's settings: the harness's own, but for these, and inside a TEE the old keys it's started with, or retiring them. */
export type ServerSettings = Partial<Config> & { legacy?: LegacyKeys | undefined; retire?: boolean | undefined };

const docPoolFor = (cfg: Config) => createDocPool({ workers: cfg.DOC_WORKERS, timeoutMs: cfg.DOC_WORK_MS, heapMb: cfg.DOC_HEAP_MB, waitingPerPerson: cfg.DOC_WAITING_PER_PERSON });

async function listen(deps: Deps, stopping?: AbortSignal | undefined): Promise<{ server: ServerType; baseUrl: string }> {
  const app = createApp(deps, stopping);
  // The browsers share this process's event loop: a test that holds it for seconds (scanning every log line for
  // canaries) mustn't leave them a kept-alive socket the server is closing as they reuse it.
  const server: ServerType = await new Promise((resolve) => { const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1', serverOptions: { keepAliveTimeout: 60_000 } }, () => resolve(s)); });
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
  const oneclick = await startFakeOneClick();
  // The bucket follows the test database (alcove_test → alcove-test), so runs against different test
  // databases, as from parallel worktrees, never sweep each other's objects.
  const bucket = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const cfg = await loadConfig(loadEnv(process.env, {
    DATABASE_URL: url, OBJECTS_BUCKET: bucket, WEB_ORIGIN: ORIGIN, API_URL: 'http://127.0.0.1',
    GOOGLE_ISSUER: google.issuer, GOOGLE_API_URL: google.issuer, GOOGLE_CLIENT_ID: google.clientId, GOOGLE_CLIENT_SECRET: google.clientSecret,
    // NEAR AI, and the stand-in Intel and NVIDIA roots its evidence is checked against.
    ...near.settings,
    // 1Click, paying the treasury's confidential balance for top-ups, signed in to with a test key made for the treasury.
    ...oneclick.settings,
    // Sign-in photos come from the stand-in Google here, as they come from lh3.googleusercontent.com in production.
    PHOTO_HOSTS: 'googleusercontent.com,127.0.0.1',
    // A limit a test sets is in force on its next request, and gone once the test is: tests that look at the window set their own.
    LIMITS_CACHE_MS: '0',
    // Likewise a feature flag switched on or off.
    FEATURE_FLAGS_CACHE_MS: '0'
  }), pool, undefined);
  const resetLimits = async () => { await pool.query('DELETE FROM service_limits'); };
  const setLimit = async (name: LimitName, value: number) => {
    await pool.query('INSERT INTO service_limits (name, value) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now()', [name, value]);
  };
  const objects = await createObjectStore(cfg);
  const deps: Deps = { cfg, pool, objects, livekit: createLiveKit(cfg), hub: createHub(url, { checkMs: cfg.HUB_CHECK_MS, timeoutMs: cfg.HUB_TIMEOUT_MS, maxStreams: cfg.LIVE_STREAMS_MAX, maxPerAddress: cfg.LIVE_STREAMS_PER_ADDRESS, makeRoomAfterMs: cfg.LIVE_MAKE_ROOM_MS }), docs: docPoolFor(cfg) };
  const { server, baseUrl } = await listen(deps);
  // Only now is the API's address known: it's where Google sends people back to.
  deps.cfg = { ...cfg, API_URL: baseUrl };
  google.register(`${baseUrl}/v1/auth/google/callback`);
  google.register(`${baseUrl}/v1/drive/callback`);
  // Every call session a browser joins, so a test's sessions can be stopped once it's done instead of polling on.
  const calls: CallSession[] = [];
  const streams: { close(): void }[] = [];
  const closeCalls = () => { for (const s of [...calls.splice(0), ...streams.splice(0)]) s.close(); };
  return {
    baseUrl, pool, objects, deps, logs, google, near, oneclick,
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
    resetLimits,
    setLimit,
    async secondServer(more = {}, stopping = undefined, own = undefined, hubUrl = undefined) {
      const { legacy, retire, ...over } = more;
      const given = { ...deps.cfg, ...over };
      // Inside a TEE nothing of the harness's keys carries over: only what the stand-in Cloud KMS, the database and the old keys say.
      const settings: Config = given.TEE === 'confidential-space'
        ? { ...given, ...(await resolveKeys(own ?? pool, { tee: 'confidential-space', wrapper: fakeKms(), legacy, retire: retire ?? false })) }
        : given;
      const hub = createHub(hubUrl ?? url, { checkMs: settings.HUB_CHECK_MS, timeoutMs: settings.HUB_TIMEOUT_MS, maxStreams: settings.LIVE_STREAMS_MAX, maxPerAddress: settings.LIVE_STREAMS_PER_ADDRESS, makeRoomAfterMs: settings.LIVE_MAKE_ROOM_MS });
      // Workers take a moment to start, so instances share them, unless a test wants them to behave differently.
      const docs = more.DOC_WORK_MS || more.DOC_HEAP_MB || more.DOC_WORKERS || more.DOC_WAITING_PER_PERSON ? docPoolFor(settings) : deps.docs;
      const second = await listen({ ...deps, hub, docs, cfg: settings, ...(own ? { pool: own } : {}) }, stopping);
      return { baseUrl: second.baseUrl, cfg: settings, close: async () => { await hub.close(); await stop(second.server); if (docs !== deps.docs) await docs.close(); } };
    },
    async close() {
      closeCalls();
      await deps.hub.close();
      await deps.docs.close();
      await stop(server);
      await google.close();
      await near.close();
      await oneclick.close();
      await pool.end();
    }
  };
}
