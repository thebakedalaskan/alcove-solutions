import type { AlcoveApi } from '@alcove/api';
import { createHttpApi, type PasskeyDevice } from '@alcove/api-http';
import { serve, type ServerType } from '@hono/node-server';
import pg from 'pg';
import { createApp } from '../app';
import { loadConfig } from '../config';
import { createPool } from '../db';
import { migrate } from '../migrate';
import { createObjectStore, type ObjectStore } from '../objects';
import { SessionStore } from '../sessions';
import { cookieFetch, memorySecrets, softPasskeys } from './soft-passkey';

export const ORIGIN = 'http://localhost:3000';
export interface Harness {
  baseUrl: string;
  pool: pg.Pool;
  objects: ObjectStore;
  /** A fresh "browser": its own cookie jar and passkeys. */
  /** A fresh "browser" with its own cookie jar, or the same browser (pass its fetch) with another passkey. */
  client(device?: PasskeyDevice, sameBrowser?: typeof fetch): { api: AlcoveApi; device: PasskeyDevice; fetch: typeof fetch };
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

  const cfg = loadConfig(process.env, { DATABASE_URL: url, OBJECTS_BUCKET: 'alcove-test', WEB_ORIGIN: ORIGIN, RP_ID: 'localhost' });
  const pool = createPool(url);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const objects = await createObjectStore(cfg);
  const app = createApp({ cfg, pool, objects, sessions: new SessionStore() });
  const server: ServerType = await new Promise((resolve) => { const s = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => resolve(s)); });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    baseUrl, pool, objects,
    client(device, sameBrowser) {
      const d = device ?? softPasskeys({ origin: ORIGIN, rpId: 'localhost' });
      const f = sameBrowser ?? cookieFetch();
      return { api: createHttpApi({ baseUrl, fetch: f, passkeys: d, secrets: memorySecrets(), deviceName: () => 'Test laptop' }), device: d, fetch: f };
    },
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await pool.end();
    }
  };
}
