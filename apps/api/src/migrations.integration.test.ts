/*
 * Upgrading a database that's in use (AGENTS.md › Stored data survives every deploy). Production only ever moves
 * forward, so a new migration has to apply on top of today's schema and the data in it, once, however many runs
 * start at the same time.
 */
import { copyFile, cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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

  it('lets a series be an item on a database in use: what the release before wrote stays, and it still can’t be anything else', async () => {
    configureLogging({ level: 'silent', destination: { write: () => {} } });
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) throw new Error('TEST_DATABASE_URL is not set');
    const name = `${new URL(url).pathname.slice(1)}_series_upgrade`;
    const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
    const dir = await mkdtemp(join(tmpdir(), 'alcove-migrations-'));
    const pool = createPool(url.replace(/\/[^/]+$/, `/${name}`));
    const owner = 'o'.repeat(43);
    /** An item of a kind, as the API writes one: its row and its first revision, in one transaction. */
    const item = (id: string, kind: string) => `BEGIN;
      INSERT INTO items (owner_id, item_id, kind, current_revision_id, version) VALUES ('${owner}', '${id.repeat(22)}', '${kind}', '${id.repeat(21)}r', 0);
      INSERT INTO revisions (owner_id, item_id, revision_id, key_envelope, manifest_ciphertext, created_at) VALUES ('${owner}', '${id.repeat(22)}', '${id.repeat(21)}r', '\\x00', '\\x00', now());
      COMMIT;`;
    /** An item the check turns away: its transaction is left open, so it's rolled back on the same connection. */
    const refused = async (sql: string) => {
      const c = await pool.connect();
      try {
        await expect(c.query(sql)).rejects.toThrow(/items_kind_check/);
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    };
    try {
      // The schema as the release before had it, with a call in it.
      const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
      for (const f of files.filter((x) => x < '0006_series_items.sql')) await copyFile(join(MIGRATIONS, f), join(dir, f));
      await migrate(pool, dir);
      await pool.query(`INSERT INTO owners (owner_id, root_envelope, root_check) VALUES ('${owner}', '\\x00', '\\x00')`);
      await pool.query(item('m', 'meeting'));
      await refused(item('s', 'series'));

      for (const f of files.filter((x) => x >= '0006_series_items.sql')) await copyFile(join(MIGRATIONS, f), join(dir, f));
      expect(await migrate(pool, dir)).toContain('0006_series_items.sql');

      // The call is as it was and can still be saved, as the release before goes on serving; the turn starts empty.
      const items = await pool.query<{ kind: string }>('SELECT kind FROM items');
      expect(items.rows).toEqual([{ kind: 'meeting' }]);
      expect((await pool.query("UPDATE items SET version = 1 WHERE kind = 'meeting'")).rowCount).toBe(1);
      expect((await pool.query<{ series_turn_until: Date | null }>('SELECT series_turn_until FROM owners')).rows).toEqual([{ series_turn_until: null }]);
      // A series can be an item now, and the check still holds for anything new, though nothing old was scanned for it.
      await pool.query(item('s', 'series'));
      await refused(item('x', 'nonsense'));
    } finally {
      await pool.end();
      await rm(dir, { recursive: true, force: true });
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      await admin.end();
    }
  });
});
