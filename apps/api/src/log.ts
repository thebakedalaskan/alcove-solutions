/*
 * The one logger for the API. Every module imports `log` (or a child of it) and never `console`.
 *
 * - Levels: debug < info < warn < error, set with LOG_LEVEL (default: info; debug in tests if asked).
 * - Format: JSON lines in production (LOG_FORMAT=json), readable lines in development (pretty).
 * - Context: request ID, method, route and owner are attached automatically from AsyncLocalStorage;
 *   `log.child({...})` binds more. Errors go in `err` and are serialized with their cause chain.
 * - Privacy: never pass content (titles, names, chat, audio, notes, request bodies). Known secret
 *   field names are redacted as a backstop.
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

const REDACT = ['secret', 'root', 'wrapKey', 'key', 'krec', 'password', 'cookie', 'authorization', 'sessionId', 'body', 'plaintext', 'NEAR_AI_API_KEY', 'KMASTER', 'KSERVICE', 'DATABASE_URL']
  .flatMap((k) => [k, `*.${k}`, `ctx.${k}`]);

export interface LogOptions { level?: Level | 'silent'; format?: 'json' | 'pretty'; destination?: DestinationStream; service?: string }

function build(o: LogOptions): Pino {
  const options = {
    level: o.level ?? 'info',
    base: { service: o.service ?? 'alcove-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'msg',
    errorKey: 'err',
    serializers: { err: pino.stdSerializers.errWithCause },
    redact: { paths: REDACT, censor: '[redacted]' },
    mixin: () => ({ ...store.getStore() })
  };
  if (o.destination) return pino(options, o.destination);
  return (o.format ?? 'pretty') === 'pretty'
    ? pino(options, pretty({ colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service', singleLine: true }))
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
  private emit(level: Level, msg: string, ctx: LogContext) { state.root[level]({ ...this.bound, ...ctx }, msg); }
}

export const log = new Logger();
export const flushLogs = () => state.root.flush();
