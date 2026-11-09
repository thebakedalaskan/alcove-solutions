import pg from 'pg';
import { z } from 'zod';
import { DatabaseBusyError, DatabaseError, LostConnectionError } from './errors';
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
    const context = { sql: label(sql), pgCode: pgCode(e), ms: Math.round(performance.now() - t0) };
    if (busy(e)) throw busyError(e, context);
    if (!gone(e)) throw new DatabaseError(undefined, { cause: e, context });
    // Said here, where whatever was using the connection can be found: the request it fails, or the job.
    dblog.warn('lost the connection to the database', context);
    throw new LostConnectionError(undefined, { cause: e, context });
  }
}
const pgCode = (e: unknown) => (e instanceof Error && 'code' in e && typeof e.code === 'string' ? e.code : undefined);
/** What pg says when a connection has gone, from Postgres's side or this one's: what was running on it won't finish. */
const GONE_CODES = new Set(['57P01', '57P02', '57P03', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT']);
const GONE_MESSAGES = new Set(['Connection terminated unexpectedly', 'Connection terminated', 'Client has encountered a connection error and is not queryable', 'Client was closed and is not queryable']);
const gone = (e: unknown) => e instanceof Error && (GONE_MESSAGES.has(e.message) || GONE_CODES.has(pgCode(e) ?? '') || (pgCode(e) ?? '').startsWith('08'));
/**
 * A client that's lent out lost its connection. pg says so as an error event, and the pool only listens for those on the
 * clients it's holding: one nobody listens for is an uncaught error, which stops the server. Whatever has the client hears
 * from the query it was running, or its next one, and says so in its own request (`query`).
 */
const lent = (e: Error) => dblog.debug('a lent connection went', { err: e });
/** What pg-pool says when no connection came free within `CONNECTION_WAIT_MS`. */
const busy = (e: unknown) => e instanceof Error && e.message === 'timeout exceeded when trying to connect';
/** Said in the request that waited, so its ID finds it; the request can be tried again. */
function busyError(e: unknown, context: { sql: string; ms: number }) {
  dblog.warn('no database connection came free', context);
  return new DatabaseBusyError(undefined, { cause: e, context });
}

export type Db = pg.Pool | pg.PoolClient;

/**
 * A transaction holds its connection until it's done, so everything it reads goes on that connection (`Db`), never the
 * pool: enough transactions each waiting for a second connection would wait for each other for ever. Nothing waits for a
 * connection longer than this, so whatever does go wrong comes back as an error.
 */
const CONNECTION_WAIT_MS = 10_000;
/** The longest one statement may run, lock waits included. */
export const STATEMENT_TIMEOUT_MS = 15_000;
export function createPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10, statement_timeout: STATEMENT_TIMEOUT_MS, connectionTimeoutMillis: CONNECTION_WAIT_MS });
  pool.on('error', (e) => dblog.error('idle database client failed', { err: e }));
  pool.on('acquire', (c) => { c.on('error', lent); });
  pool.on('release', (_e, c) => { c.off('error', lent); });
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
  const t0 = performance.now();
  const c = await pool.connect().catch((e: unknown) => {
    const context = { sql: 'BEGIN', ms: Math.round(performance.now() - t0) };
    throw busy(e) ? busyError(e, context) : new DatabaseError(undefined, { cause: e, context });
  });
  /** The connection went, and the transaction with it: there's nothing to roll back, and it never goes back to the pool. */
  let lost = false;
  try {
    await exec(c, 'BEGIN');
    const out = await fn(c);
    await exec(c, 'COMMIT');
    return out;
  } catch (e) {
    lost = e instanceof LostConnectionError;
    if (!lost) await exec(c, 'ROLLBACK').catch((r: unknown) => { lost = r instanceof LostConnectionError; if (!lost) dblog.error('rollback failed', { err: r }); });
    dblog.debug('transaction rolled back', { err: e });
    throw e;
  } finally {
    c.release(lost);
  }
}

export const bytea = z.instanceof(Uint8Array);
export const timestamp = z.date();
export const bigintText = z.union([z.string(), z.number()]).transform((v) => Number(v));
