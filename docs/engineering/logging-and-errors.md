# Logging and errors

How to find out what went wrong, anywhere in Alcove, without logging anything private.

## The short version

- Every response carries an `x-request-id` header. Error bodies repeat it: `{ code, message, requestId }`.
  In the browser it is `AlcoveApiError.requestId` (`errorRequestId(e)` from `@alcove/api`).
- Search the API log for that ID. Every line written while handling the request carries it: the access
  line, the error line (class, code, status, context, stack and cause chain), each database query and
  object-store call, and the module events (`signed in`, `call started`, `audio piece stored`,
  `clip transcribed`, ...). The notes worker keeps going after the request that stopped the recording has
  answered, and maintenance runs it with no request at all: find its lines by `noteId` or `jobId`.
- Browser warnings and errors are sent to the API (`POST /v1/telemetry`) and appear in the same log
  with `source: "browser"`, including the request ID of any failed request they mention.

## Server: `apps/api/src/log.ts`

One pino logger. Import `log` and make a child per component; never use `console` (the policy
script fails the build on it).

```ts
import { log } from '../log';
const clog = log.child({ component: 'calls' });
clog.info('call started', { callId, meetingId, notes: s.notes.status });
clog.warn('object delete failed; queued for retry', { objectId, err: e });
```

| Level | Use for |
| --- | --- |
| `debug` | Every query and object call with timing, request starts, audio pieces, transcript clips and NEAR AI replies (sizes, counts, timings), people searches |
| `info` | Things that happened: sign-ins, accounts created, sessions opened and ended, Google connected, calls placed on or changed in a calendar, calls started and ended, notes jobs queued, notes written, questions answered, notes shared or deleted, ordinary refusals (400, 401, 404, 409) |
| `warn` | Something is off but handled: forbidden requests, keys that can't open data, rate limits and services not connected yet or busy, notes retried after a failed attempt, calendar changes that didn't reach Google (the call is kept), retries, slow queries (>250 ms), slow object calls (>1 s) |
| `error` | We failed: 5xx, integrity failures, lost data, a Google sign-in that failed on our side, notes finished without a summary after their last attempt, maintenance failures, uncaught exceptions |

- **Context.** The request middleware sets `requestId`, `method` and `path` with AsyncLocalStorage; the
  auth middleware adds `ownerId`. `withLogContext()` and `addLogContext()` do the same for background
  work. Errors go in `err` and are serialized with their `cause` chain.
- **Config.** `LOG_LEVEL` (`debug | info | warn | error | silent`, default `info`) and `LOG_FORMAT`
  (`pretty` for a terminal, `json` in production, where Cloud Run parses each line).
- **Lifecycle.** Startup, migrations, listening, maintenance runs, `SIGTERM`/`SIGINT` shutdown (server and
  pool closed), unhandled rejections and uncaught exceptions are all logged.

## Errors: `apps/api/src/errors.ts`

Throw the most specific `AppError` subclass. Each has a stable client code, an HTTP status, a log level
and optional `context` (logged, never sent) and `cause` (logged with its stack).

| Class | Code | Status | Level |
| --- | --- | --- | --- |
| `ValidationError` | `invalid` | 400 | info |
| `AuthError` | `unauthenticated` | 401 | info |
| `ForbiddenError` | `forbidden` | 403 | warn |
| `KeyError` | `key-unavailable` | 403 | warn |
| `IntegrityError` | `key-unavailable` | 403 | error |
| `NotFoundError` | `not-found` | 404 | info |
| `ConflictError` | `conflict` | 409 | info |
| `UnavailableError` | `unavailable` | 503 | warn |
| `InternalError` (`DatabaseError`, `ObjectStoreError`) | `unknown` | 500 | error |

```ts
throw new ConflictError('Notes aren’t recording right now.', { context: { callId, notes: state.notes.status } });
throw new KeyError('This key can’t open that data.', { cause: err, context: { scopeId } });
```

- The database layer wraps every failed query in `DatabaseError` with the statement's first words and
  the Postgres error code; the object store wraps failures in `ObjectStoreError` with the operation and
  object ID. Anything else thrown becomes an `InternalError` whose cause is the original.
- `app.onError` is the only place errors become responses: one log line at the error's level, and the
  client gets the code, the safe message and the request ID. Unexpected failures never leak their
  internal message.
- Zod failures become a `ValidationError` that reports field paths and issue codes only (no values),
  logged at info.
- Rate limits answer `503 unavailable` ("Too many attempts. Wait a minute and try again.") and log the
  limit's name: `sign-in` (30 a minute) and `telemetry` (60 a minute) per client address, `transcribe`
  (120 a minute, calls and room recordings together) and `ask` (20 a minute) per account. Google sign-in
  goes back to the welcome screen with `signin=busy` instead.
