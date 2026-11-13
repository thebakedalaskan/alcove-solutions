/*
 * Error hierarchy. Every failure that reaches a client is an AppError with a stable code, an HTTP
 * status, a log level, a safe message, optional structured context, and an optional cause. Throw the
 * most specific subclass; wrap infrastructure failures (database, object store) with what was being
 * attempted so the log explains it.
 *
 *   AppError                code             status level  meaning
 *   ├─ ValidationError      invalid          400    info   bad input from the client
 *   ├─ AuthError            unauthenticated  401    info   not signed in, or the session ended
 *   ├─ ForbiddenError       forbidden        403    warn   authenticated but not allowed
 *   ├─ KeyError             key-unavailable  403    warn   wrong or missing key material
 *   ├─ IntegrityError       key-unavailable  403    error  stored data failed verification
 *   ├─ NotFoundError        not-found        404    info
 *   ├─ ConflictError        conflict         409    info   state changed / wrong state
 *   │   └─ ClientTakenError                                a change from the server was worked out as a Yjs client someone wrote as first
 *   ├─ TooLargeError        too-large        413    info   more than something can hold
 *   ├─ PlanLimitError       plan-limit       402    info   the plan's notes or storage have run out for whoever pays
 *   ├─ UnavailableError     unavailable      503    warn   not connected yet / rate limited
 *   │   └─ UnverifiedError                          warn   a model's attestation didn't check out (or couldn't be checked), so it was sent nothing
 *   └─ InternalError        unknown          500    error  our bug or a dependency failure
 *       ├─ DatabaseError                                   a Postgres query failed
 *       ├─ ObjectStoreError                                an object store call failed
 *       └─ MediaError                                      ffmpeg couldn't remux or decode a shared screen's video
 *
 * The client gets { code, message, requestId }. The log gets the class, context, stack and causes.
 */
import type { AlcoveErrorCode } from '@alcove/api';
import type { Level, LogContext } from './log';

type Status = 400 | 401 | 402 | 403 | 404 | 409 | 413 | 500 | 502 | 503;
const DEFAULTS: Record<AlcoveErrorCode, { status: Status; level: Level }> = {
  invalid: { status: 400, level: 'info' }, unauthenticated: { status: 401, level: 'info' },
  forbidden: { status: 403, level: 'warn' }, 'key-unavailable': { status: 403, level: 'warn' }, 'not-found': { status: 404, level: 'info' },
  conflict: { status: 409, level: 'info' }, 'too-large': { status: 413, level: 'info' }, 'plan-limit': { status: 402, level: 'info' }, unavailable: { status: 503, level: 'warn' },
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
export class ForbiddenError extends AppError { constructor(m: string, o?: ErrorOptions) { super('forbidden', m, o); } }
export class GoogleSignupInviteRequiredError extends ForbiddenError {
  constructor() { super('An invitation is required to sign up with Google.', { level: 'info' }); }
}
export class GoogleEmailRequiredError extends ForbiddenError {
  constructor() { super('A Gmail or Google Workspace address is required.', { level: 'info' }); }
}
export class KeyError extends AppError { constructor(m: string, o?: ErrorOptions) { super('key-unavailable', m, o); } }
export class NotFoundError extends AppError { constructor(m: string, o?: ErrorOptions) { super('not-found', m, o); } }
export class ConflictError extends AppError { constructor(m: string, o?: ErrorOptions) { super('conflict', m, o); } }
/**
 * A change the server made to a document was worked out as a Yjs client the log has had by the time it was written, so it's
 * taken back with the transaction writing it, and worked out again on the document as it now stands. It reaches whoever
 * asked only when that keeps happening, as the document's changing that fast.
 */
export class ClientTakenError extends ConflictError { constructor(m = 'This document is changing too fast to change from here. Try again.', o?: ErrorOptions) { super(m, o); } }
export class TooLargeError extends AppError { constructor(m: string, o?: ErrorOptions) { super('too-large', m, o); } }
/**
 * What a plan brings has run out for whoever pays (features/billing): its notes, so no AI request goes out for them, or
 * its storage, so nothing more is stored. `reason` says which.
 */
export class PlanLimitError extends AppError {
  constructor(m: string, readonly reason: 'notes' | 'storage', o?: ErrorOptions) { super('plan-limit', m, { ...o, context: { ...o?.context, reason } }); }
}
export class UnavailableError extends AppError { constructor(m: string, o?: ErrorOptions) { super('unavailable', m, o); } }
/**
 * NEAR AI's evidence for a model didn't check out, or couldn't be checked, so nothing with content was sent
 * to it. The notes worker waits for evidence that checks out instead of counting this as a failed attempt.
 */
export class UnverifiedError extends UnavailableError {}
/**
 * NEAR AI didn't answer: it timed out, couldn't be reached, or was busy. Nothing about the request was wrong,
 * so the notes worker waits and tries again instead of counting this as a failed attempt, unless it timed out once
 * sent (`context.timedOut`): that one was charged what it held, so it counts.
 */
export class UnansweredError extends UnavailableError {}
/**
 * The database connection a request was using went before it answered: Postgres ended it, or it dropped on the way. A
 * transaction on it goes with it, so the request can be tried again.
 */
export class LostConnectionError extends UnavailableError { constructor(m = 'Alcove lost its connection to the database. Try again.', o?: ErrorOptions) { super(m, o); } }
/**
 * Every database connection was in use for as long as a request may wait for one. Nothing about the request was wrong
 * and nothing of it was done, so it can be tried again.
 */
export class DatabaseBusyError extends UnavailableError { constructor(m = 'Alcove is busy right now. Try again in a moment.', o?: ErrorOptions) { super(m, o); } }
export class InternalError extends AppError { constructor(m = 'Something went wrong on our side.', o?: ErrorOptions) { super('unknown', m, o); } }
export class DatabaseError extends InternalError {}
export class ObjectStoreError extends InternalError {}
export class MediaError extends InternalError {}
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
