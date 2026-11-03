import pg from 'pg';
import { z } from 'zod';
import { DatabaseError } from './errors';
import { log } from './log';

const dblog = log.child({ component: 'db' });
/** The statement's first words, e.g. "SELECT revision_id FROM revisions": SQL text is static, parameters are never logged. */
const label = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 80);

/** Runs one statement with timing, a slow-query warning, and failures wrapped with what was attempted. */
async function query(db: Db, sql: string, params: unknown[]) {
  const t0 = performance.now();
  try {
    const r = await db.query(sql, params);
    const ms = Math.round(performance.now() - t0);
    if (ms > 250) dblog.warn('slow query', { sql: label(sql), ms, rows: r.rowCount ?? 0 });
    else if (dblog.isDebug()) dblog.debug('query', { sql: label(sql), ms, rows: r.rowCount ?? 0 });
    return r;
  } catch (e) {
    throw new DatabaseError(undefined, { cause: e, context: { sql: label(sql), pgCode: pgCode(e), ms: Math.round(performance.now() - t0) } });
  }
}
const pgCode = (e: unknown) => (e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined);

export type Db = pg.Pool | pg.PoolClient;

export function createPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10, statement_timeout: 15_000 });
  pool.on('error', (e) => dblog.error('idle database client failed', { err: e }));
  return pool;
}

/** Runs a query and parses every row, so nothing leaves the database layer untyped. */
export async function rows<S extends z.ZodType>(db: Db, schema: S, sql: string, params: unknown[] = []): Promise<z.infer<S>[]> {
  const r = await query(db, sql, params);
  const parsed = z.array(schema).safeParse(r.rows);
  if (!parsed.success) throw new DatabaseError(undefined, { cause: parsed.error, context: { sql: label(sql), issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.code}`) } });
  return parsed.data;
}
export async function maybeOne<S extends z.ZodType>(db: Db, schema: S, sql: string, params: unknown[] = []): Promise<z.infer<S> | undefined> {
  const [first] = await rows(db, schema, sql, params);
  return first;
}
export async function exec(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const r = await query(db, sql, params);
  return r.rowCount ?? 0;
}

/** One transaction; constraints declared DEFERRABLE are checked at commit. */
export async function tx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch((r: unknown) => dblog.error('rollback failed', { err: r }));
    dblog.debug('transaction rolled back', { err: e });
    throw e;
  } finally {
    c.release();
  }
}

export const bytea = z.instanceof(Uint8Array);
export const timestamp = z.date();
export const bigintText = z.union([z.string(), z.number()]).transform((v) => Number(v));
