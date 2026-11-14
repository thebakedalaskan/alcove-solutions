# Operator routes: a safe way into Alcove's enclave

Design, 2026-11-13. Approved by the user the same day:

- the authentication as designed (§6);
- the core actions, plus ending a stuck call, closing a room left up and signing an account out everywhere (§5);
- the checks job for an API that won't start, in this change (§7);
- looking an account up by its sign-in address, for `write` keys only, in place of showing account IDs in the app;
- references for failures and payments in the app (§10).

The note rewrite is not built.

## 1. Why

Production runs in Google Cloud Confidential Space: the API and the web app are one signed image on attested VMs, and the
keys that open anything sealed (`KMASTER`, `KSERVICE`) exist only inside the enclave. That is the promise: Alcove can't
read people's calls, notes or names. It also leaves the team nearly locked out when something breaks:

- **No shell, few windows.** The image has no SSH. The windows are Cloud Logging and `GET /health`, which says only
  whether the database answers `SELECT 1`, whether inference is configured and whether LiveKit is reachable.
- **Support can't reach production.** `billing-cli.ts` needs `KSERVICE`, which only the enclave holds, so a payment that
  arrived late, or twice, can't be put right. `limits-cli.ts` needs only the database, but reaches production only through
  Cloud SQL's proxy with the database's password.
- **The one way in is a shared token.** `POST /v1/operator/feature-flags` takes one bearer token whose SHA-256 is in the
  attested environment. Anyone holding it can do everything it does, and the log can't say who did.

### Worked example: the notes model, 13 Nov, 20:20–20:44 UTC

A teammate reported that live notes said "The first notes couldn't be written yet" mid-call, and that questions came back
"Alcove's notes service can't be reached right now", then "The notes service turned Alcove away", while the transcript
kept working. The production log, read afterwards, shows:

| UTC | What the API logged |
| --- | --- |
| 20:19:57 | `live notes not refreshed`: the private notes model didn't answer within 60 s (`timedOut`) |
| 20:22–20:41 | the notes model refused requests in 100–300 ms: `InternalError` "turned Alcove away", which `inference.ts` raises for a 401 or 403 from inside the sealed reply |
| 20:24, 20:44 | `notes could not be written after three attempts; finishing the note without a summary`: two notes, a 1-minute call and a 36-minute one |
| 20:38–20:48 | "busy" (another status), then one reply in the wrong shape |
| 20:44 onwards | `notes written`, `question answered`, `live notes written`: recovered |
| throughout | `model verified` 20 times: the model's attestation checked out the whole time |

The same afternoon the API twice refused to start at 18:32 and 19:05 UTC, with `Connection terminated due to connection
timeout` on its first database connection.

What an operator couldn't do then, and can with this design:

1. **Know which status the model sent.** `inference.ts` drops the sealed reply's status for chat and speech
   (`statusError(reply.status, { what, ms })`), so a revoked key, an account out of credit and an outage at NEAR AI all read
   alike. Every inference failure now carries the upstream `status` in its context, the log line and the error ring.
2. **See it as it happens.** `operator checks` sends each private model one fixed request with no one's content in it,
   sealed to its attested key like any other. An attestation check alone stayed green throughout. During the outage it
   would have said: the speech model answered 200 in 0.4 s; the notes model's evidence checked out, and its probe came
   back 403 in 180 ms.
3. **See what it cost.** `operator errors` would count the `ask` and `notes/watch` failures by code and status. `operator
   work` would show the writer's failures by code and the two notes finished without a summary, by note ID.
4. **Put it right.** Once the probe passes, jobs still waiting on the model can be made due at once (`operator note
   retry`). The two notes already finished without a summary need a new job. The person can start one with Rewrite, but
   support can't tell who they are. The operator action that would do it, `operator note rewrite`, is one of the
   proposed actions in §5.

## 2. Goals, non-goals, anti-goals

**Goals.** Operators can answer, from outside the enclave and within a minute: is it up, which release is serving, which
dependency is failing and how, what background work is behind or failing, why one request failed, where one account's plan
and top-ups stand, and what state one call or one note's writing is in. Support can credit a payment by hand, re-check
a top-up, retry stuck work and change a limit or a flag, each leaving an audit line. Whoever can operate is part of what
the enclave attests, and a stolen credential can neither read anyone's content nor do much damage before it's revoked.

**Non-goals.** Reading or exporting anyone's content. Searching for an account by email, name or title. A web console.
Deleting accounts or data. Replacing Cloud Logging, which stays the record. Metrics and alerting (a later step can poll
`operator checks`).

**Anti-goals: what would make this a failure even if it works.**

- An operator route that returns or logs anything that identifies a person or says what they said.
- A way to run arbitrary code, SQL or a command line inside the enclave.
- One credential that, stolen, lets someone move money, read data or switch on what isn't released, without limit or record.
- A diagnostics path that needs the database in order to report the database is down.

## 3. The privacy line

What an operator route returns, and what it logs, holds only:

- **Random IDs:** an account's, a call's, a note's, a job's, a top-up's reference, a request's. None of them is a
  capability: a call's join code, a session ID and a file's media token are never taken or returned.
- **States, codes and counts:** enum states, error classes and codes, upstream HTTP statuses, counts, sizes, booleans.
- **Times and durations:** when a job last ran, how long a check took. Top-up times are coarsened (§4.5).
- **The release and settings:** commit, image digest, migration names, setting names, and the values of settings
  that are already public in the attested environment. A secret's setting says only `set` or `not set`.

It never holds titles, names, email addresses, guests, chat, notes, transcripts, audio, labels, file names, payment
addresses or amounts, provider error text (which can echo what was sent), or anything opened from a sealed record. Where
a route needs sealed state to answer, as `billing show` opens a plan to count its months, it opens it inside the enclave
and returns only counts and states derived from it, as `billing show` does today.

**Inputs are an ID or a reference a person can hand support,** in the path. No path takes an email address, a name or a
title. Two inputs are addresses, and both go in the body, never a URL. Both are hashed inside the API and never logged,
hashed or not:

- **Finding an account by the address it signs in with** (§5.2, `write` keys only). The user chose this, accepting that
  any `write` key can find any person's account.
- **Feature flags**, which take addresses in a command's words, as today, hashed under flags' own purpose.

**Enforced by tests (§12):** the privacy test's canary flow calls every operator route with the canary account's, call's,
note's, top-up's and requests' IDs and checks that no canary, email, name, payment address or amount appears in any
response or log line. A coverage check fails if an operator route is registered that the canary sweep and the refusal
tests don't call.

## 4. Read-only diagnostics

The inventory below walked every feature's background work and failure modes:

- the deposit watcher;
- plan upkeep, renewals and reminders;
- the notes writer, inference and Drive exports;
- recordings, shared-screen joins and `object_gc`;
- calls, rooms and LiveKit;
- sign-in and sessions;
- agents and MCP;
- TLS and attestation;
- limits and feature flags.

