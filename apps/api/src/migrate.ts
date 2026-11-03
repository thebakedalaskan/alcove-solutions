import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { z } from 'zod';
import { exec, rows, tx } from './db';
import { IntegrityError } from './errors';
import { log } from './log';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const RESET = 'Alcove’s schema changes in place, so this database has to be reset (locally: pnpm db:reset).';

/**
 * Applies every migration in order, once, each in its own transaction. The schema changes in place
 * (AGENTS.md), so each applied file's checksum is kept, and a database built from a different version
 * of the files is refused instead of running new code on an old schema.
 */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  await exec(pool, 'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const tracked = await rows(pool, z.object({ n: z.number() }), `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'schema_migrations' AND column_name = 'checksum'`);
  if (!tracked[0]?.n) throw new IntegrityError(`This database was built by an earlier version of the schema. ${RESET}`, { context: { reason: 'untracked' } });
  const done = new Map((await rows(pool, z.object({ name: z.string(), checksum: z.string() }), 'SELECT name, checksum FROM schema_migrations')).map((r) => [r.name, r.checksum]));
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const name of done.keys()) {
    if (!files.includes(name)) throw new IntegrityError(`This database has a migration that no longer exists. ${RESET}`, { context: { migration: name, reason: 'removed' } });
  }
  const applied: string[] = [];
  for (const f of files) {
    const sql = await readFile(DIR + f, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const prior = done.get(f);
    if (prior !== undefined) {
      if (prior !== checksum) throw new IntegrityError(`A migration changed after this database was built. ${RESET}`, { context: { migration: f, reason: 'changed' } });
      continue;
    }
    await tx(pool, async (c) => {
      await c.query(sql);
      await exec(c, 'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f, checksum]);
    });
    applied.push(f);
    log.info('migration applied', { component: 'migrate', migration: f });
  }
  return applied;
}