- An audio piece over 2 MiB or a transcript clip over `MAX_TRANSCRIPT_CLIP_BYTES` is refused as
  `400 invalid` from its `content-length`, before the body is read.
- NEAR AI's failures become `ValidationError` (`400`, `413`, `422`), `InternalError` (`401`, `403`) or
  `UnavailableError` (unreachable, timed out, an unreadable reply, or any other status such as `429` or
  `5xx`), with the operation, status and timing as context. Evidence or a reply that doesn't check out is
  an `UnverifiedError` (an `UnavailableError`, logged at error, or warn when a service couldn't be reached),
  with the model, the task and the check that failed
  ([Notes and inference › Models and requests](notes-and-inference.md#models-and-requests)).

## Browser: `apps/web/src/lib/log.ts`

The same four levels. `lib/api.ts` connects it to the API client's `onEvent` hook, so every failed
request is logged with method, path, status, code, duration and request ID. A `401 unauthenticated` is
logged at debug: being signed out is an ordinary state.

- Console shows `debug`+ in development and `warn`+ in production. Set `localStorage["alcove:log"] =
  "debug"` to see everything in a deployed app. `recentLogs()` holds the last 200 entries.
- `warn` and `error` are batched to `POST /v1/telemetry` (at most 20 per request, 30 per minute, sent on
  page hide too). The endpoint is public, Origin-checked, rate-limited and schema-validated
  (`ClientLogBatchSchema`).
- Also logged: uncaught errors, unhandled rejections, crashed screens (router `defaultOnCatch`),
  non-API query failures, camera/microphone/screen failures, recorder errors and every audio upload
  retry or loss.

## Privacy rules for logs

Logs are operator-readable, so they get the same rule as database columns: nothing readable. They're
built to leave the confidential VM ([Privacy › Production requirements](privacy-keys-and-sessions.md#production-requirements)):
whoever reads them can debug a request from its ID, timings, codes, states and sizes, and learns nothing
about what anyone said, wrote or who they are.

- Log IDs, codes, states, counts, sizes, durations and flags. Never titles, names, emails, guests, chat,
  search terms, questions, notes, transcripts, prompts or model replies, audio, request bodies or key
  material.
- Session IDs are bearer secrets and are never logged; `ownerId` identifies a session. Call codes are join
  tokens: paths show `/v1/calls/:code`. Paths never include the query, so the Google callback's code and
  state stay out too.
- Google's tokens are never logged, nor its error descriptions: only its error code (such as
  `invalid_grant`). `inference.ts` logs only models, sizes, durations, counts, statuses, timings, finish
  reasons and token counts; `evidence.ts` only models, result codes, durations, TCB statuses, advisory IDs,
  GPU counts and hashes of keys, quotes and configurations, never the evidence itself.
- SQL is logged as static text; parameters never are.
- pino redacts common secret field names (`secret`, `root`, `wrapKey`, `key`, `krec`, `cookie`,
  `authorization`, `body`, `plaintext`, ...) as a backstop; the browser logger drops key-like and
  content-like fields and cuts strings to 300 characters.
- A second backstop scrubs every string on its way out, wherever it came from (messages, fields,
  browser reports, errors and their causes): email addresses become `[email]`, bearer and basic
  credentials `Bearer [redacted]`, and signed tokens (JWTs) `[token]`. Errors are serialized with their
  whole cause chain before scrubbing, so nothing is lost for debugging. Postgres's own explanations that
  echo a row (`Failing row contains (…)`, `Key (…)=(…)`) are replaced by `[row hidden]`; the code
  (`pgCode`) and the statement's static text stay.
- Client addresses (IPs) and user agents are never logged. The rate limiter keys by address in memory
  only.
- The privacy-at-rest integration test runs at debug level and checks the captured log for every
  canary (names, emails, titles, guests, chat, speech, audio and search terms, and a Google account's ID,
  name, address and photo, in several encodings), every session and Google sign-in attempt cookie the
  browser received, Google refresh tokens, and the call code. It also checks that, across the whole test
  run, the log holds no email address of anyone and no client address.

## Tests

`startHarness()` captures every log line at debug level in `h.logs` (set `TEST_LOGS=1` to also print
them). The `logging and errors` flows check that a failed request's ID matches its client error, its
header and its log lines; that callers' request IDs are kept and malformed ones replaced; that browser
reports are recorded and malformed or cross-site ones refused; and that an unexpected failure logs its
cause while the client gets only a generic message and a request ID.
