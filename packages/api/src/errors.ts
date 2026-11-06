export type AlcoveErrorCode =
  | 'unauthenticated' | 'not-found' | 'forbidden' | 'invalid' | 'insufficient-credits' | 'conflict' | 'unavailable'
  | 'key-unavailable' | 'too-large' | 'network' | 'unknown';


/** Where a failed request went, for logs and bug reports. `requestId` matches the server's log lines. */
export interface ErrorDetails { requestId?: string | undefined; status?: number | undefined; method?: string | undefined; path?: string | undefined; cause?: unknown }


export class AlcoveApiError extends Error {
  readonly requestId: string | undefined;
  readonly status: number | undefined;
  readonly method: string | undefined;
  readonly path: string | undefined;
  constructor(public readonly code: AlcoveErrorCode, message: string, details: ErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'AlcoveApiError';
    this.requestId = details.requestId;
    this.status = details.status;
    this.method = details.method;
    this.path = details.path;
  }
}

/** The server's request ID behind an error, if it has one: quote it when reporting a problem. */
export const errorRequestId = (e: unknown): string | undefined => (e instanceof AlcoveApiError ? e.requestId : undefined);


export const ALCOVE_ERROR_CODES: readonly AlcoveErrorCode[] = ['unauthenticated', 'not-found', 'forbidden', 'invalid', 'insufficient-credits', 'conflict', 'unavailable', 'key-unavailable', 'too-large', 'network', 'unknown'];

export const isAlcoveErrorCode = (v: unknown): v is AlcoveErrorCode => typeof v === 'string' && ALCOVE_ERROR_CODES.some((c) => c === v);


/** A user-facing message for anything thrown. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong. Try again.';
}

export const errorCode = (e: unknown): AlcoveErrorCode => (e instanceof AlcoveApiError ? e.code : 'unknown');