Each route gives the question it answers, its input and exactly what it returns. Every answer carries `instance` (the
VM's host name) and `at`. Facts held in memory are that instance's own. Production runs one VM, two during a rollout,
and the load balancer picks which one answers. The CLI prints which instance answered.

### 4.1 Who am I: `GET /v1/operator/whoami`

*Does my key work, and what can it do?* No input. Returns the key's ID and scope, the instance and the server's time.

### 4.2 What's running: `GET /v1/operator/release`

*Is it up, which release is serving, and did it start cleanly?* No input. Returns:

| Part | Fields |
| --- | --- |
| `build` | `commit`; `imageDigest`, from the attestation token's claims (null outside a TEE); `rekorLogIndex` of the release's entry (null if the log wasn't reached) |
| `instance` | host name, `startedAt`, `uptimeS` |
| `boot` | each start step (§7) with `ms`, `ok`, and the error's class and code if it failed |
| `migrations` | `applied` (count and newest name), `inImage` (count and newest name), `notApplied`, `unknown` and `changed` (names; all should be empty), and why a start would refuse the database (`refused`), by the verdict a start acts on |
| `settings` | values for an allowlist of settings that change behaviour and are public anyway (`TEE`, `WEB_ORIGIN`, `API_URL`, `TLS_HOSTS`, `DEMO_AUTH_ENABLED`, `GOOGLE_SIGNUP_MODE`, `NEAR_AI_*_MODEL`, `NEAR_AI_BASE_URL`, `ACME_DIRECTORY`, `LOG_LEVEL`, the cache and stream timings); `set` or `not set` for every other setting, secrets included; the operator keys' IDs and scopes |
| `clock` | `behindGoogleS` and `roundTripMs` from the newest measurement (the attested identity's last exchange, or the last Google check), and when it was taken |
| `attestation` | inside a TEE: the held token's `issuedAt`, `expiresAt` and age, the last failure's code and time, and when the launcher is asked next |
| `certificate` | with `TLS_HOSTS`: `notAfter`, days left, whether renewal is due or past due, how many hosts it names, when it was stored, whether its key is the attested one, and this instance's last check (time, ok, code) |
| `caches` | for limits and for feature flags: when last read, when last read successfully, failures since |

### 4.3 Live checks from inside: `GET /v1/operator/checks`

*Which dependency is failing, and how?* No input. It runs every check at once, each with a 10-second limit, at most
once every 20 s per instance; a request in between gets the last run, marked `cached`. Each check returns `ok`, `ms`
and, when it fails, a `code`: the error's class and code, an HTTP status, or an S3 error name. Never a provider's
message.

| Check | What it does | Also returns |
| --- | --- | --- |
| `database` | `SELECT 1` | pool: total, idle, waiting, max |
| `objects` | `HeadBucket` (a new `ping()` on the object store) | — |
| `livekit` | `ListRooms`, on a client of its own with a 5 s timeout and no failover across regions | rooms open (a count) |
| `near-ai:speech`, `near-ai:notes` | Fetches the default model's evidence fresh and verifies it, without touching the cache requests use. Then sends one fixed request with no one's content in it, sealed to the attested key like any other: for notes, a chat asking for `{"ok":true}` (16 tokens at most); for speech, one second of silence. Alcove pays for both; no one's plan is metered | evidence: ok, ms, the check that failed, TCB status, GPU count; probe: ok, ms, the sealed reply's HTTP status |
| `oneclick` | `GET /v0/tokens`, which sends nothing about anyone | routes offered of those allowed, whether a partner key is set, whether top-ups are on |
| `google` | Google's discovery document and key set. Then the token endpoint with a random code: `invalid_grant` means the client ID and secret are good, `invalid_client` that they aren't | whether a client is set; the signup mode; how many testers (never who); key count; the clock offset from Google's `Date` header |

### 4.4 Background work: `GET /v1/operator/work`

*What's behind, and what's failing?* No input. Returns two parts.

**Loops**, from this instance's memory. Each loop records its runs as it goes (`operator/runs.ts`). Covered: upkeep and
each of its steps, the deposit watcher, ending overdue calls, certificate checks, the attestation token, re-wrapping
owners, and the notes writer's runs. For each: last started and ended, duration, whether a run is in progress (upkeep's
runs can overlap today), its last counts, when it last succeeded, and its failures in the last hour by code.

**Queues**, from the database, counts only:

| Queue | Fields |
| --- | --- |
| notes | jobs by state (`queued`, `writing`, `waiting`); claimable now; age of the oldest claimable; writers whose lease ran out |
| Drive exports | jobs by state; claimable now; highest attempt |
| shared screens | recordings waiting to be joined; pieces; bytes; age of the oldest stop |
| object deletes | queued; failing (attempts above 0); highest attempt; age of the oldest |
| deposits | due; lag; open; open past their deadline with no answer; credited but not yet carried |
| plans, teams | due; lag; accounts with no plan row |
| calls | live; past their longest (and how late); host away past the grace, by the row (its connection left: whether a host is really gone takes LiveKit's word, which a call's own lookup asks); live with no room; room gone (one `ListRooms`); ended in the last hour with a room still up. Counted by the calls feature's own view, by its own rules (`callsWork`) |
| sweeps | sessions, agent rows and expired invites waiting to be swept |

**Finals**, from the error ring (§4.5): notes finished without a summary, and Drive exports that failed for good, in the
last 24 hours on this instance, by ID, with their time and code.

### 4.5 Recent errors: `GET /v1/operator/errors?minutes=<n>` and `GET /v1/operator/requests/:requestId`

The ring is fed by the logger. Every warn and error line the API writes, and every request's own line once it's refused
(4xx) or failed, goes into an in-memory ring, already scrubbed as the log is, and reduced to these fields:

- the time and level;
- `component`, `msg` (with anything a terminal would act on replaced), `requestId`, and `route`: the method and template of
  the route the request matched (`GET /v1/notes/:id`), from the routes registered, never the path as sent, which holds
  whatever a client typed (escape sequences, say) and, for a sign-in photo, a token that shows whose face it is;
- `status`, and the error's class and code;
- the upstream `status` and `what` from the error's context;
- the IDs among the line's fields: `ownerId`, `callId`, `noteId`, `jobId`, `depositId`, `recordingId`, `grantId`;
- `final`, on a line that says a piece of work was given up for good: its kind (`notes-without-summary`,
  `drive-export-failed`).

No other field, and no free text, is kept. So the ring holds less than the log does. Background failures (the notes
writer, evidence refusals, 1Click, certificates, upkeep steps) come in through the same lines as requests' failures,
with no instrumentation in the features but the two final lines' `final`. A request is one line: its error's own line
isn't kept, and what it says (its class, code, upstream status and IDs) is on the request's line, in the log too.

**Nothing a browser sends reaches the ring, and what anyone sends can't flood it.** `POST /v1/telemetry` is public, and its
lines carry fields the browser chose, which can override the logger's own, `component` and `requestId` among them. So the
ring is closed to the telemetry logger by the logger itself, set when it's made, whatever fields its lines carry; and so it
is to the operator audit line (§6.6), which anyone can make by sending an unsigned request. Any 4xx is anyone's to make, so:

- requests' own lines and every other warn and error line are kept apart, the newest 5,000 of each;
- what's logged while answering one client's requests, and by the work they start, is kept up to that client's share, 120
  lines a minute, and counted past it, the address held in memory for that and never logged;
- a request that matched no route isn't kept, only counted;
- the lines given up for good are kept a third time, the newest 1,000, whatever their client's share, and the work report's
  finals come from there.

`errors` says what it counted and didn't keep, and how far back each part reaches once it's full.

**Another service's status is `upstreamStatus`.** An error's context names the HTTP status another service answered
with `upstreamStatus`: NEAR AI, Google, Cloud KMS, 1Click, Cloudflare. A context may never overwrite the line's own
`status`, which is the response's. Today the error line spreads the context after `status`, so NEAR AI's 502 is logged
as the status of what was really a 503. The middleware writes `status` last.

- **`errors`** (*what's failing, how often?*): input `minutes`, from 1 to 240, default 60. Counts grouped two ways over
  the window: requests by route, status and code; and every line by component, message, code and upstream status. Each
  group has its last time and one request ID to follow.
- **`requests/:requestId`** (*why did this request fail?*): input a request ID, from an error's "Ref" or a log line.
  Returns every ring line with that ID: when, the route, the status, the error's class, code and upstream status, and
  the IDs. It answers 404 when this instance holds none: the request is then older than the ring or was served by
  another instance, and Cloud Logging has it (§13).

### 4.6 An account: `GET /v1/operator/accounts/:accountId` and `billing show`

*Why can't this account sign in? Where does its plan stand?* Input: an account's ID. Today the app shows it nowhere;
§10 adds it to Settings. The ID must be a person's: one with an identity, not a workspace's or a team's.

The account route returns JSON:

- **The account:** whether it exists, when it was made (the day), and its keys: which envelopes it has (v2, v1) and
  whether its root key opens inside the enclave (ok or the error's code).
- **Sign-in:** last sign-in (the day and hour); sessions by provider (live, when the newest started, when one was last
  seen); sessions ended but not yet swept.
- **Agents:** each connection's ID, made, expires, last used, live refresh tokens, and token rows against the cap; the
  live count against 50.
- **Plan:** its kind, as a pointer to `billing show` for the rest, or `none` for an account from before plans that has had
  none made yet: neither looking nor `billing show` makes one, which would start a storage grace from that look.

`POST /v1/operator/billing` with `{"words":["show","<account id or top-up reference>"]}` returns the lines `billing show`
prints, from the same function (§9). They are extended with:

- why Pro renews or doesn't, as a code;
- notices waiting, by kind;
- license: none, member or admin, and until when (the day);
- whether notes are stopped;
- whether storage is over its limit or in grace;
- for a team: the role, and counts of members, licenses and open invites.

Still no amount, balance, price, history, address or name.

### 4.7 A top-up: `GET /v1/operator/topups/:reference`

*What happened to this payment?* Input: the top-up's reference, its deposit ID (22 characters). The person sees it in
checkout (§10). Returns:

- the account's ID, the provider and the state;
- opened and deadline, to the hour, and whether the deadline has passed;
- watched (next check in so many seconds) or not. Its state says why where it can. Closed by support, given up on a
  record that won't open, and 30 days over all look alike in the columns, so no more is claimed;
- the last check, so many seconds ago.

Then, from its sealed record, opened inside the enclave: whether anything was seen, whether it settled, the doubt code
(if its provider's answer couldn't be trusted), whether its provider has gone unanswered since the deadline, and the
purchase's kind and outcome.

It never returns:

- amounts;
- the deposit address or memo;
- the quote;
- the provider's reference (an intent hash that leads to the payer's wallet);
- why a purchase was refused (stored only as words).

Times are to the hour because a payment's exact time, set against the treasury's public transfers, could lead to the
payer's wallet.

### 4.8 A call: `GET /v1/operator/calls/:id`

*Is this call still on, and why won't it end?* Input: one of three IDs. A call's ID is in the log lines. A meeting's ID is
the address of a call ahead, `/calls/upcoming/<id>`. A note's ID is the address of a call's page, `/calls/<id>`. A call's
code is a join secret and is never taken. The CLI takes a pasted address, keeps its ID, and refuses a `/join/` or `/call/`
link before sending anything.

Returns which kind of ID matched, then each run of the call, newest first:

- **The row:** call ID; state; started, ended, how long; how far past `call.max_seconds`; locked; host here, or away for
  so many seconds; generation.
- **From its sealed state, counts only, opened inside the enclave as upkeep opens it:** people by status (in, waiting,
  left) and role; places taken of the most; whether a stand-in hosts; notes (status, ever on, segment); breakout rooms
  open; live shares; whether the timer runs.
- **The recorder:** recording ID and state; segments, pieces and seconds; transcript clips, and how long since the last
  was heard.
- **The notes job:** as in §4.9.
- **LiveKit:** for a live call, or one ended in the last hour, whether its room exists, and its participants and
  publishers.
- **Signals:** past its longest; host gone past the grace; room gone; no room; room left up after it ended.

It never returns names, addresses, photos, breakout rooms' names, messages, the meeting's title or guests, the call's
code, or the room's name, which is LiveKit's key to its dashboards.

### 4.9 A note's writing: `GET /v1/operator/notes/:noteId`

*Why aren't these notes written?* Input: a note's ID, from `/calls/<id>`. Returns:

- **The recording:** state, ended, when the shared screens' tail ends.
- **The notes job:** state, attempt, lease, claimable now, and when it was queued (exact for first notes, an upper bound
  for a rewrite).
- **The live transcript:** clips, and how long since the last.
- **Drive exports:** format, state, attempt, when due, leased.
- **Shared screens:** pieces left and bytes, videos joined, join due.
- **This instance's recent ring lines for the note:** time, message, code, upstream status.

It never opens the job's sealed record, which holds words of the transcript.

### 4.10 Limits and flags

`POST /v1/operator/limits` with `{"words":["list"]}` returns the lines `limits list` prints. `POST
/v1/operator/feature-flags` with `list`, `groups` or `group members <group>` (a count) returns what those commands print
today. Asking whether an address is in a group finds something out about a person by their address, so it's an action
(§5.1), as finding an account by one is.

## 5. Actions (needs approval)

Every action needs a `write` key and a `reason` (§6.5). Each answers with what it did, and logs the operator line plus
its own line with the IDs it acted on.

### 5.1 The actions asked for

| Action | Route | Does | Idempotent | Blast radius |
| --- | --- | --- | --- | --- |
| Add money by support | `POST /v1/operator/billing`, `{"words":["credit","<reference or account id>","<usd>"],"reason":"…"}` | What `billing credit` does, from the same function. By a top-up's reference, it adds that top-up's money and closes the top-up, once. By an account's ID, it adds money of its own | By reference, yes (today's rule). By account ID, once per account and reason: a ticket credits an account once, and a second credit for one ticket needs another reference | One balance. Capped: at most $1,000 a credit and $2,000 a key a day, fixed in code |
| Set a limit | `POST /v1/operator/limits`, `{"words":["set","<name>","<value>"],"reason":"…"}` | What `limits set` does, within the limit's bounds | Yes | Every instance within 30 s. `call.max_seconds` shortens live calls, and `plan.*` changes prices. Bounds hold |
| Check a top-up again now | `POST /v1/operator/topups/:reference/check` | Runs exactly the check the person's own page runs (`ask` in `deposits.ts`, which their `get` runs) for that one top-up. It's under the same row lock as the watcher, so it credits and buys only as their own check would. Answers with its state before and after, and whether 1Click was asked and answered or why not (asked within 5 s, unwatched, no provider), and nothing of what the check returned besides. 1Click not answering is a 503 | Yes. A finished or closed top-up is left alone, and a second check within 5 s asks 1Click nothing | One top-up: one 1Click status call |
| Retry a note's waiting work | `POST /v1/operator/notes/:noteId/retry` | Makes the note's notes job due now if it's `waiting` (on the model's evidence or answer) or `queued` for a retry, and starts the writer for its organizer. Refused while a writer holds it | Yes. A job waiting on the model gets its attempt back, as it does today | That organizer's due notes jobs (the writer runs up to 20). Each attempt is charged as usual |
| Retry a note's Drive exports | `POST /v1/operator/notes/:noteId/exports/retry` | Makes the note's `pending` exports due now. Those that failed for good or need reconnecting are left to the person's own Try again, which needs their consent | Yes. The reserved file and the job's version stop a second copy | The exporters' due exports (up to 30 each) |
| Feature flags | `POST /v1/operator/feature-flags`, `{"words":[…],"reason":"…"}` | Every command it takes today | As today: each says when nothing changed | As today |

Money can't leave through these. A credit only adds to an Alcove balance, and spending it buys Alcove's own plans.

### 5.2 Also approved

| Action | Route | Does | Blast radius |
| --- | --- | --- | --- |
| End a stuck call | `POST /v1/operator/calls/:callId/end` | Ends a call only if it's stuck: past its longest, its room gone, or its host gone past the grace with nobody in the room. It ends as when its host leaves: everyone's disconnected, breakout rooms close into the notes, the recording stops and its notes are written. Refused for a call that isn't stuck, and, while LiveKit can't say whether its room is up or who's in it, for one only LiveKit's word could make stuck (`503`) | One call, and only a stuck one. It can't be undone: rejoining starts a new run with a new note |
| Close a room left up | `POST /v1/operator/calls/:callId/room/close` | Deletes the LiveKit room of a call that has already ended. Refused for a live call | Whoever is still connected to an ended call is disconnected. Nothing stored changes |
| Sign an account out everywhere | `POST /v1/operator/accounts/:accountId/sessions/end` | Ends all its sessions, at the person's request (a lost laptop) | Its browsers are signed out; its agents keep working; a Calendar or Drive consent in progress is cancelled |
| Find an account by its sign-in address | `POST /v1/operator/accounts/find`, `{"email":"…","reason":"…"}` | Hashes the address inside the enclave with the index key, under sign-in's own purpose, as sign-in does, and answers with the account's ID. If no account signs in with it, says so. If more than one does, says how many | Anyone holding a `write` key can find any person's account by their address and follow its ID through the logs. So it's `write` only, 20 a key an hour, and audited. The address is in the body, never a URL, and is never logged, hashed or not |

Not built: rewriting a note finished without a summary. The person's own Rewrite does it.

### 5.3 Not proposed

- Deleting anything: accounts, notes, objects, connections.
- Disconnecting an account's agents: their activity history goes with them, for good.
- Reopening a closed top-up: it breaks the rule that a top-up's money is added once.
- Ordering a certificate regardless of when it's due: Let's Encrypt allows 5 duplicates a week, and each order edits DNS.
- Running all upkeep now: today's runs can overlap, and a run lists the whole bucket and opens every Drive account's keys.
- Anything that runs code, SQL or a command line.

## 6. Authentication (needs approval)

### 6.1 Keys

Each operator has an Ed25519 key pair of their own, made on their own machine:

```
pnpm --filter @alcove/server operator keygen
```

It asks for a passphrase twice, hidden. It writes the private key to `~/.config/alcove/operator-key.json` with mode 0600,
sealed with the passphrase (scrypt with N = 2^17, then AES-256-GCM), and refuses to overwrite a key that's there. Then it
prints the one line to add to an environment's list: `<key id> <public key>`. It never prints the private key, sends it
anywhere or writes it into the repository. `--no-passphrase` writes the key unsealed, for an operator who accepts that
anything running as them can then read it.

A key's ID is the first 16 characters of the base64url SHA-256 of its 32-byte public key: a fingerprint, never a name.
The list is public, in the repository, the image and the attestation token's claims.

### 6.2 Who can operate is in the image

`OPERATOR_KEYS` lists the keys: `read:<public key>` or `write:<public key>`, base64url, comma-separated. env.sh holds each
environment's list (`CS_OPERATOR_KEYS`), with a comment on each key saying what it's for, never whose it is.

**Recommended: build the list into the image** rather than set it per VM. build.sh passes the environment's list as a
build argument, the Dockerfile sets `ENV OPERATOR_KEYS=…`, and the name stays out of
`tee.launch_policy.allow_env_override`, so no template can change it: the launcher refuses an image started with a variable
it doesn't allow. The list is then part of the image digest that Confidential Space attests and cosign signs with the
Cloud KMS key, and anyone who reads the attestation token's claims sees exactly which keys can operate. CI also records
each release in Rekor, where the app looks for it, though the attestation policy doesn't require that. Adding or removing
a key is a reviewed pull request and a deploy. The alternative, a `tee-env-OPERATOR_KEYS` override like today's
`OPERATOR_TOKEN_SHA256`, is attested and logged too. But anyone who can make an instance template could add a key of their
own without a commit.

Without `OPERATOR_KEYS`, every operator route answers 404, as if it weren't there. The API refuses to start with a list it
can't parse, a key listed twice, or a key of small order, which anyone can sign for without its private half (a placeholder
of `A`s is one); env.sh refuses the same before a build. Locally and in tests the list comes from `.env` and the harness.

