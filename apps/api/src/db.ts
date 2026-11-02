import pg from 'pg';
import { z } from 'zod';

export type Db = pg.Pool | pg.PoolClient;

export function createPool(url: string): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 10, statement_timeout: 15_000 });
}

/** Runs a query and parses every row, so nothing leaves the database layer untyped. */
export async function rows<S extends z.ZodType>(db: Db, schema: S, sql: string, params: unknown[] = []): Promise<z.infer<S>[]> {
  const r = await db.query(sql, params);
  return z.array(schema).parse(r.rows);
}
export async function maybeOne<S extends z.ZodType>(db: Db, schema: S, sql: string, params: unknown[] = []): Promise<z.infer<S> | undefined> {
  const [first] = await rows(db, schema, sql, params);
  return first;
}
export async function exec(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query(sql, params);
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
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

export const bytea = z.instanceof(Uint8Array);
export const timestamp = z.date();
export const bigintText = z.union([z.string(), z.number()]).transform((v) => Number(v));
