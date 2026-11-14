import pg from 'pg';
import { z } from 'zod';
import { DatabaseBusyError, DatabaseError, LostConnectionError, UnavailableError } from './errors';
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
/**
 * Connections to the database: ten for the API's work, or `max`, as for the one the edge holds its certificate lock on.
 * `readOnly`: Postgres refuses every write on them (the checks job, operator-job.ts, which never writes).
 */
export function createPool(url: string, max = 10, o: { readOnly?: boolean } = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: url, max, statement_timeout: STATEMENT_TIMEOUT_MS, connectionTimeoutMillis: CONNECTION_WAIT_MS,
    ...(o.readOnly ? { options: '-c default_transaction_read_only=on' } : {})
  });
  pool.on('error', (e) => dblog.error('idle database client failed', { err: e }));
  pool.on('acquire', (c) => { c.on('error', lent); });
  pool.on('release', (_e, c) => { c.off('error', lent); });
  return pool;
}

/** The waits between a starting server's tries to reach its database: 1 s, doubling to 15 s at most. */
const FIRST_WAIT_MS = 1_000;
const MOST_WAIT_MS = 15_000;
/**
 * Postgres's answers that are about the connection or the server's resources (classes 08, 53, 57 and 58: a connection
 * failing, too many connections, a server starting or stopping, a system error), which a later try can get past. Any other
 * answer, such as a wrong password or no such database, is the same however often it's asked.
 */
const PASSING_CLASSES = new Set(['08', '53', '57', '58']);
/** What a try to connect failed with, for the log: Postgres's code or the system's, or how pg says it ended. Never its message. */
function connectFailure(e: unknown): string {
  const code = pgCode(e);
  if (code) return code;
  if (e instanceof Error && e.message === 'Connection terminated due to connection timeout') return 'connect-timeout';
  if (e instanceof Error && GONE_MESSAGES.has(e.message)) return 'connection-ended';
  return 'unknown';
}
/** What the system says when a connection to the database can't be made at all: nobody there, or no way there. */
const UNREACHED = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
/**
 * Whether a failure says the database can't be reached now, rather than that what was asked of it was wrong: a connection
 * lost (LostConnectionError) or none free (DatabaseBusyError), or one that couldn't be made, as a start's tries tell them
 * apart (`connectFailure`, PASSING_CLASSES). What an operator's read falls back on memory for (http/operator.ts).
 */
export function unreachable(e: unknown): boolean {
  if (e instanceof LostConnectionError || e instanceof DatabaseBusyError) return true;
  if (!(e instanceof DatabaseError)) return false;
  const code = connectFailure(e.cause);
  return UNREACHED.has(code) || PASSING_CLASSES.has(code.slice(0, 2)) || code === 'connect-timeout' || code === 'connection-ended';
}

/**
 * A starting server's first connection, tried until it's made or `forMs` has gone (DATABASE_WAIT_MS). Each try is an ordinary
 * connection, which pg gives up on after CONNECTION_WAIT_MS, and between tries the wait doubles from FIRST_WAIT_MS to
 * MOST_WAIT_MS, each said at warn with the try, how long it took, the wait and what it failed with. On 2026-11-13 five of
 * the eighteen VMs production started in Confidential Space had their first connection through the Cloud SQL Auth Proxy
 * cut at those 10 s and refused to start, which cost each a reboot, about three minutes, and each connected at once after it.
 * Postgres answering that it won't take this connection (a wrong password, no such database) is refused at once.
 */
export async function waitForDatabase(pool: pg.Pool, forMs: number): Promise<void> {
  const t0 = performance.now();
  const since = () => Math.round(performance.now() - t0);
  for (let attempt = 1; ; attempt++) {
    const tried = performance.now();
    try {
      const c = await pool.connect();
      c.release();
      if (attempt > 1) dblog.info('database reached', { attempts: attempt, ms: since() });
      return;
    } catch (e) {
      const code = connectFailure(e);
      if (e instanceof pg.DatabaseError && !PASSING_CLASSES.has(code.slice(0, 2))) {
        throw new DatabaseError('The database refused this server’s connection.', { cause: e, context: { attempts: attempt, code, ms: since() } });
      }
      const left = forMs - since();
      if (left <= 0) {
        throw new UnavailableError(`The database couldn’t be reached: ${attempt} ${attempt === 1 ? 'try' : 'tries'} in ${Math.round(since() / 1000)} s.`, { cause: e, context: { attempts: attempt, code, ms: since() } });
      }
      const retryInMs = Math.min(MOST_WAIT_MS, FIRST_WAIT_MS * 2 ** (attempt - 1), left);
      dblog.warn('database not reachable yet; trying again', { attempt, code, tookMs: Math.round(performance.now() - tried), retryInMs });
      await new Promise((r) => setTimeout(r, retryInMs));
    }
  }
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
