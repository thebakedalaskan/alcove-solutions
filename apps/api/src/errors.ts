import type { AlcoveErrorCode } from '@alcove/api';

const STATUS: Record<AlcoveErrorCode, 400 | 401 | 402 | 403 | 404 | 409 | 423 | 500 | 502 | 503> = {
  unauthenticated: 401, locked: 423, 'not-found': 404, forbidden: 403, invalid: 400, 'insufficient-credits': 402,
  conflict: 409, unavailable: 503, 'key-unavailable': 403, network: 502, unknown: 500
};

/** An error with a stable code and a message safe to show the user. */
export class ApiError extends Error {
  readonly code: AlcoveErrorCode;
  constructor(code: AlcoveErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ApiError';
  }
  get status() { return STATUS[this.code]; }
}

export const notFound = (what: string) => new ApiError('not-found', `${what} doesn’t exist, or you don’t have access to it.`);
export const conflict = (message: string) => new ApiError('conflict', message);
export const invalid = (message: string) => new ApiError('invalid', message);
