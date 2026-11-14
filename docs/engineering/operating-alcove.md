# Operating Alcove

How to find out what's wrong in production, and put a few things right, from outside the enclave.

Production runs in Google Cloud Confidential Space: one signed image on attested VMs, with no shell, and the keys that open
anything sealed only inside them ([Confidential Space runbook](../../infra/confidential-space/README.md)). Operators reach
it through the operator routes, `/v1/operator/…`, every request signed with an operator's own key by the operator CLI.
What they answer and log holds only random IDs, states, codes, counts, sizes, booleans, times and durations, the release,
and the values of settings that are public anyway. Never a title, a name, an address, chat, notes, a transcript, audio, a
payment's address or amount, a provider's error text, a call's code, or anything opened from a sealed record: where an
answer needs sealed state, it's opened inside the API and only counts and states come out. No route runs code, SQL or a
command line, reads anyone's content, or deletes an account or anyone's data.

The code: the signed-request check in `apps/api/src/http/operator.ts`, with the keys in
`apps/api/src/keys/operator-keys.ts`; the service's own routes, the CLI and the diagnostics in
`apps/api/src/features/operator/`, the last feature in the order ([Folder ownership](folder-ownership.md)); and each
feature's own in its `operator/` subfolder. The design is in [the spec](../superpowers/specs/2026-11-13-operator-routes-design.md).

## Who can operate

Each operator has an Ed25519 key pair of their own, made on their own machine. An environment lists the public keys that
may operate it, each with a scope:

- `read`: every diagnostic.
- `write`: those, and every action. An action also takes a reason: a ticket's or an incident's reference, a short prefix
  (a letter, then up to nine letters or digits), a dash and its number, such as `SUP-1182` or `INC-77`, in either case.
  It's never prose, nor a word with dots or slashes, so it can't carry an address, a wallet or a name with its surname.

Most keys should be `read`.

The list is each environment's `CS_OPERATOR_KEYS` in [env.sh](../../infra/confidential-space/env.sh), and it's built into
the image: build.sh passes it as a build argument and the Dockerfile sets `ENV OPERATOR_KEYS`, which the image's
`allow_env_override` doesn't name, so no instance template can add a key. The image's digest, which Confidential Space
attests and cosign signs, then says who can operate, and the attestation token's claims list the keys. Adding or removing
one is a reviewed pull request and a deploy. With an empty list every operator route answers 404 ("That isn’t here."), as if
it weren't there. The API refuses to start with an entry it can't read, a key listed twice, or a key anyone can sign for
without its private half (one of the Ed25519 points of small order, such as a placeholder of `A`s), naming the entry by its
position, never its value; env.sh refuses the same before a build. Locally the list is `OPERATOR_KEYS` in `.env`.

A key's ID is the first 16 characters of the base64url SHA-256 of its public key: a fingerprint, never a name. The list is
public, and `operator release` says the IDs and scopes in force on the instance that answers.

### Making a key

On your own machine, in a checkout:

```sh
pnpm --filter @alcove/server operator keygen
```

It asks for a passphrase twice, hidden, and writes the key to `~/.config/alcove/operator-key.json` (mode 0600, in a
directory of mode 0700), its private half sealed with the passphrase (scrypt with N = 2^17, then AES-256-GCM). It never
overwrites a key that's there, and needs a terminal to ask in. `--no-passphrase` writes it unsealed, for an operator who
accepts that anything running as them can then read it. It prints three lines, and never the private key:

```text
Key ID: nJSR4NKXiwI-ioJq
Public key: 1rZ2NNJMx0Yf5I9izqHzyCCG8HBupTvYEc7dRrO0kzQ
For env.sh: read:1rZ2NNJMx0Yf5I9izqHzyCCG8HBupTvYEc7dRrO0kzQ  (or write:1rZ2NNJMx0Yf5I9izqHzyCCG8HBupTvYEc7dRrO0kzQ)
```

### Adding a key

Send the `For env.sh` line, which is public, to whoever reviews env.sh. A pull request adds it to the environment's
`CS_OPERATOR_KEYS`, with the scope it needs and a comment saying what the key is for, never whose it is:

```bash
CS_OPERATOR_KEYS=(
  # Support's tickets: top-ups, credits, plans given, finding an account by its address
  write:1rZ2NNJMx0Yf5I9izqHzyCCG8HBupTvYEc7dRrO0kzQ
)
```

