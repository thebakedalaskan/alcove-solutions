/*
 * The one logger for the API. Every module imports `log` (or a child of it) and never `console`.
 *
 * - Levels: debug < info < warn < error, set with LOG_LEVEL (default: info; debug in tests if asked).
 * - Format: JSON lines in production (LOG_FORMAT=json), readable lines in development (pretty). Each JSON line carries
 *   pino's numeric `level` and the `severity` Cloud Logging reads (DEBUG, INFO, WARNING, ERROR).
 * - Context: request ID, method, route and owner are attached automatically from AsyncLocalStorage;
 *   `log.child({...})` binds more. Errors go in `err` and are serialized with their cause chain.
 * - Privacy: never pass content (titles, names, chat, audio, notes, request bodies). Logs are built
 *   to leave the confidential VM, so they hold only IDs, codes, states, counts, sizes and timings.
 *   Two backstops catch mistakes: known secret field names are redacted, and every string (messages,
 *   fields, errors and their causes) is scrubbed of email addresses, bearer credentials, signed
 *   tokens and files' URLs. Postgres errors keep their codes but never echo row values.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type DestinationStream, type Logger as Pino } from 'pino';
import pretty from 'pino-pretty';

export type Level = 'debug' | 'info' | 'warn' | 'error';
type Value = string | number | boolean | null | undefined | readonly string[] | readonly number[];
/** Structured fields attached to a log line. Keep them to IDs, codes, counts, sizes and durations; errors go in `err`. */
export type LogContext = Record<string, unknown>;

const store = new AsyncLocalStorage<Record<string, Value>>();
/** Runs `fn` with fields every log line inside it will carry (used per request and per job). */
export const withLogContext = <T>(ctx: Record<string, Value>, fn: () => T): T => store.run({ ...store.getStore(), ...ctx }, fn);
/** Adds fields to the current context (e.g. the owner, once authenticated). */
export function addLogContext(ctx: Record<string, Value>) { const s = store.getStore(); if (s) Object.assign(s, ctx); }
export const currentLogContext = (): Record<string, Value> => ({ ...store.getStore() });

const REDACT = ['secret', 'root', 'wrapKey', 'key', 'krec', 'password', 'cookie', 'authorization', 'sessionId', 'body', 'plaintext', 'NEAR_AI_API_KEY', 'KMASTER', 'KSERVICE',
  'INDEX_KEY', 'PHOTO_KEY', 'LEGACY_KMASTER', 'LEGACY_KSERVICE', 'indexKey', 'photoKey', 'kservice', 'legacyKmaster', 'DATABASE_URL', 'OBJECTS_SECRET_KEY',
  'LIVEKIT_API_SECRET', 'GOOGLE_CLIENT_SECRET', 'CLOUDFLARE_API_TOKEN', 'privateKeyPem', 'subjectToken', 'access_token']
  .flatMap((k) => [k, `*.${k}`, `ctx.${k}`]);

export interface LogOptions { level?: Level | 'silent'; format?: 'json' | 'pretty'; destination?: DestinationStream; service?: string }

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const CREDENTIAL = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const SIGNED_TOKEN = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g;
/** Where a file is read from, as a browser's report of a picture that failed might quote it, whole or cut short. */
const FILE_URL = /\/v1\/media\/[A-Za-z0-9_.-]+/g;
/** What a string may not carry into a log line, wherever it came from. */
export const scrubText = (s: string): string => s.replace(EMAIL, '[email]').replace(CREDENTIAL, '$1 [redacted]').replace(SIGNED_TOKEN, '[token]').replace(FILE_URL, '/v1/media/[token]');
function scrubValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return scrubText(v);
  // pino calls this before its own serializers, so errors (and their causes) are serialized here first.
  if (v instanceof Error) return scrubValue({ ...pino.stdSerializers.errWithCause(v) }, depth + 1);
  if (v === null || typeof v !== 'object' || depth > 8) return v;
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1));
  return scrubObject(Object.fromEntries(Object.entries(v)), depth + 1);
}
/** Postgres explains a failed check with the row it refused ("Failing row contains (…)"): keep the code, not the row. */
function scrubObject(o: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = k === 'detail' && typeof v === 'string' && /^Failing row contains|^Key \(/.test(v) ? '[row hidden]' : scrubValue(v, depth);
  return out;
}

/** Cloud Logging's name for each level: it reads a line's `severity`, and takes a line without one as INFO whatever it says. */
const SEVERITY: Record<string, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR', fatal: 'CRITICAL' };

function build(o: LogOptions): Pino {
  const options = {
    level: o.level ?? 'info',
    base: { service: o.service ?? 'alcove-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    errorKey: 'err',
    // Errors are serialized (with their cause chain) by the scrubber below, so pino's own `err` serializer steps aside.
    serializers: { err: (v: unknown) => v },
    redact: { paths: REDACT, censor: '[redacted]' },
    formatters: {
      level: (label: string, number: number) => ({ level: number, severity: SEVERITY[label] ?? 'DEFAULT' }),
      log: (o: Record<string, unknown>) => scrubObject(o)
    },
    mixin: () => ({ ...store.getStore() })
  };
  if (o.destination) return pino(options, o.destination);
  return (o.format ?? 'pretty') === 'pretty'
    ? pino(options, pretty({ colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service,severity', singleLine: true }))
    : pino(options);
}

const state: { root: Pino } = { root: build({ level: (process.env['LOG_LEVEL'] ?? 'info') === 'debug' ? 'debug' : 'info', format: process.env['LOG_FORMAT'] === 'json' ? 'json' : 'pretty' }) };
/** (Re)configures the process logger. Call once at startup; tests pass an in-memory destination. */
export function configureLogging(o: LogOptions) { state.root = build(o); }

export class Logger {
  constructor(private readonly bound: LogContext = {}) {}
  child(ctx: LogContext): Logger { return new Logger({ ...this.bound, ...ctx }); }
  debug(msg: string, ctx: LogContext = {}) { this.emit('debug', msg, ctx); }
  info(msg: string, ctx: LogContext = {}) { this.emit('info', msg, ctx); }
  warn(msg: string, ctx: LogContext = {}) { this.emit('warn', msg, ctx); }
  error(msg: string, ctx: LogContext = {}) { this.emit('error', msg, ctx); }
  /** Logs at the given level (used where the level depends on the error). */
  at(level: Level, msg: string, ctx: LogContext = {}) { this.emit(level, msg, ctx); }
  isDebug() { return state.root.isLevelEnabled('debug'); }
  /** Times `fn` and logs its duration at debug, or at warn when slower than `slowMs`. */
  async timed<T>(msg: string, ctx: LogContext, fn: () => Promise<T>, slowMs = 500): Promise<T> {
    const t0 = performance.now();
    try { return await fn(); } finally {
      const ms = Math.round(performance.now() - t0);
      if (ms > slowMs) this.warn(`${msg} (slow)`, { ...ctx, ms }); else if (this.isDebug()) this.debug(msg, { ...ctx, ms });
    }
  }
  private emit(level: Level, msg: string, ctx: LogContext) { state.root[level]({ ...this.bound, ...ctx }, scrubText(msg)); }
}

export const log = new Logger();
export const flushLogs = () => state.root.flush();
