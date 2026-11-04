/*
 * Upgrading a database that's in use (AGENTS.md › Stored data survives every deploy). Production only ever moves
 * forward, so a new migration has to apply on top of today's schema and the data in it, once, however many runs
 * start at the same time.
 */
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createPool } from './db';
import { configureLogging } from './log';
import { migrate } from './migrate';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

describe('migrations', () => {
  it('moves a database in use forward: rows keep their data, a new migration applies once even when two runs race, and one that fails leaves nothing', async () => {
    configureLogging({ level: 'silent', destination: { write: () => {} } });
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is not set');
    // A database of its own, so the migrations added here never reach the one the other tests share.
    const name = `${new URL(url).pathname.slice(1)}_upgrade`;
    const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
    const dir = await mkdtemp(join(tmpdir(), 'alcove-migrations-'));
    const pool = createPool(url.replace(/\/[^/]+$/, `/${name}`));
    try {
      await cp(MIGRATIONS, dir, { recursive: true });
      // Today's schema, as production has it, and then a release that adds a table with rows in it.
      expect((await migrate(pool, dir)).length).toBeGreaterThan(0);
      await writeFile(join(dir, '9000_probe.sql'), 'CREATE TABLE probe (id int PRIMARY KEY); INSERT INTO probe VALUES (1), (2);');
      expect(await migrate(pool, dir)).toEqual(['9000_probe.sql']);

      // The next release adds a column with a default, and the deploy's job and a starting API both migrate.
      await writeFile(join(dir, '9001_probe_label.sql'), "ALTER TABLE probe ADD COLUMN label text NOT NULL DEFAULT 'none';");
      const [a, b] = await Promise.all([migrate(pool, dir), migrate(pool, dir)]);
      expect([...a, ...b]).toEqual(['9001_probe_label.sql']);
      expect((await pool.query<{ id: number; label: string }>('SELECT id, label FROM probe ORDER BY id')).rows).toEqual([{ id: 1, label: 'none' }, { id: 2, label: 'none' }]);

      // A migration that fails partway applies nothing, isn't recorded, and stops the ones after it.
      await writeFile(join(dir, '9002_half.sql'), 'CREATE TABLE half (id int); SELECT no_such_function();');
      await writeFile(join(dir, '9003_after.sql'), 'CREATE TABLE after_half (id int);');
      await expect(migrate(pool, dir)).rejects.toThrow(/no_such_function/);
      expect((await pool.query<{ half: string | null; after: string | null }>("SELECT to_regclass('half')::text AS half, to_regclass('after_half')::text AS after")).rows).toEqual([{ half: null, after: null }]);
      expect((await pool.query<{ name: string }>("SELECT name FROM schema_migrations WHERE name LIKE '9%' ORDER BY name")).rows.map((r) => r.name)).toEqual(['9000_probe.sql', '9001_probe_label.sql']);
    } finally {
      await pool.end();
      await rm(dir, { recursive: true, force: true });
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });
});