`infra/confidential-space/env.sh production` prints the list under "Image build" (with the
[Settings](../../infra/confidential-space/README.md#settings) exported), and build.sh refuses an entry that isn't
`read:<public key>` or `write:<public key>`, or a key listed twice. The deploy after the merge puts it in force once the new
VM serves, about 15 minutes after the merge (CI, build, sign, roll). `operator whoami` then says the key's ID and scope.

### Rotating a key

1. Make the new key in a file of its own, since keygen never overwrites one:
   `pnpm --filter @alcove/server operator keygen --key ~/.config/alcove/operator-key-2.json`.
2. Add its line beside the old one, and deploy.
3. Sign with it: `--key ~/.config/alcove/operator-key-2.json` on each command, or `ALCOVE_OPERATOR_KEY` set to that file.
   `operator whoami` says its ID.
4. Remove the old key's line, and deploy. Then delete the old key's file.

The kept templates can stay as they are after a rotation: the old key's private half went with its file. A key that may be
in anyone else's hands is revoked instead.

### Revoking a key

1. A pull request removes its line from `CS_OPERATOR_KEYS`. Merge it. It's in force once the new VM serves, about 15
   minutes after the merge. Until then the key still works, within its scope and the caps every key has: $1,000 a credit
   and $2,000 a day; 12 months of Pro, or 25 licenses each for 12 months, a grant, and five grants a day; 20 accounts found
   by address an hour; 20 actions and 120 reads a minute. A deploy that's stuck holds the revocation back too
   ([runbook 6](#6-a-deploy-is-stuck)).
2. `operator release` lists the keys in force (`Operator keys`) on the instance that answers: the key's ID is gone from it.
3. Delete the kept templates whose image lists it. Rolling back onto one would bring the key back
   ([Rolling back](../../infra/confidential-space/README.md#rolling-back)). deploy.sh keeps the newest five, and every one
   made before the deploy that removed the key, back to the deploy that added it, has an image that lists it. A
   template's name says when it was made, `alcove-api-<UTC date>-<UTC time>-<the image digest's first 12 characters>`:

   ```sh
   gcloud --configuration=alcove compute instance-templates list --filter="name ~ ^alcove-api-[0-9]{8}-" \
     --sort-by=~creationTimestamp --format='table(name, creationTimestamp)'
   gcloud --configuration=alcove compute instance-groups managed describe alcove-api --zone=us-central1-a \
     --format='value(versions[].instanceTemplate)'
   ```

   The second names the template the group runs, which stays. Delete each of the others that lists the key, by name:

   ```sh
   gcloud --configuration=alcove compute instance-templates delete <template>
   ```

   It's the one `gcloud` command on this page that changes anything. A release can then go back no further than the
   revocation: fix forward instead.
4. Read what the key did: its audit lines ([The audit line](#the-audit-line)), and under each one's request ID the
   action's own line:

   ```sh
   gcloud --configuration=alcove logging read 'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND jsonPayload.message:"\"msg\":\"operator call\"" AND jsonPayload.message:"\"keyId\":\"<key id>\""' \
     --freshness=30d --format='value(timestamp, jsonPayload.message)'
   ```

**A lost or stolen laptop.** Revoke its key at once, then read its audit lines since the loss. Nothing else needs changing:
the key opens nothing but these routes, and none of them returns anyone's content or keys.

## Signed requests

The CLI signs every request with the operator's key, over these lines joined by newlines (`keys/operator-keys.ts`):

```text
alcove-operator/v1
<audience: the API's origin, such as https://api.alcove.solutions>
<method>
<path and query, exactly as sent>
<time: Unix milliseconds>
<nonce: 16 random bytes, base64url>
<the body's SHA-256, base64url; of no bytes for a GET>
```

and sends one header:

```text
Authorization: Alcove-Operator key=<key id>, time=<ms>, nonce=<nonce>, signature=<Ed25519 signature, base64url>
```

The API checks each request in this order, cheapest first (`http/operator.ts`):

1. The client address's own limit, 60 requests a minute, before any work; past it, `503`.
2. The body is JSON of 64 KiB at most; past it, `400`.
3. The header parses and names a listed key.
4. The signed time is within 60 seconds of the server's, either way. The VMs' clocks have run 7 to 9.5 seconds behind.
5. The body and the signature check out against the audience the API is (its `API_URL`'s origin) and the method and path it
   received. A request signed for staging is refused by production.
6. The nonce has never been used, on any instance. It's taken in this instance's memory the moment it's seen, so a copy sent
   at the same moment is refused even while the database is slow to answer, and recorded in `operator_nonces` for every
   other instance, swept after 10 minutes. With the database out of reach, a request that only reads is checked against
   this instance's memory alone, and says so on its audit line (`nonceIn: memory`); one that changes something is refused,
   `503`.
7. The key's scope covers the route. A `read` key on an action gets `403`: "That key only reads: changing something takes a
   write key."
8. The key's own limit: 120 reads and 20 actions a minute; past it, `503`, "Too many attempts. Wait a minute and try
   again."

Then an action needs its reason: none, or one that isn't a ticket's reference, is a `400`. Steps 3 to 6 refuse with the same
`401`, "That isn’t a signed operator request.", whichever step it was, so probing learns nothing; the audit line says which
(`why`). When the answer's `Date` is more than a minute from your clock, the CLI says "Your clock is <n> s off the server's."
Operator routes take no cookie and no Origin, so an app session alone gets the same `401`.

### The audit line

Every operator request, allowed or refused, logs one line, `operator call` (component `operator`): at warn when the check
itself refused it (it has a `why`), at error when it failed, and otherwise at info, a handler's ordinary refusal (that ID
isn't here, that call isn't stuck) included. It's in the log, not in the ring: the request's own line says its route,
status and code there, and anyone can send an unsigned request.

```json
{"component":"operator","msg":"operator call","keyId":"nJSR4NKXiwI-ioJq","scope":"write","route":"POST /v1/operator/topups/:reference/check","outcome":"ok","status":200,"ms":412,"reason":"SUP-1182","nonceIn":"database","requestId":"Hq3vX9mT2bLwR8kZ"}
```

- `route` is the route's template, never the IDs in its path. Every other line of the request says the template too.
- `outcome` is `ok` (2xx), `refused` (4xx) or `failed` (5xx), with the error's `code`.
- `why`, for a refusal of the request itself: `no-key`, `unknown-key`, `stale`, `bad-signature`, `replayed`, `scope` or
  `limit`.
- `nonceIn` is `database`, or `memory` when the database couldn't be reached.

An action's own line carries the IDs it acted on, under the same request ID:

| Action | Its line |
| --- | --- |
| `billing credit` | `balance added by support` (`ownerId`, `depositId`), and `top-up added by support` when a top-up's reference named it |
| `plan grant` | `plan given by support` (`ownerId`; `teamId` for a team's licenses, null for Pro; `kind`, `pro` or `team`; `months`; `licenses`, null for Pro). Never an amount |
| `topup check` | `top-up checked by support` (`ownerId`, `depositId`, the state it `was` and its `state` now) |
| `account find` | `account found by address` (`found`: how many; never the address, hashed or not) |
| `account sign-out` | `account signed out everywhere by support` (`ownerId`, `ended`) |
| `call end` | `stuck call ended by an operator` (`callId`, `meetingId`, `noteId` and the signals) |
| `call room close` | `room of an ended call closed by an operator` (`callId`, `deleted`, `participants`) |
| `note retry` | `notes job made due by an operator` (`noteId`, `jobId`, the state `before` and `after`, `attempt`) |
| `note exports retry` | `Drive exports made due by an operator` (`noteId`, `retried`, `jobIds`) |
| `limits set` | `service limit set` (`limit`, `old`, `new`) |
| `feature-flags` | `operator feature flags` (`command`, `ok`), and what the command changed ([Feature flags](feature-flags.md#in-production)) |

Cloud Logging keeps both, as it keeps every line ([Logging and errors](logging-and-errors.md#where-production-logs-are)).

## The routes

Every answer says which instance answered, as `instance` (its host name, and the `x-alcove-instance` header) and when, as
`at`, but for the command routes, which answer `{ lines }`: what their command line prints, or what a grant gave. What an
instance knows from memory (its start, its loops, its recent failures, its last checks) is its own. Production runs one
VM, two during a rollout, and the load balancer picks which one answers, keeping a client on one VM while it can. The answers' schemas are in
`features/operator/wire.ts`, `features/operator/checks.ts`, each feature's `operator/operator.ts` and, for `{ lines }`,
`http/operator.ts`, and the CLI parses answers with them.

### Diagnostics

| Route | Scope | Takes | Answers |
| --- | --- | --- | --- |
| `GET /v1/operator/whoami` | read | nothing | the key's ID and scope, the instance and the server's time |
| `GET /v1/operator/release` | read | nothing | which release is serving and how it started (below) |
| `GET /v1/operator/checks` | read | nothing | each dependency, checked from inside (below) |
| `GET /v1/operator/work` | read | nothing | the background loops, the queues, and notes and exports that failed for good (below) |
| `GET /v1/operator/errors?minutes=<n>` | read | `minutes`, 1 to 240, 60 unless given | what failed in that window on this instance, counted (below) |
| `GET /v1/operator/requests/:requestId` | read | a request's ID: a reference the app showed, or a log line's `requestId` | every line this instance's ring holds for it, oldest first: when, the level, component and message, the route it matched (its method and template, never the path as sent), the status, the error's class and code, the upstream status, whether it gave work up for good, and the IDs. `404` when it holds none: the request is older than the ring, matched no route, was past its client's share, or another instance served it, and Cloud Logging has it |

All but the queues and the migrations come from the instance's memory, so they answer with the database out of reach; the
parts that need it say why they couldn't be read instead (a code, such as `timeout`).

**`release`** says:

- `build`: the commit; the image's digest, from the attestation token (none outside a TEE); and the release's entry in
  Sigstore's public log, Rekor, when it was found.
- `running`: when this instance started, and for how long it's been up.
- `boot`: each step of the start that's serving, with how long it took, and the error's class and code if it failed
  ([Logging and errors](logging-and-errors.md#server-appsapisrclogts): `boot step`).
- `migrations`: how many the database has applied and the newest, how many the image has and its newest, three lists that
  should be empty, `notApplied` (in the image, not in the database), `unknown` (in the database, not in the image) and
  `changed` (applied, then changed in the image), and `refused`: why a start would refuse this database (`untracked`,
  `removed`, `changed`), or null. It's the verdict a start acts on (`migrate.ts` › `migrationCheck`).
- `settings`: the values of those that change behaviour and are public anyway (`TEE`, `WEB_ORIGIN`, `API_URL`, `TLS_HOSTS`,
  `DEMO_AUTH_ENABLED`, `GOOGLE_SIGNUP_MODE`, the NEAR AI models and base URL, `ACME_DIRECTORY`, `LOG_LEVEL`, and the cache
  and stream timings); every other setting, secrets included, as `set` or `not set`, never its value; and the operator keys'
  IDs and scopes.
- `clock`: how far this VM's clock is behind Google's, from the last answer Google dated.
- `attestation`: inside a TEE, the token this instance holds (when it was issued and runs out, how old it is), its last
  failure to get one, and when it asks the launcher next.
- `certificate`: with `TLS_HOSTS`, when it runs out and how many days that is, whether renewal is `not due`, `due` or
  `past due`, how many hosts it names, when it was stored, whether its key is the attested one, and this instance's last
  check.
- `caches`: for limits and for feature flags, when this instance last read them, last read them successfully, and how many
  reads failed since.

**`checks`** runs every check at once, each for 10 seconds at most, and an instance runs them at most once every 20
seconds: a request in between gets the last run, marked `cached`. Once a check's time is up it sends nothing more: no probe
is sent after its evidence came back late, and 1Click and Google are asked no further. Each check says whether it passed and
how long it took, and when it failed, a `code`, as every failure is coded (`platform/runs.ts` › `codeOf`): what the error's
context names it by (an evidence check, a provider's error code, Postgres's code), another service's HTTP status, an S3
error's name, a system's code, or the error's class. Never a provider's message.

| Check | What it does | What it says besides |
| --- | --- | --- |
| `database` | `SELECT 1` | the pool: connections open, idle, waiting, and the most it opens |
| `objects` | a `HeadBucket` on the object store | nothing |
| `livekit` | `ListRooms`, on a client of its own with 5 seconds and no failover | how many rooms are open |
| `near-ai:speech`, `near-ai:notes` | Fetches the default model's evidence afresh and checks it, apart from the verifications requests use. Then one fixed request with nothing of anyone's in it, sealed to the key that evidence vouched for: a second of quiet noise to transcribe, or a chat asking for `{"ok":true}`. Alcove pays for them, and no one's plan is metered | the model; the evidence (ok, how long, the check that failed, the TCB status, how many GPUs); the probe (ok, how long, the HTTP status inside the sealed reply, whether it timed out). `not-connected` without a NEAR AI key |
| `oneclick` | 1Click's list of tokens, which says nothing about anyone | how many of the routes Alcove allows it offers (`no-routes` when none), whether a partner key is set, whether top-ups are on |
| `google` | Google's discovery document and key set, then its token endpoint with a code Google never issued: `invalid_grant` means the client ID and secret are good, `invalid_client` that they aren't | whether Google takes the client (`ok`, `refused`, `not-set`), the step that failed, the sign-up mode and how many testers (never who), how many keys, and how far this clock is behind Google's |

**`work`** has three parts:

- **Loops**, from this instance's memory. Each says whether a run is going now, when the last one started and ended and how
  long it took, whether it did its work and what it counted, when one last did, and its failures in the last hour by code: the
  error's class, with another service's status when it names one (`InternalError:403`). The loops: `upkeep` every 5 minutes,
  and each of its steps as `upkeep:<step>` (`sessions`, `agents`, `agent activity`, `receipts`, `operator nonces`,
  `object deletes`, `orphaned objects`, `shared screens`, `notes`, `calls`, `drive exports`, `moves`, `note links`, `rings`,
  `live notes`, `attention`, `plans`, `carried top-ups`, `teams`); `deposits`, the top-up watcher, every 5 seconds;
  `overdue-calls`, ending calls at their longest, every 30 seconds; `notes-writer`, each pass of the writer, with each note's
  failed attempt counted by its code; and `certificates` (with `TLS_HOSTS`), `attestation` (inside a TEE) and
  `owners-rewrap` (while an old master is carried).
- **Queues**, counted from the database, never from a sealed column, one statement at a time and within 10 seconds, after
  which none more is sent. While an instance counts them, another request waits for that count rather than starting one of
  its own beside it, so asking again during a slow database stacks nothing on it. Each count is by its owner's own rule:
  what the writer and the exporter take next, the states the top-up watcher looks at, what each sweep removes.

  | Queue | Counts |
  | --- | --- |
  | Notes | jobs queued, writing and waiting; due now, and how long the oldest due has waited; writers whose lease ran out |
  | Drive exports | pending, uploading, uploaded, failed and to reconnect; due now; the most attempts |
  | Shared screens | recordings stopped with kept shares still in pieces; the pieces and their bytes; the oldest stop |
  | Object deletes | queued; failing; the most attempts; the oldest |
  | Top-ups | due a look, and how late the oldest is; open; open past their deadline with no answer; credited but not carried |
  | Plans and teams | due a look, and how late the oldest is; accounts with no plan |
  | Calls | live; past their longest, and how far past it the most overdue is; host away past the grace (its connection left over 25 seconds ago, by the row: `operator call` asks LiveKit whether one's host is really gone); with no room; ended in the last hour; and from one `ListRooms` (5 seconds): live calls over a minute old whose room is gone, and ended ones whose room is still up (`calls/operator/operator.ts` › `callsWork`) |
  | Sweeps | sessions, agents' rows and team invites waiting to be swept |

- **Finals**, from the ring's list of work given up for good, which requests can't push out: notes finished without a
  summary, and Drive exports that failed for good, in the last day on this instance, as the line that says so names it
  (`final`), by note and job ID, with the error's class and code when it has them.

**`errors`** counts this instance's ring ([Logging and errors](logging-and-errors.md#the-ring-and-the-audit-line)) over the
window, two ways, each group with its newest time and one request ID to follow, the 100 most frequent:

- `requests`: refused and failed requests by the route they matched, as its template (`GET /v1/notes/:id`), status and code.
- `groups`: every line by component, message, code and upstream status.

It says what it counted and didn't keep (`notKept`: requests that matched no route, and lines past their client's share of
120 a minute), and, once a part of the ring is full, the oldest line it still holds (`heldFrom`), so a window reaching
further back than that is said to be cut short. The CLI says both.

### Support

| Route | Scope | Takes | Answers |
| --- | --- | --- | --- |
| `POST /v1/operator/billing` | `show` reads; `credit` is an action | `{ words, reason }`: `billing`'s words, the account named only by a top-up's reference or its ID | `{ lines }`: what `billing` prints ([Plans and usage › Support](plans-and-usage.md#support)) |
| `POST /v1/operator/plans/grant` | write | `{ words, reason }`: an account's ID, then `pro <months>` (1 to 12) or `team <licenses> <months>` (1 to 25 licenses, each for 1 to 12 months), as `plan grant` takes them | `{ lines }`: what was given, and for Pro the day it runs to now ([runbook 8](#8-give-someone-a-plan-for-a-while)) |
| `GET /v1/operator/topups/:reference` | read | a top-up's reference, its 22 characters as checkout shows them | its account's ID, provider and state; when it was opened and its deadline, to the hour, and whether that has passed; whether it's still watched, and when it's next and was last asked about. Then, from its sealed record, opened inside: whether anything was seen arriving, whether it settled, a doubt's code, whether its provider has gone unanswered since the deadline, and what it was to buy and how that went. Never an amount, its address or memo, the quote, or the provider's reference |
| `POST /v1/operator/topups/:reference/check` | write | `{ reason }` | its state before and after asking its provider now, as the person's own checkout asks, under the watcher's lock, whether it's still watched, and `asked`: `answered`, or why its provider wasn't asked (`recently`, within the last 5 seconds, whose answer stands; `unwatched`; `no-provider`). A provider that didn't answer is a `503`, the top-up as it was. One that isn't watched any more is refused, `409` |
| `GET /v1/operator/accounts/:accountId` | read | a person's account ID, its 43 characters; a workspace's or a team's reads as nobody's | the day it was made; its root key's envelopes (`v2`, `v1`) and whether it opens here, or the error's class and its most specific code, when it has one; its last sign-in, its sessions by provider (live, the newest started, last seen) and those ended but not swept; each agent connection's ID, times, live refresh tokens and credentials kept against their most, and how many are live of 50; its plan's kind, or `none` for an account from before plans that hasn't had one made yet (looking makes none), or null when it doesn't open here. Times to the hour |
| `POST /v1/operator/accounts/find` | write | `{ email, reason }`: the address it signs in with, in the body | `{ found, accountId }`: the account's ID when one account signs in with it, otherwise how many do (0, or one for each way of signing in). Hashed inside as sign-in hashes it, and never logged, hashed or not. 20 a key an hour on each instance |
| `POST /v1/operator/accounts/:accountId/sessions/end` | write | `{ reason }` | `{ ended }`: how many sessions it ended. Its browsers are signed out, a Calendar or Drive consent in progress is refused when it comes back, and its agents keep working |
| `POST /v1/operator/limits` | `list` reads; `set` is an action | `{ words, reason }`: `limits`' words | `{ lines }`: what `limits` prints ([Deployment › Changing a limit](deployment-and-acceptance.md#changing-a-limit)) |
| `POST /v1/operator/feature-flags` | `list`, `groups` and counting a group's members (`group members <group>`) read; asking whether an address is in a group, and the rest, are actions | `{ words, reason }`: `feature-flags`' words, addresses hashed inside | `{ lines }`: what `feature-flags` prints ([Feature flags › In production](feature-flags.md#in-production)) |

A credit through the route adds at most $1,000, and a key makes at most two credits a day (UTC), so it adds at most $2,000:
every credit is kept in `operator_credits`, which every instance shares, as a keyed hash and the key's ID, never an amount,
and the key's day is counted there, so the bound holds whichever instance answers and whatever restarts. A key's third
credit of the day is refused, `403`. Named by an account's ID, a ticket adds money to that account once: a second credit with
the same reason, whatever its case, is refused, `409`. Money can't leave through any route: a credit adds to an Alcove balance, which
buys only Alcove's plans.

A grant gives at most 12 months of Pro, or 25 licenses each for 12 months; more is refused, `400`. A key gives at most five
grants a day (UTC), counted in `operator_grants`, which every instance shares, as a keyed hash of the account and the
ticket and the key's ID, never what was given: a key's sixth of the day is refused, `403`. A ticket gives an account a plan
once: a second grant with the same reason, whatever its case or what it gives, is refused, `409`, "That ticket already gave
this account a plan. Nothing was given." A grant is never money: nothing is added to the balance, a refund gives nothing
back for it, and it has no receipt ([Plans and usage › Support](plans-and-usage.md#support)).

### Calls and notes

| Route | Scope | Takes | Answers |
| --- | --- | --- | --- |
| `GET /v1/operator/calls/:id` | read | a call's, a meeting's or a note's ID, 22 characters: tried in that order | which kind matched, the meeting, and its newest 10 runs, newest first, then the run the ID names when it's older than those, with how many runs are left out (below). A room recording's note is `404`: `operator note` says where its writing stands |
| `POST /v1/operator/calls/:callId/end` | write | one run's own call ID; `{ reason }` | `{ callId, ended: true }`. Only a stuck call ends ([runbook 5](#5-a-call-wont-end)); any other is refused, `409`, "That call isn’t stuck; nothing was done.", and while LiveKit can't say whether its room is up or who's in it, and only its word could make the call stuck, `503`: nothing was done |
| `POST /v1/operator/calls/:callId/room/close` | write | a call ID; `{ reason }` | `{ callId, deleted }`: whether LiveKit still had the room of a call that has ended, which it has now closed. Refused for a live call, `409`, and while LiveKit can't say, `503` |
| `GET /v1/operator/notes/:noteId` | read | a note's ID, the end of the address of its call's page | its recording (state, started, ended, and when its kept shared screens' last piece can arrive by); its notes job (state, attempt, lease, due now, and when it was queued: exactly for the first notes, at or after for notes written again); the live transcript's clips, and how long since the last; its Drive exports (format, whose, state, attempt, due, leased); its shared screens (pieces and bytes left to join, videos joined, whether joining is due). Nothing sealed is read |
| `POST /v1/operator/notes/:noteId/retry` | write | `{ reason }` | `{ jobId, before, after }`: the notes job made due now if it waits on the notes model (`waiting`) or to be tried again (`queued`), and the writer started for its organizer. Refused, `409`, while a writer holds it, and when the note has no job |
| `POST /v1/operator/notes/:noteId/exports/retry` | write | `{ reason }` | `{ retried }`: how many of its Drive exports waiting to be tried again were made due now, their exporters started. Those that failed for good or need reconnecting are left to the person, whose consent they need |

Each run of a call says:

- **Its row:** the call's ID, its state, when it started and ended, how long it ran and how far past `call.max_seconds`,
  whether it's locked, whether its host is here, away (for how long) or none, and its generation.
- **From its sealed state, counts only,** opened inside as upkeep opens it: people in, waiting, left and turned away, each by
  role (host, invited, guest); places taken of `call.max_people`; whether someone stands in for the host; its notes (off,
  on or paused, whether ever on, the segment); breakout rooms open; live shares; whether the timer runs.
- **Its recorder:** the recording's ID and state, its segments, pieces and seconds of audio, the transcript's clips and how
  long since the last.
- **Its notes job,** as `note` says it.
- **LiveKit,** asked about a live run or one that ended within the hour, given 5 seconds: whether its room is up, how many
  are in it and how many publish.
- **Signals:** `overdue`, `hostGone`, `roomGone` (more than a minute old), `noRoom` and `roomLeftUp` ([runbook 5](#5-a-call-wont-end)).

Never a name, an address, a photo, a title, a breakout room's name, a message, the call's code or the room's name, which is
LiveKit's key to its dashboards.

## The CLI

`pnpm --filter @alcove/server operator <command>` signs each request, sends it, and prints the answer as aligned text, or
with `--json` as the server sent it. It runs on your own machine, from a checkout, and needs no `.env`: it reads only its
options, `ALCOVE_OPERATOR_API`, `ALCOVE_OPERATOR_KEY` and the key file. Whatever a server says is shown and never acted on:
in text, every control character in an answer, a refusal or a header (line breaks among them, and the marks that reorder
text) is shown as `�`, and `--json` escapes each one, so nothing that got into an answer can clear, rewrite or retitle your
terminal, or reach your clipboard. The options go anywhere among the words:

| Option | Default | What it is |
| --- | --- | --- |
| `--api <url>` | `ALCOVE_OPERATOR_API`, else `https://api.alcove.solutions` | which API to call |
| `--audience <origin>` | `--api`'s origin | the origin the API knows itself by (its `API_URL`'s), when you reach it at another address |
| `--key <file>` | `ALCOVE_OPERATOR_KEY`, else `~/.config/alcove/operator-key.json` | the key to sign with, and where keygen writes |
| `--json` | | print the answer as the server sent it |
| `--reason <ref>` | | an action's reason |

The answer goes to standard output, and each request's ID and the instance that answered to standard error
(`Request Hq3vX9mT2bLwR8kZ on alcove-api-x7k2`), with the server's message when it refused. `pnpm --silent` keeps pnpm's own
lines out of both, for `--json` into `jq`. It exits 0 when the server answered 2xx; 1 when it refused or failed, or the API
couldn't be reached or the key opened; and 2 for words that aren't a command, or an ID, address or reason it refuses before
sending anything.

| Command | Route | What it does |
| --- | --- | --- |
| `keygen [--no-passphrase]` | none | makes your key ([Making a key](#making-a-key)) |
| `whoami` | `GET whoami` | your key's ID and scope, as the server sees them |
| `release` | `GET release` | which release is serving, how it started, its migrations, settings, clock, token and certificate |
| `checks` | `GET checks` | which dependency is failing, and how |
| `work` | `GET work` | background loops, the queues, and notes and exports that failed for good |
| `errors [--minutes <n>]` | `GET errors` | what failed in the last 1 to 240 minutes, 60 unless given, counted |
| `request <request id>` | `GET requests/:requestId` | one request's lines on the instance that answers |
| `account <account id>` | `GET accounts/:accountId` | an account's keys, sign-in sessions, agents and plan |
| `account find [<email>] --reason <ref>` | `POST accounts/find` | the account that signs in with an address; write keys only. Without the address, it asks for it hidden, so it needn't land in shell history |
| `account sign-out <account id> --reason <ref>` | `POST accounts/:accountId/sessions/end` | ends all its sessions, at the person's request |
| `topup <reference>` | `GET topups/:reference` | what happened to a payment, with no amount or address |
| `topup check <reference> --reason <ref>` | `POST topups/:reference/check` | asks its provider about it now |
| `billing show <reference or account id>` | `POST billing` | where an account's plan stands |
| `billing credit <reference or account id> <usd> --reason <ref>` | `POST billing` | adds dollars as support |
| `plan grant <account id> pro <months> --reason <ref>` | `POST plans/grant` | gives months of Pro, as Alcove, after any it has |
| `plan grant <account id> team <licenses> <months> --reason <ref>` | `POST plans/grant` | gives licenses, each for that many months, to the team the account is the admin of |
| `limits list` | `POST limits` | the limits in force, their defaults and bounds |
| `limits set <name> <value> --reason <ref>` | `POST limits` | changes a limit within its bounds |
| `feature-flags <words…> [--reason <ref>]` | `POST feature-flags` | what `feature-flags` takes; a change, or asking whether an address is in a group, needs a write key and a reason |
| `call <id or /calls/… address>` | `GET calls/:id` | a call by its, its meeting's or its note's ID: each run, its room and signals |
| `call end <call id> --reason <ref>` | `POST calls/:callId/end` | ends a call that's stuck |
| `call room close <call id> --reason <ref>` | `POST calls/:callId/room/close` | closes the LiveKit room of a call that has ended |
| `note <note id or /calls/<id> address>` | `GET notes/:noteId` | where a note's writing stands |
| `note retry <note id> --reason <ref>` | `POST notes/:noteId/retry` | makes its notes job due now |
| `note exports retry <note id> --reason <ref>` | `POST notes/:noteId/exports/retry` | makes its Drive exports that wait to be tried again due now |

What it refuses before sending anything:

- A join link (`/join/…`, `/call/…`) or a call's code (`abc-defg-hij`): either lets anyone into the call. Ask for the address
  of the call's page (`/calls/<note id>`) or of the call ahead (`/calls/upcoming/<meeting id>`) instead. `call` and `note`
  take either, pasted whole, and keep only the ID.
- An address in place of an ID, for `billing`, `account` and `plan grant`, which takes an account's ID alone: `account find`
  turns an address into an account's ID.
- A call ahead's address for `note`, which has no note yet; and an address for `call end` or `call room close`, which take
  one run's own call ID, which `call <address>` gives.
- An action without `--reason`, or with one that isn't a ticket's reference. Feature flags' words don't say on this machine
  whether they're an action, so `feature-flags` sends none when none is given, and the server refuses an action without
  one, `400`; one given that isn't a ticket's is never sent.

Locally, put your key's line in `.env` (`OPERATOR_KEYS=write:<public key>`), restart `pnpm dev`, and add
`--api http://localhost:3000/api`, which reaches the API through the web app's dev proxy at the origin it knows itself by.

## Runbooks

Each runbook's `operator` commands assume this alias, set in a shell inside a checkout:

```sh
alias operator='pnpm --silent --filter @alcove/server operator'
```

Looking needs a `read` key; changing something, a `write` key and a reason. Every `gcloud` command in the runbooks only
reads, as the `alcove` configuration. Production's lines are in Cloud Logging as text, under the launcher's log
([Logs](../../infra/confidential-space/README.md#logs)), so each filter matches a line's text, as `"msg":"…"` or a word in
it.

### 1. Is it up, and which release is serving?

```sh
operator release
operator checks
curl -s https://api.alcove.solutions/health
gcloud --configuration=alcove compute instance-groups managed describe alcove-api --zone=us-central1-a \
  --format='yaml(status, versions, currentActions)'
```

- **`release`:** the commit and the image. Every `Boot` step `ok`. `Not applied` and `Unknown` both `none`: a migration the
  database has and the image doesn't means a newer release migrated it, and this one would refuse to start again. The clock
  a few seconds behind Google's (past 30 is logged at warn; every check of another service's token allows a minute). The
  attestation token with no recent failure: it's asked for again once it's 5 minutes old and someone asks for it, so on a
  quiet instance it's older. The certificate's renewal `not due`, and its key the attested one. Both caches read within the
  last 30 seconds, with no failures.
- **`checks`:** `every check passed`. A failing check says its code: [runbook 2](#2-notes-arent-being-written) for NEAR AI,
  [runbook 4](#4-someone-cant-sign-in) for Google.
- **`/health`:** `ok`, `inference`, `livekit`, `tee` and `commit`, which should be `release`'s.
- **The group:** `isStable` and `versionTarget.isReached` true, and one version, whose template's name ends with the first 12
  characters of the image's digest.
- **The deploy:** the last run of Deploy (`.github/workflows/deploy.yml`) in the repository's Actions, and its commit.

### 2. Notes aren't being written

```sh
operator checks
operator errors --minutes 60
operator work
operator note https://alcove.solutions/calls/<note id>
```

1. **`checks`:** `near-ai:notes` and `near-ai:speech`, the evidence and then the probe sealed to the key it vouched for. The
   evidence can check out while the model turns Alcove away, as on 13 Nov:

   ```text
   near-ai:notes:  failed (403) in 1.1 s; deepseek-ai/DeepSeek-V4.1-Flash-1017; evidence ok in 920 ms (UpToDate, 8 GPUs); probe answered 403 in 180 ms
   ```

2. **`errors`:** the writer's lines by message, code and upstream status (`notes not written yet; trying again`,
   `notes waiting for the notes model to answer`, `notes waiting for the notes model to check out`), and the requests that
   failed on the model meanwhile, such as questions about a note, by route.
3. **`work`:** the `notes-writer` loop's failures in the hour by code (`InternalError:403`, `UnansweredError:503`,
   `UnverifiedError`), the notes queue (queued, writing, waiting, due now, the oldest), and the finals: notes finished
   without a summary, by note ID.
4. **`note`,** for one person's note, from the address of the call's page: its recording, its notes job (state, attempt,
   when it's due) and the live transcript's clips.

What `near-ai:notes` says, and what happens to notes meanwhile:

| It says | What it is | Notes meanwhile |
| --- | --- | --- |
| evidence ok, probe `401` or `403` | NEAR AI turns Alcove's key away: revoked, or its account out of credit. The writer's error is `InternalError` ("The notes service turned Alcove away.") with that `upstreamStatus` | Each try uses an attempt; they're tried again after 20 and 90 seconds, and after the third the note is finished without a summary |
| evidence ok, probe `429` or `5xx` | NEAR AI is busy or down: check its status | Each job waits (`waiting`), tried again every 5 minutes, using no attempt |
| evidence ok, probe timed out | the model is slow or stuck | A request that timed out once sent uses an attempt, since the model may have done the work |
| evidence refused, with its check | the model's evidence doesn't check out, and nothing is sent: `collateral-unavailable` and `gpu-unavailable` mean Intel's or NVIDIA's service couldn't be reached; any other code names the check that failed ([Notes and inference › Verified private inference](notes-and-inference.md#verified-private-inference)) | Each job waits, tried again every 5 minutes, using no attempt |
| `not-connected` | no NEAR AI key in this environment | Recordings are kept, and nothing is transcribed or written |

A new NEAR AI key is a new version of the secret `alcove-near-ai-api-key`, which the API reads when it starts: the next
deploy or refresh takes it ([Refreshing](../../infra/confidential-space/README.md#refreshing)).

Once the probe passes, jobs still waiting or queued can be made due at once rather than at their next try. Find their notes
in Cloud Logging, and retry each:

```sh
gcloud --configuration=alcove logging read 'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND (jsonPayload.message:"notes waiting for the notes model" OR jsonPayload.message:"notes not written yet")' \
  --freshness=6h --format='value(jsonPayload.message)' | jq -Rr 'fromjson? | .noteId // empty' | sort -u
operator note retry <note id> --reason INC-77
```

`note retry` refuses a note whose notes no job waits for any more, written or finished, `409`. A note finished without a
summary (the finals in `work`, or `finishing the note without a summary` in Cloud Logging) needs a new job, which its
organizer starts with **Try writing them again** on the call's page. No operator action writes it.

### 3. A payment didn't arrive, or arrived twice

The person gives the top-up's reference: checkout's Pay step shows it from the start, and so do Done's receipt and Settings'
Add money.

```sh
operator topup <reference>
operator billing show <reference>
```

`topup` says its state:

| State | What it means |
| --- | --- |
| `waiting` | Open, and nothing has arrived |
| `arriving` | A payment is on its way through 1Click's swap. With a `Doubt` code, 1Click's answer couldn't be trusted: nothing is added, and it fails at its deadline |
| `short` | Less than asked arrived. 1Click refunds it to the treasury at the address's deadline, and what was sent is added then |
| `credited` | Added, and bought what it was for (`Buys`) |
| `held` | Settled with nothing to add |
| `expired` | Nothing arrived by the deadline. Still watched, less often, until 30 days after its address expired |
| `failed` | Something arrived and didn't swap cleanly by the deadline, 1Click said it failed, or its answer couldn't be trusted: it's for support. Still watched for those 30 days, and added if 1Click settles it cleanly |
| `cancelled` | The person cancelled it. A payment that still reaches it is added, and buys nothing |

- **It hasn't arrived.** `operator topup check <reference> --reason SUP-1182` asks 1Click about it now, as the person's
  checkout does, and says its state before and after. While it's watched, what reaches it is added by itself.
- **It was paid, and failed or expired.** Confirm what reached the treasury in the treasury's own records, outside Alcove
  ([Plans and usage › Treasury runbook](plans-and-usage.md#treasury-runbook)), then add it by the top-up's reference, which
  closes it so it can't add itself again: `operator billing credit <reference> <usd> --reason SUP-1182`. One Alcove still
  watches is refused: wait for its deadline. A credit is at most $1,000: a larger top-up is credited $1,000 by its
  reference, and the rest by the account's ID, each credit by ID under a reason of its own, at most $2,000 a key a day.
- **It arrived twice.**
  - Two payments to one address before it settled are added together: 1Click swaps what arrived as a whole.
  - A payment to a top-up that was cancelled, expired or failed, such as one replaced by checkout's Get a new address, is
    added to the balance and buys nothing (`Buys: pro, refused`). The person's Buy with your balance can use it.
  - A payment to an address after its top-up settled: Alcove never sees it, and 1Click refunds it to the treasury. Confirm
    it in the treasury's own records, then add it by the account's ID, which `topup` and `billing show` say:
    `operator billing credit <account id> <usd> --reason SUP-1182`.

### 4. Someone can't sign in

Ask for the word after `signin=` in the welcome page's address, and when it happened.

| `signin=` | What it means |
| --- | --- |
| `invite-only` | Sign-up is for testers (`GOOGLE_SIGNUP_MODE` `testers`), and that address isn't one. `checks`' `google` line says how many testers there are, never who |
| `google-email-required` | Sign-up is public, and a new account, or an address that changed, needs a Gmail or Google Workspace identity |
| `busy` | 30 sign-ins a minute from one client address, shared with agents' sign-in: wait a minute |
| `unavailable` | No Google client is set up on this server |
| `expired` | The sign-in took too long, or started in another tab: start again |
| `cancelled` | They cancelled at Google |
| `unverified` | Google hasn't verified that account's address |
| `failed` | Anything else: Google's answer didn't check out, or Alcove failed |

```sh
operator checks
operator account find --reason SUP-1182
operator account <account id>
gcloud --configuration=alcove logging read 'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND jsonPayload.message:"google sign-"' \
  --freshness=1d --format='value(timestamp, jsonPayload.message)'
```

- **`checks`:** the `google` line: whether Google takes the client, its keys, and the clock.
- **`account find`** asks for the address, hidden, and says the account's ID: write keys only, 20 an hour.
- **`account`:** whether its keys open here (when they don't, the error's class and code: [Privacy, keys and
  sessions](privacy-keys-and-sessions.md)), when it last signed in, its sessions by provider, and its agents.
- **The log:** `google sign-in refused` and `google sign-up refused` with the reason and, for `failed`, the step and Google's
  status and error code; `google sign-in failed` when Alcove failed, which `operator errors` counts too.
- A reference shown on a page that didn't load afterwards: `operator request <reference>`.
- A lost laptop: `operator account sign-out <account id> --reason SUP-1182` ends every session, and its agents keep working.

### 5. A call won't end

The person gives the address of the call's page (`/calls/<note id>`) or of the call ahead (`/calls/upcoming/<meeting id>`),
never the join link.

```sh
operator call https://alcove.solutions/calls/upcoming/<meeting id>
operator work
```

`call` gives each run, newest first, with its signals:

| Signal | What it means | What ends it |
| --- | --- | --- |
| `overdue` | Live past its longest (`call.max_seconds`) | The 30-second loop, `overdue-calls` in `work`. Still live means ending it fails: its failures in `work`, and `a call that ran as long as a call can wasn’t ended; trying again next time` in `operator errors` |
| `hostGone` | The connection that hosts left, or never reached the room, over 25 seconds ago, and isn't in it | Upkeep (`upkeep:calls`, every 5 minutes) hands it to someone who can host, or ends it when nobody can |
| `roomGone` | Live, over a minute old, and LiveKit has no room for it | Upkeep ends it |
| `noRoom` | Live with no room at all, so nobody can be in it | `call end`, or its longest |
| `roomLeftUp` | Ended within the hour, and LiveKit still has its room, so whoever's still connected stays connected | `call room close` |

```sh
operator call end <call id> --reason INC-77
operator call room close <call id> --reason INC-77
```

Both take one run's own call ID, the `Call` line `call` printed. `call end` ends a call only if it's stuck: past its
longest, its room gone or never made, or its host gone past the grace with nobody in the room. While LiveKit doesn't
answer, only a call past its longest or with no room ends: the rest would end on LiveKit's silence, so they're refused,
`503`, until it answers again (`operator checks` says how LiveKit is). `work`'s count of hosts away is by the row alone, so
a host who never reached the room isn't in it: `call` asks LiveKit, and its `hostGone` is the one that ends a call. It ends as when its host
leaves: everyone's disconnected, breakout rooms close into the notes, the recording stops and its notes are written. It can't
be undone, and rejoining starts a new run with a new note. `call room close` closes the LiveKit room of a call that has
ended, which disconnects whoever is still in it, and changes nothing stored.

### 6. A deploy is stuck

1. **The run:** the last run of Deploy (`.github/workflows/deploy.yml`) in the repository's Actions, and the step it's on.
   deploy.sh says what it's waiting for.
2. **The group:** its status and the template it's rolling to, then each VM's status, health, action and template. A new
   VM running but not healthy isn't serving TLS yet.

   ```sh
   gcloud --configuration=alcove compute instance-groups managed describe alcove-api --zone=us-central1-a \
     --format='yaml(status, versions, currentActions)'
   gcloud --configuration=alcove compute instance-groups managed list-instances alcove-api --zone=us-central1-a
   ```

3. **The region's C3 quota,** 8 vCPUs: production's VM and the one a rollout adds. deploy.sh refuses up front, naming what
   else holds it: staging's VM, or one an earlier rollout took out, which holds its share until it's deleted, about eight
   minutes after.

   ```sh
   gcloud --configuration=alcove compute regions describe us-central1 --format=json | jq '.quotas[] | select(.metric == "C3_CPUS")'
   ```

4. **The new VM's start,** by its name from `list-instances`: its `boot step` lines, each try at the database, or
   `refused to start` ([runbook 7](#7-the-api-wont-start)).

   ```sh
   gcloud --configuration=alcove logging read 'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND jsonPayload._HOSTNAME="<instance>" AND (jsonPayload.message:"boot step" OR jsonPayload.message:"database not reachable yet" OR jsonPayload.message:"refused to start")' \
     --freshness=1h --format='value(timestamp, jsonPayload.message)'
   ```

5. **`operator release`:** whichever VM answers says its commit and its start. While the new VM doesn't serve, the old one
   answers, with the commit it runs.

A stuck deploy holds back whatever it carries, a revoked key included ([Revoking a key](#revoking-a-key)).

### 7. The API won't start

A VM whose API can't start logs `refused to start` and exits. Confidential Space then restarts the whole VM, which serves
again about three minutes later if the next start works, and autohealing replaces one still failing after 10 minutes. The
image has no shell, so the log is what there is: each step of a start says how it went as it ends (`boot step`), the first
database connection is tried again for up to three minutes (`DATABASE_WAIT_MS`), each try said at warn, and the error that
stopped it is the `refused to start` line.

1. **The API's lines,** step by step:

   ```sh
   gcloud --configuration=alcove logging read 'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND (jsonPayload.message:"boot step" OR jsonPayload.message:"database not reachable yet" OR jsonPayload.message:"refused to start")' \
     --freshness=1h --format='value(timestamp, jsonPayload._HOSTNAME, jsonPayload.message)'
   ```

2. **The launcher's own lines,** which say whether the image was pulled, its signature found and a token issued:

   ```sh
   gcloud --configuration=alcove logging read 'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND jsonPayload.MESSAGE:*' \
     --freshness=1h --format='value(timestamp, jsonPayload._HOSTNAME, jsonPayload.MESSAGE)'
   ```

3. **The VM's boot,** from its serial port:

   ```sh
   gcloud --configuration=alcove compute instances get-serial-port-output <instance> --zone=us-central1-a
   ```

The steps run in this order, and the first that fails says why:

| Step | What failing means | Where to look |
| --- | --- | --- |
| `google-cloud` | Inside a TEE: the attested identity and the secrets. A `KeyError` naming the Workload Identity provider is the Security Token Service refusing the attestation, so the policy turned the image away; one naming a secret is Secret Manager refusing it, for a missing grant or a missing version | [The attestation policy](../../infra/confidential-space/README.md#the-attestation-policy) |
| `config` | A setting it can't run with: the error names it, such as `OPERATOR_KEYS: entry 2 isn’t read:<public key> or write:<public key>…` | env.sh and the image's settings |
| `database` | Past `DATABASE_WAIT_MS` with no connection, an `UnavailableError` saying how many tries; Postgres refusing the connection outright (a wrong password, no such database), a `DatabaseError` at once | Cloud SQL's state, `gcloud --configuration=alcove sql instances describe alcove-db --format='value(state)'`, and the Cloud SQL Auth Proxy's own lines in the same log |
| `migrations` | The database applied a migration this image doesn't have, or one changed since: the image is a release behind the database | Fix forward ([Rolling back](../../infra/confidential-space/README.md#rolling-back)) |
| `keys` | Cloud KMS refused the master, or the server keys don't open | Cloud KMS's audit log ([Known limits](../../infra/confidential-space/README.md#known-limits)) |
| `objects` | The object store's settings | env.sh |
| `edge` | With `TLS_HOSTS`: the certificate, stored or ordered | Cloudflare's code, or Let's Encrypt's limits ([Certificates](../../infra/confidential-space/README.md#certificates)) |
| `listening` | Outside a TEE: the API's port | The port |

When the log isn't enough, the checks job runs every start step on a VM of its own, made from the group's template,
carrying on past failures, then the live checks, prints the report and deletes the VM:
`infra/confidential-space/job.sh production checks`. It needs 4 vCPUs of the quota free, so not while a rollout holds two
VMs ([The checks job](../../infra/confidential-space/README.md#the-checks-job)).

### 8. Give someone a plan for a while

When support makes something good with time on a plan rather than money: months of Pro, or licenses for a team. Alcove
gives it, and no money moves. Name the account by its ID: `operator account find --reason SUP-1182` turns the address it
signs in with into one.

```sh
operator billing show <account id>
operator plan grant <account id> pro 3 --reason SUP-1182
operator plan grant <account id> team 5 3 --reason SUP-1182
```

- **`billing show` first:** its plan, its license (Pro isn't given over a live team license, whose plan is in force: `409`)
  and its team and role (licenses go only to a team it's the admin of).
- **Pro** (`pro <months>`, 1 to 12): the months go after any it has, back to back, as months bought do, or from now on Free,
  each a period long, and end any grace. It says the day Pro runs to now. The person's Settings › Plan says until when, and
  its payments say "Pro, 3 months, given by Alcove", with no receipt. Renewing, when it's on, carries on after them at a
  month's price as it was when they were given.
- **Team** (`team <licenses> <months>`, up to 25 licenses, each for 1 to 12 months): licenses for the team the account is the
  admin of, each taken by someone on it without one on their next visit and live for that many months from then, as
  licenses bought are. An account that's no team's admin is refused, `409`: they start a team first (Start a team, on Team
  or Plans), then it's given. Auto-purchase goes on buying at what a license last cost the team, which a grant doesn't
  change. The admin's payments say "Team, 5 licenses for 3 months, given by Alcove".
- **Once a ticket:** the same ticket for the same account is refused, `409`, whatever it gives, so sending it again after a
  lost answer gives nothing more. A grant that's refused (over its most, no team, a live license) uses up neither the
  ticket nor the key's day.
- **At most** 12 months of Pro or 25 licenses each for 12 months a grant, and five grants a key a day (UTC). More takes
  more than one grant, each under a ticket of its own.
- **Never money:** nothing is added to the balance, and a refund gives nothing back for it: a refund of months or licenses
  among which some were given gives back what was paid for the rest, and takes the given ones with it, and one of given
  ones alone is refused, with nothing changed. To make something good in money, `operator billing credit`
  ([runbook 3](#3-a-payment-didnt-arrive-or-arrived-twice)).
- **No route takes a grant back.** What was given runs its course, unless its owner refunds what they bought, which takes
  what was given and hasn't started with it.

Each grant's line, under its request's ID:

```sh
gcloud --configuration=alcove logging read 'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND jsonPayload.message:"\"msg\":\"plan given by support\""' \
  --freshness=30d --format='value(timestamp, jsonPayload.message)'
```
