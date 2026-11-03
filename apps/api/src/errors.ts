/*
 * Error hierarchy. Every failure that reaches a client is an AppError with a stable code, an HTTP
 * status, a log level, a safe message, optional structured context, and an optional cause. Throw the
 * most specific subclass; wrap infrastructure failures (database, object store) with what was being
 * attempted so the log explains it.
 *
 *   AppError                code             status level  meaning
 *   ├─ ValidationError      invalid          400    info   bad input from the client
 *   ├─ AuthError            unauthenticated  401    info   no session / unknown passkey
 *   ├─ LockedError          locked           423    info   session ended
 *   ├─ ForbiddenError       forbidden        403    warn   authenticated but not allowed
 *   ├─ KeyError             key-unavailable  403    warn   wrong or missing key material
 *   ├─ IntegrityError       key-unavailable  403    error  stored data failed verification
 *   ├─ NotFoundError        not-found        404    info
 *   ├─ ConflictError        conflict         409    info   state changed / wrong state
 *   ├─ UnavailableError     unavailable      503    warn   not connected yet / rate limited
 *   └─ InternalError        unknown          500    error  our bug or a dependency failure
 *       ├─ DatabaseError                                   a Postgres query failed
 *       └─ ObjectStoreError                                an object store call failed
 *
 * The client gets { code, message, requestId }. The log gets the class, context, stack and causes.
 */
import type { AlcoveErrorCode } from '@alcove/api';
import type { Level, LogContext } from './log';

type Status = 400 | 401 | 402 | 403 | 404 | 409 | 423 | 500 | 502 | 503;
const DEFAULTS: Record<AlcoveErrorCode, { status: Status; level: Level }> = {
  invalid: { status: 400, level: 'info' }, unauthenticated: { status: 401, level: 'info' }, locked: { status: 423, level: 'info' },
  forbidden: { status: 403, level: 'warn' }, 'key-unavailable': { status: 403, level: 'warn' }, 'not-found': { status: 404, level: 'info' },
  conflict: { status: 409, level: 'info' }, 'insufficient-credits': { status: 402, level: 'info' }, unavailable: { status: 503, level: 'warn' },
  network: { status: 502, level: 'error' }, unknown: { status: 500, level: 'error' }
};
export interface ErrorOptions { cause?: unknown; context?: LogContext; level?: Level }

export class AppError extends Error {
  readonly code: AlcoveErrorCode;
  readonly status: Status;
  readonly level: Level;
  /** Structured, non-sensitive details for the log (IDs, states, counts). Never sent to the client. */
  readonly context: LogContext;
  constructor(code: AlcoveErrorCode, message: string, o: ErrorOptions = {}) {
    super(message, o.cause === undefined ? undefined : { cause: o.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = DEFAULTS[code].status;
    this.level = o.level ?? DEFAULTS[code].level;
    this.context = o.context ?? {};
  }
}
export class ValidationError extends AppError { constructor(m: string, o?: ErrorOptions) { super('invalid', m, o); } }
export class AuthError extends AppError { constructor(m: string, o?: ErrorOptions) { super('unauthenticated', m, o); } }
export class LockedError extends AppError { constructor(m = 'Your session ended. Unlock with your passkey to continue.', o?: ErrorOptions) { super('locked', m, o); } }
export class ForbiddenError extends AppError { constructor(m: string, o?: ErrorOptions) { super('forbidden', m, o); } }
export class KeyError extends AppError { constructor(m: string, o?: ErrorOptions) { super('key-unavailable', m, o); } }
export class NotFoundError extends AppError { constructor(m: string, o?: ErrorOptions) { super('not-found', m, o); } }
export class ConflictError extends AppError { constructor(m: string, o?: ErrorOptions) { super('conflict', m, o); } }
export class UnavailableError extends AppError { constructor(m: string, o?: ErrorOptions) { super('unavailable', m, o); } }
export class InternalError extends AppError { constructor(m = 'Something went wrong on our side.', o?: ErrorOptions) { super('unknown', m, o); } }
export class DatabaseError extends InternalError {}
export class ObjectStoreError extends InternalError {}
/** Stored data failed verification (tampering, corruption, or a bug). Logged as an error, reported as key-unavailable. */
export class IntegrityError extends AppError { constructor(m: string, o?: ErrorOptions) { super('key-unavailable', m, { level: 'error', ...o }); } }

export const notFound = (what: string, context?: LogContext) => new NotFoundError(`${what} doesn’t exist, or you don’t have access to it.`, context ? { context } : {});
export const conflict = (message: string, context?: LogContext) => new ConflictError(message, context ? { context } : {});
export const invalid = (message: string, context?: LogContext) => new ValidationError(message, context ? { context } : {});

/** Turns anything thrown into an AppError, keeping the original as the cause. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  return new InternalError(undefined, { cause: e });
}
