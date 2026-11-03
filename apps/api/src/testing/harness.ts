/*
 * Boots the real API against a clean test database and bucket, with a stand-in Google to sign in
 * through and a stand-in NEAR AI Cloud to transcribe and write notes, and gives tests "browsers":
 * each with its own cookie jar, sending the web app's Origin, talking through @alcove/api-http.
 */
import type { AlcoveApi } from '@alcove/api';
import { createHttpApi, type ClientEvent } from '@alcove/api-http';
import { serve, type ServerType } from '@hono/node-server';
import pg from 'pg';
import { createApp } from '../app';
import type { Deps } from '../context';
import { loadConfig, type Config } from '../config';
import { createPool } from '../db';
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
  /** The NEAR AI Cloud the API transcribes speech and writes notes with. */
  near: FakeNear;
  /** A fresh browser with its own cookie jar, or one around a fetch the test supplies. */
  browser(o?: { fetch?: typeof fetch | undefined; onEvent?: ((e: ClientEvent) => void) | undefined }): Browser;
  /** Another API process on the same database and bucket, as after a restart, on a second instance, or with other settings. */
  secondServer(cfg?: Partial<Config>): Promise<{ baseUrl: string; close(): Promise<void> }>;
  close(): Promise<void>;
}

async function listen(deps: Deps): Promise<{ server: ServerType; baseUrl: string }> {
  const app = createApp(deps);
  const server: ServerType = await new Promise((resolve) => { const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s)); });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}
const stop = (server: ServerType) => new Promise<void>((r) => server.close(() => r()));

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
    NEAR_AI_BASE_URL: near.baseUrl, NEAR_AI_API_KEY: near.apiKey,
    // Sign-in photos come from the stand-in Google here, as they come from lh3.googleusercontent.com in production.
    PHOTO_HOSTS: 'googleusercontent.com,127.0.0.1'
  });
  const pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const objects = await createObjectStore(cfg);
  const deps: Deps = { cfg, pool, objects };
  const { server, baseUrl } = await listen(deps);
  // Only now is the API's address known: it's where Google sends people back to.
  deps.cfg = { ...cfg, API_URL: baseUrl };
  google.register(`${baseUrl}/v1/auth/google/callback`);
  return {
    baseUrl, pool, objects, deps, logs, google, near,
    browser(o = {}) {
      const f = o.fetch ?? cookieFetch(ORIGIN);
      return { api: createHttpApi({ baseUrl, fetch: f, ...(o.onEvent ? { onEvent: o.onEvent } : {}) }), fetch: f };
    },
    async secondServer(more = {}) {
      const second = await listen({ ...deps, cfg: { ...deps.cfg, ...more } });
      return { baseUrl: second.baseUrl, close: () => stop(second.server) };
    },
    async close() {
      await stop(server);
      await google.close();
      await near.close();
      await pool.end();
    }
  };
}
