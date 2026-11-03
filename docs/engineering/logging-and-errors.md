# Logging and errors

How to find out what went wrong, anywhere in Alcove, without logging anything private.

## The short version

- Every response carries an `x-request-id` header. Error bodies repeat it: `{ code, message, requestId }`.
  In the browser it is `AlcoveApiError.requestId` (`errorRequestId(e)` from `@alcove/api`).
- Search the API log for that ID. Every line written while handling the request carries it: the access
  line, the error line (class, code, status, context, stack and cause chain), each database query and
  object-store call, and the module events (`unlocked`, `call started`, `audio piece stored`, ...).
- Browser warnings and errors are sent to the API (`POST /v1/telemetry`) and appear in the same log
  with `source: "browser"`, including the request ID of any failed request they mention.

## Server: `apps/api/src/log.ts`

One pino logger. Import `log` and make a child per component; never use `console` (the policy
script fails the build on it).

```ts
import { log } from '../log';
const clog = log.child({ component: 'calls' });
clog.info('call started', { callId, meetingId, notes: mode });
clog.warn('object delete failed; queued for retry', { objectId, err: e });
```

| Level | Use for |
| --- | --- |
| `debug` | Every query and object call with timing, request starts, audio pieces, ceremony details |
| `info` | Things that happened: sessions opened/closed, account created, call started/ended, ordinary refusals (404, 409, 401) |
| `warn` | Something is off but handled: failed passkey verification, forbidden requests, retries, slow queries (>250 ms), slow object calls (>1 s) |
| `error` | We failed: 5xx, integrity failures, lost data, maintenance failures, uncaught exceptions |

- **Context.** The request middleware sets `requestId`, `method` and `path` with AsyncLocalStorage; the
  auth middleware adds `ownerId`. `withLogContext()` and `addLogContext()` do the same for background
  work. Errors go in `err` and are serialized with their `cause` chain.
- **Config.** `LOG_LEVEL` (`debug | info | warn | error | silent`, default `info`) and `LOG_FORMAT`
  (`pretty` for a terminal, `json` in production, where Cloud Run parses each line).
- **Lifecycle.** Startup, migrations, listening, maintenance runs, `SIGTERM`/`SIGINT` shutdown (sessions
  zeroed, pool closed), unhandled rejections and uncaught exceptions are all logged.

## Errors: `apps/api/src/errors.ts`

Throw the most specific `AppError` subclass. Each has a stable client code, an HTTP status, a log level
and optional `context` (logged, never sent) and `cause` (logged with its stack).

| Class | Code | Status | Level |
| --- | --- | --- | --- |
| `ValidationError` | `invalid` | 400 | info |
| `AuthError` | `unauthenticated` | 401 | info |
| `LockedError` | `locked` | 423 | info |
| `ForbiddenError` | `forbidden` | 403 | warn |
| `KeyError` | `key-unavailable` | 403 | warn |
| `IntegrityError` | `key-unavailable` | 403 | error |
| `NotFoundError` | `not-found` | 404 | info |
| `ConflictError` | `conflict` | 409 | info |
| `UnavailableError` | `unavailable` | 503 | warn |
| `InternalError` (`DatabaseError`, `ObjectStoreError`) | `unknown` | 500 | error |

```ts
throw new ConflictError('Notes aren’t on.', { context: { callId, notes: s.notes.status } });
throw new AuthError('That passkey couldn’t be verified.', { cause: e, level: 'warn', context: { step: 'verify-assertion' } });
```

- The database layer wraps every failed query in `DatabaseError` with the statement's first words and
  the Postgres error code; the object store wraps failures in `ObjectStoreError` with the operation and
  object ID. Anything else thrown becomes an `InternalError` whose cause is the original.
- `app.onError` is the only place errors become responses: one log line at the error's level, and the
  client gets the code, the safe message and the request ID. Unexpected failures never leak their
  internal message.
- Zod failures report field paths and issue codes only (no values); on passkey routes they log at warn,
  which is how a password manager's malformed credential shows up.

## Browser: `apps/web/src/lib/log.ts`

The same four levels. `lib/api.ts` connects it to the API client's `onEvent` hook, so every failed
request is logged with method, path, status, code, duration and request ID; passkey ceremonies log
capability facts (PRF enabled, PRF key returned, key source, authenticator attachment).

- Console shows `debug`+ in development and `warn`+ in production. Set `localStorage["alcove:log"] =
  "debug"` to see everything in a deployed app. `recentLogs()` holds the last 200 entries.
- `warn` and `error` are batched to `POST /v1/telemetry` (at most 20 per request, 30 per minute, sent on
  page hide too). The endpoint is public, Origin-checked, rate-limited and schema-validated
  (`ClientLogBatchSchema`).
- Also logged: uncaught errors, unhandled rejections, crashed screens (router `defaultOnCatch`),
  non-API query failures, camera/microphone/screen failures, recorder errors and every audio upload
  retry or loss.

## Privacy rules for logs

Logs are operator-readable, so they get the same rule as database columns: nothing readable.

- Log IDs, codes, states, counts, sizes, durations and flags. Never titles, names, guests, chat, labels,
  search terms, notes, transcripts, audio, request bodies or key material.
- Session IDs are bearer secrets and are never logged; `ownerId` identifies a session. Credential IDs
  appear as their first 8 characters. Call codes are join tokens: paths show `/v1/calls/:code`.
- SQL is logged as static text; parameters never are.
- pino redacts common secret field names (`secret`, `prf`, `deviceSecret`, `root`, `key`, `cookie`,
  `authorization`, `body`, ...) as a backstop; the browser logger drops key-like and content-like fields
  and cuts strings to 300 characters.
- The privacy-at-rest integration test runs at debug level and checks the captured log for every
  canary (in several encodings), every PRF and device secret sent on the wire, the session cookie and
  the call code.

## Tests

`startHarness()` captures every log line at debug level in `h.logs` (set `TEST_LOGS=1` to also print
them). The `logging and errors` flows check that a failed request's ID matches its client error, its
header and its log lines; that callers' request IDs are kept and malformed ones replaced; that browser
reports are recorded and malformed or cross-site ones refused; and that an unexpected failure logs its
cause while the client gets only a generic message and a request ID.