### 6.3 Signing a request

The CLI signs every request with the operator's key, over these lines joined by newlines:

```
alcove-operator/v1
<audience: the API's origin, e.g. https://api.alcove.solutions>
<METHOD>
<path and query, exactly as sent>
<time: Unix milliseconds>
<nonce: 16 random bytes, base64url>
<SHA-256 of the body, base64url; of no bytes for a GET>
```

and sends one header:

```
Authorization: Alcove-Operator key=<key id>, time=<ms>, nonce=<nonce>, signature=<Ed25519 signature, base64url>
```

The audience binds a request to one environment, so production refuses one signed for staging. A body is JSON, at most
64 KiB.

### 6.4 Checking a request

In this order, cheapest first:

1. The client address's own limit, 60 a minute, before any work.
2. The header parses and names a listed key.
3. The time is within 60 seconds of the server's, either way. The VMs' clocks have run 7–9.5 s behind, and every other
   token the API checks allows a minute too.
4. The body's hash and the signature check out against the audience the API is (`API_URL`'s origin) and the method and
   path it received.
5. The nonce hasn't been seen before. It's taken in this instance's memory the moment it's seen, so a copy sent at the same
   moment is refused there even while the database is slow, then inserted into `operator_nonces`, whose primary key
   refuses a second use, on any instance. If the database can't be reached, a request that only reads is checked against
   this instance's memory alone, and its line says so. A request that changes something is refused, since it needs the
   database anyway. Nonces older than 10 minutes are swept.
