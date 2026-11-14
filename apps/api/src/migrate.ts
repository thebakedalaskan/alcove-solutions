import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { z } from 'zod';
import { exec, maybeOne, rows, type Db } from './platform/db';
import { IntegrityError } from './platform/errors';
import { log } from './platform/log';

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

/** Where a database's migrations stand against the image's: how many of each and the newest, and names on one side only. */
export interface MigrationStatus {
  applied: { count: number; newest: string | null };
  inImage: { count: number; newest: string | null };
  /** In the image, not applied: the database is behind the release. */
  notApplied: string[];
  /** Applied, not in the image: the release is behind the database. */
  unknown: string[];
}

/** The image's migrations, in the order they're applied. */
const inImageAt = async (dir: string): Promise<string[]> => (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const checksumOf = (sql: string): string => createHash('sha256').update(sql).digest('hex');
/** Whether schema_migrations is there (its columns), and whether it keeps checksums, which a database built before them doesn't. */
const Tracked = z.object({ columns: z.number(), checksum: z.number() });
const TRACKED = `SELECT count(*)::int AS columns, count(*) FILTER (WHERE column_name = 'checksum')::int AS checksum
  FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'schema_migrations'`;

function standing(applied: string[], inImage: string[]): MigrationStatus {
  const done = new Set(applied);
  const there = new Set(inImage);
  return {
    applied: { count: applied.length, newest: applied.at(-1) ?? null },
    inImage: { count: inImage.length, newest: inImage.at(-1) ?? null },
    notApplied: inImage.filter((f) => !done.has(f)),
    unknown: applied.filter((f) => !there.has(f))
  };
}

/** What a run of `migrate` would make of a database: where it stands, and why the run would refuse it, if it would. */
export interface MigrationCheck extends MigrationStatus {
  /**
   * Why a run would refuse the database, as `migrate` says it: built before checksums were kept (`untracked`), a migration
   * applied that the image doesn't have (`removed`), or one changed in the image since it was applied (`changed`).
   */
  refused: 'untracked' | 'removed' | 'changed' | null;
  /** Applied, then changed in the image: their checksums differ. */
  changed: string[];
}

/**
 * What a run of `migrate` makes of this database: what it applies, and why it refuses the database, checksums and all. The
 * one verdict: a run (applyNew) acts on it under its lock, and read only, with nothing locked, created or applied, it's what
 * the checks job (operator-job.ts) and `operator release` say. A database without schema_migrations has applied nothing: a
 * run makes the table.
 */
export async function migrationCheck(db: Db, dir = DIR): Promise<MigrationCheck> {
  const files = await inImageAt(dir);
  const table = await maybeOne(db, Tracked, TRACKED);
  if (!table?.columns) return { ...standing([], files), refused: null, changed: [] };
  if (!table.checksum) {
    const names = (await rows(db, z.object({ name: z.string() }), 'SELECT name FROM schema_migrations ORDER BY name')).map((r) => r.name);
    return { ...standing(names, files), refused: 'untracked', changed: [] };
  }
  const done = await rows(db, z.object({ name: z.string(), checksum: z.string() }), 'SELECT name, checksum FROM schema_migrations ORDER BY name');
  const changed: string[] = [];
  for (const { name, checksum } of done) {
    if (files.includes(name) && checksumOf(await readFile(join(dir, name), 'utf8')) !== checksum) changed.push(name);
  }
  const s = standing(done.map((r) => r.name), files);
  return { ...s, refused: s.unknown.length ? 'removed' : changed.length ? 'changed' : null, changed };
}

/**
 * Under the lock: the database refused as migrationCheck refuses it, before anything is applied, or else each migration it
 * hasn't had applied, in order.
 */
async function applyNew(c: pg.PoolClient, dir: string): Promise<string[]> {
  await exec(c, 'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const m = await migrationCheck(c, dir);
  if (m.refused === 'untracked') throw new IntegrityError('This database was built before Alcove kept migration checksums. A local one can start over with pnpm db:reset.', { context: { reason: 'untracked' } });
  if (m.refused === 'removed') throw new IntegrityError('This database applied a migration that is no longer in the repository. Merged migrations are never deleted or renamed: restore it.', { context: { migration: m.unknown[0], reason: 'removed' } });
  if (m.refused === 'changed') throw new IntegrityError('A migration changed after it was applied to this database. Merged migrations never change: restore it, and make the change in a new migration.', { context: { migration: m.changed[0], reason: 'changed' } });
  const applied: string[] = [];
  for (const f of m.notApplied) {
    const sql = await readFile(join(dir, f), 'utf8');
    const checksum = checksumOf(sql);
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
