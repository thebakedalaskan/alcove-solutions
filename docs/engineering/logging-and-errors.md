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

## Server: `apps/api/src/platform/log.ts`

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
| `info` | Things that happened: sign-ins, accounts created and deleted, sessions opened and ended, Google connected, calls placed on or changed in a calendar, calls started and ended, notes jobs queued, notes written, questions answered, notes shared or deleted, ordinary refusals (400, 401, 404, 409) |
| `warn` | Something is off but handled: forbidden requests, keys that can't open data, rate limits and services not connected yet or busy, notes retried after a failed attempt, calendar changes that didn't reach Google (the call is kept), calls a deleted account's Google Calendar didn't cancel and grants Google didn't revoke (the deletion goes ahead), retries, slow queries (>250 ms), slow object calls (>1 s) |
| `error` | We failed: 5xx, integrity failures, lost data, a Google sign-in that failed on our side, notes finished without a summary after their last attempt, maintenance failures, uncaught exceptions |

- **Context.** The request middleware sets `requestId`, `method` and `path` with AsyncLocalStorage; the
  auth middleware adds `ownerId`. `withLogContext()` and `addLogContext()` do the same for background
  work. Errors go in `err` and are serialized with their `cause` chain.
- **Config.** `LOG_LEVEL` (`debug | info | warn | error | silent`, default `info`) and `LOG_FORMAT`
  (`pretty` for a terminal, `json` in production, where each line is one JSON object Cloud Logging reads: pino's numeric
  `level`, and beside it the `severity` Cloud Logging files it under (`DEBUG`, `INFO`, `WARNING`, `ERROR`), so an API line at
  error is an error there too).
- **Lifecycle.** Startup, migrations, listening, maintenance runs, `SIGTERM`/`SIGINT` shutdown (server and
  pool closed), unhandled rejections and uncaught exceptions are all logged. Each step of a start says how it went as it
  ends, `boot step` at info, or error when it failed: `step` (`google-cloud` inside a TEE, then `config`, `database`,
  `migrations`, `keys`, `objects`, and `edge` with `TLS_HOSTS` or else `listening`), `ms`, `ok`, and the error's
  `errorClass` and `code`. A failed step is followed by `refused to start` with the error. `operator release` shows the
  steps of the start that's serving, so a slow start shows too ([Operating Alcove](operating-alcove.md)).

### Where production logs are