6. The key's scope covers the route.
7. The key's own limit: 120 reads and 20 changes a minute.

A body over 64 KiB is a `400` before any of 2 to 5. The limits (steps 1 and 7) refuse with `503`, and a change while the
database can't be reached is a `503` too. Every refusal of steps 2 to 5 is `401 unauthenticated` with one message, "That
isn't a signed operator request.", whichever step failed, so probing learns nothing. The response's `Date` header gives the server's time, and the CLI says so when
its own clock is out of the window. A key whose scope doesn't cover the route gets `403 forbidden`. The log line names the
step: `why` is `no-key`, `unknown-key`, `stale`, `bad-signature`, `replayed`, `scope` or `limit`.

### 6.5 Scopes

- `read`: every diagnostic in §4.
- `write`: everything `read` can, and the actions in §5. Each action also takes a `reason`: a ticket or incident
  reference: a short prefix (a letter, then up to nine letters or digits), a dash and its number, such as `SUP-1182` or
  `INC-77`, in either case. It's never prose, nor a word with dots or slashes, so it can't carry an address, a wallet or a
  name with its surname.

Most keys should be `read`.

### 6.6 The audit line

Every operator request, allowed or refused, logs one line, component `operator`: at warn when the check of §6.4 refused it,
at error when it failed, and at info otherwise, a handler's ordinary refusal included. It goes to the log, not the ring
(§4.5):

