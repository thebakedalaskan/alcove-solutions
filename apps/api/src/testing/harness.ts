import type { AlcoveApi } from '@alcove/api';
import { createHttpApi, type ClientEvent, type PasskeyDevice } from '@alcove/api-http';
import { serve, type ServerType } from '@hono/node-server';
import pg from 'pg';
import { createApp } from '../app';
import type { Deps } from '../context';
import { loadConfig } from '../config';
import { createPool } from '../db';
import { configureLogging } from '../log';
import { migrate } from '../migrate';
import { createObjectStore, type ObjectStore } from '../objects';
import { SessionStore } from '../sessions';
import { cookieFetch, memorySecrets, softPasskeys } from './soft-passkey';

// The HTTP test transport carries an HTTPS web origin to exercise production cookie rules.
export const ORIGIN = 'https://localhost:3000';
export interface Harness {
  baseUrl: string;
  pool: pg.Pool;
  objects: ObjectStore;
  deps: Deps;
  /** Every log line the API wrote (at debug level), raw JSON text, oldest first. */
  logs: string[];
  /** A fresh "browser": its own cookie jar and passkeys. */
  /** A fresh "browser" with its own cookie jar, or the same browser (pass its fetch) with another passkey. */
  client(device?: PasskeyDevice, sameBrowser?: typeof fetch, deviceName?: string, onEvent?: (e: ClientEvent) => void): { api: AlcoveApi; device: PasskeyDevice; fetch: typeof fetch };
  close(): Promise<void>;
}

/** Boots the real API against a clean test database and bucket. */
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
  const cfg = loadConfig(process.env, { DATABASE_URL: url, OBJECTS_BUCKET: 'alcove-test', WEB_ORIGIN: ORIGIN, RP_ID: 'localhost' });
  const pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const objects = await createObjectStore(cfg);
  const deps: Deps = { cfg, pool, objects, sessions: new SessionStore() };
  const app = createApp(deps);
  const server: ServerType = await new Promise((resolve) => { const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s)); });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl, pool, objects, deps, logs,
    client(device, sameBrowser, deviceName, onEvent) {
      const d = device ?? softPasskeys({ origin: ORIGIN, rpId: 'localhost' });
      const f = sameBrowser ?? cookieFetch(ORIGIN);
      return { api: createHttpApi({ baseUrl, fetch: f, passkeys: d, secrets: memorySecrets(), deviceName: () => deviceName ?? 'Test laptop', ...(onEvent ? { onEvent } : {}) }), device: d, fetch: f };
    },
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await pool.end();
    }
  };
}
