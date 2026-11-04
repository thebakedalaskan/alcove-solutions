import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { z } from 'zod';
import { exec, rows } from './db';
import { IntegrityError } from './errors';
import { log } from './log';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
/** Any fixed number. Every run takes this advisory lock, so two runs (the deploy's job, an API starting) never interleave. */
const LOCK = 4_120_771;
const mlog = log.child({ component: 'migrate' });

/**
 * Applies the migrations this database hasn't had yet, in order, each once and in its own transaction.
 * Migrations only move forward (AGENTS.md › Stored data survives every deploy): a merged one never changes.
 * So each applied file's checksum is kept, and a database whose applied files differ from the repository's
 * is refused rather than run against code that expects another schema.
 */
export async function migrate(pool: pg.Pool, dir = DIR): Promise<string[]> {
  const c = await pool.connect();
  let broken = false;
  try {
    await c.query('SELECT pg_advisory_lock($1)', [LOCK]);
    try {
      return await applyNew(c, dir);
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch((e: unknown) => {
        // A connection that may still hold the lock never goes back to the pool.
        broken = true;
        mlog.warn('migration lock release failed; closing its connection', { err: e });
      });
    }
  } finally {
    c.release(broken);
  }
}

async function applyNew(c: pg.PoolClient, dir: string): Promise<string[]> {
  await exec(c, 'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const tracked = await rows(c, z.object({ n: z.number() }), `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'schema_migrations' AND column_name = 'checksum'`);
  if (!tracked[0]?.n) throw new IntegrityError('This database was built before Alcove kept migration checksums. A local one can start over with pnpm db:reset.', { context: { reason: 'untracked' } });
  const done = new Map((await rows(c, z.object({ name: z.string(), checksum: z.string() }), 'SELECT name, checksum FROM schema_migrations')).map((r) => [r.name, r.checksum]));
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of done.keys()) {
    if (!files.includes(name)) throw new IntegrityError('This database applied a migration that is no longer in the repository. Merged migrations are never deleted or renamed: restore it.', { context: { migration: name, reason: 'removed' } });
  }
  const applied: string[] = [];
  for (const f of files) {
    const sql = await readFile(join(dir, f), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = done.get(f);
    if (prior !== undefined) {
      if (prior !== checksum) throw new IntegrityError('A migration changed after it was applied to this database. Merged migrations never change: restore it, and make the change in a new migration.', { context: { migration: f, reason: 'changed' } });
      continue;
    }
    await c.query('BEGIN');
    try {
      await c.query(sql);
      await exec(c, 'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f, checksum]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch((r: unknown) => mlog.error('migration rollback failed', { migration: f, err: r }));
      throw e;
    }
    applied.push(f);
    mlog.info('migration applied', { migration: f });
  }
  return applied;
}