```json
{"msg":"operator call","keyId":"Q3ZxkV0pTq1m8aLc","scope":"write","route":"POST /v1/operator/topups/:reference/check","outcome":"ok","status":200,"ms":412,"reason":"SUP-1182","requestId":"…"}
```

`outcome` is `ok`, `refused` (4xx) or `failed` (5xx), with the error's `code` when there is one. The line holds the route's
template, not its IDs. The action's own line (`balance added by support`, say) carries the IDs it acted on, under the same
request ID. Cloud Logging keeps both. §8 recommends a locked log bucket for them.

### 6.7 Making, rotating and revoking keys

- **Adding.** The operator runs `operator keygen` and sends the public line (it's public) to whoever reviews env.sh. A
  pull request adds it to `CS_OPERATOR_KEYS` with its scope, and the deploy after the merge puts it in force.
- **Rotating.** Make a new key, add it and deploy; point the CLI at it (`--key`); remove the old one and deploy.
- **Revoking.** A pull request removing the key, merged and deployed. It's in force once the new VM serves, about 15
  minutes after the merge (CI, build, sign, roll). Until then the key works, and §5's caps bound what it can do.
  - Rolling back to an older template would bring back every key its image listed. So after revoking a key, delete the
    kept templates whose image lists it. `deploy.sh` keeps the newest five.
  - `operator release` lists the keys in force, to check.
  - A deploy that's stuck holds a revocation back too: runbook 6.
- **A lost or compromised laptop.** Revoke its key at once, then read its key ID's audit lines since the loss. Nothing
  else needs changing: the key opens nothing but these routes.

### 6.8 Replacing the shared token

`OPERATOR_TOKEN_SHA256` goes everywhere at once: the setting, env.sh, the Dockerfile's allowed list, the route's token
check, the docs and the test. `POST /v1/operator/feature-flags` takes a signed request like every other operator route:
`list`, `groups` and `group members <group>` need `read`, and every other command, asking about an address among them,
needs `write` and a reason.

## 7. When the API won't start

Today a VM whose API can't start logs `refused to start` with the error and exits. The container's exit restarts the VM
(about 2 minutes) to try again, and autohealing replaces a VM that's still failing after 10 minutes. The launcher's own
lines say whether the image was pulled, its signature found and a token issued. On 13 Nov that one line was enough, twice,
only because the cause was the first thing the API does.

What that case needs:

1. **Every start step said as it happens.** One `boot step` line for each: configuration, Google Cloud (the attested
   identity and secrets), the database's first connection, migrations, keys, the object store, LiveKit, certificates,
   listening. Each line gives the step's duration and, when it failed, the error's class and code. `operator release`
   shows the same steps for the start that's serving, so a slow start shows too.
2. **The first database connection retried.** Both refusals on 13 Nov were one connection timing out while Cloud SQL's
   proxy came up. The start now tries again with backoff (1, 2, 4, 8, then every 15 s) for up to 2 minutes before it
   refuses, logging each try. Nothing else at start is retried: a refused key or a missing secret won't fix itself.
3. **An operator job, for when the log isn't enough.** Two ways were weighed:
   - *Overriding the container's command* (`tee-cmd`, with `allow_cmd_override` in the launch policy). Rejected: anyone
     who can make a VM as production's account could then run any command in the image with production's attested
     identity, which opens the master key, unless the Workload Identity provider's condition pinned the arguments too.
   - *A fixed job chosen by a variable.* Recommended, and approved for this change. A new allowed variable, `ALCOVE_JOB=checks`, makes the entrypoint
     run `dist/operator-job.js` instead of the server. The job runs every start step on its own, carrying on past
     failures, then the live checks of §4.2. It prints the report `operator checks` prints, as log lines held to the same
     rule, and exits. It never listens, migrates or writes.

     `infra/confidential-space/job.sh production checks` makes a one-off VM from the group's current template (same
     image, account and environment, plus the variable, restart policy `Never`). It waits for the VM to finish, prints
     the report from Cloud Logging and deletes the VM. It needs 4 free vCPUs of the region's 8, so it can't run while a
     rollout holds two VMs. Its blast radius: a second VM with production's identity, running code that's already in
     the signed image.

## 8. Threat model