The API runs in Confidential Space ([its runbook](../../infra/confidential-space/README.md#logs)). The launcher sends the
container's stdout and stderr to Cloud Logging, as resource `gce_instance` and log `confidential-space-launcher`, so a
request ID is found with:

```sh
gcloud --project=alcove-solutions logging read \
  'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND "<request id>"'
```

Each API line reaches Cloud Logging as text in `jsonPayload.message` (the launcher sends it through journald unparsed), so
filter on its own level as text: `jsonPayload.message:"\"level\":50"` for errors, and `"\"level\":40"` for warnings.

The Cloud SQL Auth Proxy beside the API logs there too, as JSON, and so does the launcher itself: when it starts, the
image's labels and ports, and the full claims of every attestation token it refreshes, the container's environment
included. That's why the environment carries no secrets ([Settings](../../infra/confidential-space/README.md#settings)).
The production image has no SSH and shows nothing of a failed workload but its exit, so these lines are what there is.
The load balancer keeps no request logs, so client addresses aren't logged there either. The migration job still runs
on Cloud Run, and logs there.

Operators also read each instance's recent failures from inside it, without Cloud Logging, through the signed operator
routes: `operator errors`, `operator request <id>` and `operator work`, read from the ring below
([Operating Alcove](operating-alcove.md), whose runbooks hold the Cloud Logging queries for each case).

### The ring and the audit line

Each instance keeps, in memory (`platform/recent.ts`), the lines that say something went wrong: every warn and error line,
and every request's own line once it's refused or failed (`request refused`, `request failed`). The logger feeds it as it
writes, after scrubbing, so every feature's failures are there, background work's included, with no counting of their
own. Each line is reduced to fields that hold no free text: the time and level, `component`, `msg` (with anything a
terminal would act on replaced), the request's `requestId` and the `route` it matched, its method and template
(`GET /v1/notes/:id`) from the routes registered, never the path that was sent, which holds whatever the client typed and,
for a photo, a token that shows someone's face; `status`, the error's class and code, `upstreamStatus` and `what` (from the
line, or its error's context), `final` (below), and the IDs among the line's fields (`ownerId`, `callId`, `noteId`,
`jobId`, `depositId`, `recordingId`, `grantId`). Nothing else is kept, so it holds less than the log. A request is one line
there: its error's line isn't kept, and what it says (its class, code, upstream status and IDs) is on the request's own
line, in Cloud Logging too, beside the route.

What anyone can send can't push out what the server says about itself:

- requests' own lines and every other warn and error line are kept apart, the newest 5,000 of each;
- what's logged while answering one client's requests, and by the work they start, is kept up to that client's share, 120
  lines a minute, and only counted past it (`notKept.overShare` in `operator errors`); the client's address is held in
  memory for that, never logged;
- a request that matched no route isn't kept at all, only counted (`notKept.unrouted`);
- a line that says a piece of work was given up for good names its kind as `final` (`notes-without-summary` from the writer,
  `drive-export-failed` from the exporter), and is kept a third time, in a list of the newest 1,000 that only such lines
  reach, whatever their client's share: `operator work`'s finals are read from it.

A logger made with `{ ring: false }` never feeds it, whatever its lines say: the browser's telemetry is logged that way,
since its fields could claim any component or request ID, and so are the audit line below and a request's error line. It's
this process's memory alone, gone with a restart. `operator errors` counts it, saying when a window reaches back further
than what it still holds, `operator request <id>` gives one request's lines, and `operator work` gives its finals.

Every operator request, allowed or refused, logs one audit line, `operator call` (component `operator`): at warn when the
signed-request check refused it (it has a `why`), at error when it failed, and otherwise at info, a handler's ordinary
refusal included. It says the key's ID and scope, the route's template (never the IDs in its path), the outcome, status
and code, how long it took, the action's reason, where its nonce was checked, and on a refusal of the request itself,
`why`. Never its body, nonce or signature, and it isn't in the ring: anyone can send an unsigned request. An action's own line, with the IDs it acted on, carries the same request ID
([Operating Alcove › The audit line](operating-alcove.md#the-audit-line)).

## Errors: `apps/api/src/platform/errors.ts`

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
| `ConflictError` (`ClientTakenError`) | `conflict` | 409 | info |
| `TooLargeError` | `too-large` | 413 | info |
| `PlanLimitError` | `plan-limit` | 402 | info |
| `UnavailableError` (`LostConnectionError`, `DatabaseBusyError`) | `unavailable` | 503 | warn |
| `InternalError` (`DatabaseError`, `ObjectStoreError`) | `unknown` | 500 | error |

```ts
throw new ConflictError('Notes aren’t recording right now.', { context: { callId, notes: state.notes.status } });
throw new KeyError('This key can’t open that data.', { cause: err, context: { scopeId } });
```

- The error line's `status` is always the status Alcove answered with, written after the context, so a context can't
  change it. Another service's answer (NEAR AI, Google, Cloud KMS, 1Click, Cloudflare) is the context's `upstreamStatus`,
  and a record's own state is `state`, never `status`.

- The database layer wraps every failed query in `DatabaseError` with the statement's first words and
  the Postgres error code. A connection that goes while it's in use (Postgres ended it, or it dropped on the way) is a
  `LostConnectionError` instead: logged at warn in the request or job that was using it, which fails and can be tried
  again, while everything else carries on. The pool listens to a client while it's lent out as well as while it holds
  it, because pg reports a lost connection as an error event, and one nobody listens for would stop the server. A
  transaction whose connection went isn't rolled back (Postgres did that) and its connection never goes back to the
  pool. A request that waits the whole 10 seconds for a free connection gets `DatabaseBusyError` ("Alcove is busy right
  now. Try again in a moment."), logged at warn in that request: busy, not broken, and nothing of it was done. The object store wraps failures in `ObjectStoreError` with the operation and
  object ID. Anything else thrown becomes an `InternalError` whose cause is the original.
- A change the server makes to a document that finds a Yjs client it was written as taken by then is taken back with its
  transaction as a `ClientTakenError`, and worked out again, with a debug line (`server change worked out again`) giving the
  document's ID, what the change was and which try. It reaches whoever asked only when all three tries find one ("This
  document is changing too fast to change from here. Try again."). One that could never get past it, written as one of the
  server's own clients the log already had, is a `ConflictError` at once ("This document has had this change already, so it
  can’t have it again."). A browser's update written as one of the server's clients is refused as `server-client`
  ([Data and storage › What gets into a document](data-and-storage.md#what-gets-into-a-document)).
- `app.onError` is the only place errors become responses: one log line at the error's level, and the
  client gets the code, the safe message and the request ID. Unexpected failures never leak their
  internal message.
- Zod failures become a `ValidationError` that reports field paths and issue codes only (no values),
  logged at info.
- Rate limits answer `503 unavailable` ("Too many attempts. Wait a minute and try again.") and log the
  limit's name: `sign-in` (30 a minute) and `telemetry` (60 a minute) per client address, `transcribe`
  (240 a minute, calls and room recordings together; 40 for each voice in a call), `ask` (20 a minute, writing a note's notes again included) and `carry-over` (60 a minute) per account, and
  `guest ask` and `guest catch-up` (6 a minute per guest: the organizer pays for them),
  `request-notes` (10 a minute), `others-point` (20 a minute), `screen-video` (60 a minute), and `share` and `share-ended`
  (30 a minute together) per person in a call, and `ring` (20 a minute) per organizer, `ring answer` and `rings` (30 a minute each) per
  account, `calls` (30 a minute) per account on everything that makes one, and `open rings` when a process holds all
  the streams of rings it takes, and `media piece` (600 a minute) and `media` (240 a minute, each file's URL asked for and each piece opened) per person.
  Operator routes have their own: `operator` (60 a minute per client address, before a signature is checked),
  `operator reads` (120 a minute) and `operator writes` (20 a minute) per operator key, and `operator finds` (20 an hour
  per key on each instance: finding accounts by address).
  Past what a process takes on at once, a file's upload or read logs `pieces arriving` or `files being read`. Google sign-in
  goes back to the welcome screen with `signin=busy` instead.
- Every tab holds a stream of rings and opens a new one every few minutes, so `GET /v1/rings` is logged at debug, like
  a health check, unless it's refused. Rings say who rang how many and that a ring was answered, by IDs and counts:
  never an address, and never the answer, which is sealed so that nothing shows who's coming.
- An audio piece over 2 MiB, a transcript clip over `MAX_TRANSCRIPT_CLIP_BYTES`, a piece of a shared screen's video over
  `MAX_VIDEO_PIECE_BYTES` or a piece of a file over `MEDIA_PIECE_BYTES` is refused as `400 invalid` from its `content-length`,
  before the body is read. Whatever's left of a request answered before all of it arrived is read and dropped once the
  answer has gone, so its connection can take the next request. A body still arriving half a second later, or past 64 MiB,
  goes with its connection, as the Node adapter has it.
- A file's upload logs `upload started` and `upload finished` with its IDs, and its pieces at debug; deleting one logs `file
  deleted`. Deleting one refused because someone can edit its document only through a seat in a call is an ordinary
  refusal: `forbidden` at info, with `why: 'only a seat'`. A piece that's refused after reaching the store logs `piece not
  recorded; deleting its object`, at info for a refusal and warn for a failure. A file that can't be read to the end has
  already sent its first bytes, so nothing reaches the client
  but a broken connection: it's `a file couldn’t be read to the end`, with the request's ID and the file's and piece's, at the
  level of what stopped it (info for someone who lost the document, warn for a limit, error for a failure). The Node adapter
  also prints one generic line of its own to standard error. A read logs `a read has its place` at debug once it has one,
  with its IDs and whether it waited, and `waiting for a place` when it joins the line, with how many are in it; a piece logs
  `a piece has its place` at debug once it's counted, with its IDs. A read this side ends logs `a read was cut`, with its IDs and why: it stopped and
  someone's waiting, or its time ran out. A piece that stopped arriving, or a read whose browser went while it
  waited, is an ordinary `503` at info, and so is its request's own line, `request refused`: a 5xx is `request failed` at error
  unless what answered it says it's an ordinary refusal.
- Whatever a plan's limits refuse is an ordinary refusal at info, `402 plan-limit` with its `reason` in the context
  (`notes`: the AI allowance is spent; `storage`: the account's storage is full), with IDs, sizes and kinds as its context, never an allowance, a balance or a title ([Plans and usage](plans-and-usage.md)).
  Guests in a call who have spent their share of its organizer's allowance are refused the same way, with `why: 'guests'`,
  after `guests in a call asked as much as its share allows` at info with the organizer's owner and the call's ID.
- A purchase refused as it's asked for (`409 conflict`: a price that changed, a balance short of it; `400 invalid`: more
  than one purchase buys) is an ordinary refusal at info, with the owner, what it buys and `why`. Its words say what it
  costs, never the balance, since a refusal's message is its log line's.
- An upload refused by a storage limit is an ordinary refusal at info: `402 plan-limit` for an account's storage that's full,
  or, for someone other than whoever pays, for the room kept for the payer's notes (`why: 'kept for notes'`, with
  `reserveBytes`); `409 conflict` for a day used up, theirs or what they can add to someone else's storage
  (`media.others_day_bytes`, `media.guests_day_bytes`); `400 invalid` for a file too big, with the limit's name
  (`plan.free.file_bytes`, `plan.free.storage_bytes`, …), the sizes (`usedBytes`, `addingBytes`) and the limit (`limitBytes`)
  in its context. A recording that can't start for storage logs the same, for the room it would need.
  A piece that takes an account past 80% of its storage logs `an account is past 80% of its storage` at warn, and one that takes someone's day past 80% logs `someone is past
  80% of what they can upload today`, once each time it's crossed, with IDs and sizes. Every instance logs `service limit
  changed` at info when it reads a new value, with `limit`, `old` and `new`, and `service limit ignored` or `service limit
  clamped` at warn, once, for a row it can't use or had to hold to its bounds, and `service limits not read; keeping what was in
  force` at warn when it can't read them. `limits set` logs `service limit set`, with the old value and the new, and `limit not
  set` at warn with why: a typo is an ordinary refusal.
- Feature flags log under `component: 'feature-flags'`: `feature flag changed` at info when an instance sees a flag change, with
  `featureFlag`, `everyone`, how many `groups` have it, and how many `people` directly and `members` through those groups; `feature flag ignored` at warn, once, for a name that isn't
  a flag; `feature flags not read; keeping what was in force` at warn. Each `feature-flags` command logs what it changed with the flag,
  group and counts, and `feature flags refused` at warn for a refusal. A flagged endpoint refusing logs at info with its `featureFlag`. No
  address or hash is ever logged.
- Support's billing commands log `balance added by support` at info (`component: 'billing-support'`) with the owner and the
  top-up it was named by, and `top-up added by support` with that top-up's ID and state, whether they ran from the `billing`
  command line (`service: 'alcove-billing'`) or through the operator route, inside the API. On the command line a refusal
  (nobody found, more than one account, a top-up still watched, an amount that isn't one) logs `billing refused` at warn
  with its `code` or `why`, and anything else `billing failed` at error; through the route it's the request's own error
  line and `request refused`, beside the `operator call` line. Asking 1Click about a top-up for support logs
  `top-up checked by support` with the owner, the top-up and its state before and after. Never an amount, and never what
  was typed, which may be an address ([Plans and usage › Support](plans-and-usage.md#support)).
- Start-up waits for the database (`component: 'db'`). Each try that fails is `database not reachable yet; trying again`
  at warn, with `attempt`, `code` (Postgres's or the system's, `connect-timeout` when pg gave up on it after 10 s, or
  `connection-ended`), `tookMs` and `retryInMs`, and once a later try gets through, `database reached` at info with
  `attempts` and `ms`. Running out of `DATABASE_WAIT_MS` (three minutes) is an `UnavailableError`, and Postgres refusing
  the connection outright (a wrong password, no such database) a `DatabaseError` at once, each `refused to start` with
  `attempts`, `code` and `ms`; never the database's address.
- Inside a TEE, start-up logs `secrets read` with the names of the settings read from Secret Manager (`component: 'gcp'`),
  never a value, `attestation exchanged for an access token` with how long it lasts, and `clock offset` with how many
  seconds the VM's clock is behind Google's (`behindGoogleS`, by Google's Date header), at warn past 30: checks of other
  services' tokens allow a minute ([Known limits](../../infra/confidential-space/README.md#known-limits)). Whatever stops it starting (a secret
  Secret Manager won't give, an attestation the Security Token Service refuses, or Cloud KMS refusing the master, each a
  `KeyError` naming the secret, the provider or the key) is `refused to start`, at error, with Google's status codes only.
  The shared attestation token logs `attestation token issued` with when it was issued and runs out, and `no attestation
  token` at warn with the launcher's status and its line of explanation; never the token.
- The edge (`component: 'edge'`) logs `tls key` with the TLS key's SPKI hash, `web app loaded` with how many files and
  header rules, `listening for http` and `listening for https` with ports, `tls certificate found`, `acme account` with the
  account's URI (for the CAA record), `tls certificate issued` with how many hosts, when it runs out and how long ordering
  took, `tls certificate replaced` and `tls certificate renewed`, and at error `tls certificate not ordered; trying again` and
  `tls certificate not renewed; trying again later`. A connection to the HTTPS port without the load balancer's PROXY line is
  `connection without a PROXY line refused`, at warn, with why and how many bytes came: never the address.
- A piece of a shared screen's video is refused as `403 forbidden` when it isn't the sender's share or the share
  doesn't go in the notes, `404 not-found` when the share is unknown or has ended, and `409 conflict` while notes are
  paused or off, or when a different piece is already stored in its place. ffmpeg failing to join or decode a share's
  video is a `MediaError` (500) with its exit code and sizes only; while the notes are written a share whose video won't
  join is a warn (`a shared screen’s video couldn’t be joined; left out of replay`). A frame whose image still can't be
  fetched on a second try while the notes are written is a warn (`a frame’s image couldn’t be fetched; kept as
  unread`), with the note's and the frame's IDs only.
- NEAR AI's failures become `ValidationError` (`400`, `413`, `422`), `InternalError` (`401`, `403`) or
  `UnavailableError` (unreachable, timed out, an unreadable reply, or any other status such as `429` or
  `5xx`), with the operation, the status NEAR AI answered (`upstreamStatus`) and timing as context. Evidence that doesn't check out is an
  `UnverifiedError` (an `UnavailableError`, logged at error, or warn when a service couldn't be reached), with
  the model, the task and the check that failed; the notes worker waits on it instead of counting an attempt
  ([Notes and inference › Models and requests](notes-and-inference.md#models-and-requests)). So a revoked key, an
  account out of credit and an outage at NEAR AI read apart: `operator errors` groups lines by their upstream status, and
  `operator work` counts the writer's failures as the class and that status (`InternalError:403`). `operator checks` probes
  each private model with one fixed request, logged `operator probe` with the model, `upstreamStatus`, whether the reply
  opened, and how long it took; a check that fails logs `operator check failed` at warn with its name and code.

## Browser: `apps/web/src/lib/log.ts`

The same four levels. `lib/api.ts` connects it to the API client's `onEvent` hook, so every failed
request is logged with method, path, status, code, duration and request ID. A `401 unauthenticated` is
logged at debug: being signed out is an ordinary state.

- Screens can show a failed request's ID to the person it happened to, as a reference to quote (`RequestRef`
  from `@alcove/ui`, which copies it on press): the join page does for every refusal and for a card it can't
  read, and so do the page that didn't load (`RouteError`) and a call's page or a call ahead that's gone. It's
  random, so it finds the request's log lines and says nothing about anyone. A failure said in a toast goes
  through `toastFailure` (`apps/web/src/lib/failed.ts`), which adds **Copy reference** when the error has a
  request ID; Settings, Plans, Start a call, scheduling (moving a calendar meeting to Alcove among it), a call
  ahead and a call's page say theirs that way, and the other screens' toasts don't yet. A request that never
  reached the API has no ID, so it has no reference.
- A payment's reference is its top-up's ID, which finds the top-up and nothing else: checkout's Pay step and
  Settings' Add money show it from the start (`RequestRef`), and Done's receipt row shows it whole.
- Support looks a request's reference up with `operator request <reference>`, on the instance that served it while its
  ring holds it, and otherwise in Cloud Logging; and a payment's with `operator topup <reference>`
  ([Operating Alcove](operating-alcove.md)). A call is named by the address of its page, never the join link.
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
  tokens: paths show `/v1/calls/:code`, and a file's token `/v1/media/:token`. Paths never include the query, so the
  Google callback's code and state stay out too.
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
  credentials `Bearer [redacted]`, signed tokens (JWTs) `[token]`, a file's URL, whole or cut short,
  `/v1/media/[token]`, and a sign-in photo's, `/v1/photos/[token]`; a request's own path masks both tokens, a
  call's code and a calendar event's ID. Errors are serialized with their
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
