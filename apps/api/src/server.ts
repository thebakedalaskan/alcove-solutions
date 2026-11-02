import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { createPool } from './db';
import { inference } from './inference';
import { maintain } from './maintenance';
import { migrate } from './migrate';
import { createObjectStore } from './objects';
import { SessionStore } from './sessions';

const cfg = loadConfig();
const pool = createPool(cfg.DATABASE_URL);
const applied = await migrate(pool);
if (applied.length) console.log(`Migrated: ${applied.join(', ')}`);
const objects = await createObjectStore(cfg);
const deps = { cfg, pool, objects, sessions: new SessionStore() };
const app = createApp(deps);
const upkeep = () => maintain(deps).catch((e: unknown) => console.error('maintenance failed:', e instanceof Error ? e.message : e));
void upkeep();
setInterval(() => void upkeep(), 5 * 60_000).unref();
serve({ fetch: app.fetch, port: cfg.API_PORT, hostname: cfg.API_HOST }, (info) => {
  console.log(`Alcove API on http://${cfg.API_HOST}:${info.port} · NEAR AI ${inference(cfg).configured ? 'configured' : 'not configured'}`);
});