| Threat | What they could do | What stops or limits it | What's left |
| --- | --- | --- | --- |
| A stolen `read` key | Everything in §4, until it's revoked | Nothing returned identifies anyone or says what they said. Inputs are IDs, so nobody can be looked up by address. Per-key limits, audit lines, revoked by a deploy | Operational detail, and the plan and top-up states of accounts whose IDs they already hold |
| A stolen `write` key | §5's actions, until it's revoked | Credits capped per credit and per key per day. A ticket credits an account once. Limits move only within their bounds, and flags switch on only what's in the build. Finding accounts by address is held to 20 an hour. Every action is audited with the key ID. Revoked by a deploy, about 15 minutes | Up to the daily credit cap given to accounts they choose; flags switched on early; limits moved within bounds; up to 20 addresses an hour turned into account IDs, which name those people's activity in the logs. All on record |
| A malicious operator | The same, knowingly | The same, and a reason on every action. No route returns content or keys, and none runs code, SQL or a command. Keys and code change only through reviewed pull requests | Abuse within the caps, on record under their key ID |
| A compromised laptop | Use the key while the laptop is theirs, or steal it | The key file is sealed with a passphrase. Scopes and caps as above. Revoke at once | Once the operator types the passphrase on that machine, the key is theirs. Keys held in hardware, a later step, would make every signature need a touch |
| A replayed request | Send a captured request again | Its signed time must be within a minute. Its nonce is recorded in Postgres, so a second use is refused on any instance. The audience binds it to one environment, the body's hash to what it does | With the database down, a captured read could be replayed on another instance within that minute. It only reads |
| Someone who can deploy or make templates | Add a key of their own, or roll back to an image that lists a revoked one | Keys are built into the signed image (§6.2). Adding one needs a commit and a build signed with Cloud KMS. A template can't add one. Revoking deletes the kept templates that list the key | Project Owners can sign images (README › Known limits). Cloud KMS's audit logs record every signature |
| Someone reading the logs | Read the audit lines | They hold key IDs, routes, codes, durations and the IDs of what was acted on | Nothing about people |

Two hardening steps outside this change, recommended: route `component: operator` lines to a log bucket with a retention
lock, so the audit can't be deleted from inside the project; and, later, keys held in hardware.

## 9. The operator CLI

`pnpm --filter @alcove/server operator <command>` signs each request, sends it, and prints the answer with the
request's ID. It runs on an operator's own machine and needs no `.env`. Options:

- `--api <url>`: which API to call. The default is `ALCOVE_OPERATOR_API`, else `https://api.alcove.solutions`.
- `--key <file>`: which key to sign with. The default is `ALCOVE_OPERATOR_KEY`, else `~/.config/alcove/operator-key.json`.
- `--json`: print the answer as the server sent it.

The commands, each a route of §4 or §5:

```
operator keygen [--no-passphrase]
operator whoami                       the key's ID and scope, as the server sees them
operator release
operator checks
operator work
operator errors [--minutes <n>]
operator request <request id>
operator account <account id>
operator account find <email> --reason <ref>          write keys only
operator account sign-out <account id> --reason <ref>
operator topup <reference>
operator topup check <reference> --reason <ref>
operator call <call, meeting or note id, or a /calls/… address>
operator call end <call id> --reason <ref>
operator call room close <call id> --reason <ref>
operator note <note id or a /calls/… address>
operator note retry <note id> --reason <ref>
operator note exports retry <note id> --reason <ref>
operator billing show <reference|account id>
operator billing credit <reference|account id> <usd> --reason <ref>
operator limits list
operator limits set <name> <value> --reason <ref>
operator feature-flags <words…> [--reason <ref>]
```

`account find` reads the address from a hidden prompt when it isn't given, so it needn't land in shell history.

Exit codes: 0 when the server answered 2xx; 1 when it refused or failed, printing its message and request ID; 2 for
words that aren't a command.

Every command has one implementation. Where a command line already exists (`billing`, `limits`, `feature-flags`), its
commands move into a module the CLI and the route both run, as `featureFlagCommands.ts` does already. The route returns
the lines that CLI prints, and `operator` prints them. The diagnostics return JSON, parsed by schemas the server and the
CLI share, and `operator` prints them as aligned text.

## 10. What people can hand support

What a person can quote today:

| Reference | Where it's shown today | Gap |
| --- | --- | --- |
| A request's ID | `RequestRef` ("Ref …", copied when pressed): the join page, the call modal's failure, checkout's errors, the move pages | Not on any failure toast (about 115 call sites), the page that didn't load (`RouteError`), a call's page that's gone, or a notice in a call |
| An account's ID | Nowhere: it's on every log line, but never on screen | Support can't find an account at all |
| A top-up's reference | The Pay step only once a top-up failed or is held; checkout's Done receipt, cut to 8 characters | Never while a payment is waiting, which is when people ask. Settings' receipts show a "Reference" that is the balance entry's ID, which nothing can look up |
| A note's or a meeting's ID | The address of a call's page (`/calls/<note id>`) and of a call ahead (`/calls/upcoming/<meeting id>`) | None. But Copy link copies the join link, whose code is a secret: support must never ask for "the link" |
| An agent connection's ID | Nowhere | The account's ID covers it: §4.6 lists its connections |

In this pull request, the smallest change that gives each case one thing to quote:

