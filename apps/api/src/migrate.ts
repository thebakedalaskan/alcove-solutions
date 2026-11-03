import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { z } from 'zod';
import { exec, rows, tx } from './db';
import { log } from './log';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Applies every migration in order, once, each in its own transaction. */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await exec(pool, 'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await rows(pool, z.object({ name: z.string() }), 'SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(DIR + f, 'utf8');
    await tx(pool, async (c) => {
      await c.query(sql);
      await exec(c, 'INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    });
    applied.push(f);
    log.info('migration applied', { component: 'migrate', migration: f });
  }
  return applied;
}

