/*
 * The app's one logger. Import `log` (or `log.child({...})`) instead of using `console`.
 *
 * - Levels: debug < info < warn < error. The console shows debug and up in development, warn and up
 *   in production; set localStorage "alcove:log" to "debug" to see everything in a deployed app.
 * - Warnings and errors are batched to the API (`api.diagnostics.report`) so they land in the server
 *   log beside the request IDs they mention. The last 200 lines are kept in memory: `recentLogs()`.
 * - Privacy: context holds codes, names, statuses, sizes, flags and IDs. Never titles, names, chat,
 *   notes, transcripts or keys. Strings are cut to 300 characters; key-like fields are dropped.
 */
import { AlcoveApiError, type ClientLogEntry } from '@alcove/api';

export type Level = 'debug' | 'info' | 'warn' | 'error';
type Primitive = string | number | boolean | null;
export type LogContext = Record<string, unknown>;
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET = /^(secret|deviceSecret|key|root|token|cookie|password|credential|transcript|chat|title|text|body|name|email|guests)$/i;

const storedLevel = (): Level | undefined => {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem('alcove:log');
    return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : undefined;
  } catch { return undefined; }
};
const consoleLevel: Level = storedLevel() ?? (import.meta.env.DEV ? 'debug' : 'warn');
const REPORT_LEVEL: Level = 'warn';

/** Flattens an error into safe fields: its class, code, request ID, status and a short message. */
function describe(e: unknown): Record<string, Primitive> {
  if (e instanceof AlcoveApiError) return { errorName: e.name, errorCode: e.code, requestId: e.requestId ?? null, status: e.status ?? null, path: e.path ?? null, method: e.method ?? null, errorMessage: e.message.slice(0, 300) };
  if (e instanceof Error) return { errorName: e.name, errorMessage: e.message.slice(0, 300), stack: (e.stack ?? '').split('\n').slice(0, 6).join('\n').slice(0, 300) };
  return { errorName: typeof e, errorMessage: typeof e === 'string' ? e.slice(0, 300) : null };
}
function sanitize(ctx: LogContext): Record<string, Primitive> {
  const out: Record<string, Primitive> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (k === 'err') { Object.assign(out, describe(v)); continue; }
    if (SECRET.test(k)) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 300);
    else if (v !== undefined) out[k] = String(v).slice(0, 100);
  }
  return out;
}

const recent: ClientLogEntry[] = [];
let queue: ClientLogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let reporter: ((entries: ClientLogEntry[]) => Promise<void>) | undefined;
/** At most 30 reports a minute, so a crash loop can't flood the API. No timers at import: the shell is prerendered in Node. */
const budget = { windowStart: 0, used: 0 };
function takeReport(): boolean {
  const now = Date.now();
  if (now - budget.windowStart > 60_000) { budget.windowStart = now; budget.used = 0; }
  return budget.used++ < 30;
}
const inBrowser = () => typeof window !== 'undefined';

/** Wired once by lib/api.ts, so this module doesn't import the API. */
export function setLogReporter(fn: (entries: ClientLogEntry[]) => Promise<void>) { reporter = fn; }
export function flushLogs() {
  if (timer) { clearTimeout(timer); timer = undefined; }
  const batch = queue.splice(0, 20);
  if (batch.length && reporter) void reporter(batch);
}
export const recentLogs = (): readonly ClientLogEntry[] => recent;

function emit(level: Level, msg: string, ctx: LogContext) {
  const entry: ClientLogEntry = { level, msg: msg.slice(0, 200), at: new Date().toISOString(), context: sanitize(ctx) };
  recent.push(entry); if (recent.length > 200) recent.shift();
  if (RANK[level] >= RANK[consoleLevel]) {
    // The only console use in the app.
    const out = level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'info' ? console.info : console.debug;
    out(`[alcove] ${msg}`, entry.context);
  }
  if (inBrowser() && RANK[level] >= RANK[REPORT_LEVEL] && takeReport()) {
    queue.push({ ...entry, context: { ...entry.context, page: location.pathname.replace(/\/(call|join)\/[^/]+/, '/$1/:code').slice(0, 80) } });
    if (queue.length >= 20) flushLogs(); else timer ??= setTimeout(flushLogs, 2000);
  }
}

export class Logger {
  constructor(private readonly bound: LogContext = {}) {}
  child(ctx: LogContext) { return new Logger({ ...this.bound, ...ctx }); }
  debug(msg: string, ctx: LogContext = {}) { emit('debug', msg, { ...this.bound, ...ctx }); }
  info(msg: string, ctx: LogContext = {}) { emit('info', msg, { ...this.bound, ...ctx }); }
  warn(msg: string, ctx: LogContext = {}) { emit('warn', msg, { ...this.bound, ...ctx }); }
  error(msg: string, ctx: LogContext = {}) { emit('error', msg, { ...this.bound, ...ctx }); }
  at(level: Level, msg: string, ctx: LogContext = {}) { emit(level, msg, { ...this.bound, ...ctx }); }
}
export const log = new Logger();

let installed = false;
/** Reports uncaught errors and rejected promises, and flushes pending reports when the page hides. */
export function installGlobalLogging() {
  if (installed || !inBrowser()) return;
  installed = true;
  window.addEventListener('error', (ev) => log.error('uncaught error', { err: ev.error ?? ev.message, source: ev.filename.split('/').pop() ?? '', line: ev.lineno }));
  window.addEventListener('unhandledrejection', (ev) => log.error('unhandled promise rejection', { err: ev.reason }));
  window.addEventListener('pagehide', flushLogs);
  log.info('app started', { build: import.meta.env.MODE, consoleLevel });
}