1. **A failed request.** Show `RequestRef` where a failure stays on screen: the page that didn't load and a call's page
   that's gone. Give failure toasts a "Copy reference" action through one shared helper that replaces `toast(errorMessage(e),
   { icon: 'x' })`, starting with Settings, Plans, Start a call and scheduling. No new component.
2. **The account.** Its sign-in address: support finds the account with `operator account find` (§5.2, `write` keys
   only). The user chose this over showing account IDs in Settings, accepting that any `write` key can find anyone's
   account.
3. **A payment.** On the Pay step the reference shows from the start (`RequestRef` with the top-up's ID, as the failed
   state has it), and checkout's Done receipt shows all 22 characters.
4. **A call.** Nothing new: the note's or meeting's ID is in the page's address. The CLI takes a pasted address.

Each updates its stories: Toast, RequestRef, Offline and errors, Call (`Gone`, `CouldntOpen`), Checkout and journey 16b.

Left for later: Settings' receipt could carry the top-up's reference too. That's a contract change, a `topUpId` on a
balance entry, sealed with a default of null, so it's kept out of this pull request.

## 11. Where it lives

Routes live with their owners, and `app.ts` composes them before the signed-in routes, as it does `system-routes.ts`
today. Operator routes take no cookie and no Origin.

| Where | What |
| --- | --- |
| `apps/api/src/operator/` (new home) | Operating the service from outside the enclave: `keys.ts` (the key list, key IDs, the canonical request and its signature, shared by the server and the CLI), `recent.ts` (the ring), `runs.ts` (loops record their runs), `release.ts`, `checks.ts`, `work.ts`, `routes.ts` (whoami, release, checks, work, errors, requests, and the limits and feature-flags command routes), `wire.ts` (the answers' schemas, shared with the CLI) |
| `apps/api/src/http/operator.ts` | The signed-request check, scopes, per-key limits and the audit line, and `operatorRoute()`, which every owner registers through |
| `features/billing/operator-routes.ts`, `supportCommands.ts` | The billing command route (show, credit), the top-up lookup and check; `billing`'s commands, shared with `billing-cli.ts` |
| `features/calls/operator.ts`, `operator-routes.ts` | The call lookup; ending a stuck call; closing a room left up |
| `features/notes/operator.ts`, `operator-routes.ts` | The note's writing, and its retries |
| `features/account/operator.ts`, `operator-routes.ts` | The account lookup (keys, sign-in, agents); finding an account by its address; signing it out everywhere |
| `apps/api/src/limitCommands.ts` | `limits`' commands, shared with `limits-cli.ts` and the route |
| `apps/api/src/operator-cli.ts` | The CLI (`pnpm --filter @alcove/server operator`, with no `.env`) |
| `apps/api/src/operator-job.ts` | The checks job, if approved (§7) |
| `migrations/0035_operator.sql` | `operator_nonces` (nonce, key ID, seen at), and `operator_credits` (for each credit through the route, a keyed hash of account and reason, or of the top-up a reference named, the key ID and when), so a ticket credits an account once and a key's credits are counted per day on every instance. No amount is stored |
| infra | env.sh's `CS_OPERATOR_KEYS` and its build argument; the Dockerfile's `ENV OPERATOR_KEYS`, and `OPERATOR_TOKEN_SHA256` out of its allowed list; `job.sh`, if approved |

Smaller changes along the way:

- `inference.ts` puts the sealed reply's `status` in every failure's context.
- `objects.ts` gains `ping()`.
- `evidence.ts` exports a check that bypasses the cache.
- `oneclick.ts` exports a tokens probe.
- `google.ts` exports its configuration check.
- `tee.ts`'s attester reports its state.
- The edge's certificates report theirs.
- `gcp.ts` keeps its last clock measurement.
- `log.ts` feeds the ring.
- `maintenance.ts` and the loops record their runs.
- `support.ts`'s lookup for routes takes only references and people's account IDs, never an address, a workspace or a team.
- `limits-cli.ts` no longer logs what was typed.

The structure policy gets `operator` as a home and `operator-cli.ts`, `limitCommands.ts` (and `operator-job.ts`) as root
entries. `folder-ownership.md` and `features/AGENTS.md` say why: an operator's view composes every owner's, so it has a
home of its own, like `edge/`.

## 12. Tests

Integration tests only, through the real API over HTTP against real Postgres and the object store, with the harness's
stand-ins for Google, NEAR AI and 1Click. Operator requests are signed by the CLI's own signing code with keys made for
the test. Each file is independent of the others.

- **`integration/operator.integration.test.ts`** (infrastructure):
  - *Refusals:* every refusal of §6.4:
    - no header, or one that won't parse;
    - an unknown key;
    - a time a minute stale or ahead;
    - the wrong audience, method or path;
    - a body changed after signing;
    - a bad signature;
    - a nonce replayed on the same instance and on a second instance sharing the database;
    - a `read` key on every write route;
    - an app session alone;
    - no `OPERATOR_KEYS`, which answers 404 everywhere.
  - *Behaviour:* per-key limits; the audit line for each outcome; whoami, release, checks, work, errors and requests.
  - *The worked example, as a test:* the NEAR AI stand-in answers the notes model's probe 403, and `checks` says so while
    the evidence passes; the writer's failures then show in `errors` and `work`, with the upstream status.
  - *The CLI end to end:* `keygen` into a temporary home, then its commands against the test server.
  - *Coverage:* the test reads the app's registered routes and fails on any `/v1/operator/*` route that the refusal tests
    or the canary sweep don't call.
- **`features/billing/support.integration.test.ts`** (extended):
  - `billing show` and `credit` through the route, and the CLI still printing the same lines.
  - Refused: an address, a workspace's or a team's ID, a second credit for one account and reason, and amounts over the
    caps.
  - The top-up lookup and the check, against the 1Click stand-in.
  - Cross-owner: one account's reference credits only that account, and one account's lookup names none of another's
    IDs.
- **`features/calls/operator.integration.test.ts`:**
  - The lookup by call, meeting and note ID, and its counts against a real call with the test LiveKit.
  - The stuck-call signals, and a room left up.
  - Cross-owner: one call's lookup holds nothing of another account's call.
- **`features/notes/operator.integration.test.ts`:**
  - The note's writing state.
  - A job waiting on the stand-in model, made due by `retry` and written.
  - Exports retried.
  - Refused while a writer holds the job.
- **`features/account` (in the operator suite):** the account lookup's sessions, keys and agents, and that it refuses a
  workspace's ID.
- **`integration/flows.integration.test.ts`** (the privacy test): after the canary flow, every operator route is called
  with the canary account's, call's, note's, top-up's and requests' IDs. No canary, email, name, payment address or amount
  may appear in any answer or in any log line, the audit lines included.
- **`integration/feature-flags.integration.test.ts`:** the route takes signed requests. The old token's test goes.
- **Start-up:** a server whose database refuses its first connections starts once the database answers within the
  window, and its `boot step` lines say so. One whose database never answers refuses after the window.

## 13. Runbooks

A new page, `docs/engineering/operating-alcove.md`, holds the routes, the CLI and seven runbooks, each with exact
commands. The read-only `gcloud` commands use the `alcove` configuration. Outlines:

1. **Is it up, and which release is serving?** Run `operator release`: check the commit and digest, that no migration is
   missing or unknown, the clock, the token and the certificate. Then `operator checks`. Cross-check the commit with
   `curl -s https://api.alcove.solutions/health`, the group's version with `gcloud compute instance-groups managed
   describe alcove-api`, and the deploy run.
2. **Notes aren't being written.**
   - Run `operator checks` and read both models' evidence and probes.
   - Run `operator errors --minutes 60` and `operator work` for the writer's failures by code and the notes finished
     without a summary.
   - For one person, `operator note <id>`.
   - Then by cause: a probe's 401 or 403 is a key or an account at NEAR AI; 429 or 5xx, or timeouts, is an outage there
     (check NEAR AI's status); evidence refused is an attestation problem (its code says which check). Once the probe
     passes, `operator note retry` for each note still waiting.
3. **A payment didn't arrive, or arrived twice.**
   - Run `operator topup <reference>`, then `operator billing show <reference>`.
   - Read the state:
     - `waiting`: nothing has arrived.
     - `short`: less than asked, refunded at the deadline.
     - `expired`: nothing by the deadline, but still watched for 30 days.
     - `failed`, with its doubt code.
     - `credited`.
   - `operator topup check` asks again now.
   - Arrived twice:
     - Two sends before it settled are both added.
     - Two top-ups for the same thing: the second's purchase is refused, and its money stays in the balance.
     - A send after it settled: Alcove never sees it, and 1Click refunds it to the treasury. Confirm that in the treasury's
       own records, outside Alcove, then `operator billing credit <account id> <usd> --reason <ticket>`.
4. **Someone can't sign in.**
   - Ask for the reason word in the welcome page's address (`signin=…`) and a request reference if one showed.
   - Run `operator checks` (the `google` check) and `operator request <id>`.
   - With an account ID, run `operator account <id>` for its sessions and whether its keys open.
   - What each reason means: `invite-only` (sign-up is for testers); `google-email-required`; `busy` (the 30-a-minute
     limit per address, shared with agents' sign-in); `unavailable` (no client configured); `failed` (follow the request
     ID).
5. **A call won't end.**
   - `operator call <id>` gives the signals: past its longest, host gone past the grace, room gone, no room, room left up.
   - `operator work` shows whether upkeep and the 30-second loop are running.
   - What each signal means: past its longest means `endCall` is failing (see `errors`); a room left up after the call
     ended needs `call room close`, if approved.
6. **A deploy is stuck.**
   - The deploy workflow's run.
   - `gcloud compute instance-groups managed describe alcove-api --zone=us-central1-a` (status, versions) and
     `list-instances` (each VM's action and health).
   - The C3 quota (`deploy.sh` says what holds it).
   - The new VM's `boot step` lines in Cloud Logging, or `refused to start`.
   - `operator release` against whichever VM answers: the old one says its commit.
7. **The API won't start.**
   - In Cloud Logging, its `boot step` and `refused to start` lines and the launcher's own: image pulled, signature
     found, token issued.
   - The serial port output for the boot.
   - What each failed step means:
     - configuration: the error names the setting;
     - Google Cloud: the Security Token Service's code means the attestation policy, a secret's status means a grant or a
       missing version;
     - the database: Cloud SQL's state, and the proxy's lines;
     - migrations: a release behind the database;
     - keys: Cloud KMS's audit log;
     - certificates: Cloudflare's code or Let's Encrypt's limits.
   - If approved, `job.sh production checks` runs every step and check on a VM of its own.

The infra README's Logs section, `logging-and-errors.md`, `feature-flags.md` and the docs index link to it, and say what
changed.

## 14. Approaches considered

**How an operator proves who they are.**

| Approach | Why or why not |
| --- | --- |
| Keep the shared token, add routes behind it | Rejected. No one's identity, so no audit of who did what; no way to revoke one person; everything or nothing |
| Google identity: an ID token from `gcloud`, its address on an allowlist | Rejected. Staff addresses would sit in the attested environment, which is public. Every session of those Google accounts would be an operator credential, and the trust would rest on Google |
| Client certificates at the edge (TLS ends in the VM) | Workable, but needs a certificate authority, certificate lifecycles, and care with HTTP/2 and the load balancer. Signed requests give the same with less |
| **Signed requests, an Ed25519 key per operator (chosen)** | Each request names its key and binds its time, environment, method, path and body. Keys are made where they're used and never travel. Who can operate is in the signed image |
| Signing through an SSH agent or a hardware key | Later. An agent's `ssh-ed25519` key signs exactly what the server checks, so it can come without a server change. FIDO keys sign differently, and would need the server to accept their format |

**Where the key list lives.** Built into the image (chosen, §6.2), or a VM's environment override, as the token is
today. Both are attested and visible. Only the image keeps a template from adding a key.

**When the API won't start.** A command override (rejected), a fixed checks job (recommended, §7), or the log alone.

**What the answers look like.** Commands that already have a CLI (billing, limits, feature flags) keep their words and
lines, so a route prints exactly what the CLI prints, from one implementation. The new diagnostics answer in JSON, so
they can be read by tools and checked field by field, and the CLI prints them as text.

**Where recent failures come from.** The logger feeds the ring (chosen), so every feature's failures are there without
instrumenting each one, held to what the log holds. The alternative, counters in each feature, would miss whatever a
feature forgot to count.

## 15. Decisions made without asking, and open questions

**Calls made in this design, for the user to check:**

- A top-up's times are given to the hour, and when it settled not at all (§4.7).
- Credits are capped at $1,000 each and two credits a key a day (so $2,000), fixed in code. The day is counted in the
  database every instance shares (`operator_credits`, which keeps no amount), not in memory, so a rollout's second VM or a
  restart can't double it (changed after review: it was $2,000 counted in memory). A top-up can be up to $8,000, and a
  credit by its reference closes it. So a failed top-up over $1,000 is credited $1,000 by its reference, and the rest by
  the account's ID, under a new reference, within the day's two credits, or the next day's. Lifting the caps is a code
  change.
- A reason is a ticket's reference in shape: a short prefix, a dash and its number (changed after review, from any 3 to 64
  of letters, digits and `-_.:#/`, which let a name or a wallet's address through).
- A credit by account ID happens once per account and reason (the ticket).
- Checks of NEAR AI are paid by Alcove and metered to no one.
- A call's counts come from its sealed state, opened inside the enclave for an operator's request, as upkeep and
  `billing show` open what they need. Only counts come out.
- The ring holds this instance's newest 5,000 lines; nothing about requests is stored in the database.
- Feature flags keep taking addresses in a command's words, in the body, hashed inside and never logged. They're the
  one input that isn't an ID, and they were already so.
- Three small fixes ride along, since the routes depend on them:
  - inference failures carry the upstream status;
  - the routes' account lookup takes no address and no workspace or team;
  - `limits` stops logging what was typed.

**Found along the way, not changed here:**

1. Billing logs amounts beside an account's ID: `pro bought`, `notes bought`, `pro refunded`, `team deleted`, `team
   licenses refunded`, `ai period closed`.
2. One plan or team record that won't open stops renewals and reminders for everyone after it, since upkeep takes the
   oldest due row first.
3. Upkeep's runs can overlap. An idle run logs only at debug, so production never sees it.
4. Sign-in shares its 30-a-minute budget per address with agents' sign-in.
5. The 10,000-row caps on agent registrations and consent requests can be filled by anyone, unauthenticated.
6. Calls:
   - Ending calls at their longest retries failing calls first, so 100 failing calls would block the rest.
   - A room that failed to be deleted when its call ended is never tried again.
7. When a reply doesn't match the contract, the browser logs its path, a call's code included, and telemetry carries it
   into the server's log.
8. `object_gc.last_error` is always "Something went wrong on our side."
9. Settings' receipts show a balance entry's ID as "Reference", which nothing can look up (§10).

**The user's decisions (13 Nov):**

1. The authentication of §6, with the key list built into the image: approved as designed.
2. Actions: the core five, plus ending a stuck call, closing a room left up and signing an account out everywhere. Not
   the note rewrite.
3. The checks job of §7: in this change. `job.sh` can be checked only with `--dry-run` here, since this work runs no
   `gcloud` command that changes anything.
4. Accounts are found by their sign-in address, for `write` keys only, not by an account ID shown in Settings. References
   for failures and payments are in this change.
