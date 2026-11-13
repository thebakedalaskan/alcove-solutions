# Deployment and acceptance

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Deployment runbook](../../infra/README.md)

## Environments

The target is the apex `https://alcove.solutions`, with API `https://api.alcove.solutions`. Acceptance
requires the deployed commit, valid public HTTPS and the user journeys below. The deploy's own check, through the load
balancer's address, establishes that the release runs attested with the right key; public-domain access requires its
own verification.

| | Local | Deployment target |
| --- | --- | --- |
| Web | Vite on `:3000` | Served by the API from its own image, on `alcove.solutions` (`www` redirects to it) |
| API | `tsx watch` on `:8787`, proxied at `/api` | Google Cloud Confidential Space on Intel TDX: managed instance group `alcove-api` (one c3-standard-4 VM, `us-central1-a`) behind a regional external proxy Network Load Balancer, `alcove-api-ip`, for `api.alcove.solutions`. TLS ends in the VM ([Confidential Space runbook](../../infra/confidential-space/README.md)) |
| Database | Postgres 17 in Docker | Cloud SQL `alcove-db`, Postgres 17 Enterprise; SSL, 03:00 UTC daily backup window, seven retained backups, PITR; reached through the Cloud SQL Auth Proxy in the image |
| Objects | RustFS in Docker | Private Cloudflare R2 `alcove-objects`, accessed through the API |
| Secrets | `.env`, gitignored | GCP Secret Manager: database, storage, LiveKit and Cloudflare DNS credentials; optional inference and Google credentials; the keys from before Confidential Space, until they're retired. Only an attested, signed image may read them, or use the Cloud KMS key that wraps the master ([Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing)) |
| DNS | Localhost | GoDaddy registrar; Cloudflare nameservers `johnny.ns.cloudflare.com` and `maleah.ns.cloudflare.com`; DNS-only records |

Run locally with `pnpm install && pnpm dev`. The [runbook](../../infra/README.md) contains bootstrap,
credential setup and repository variables, and the [Confidential Space runbook](../../infra/confidential-space/README.md)
the setup, deploys, rollbacks, staging, certificates and release verification.

## Pipeline

1. **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`, as four checks:
   - **Policy:** integration tests only and strict typing; no `any`, assertions, non-null or suppressions.
   - **Typecheck:** every package with strict compiler flags, after writing the web app's route tree as its build
     does (`pnpm --filter @alcove/web run routes`), without building.
   - **Build:** web, API bundle and API container.
   - **Integration tests:** the real API against Postgres and an S3-compatible store, signing in the way
     the web app does, with local stand-ins for Google (an OpenID provider and the Calendar API) and for
     NEAR AI Cloud. They're split across ten runners, each with its own Postgres, object store and LiveKit,
     by how long each file took (`scripts/ci-tests.mjs`, timings in `scripts/ci-test-times.json`); a file
     longer than a runner's share is split at its top-level `describe` blocks. The check fails unless every
     test vitest lists ran once and passed. A pull request that only changes `apps/web`, `apps/storybook`,
     `packages/ui`, `docs` or top-level Markdown skips them, since they test the API; pushes to `main`
     always run them. When the runners drift apart, refresh the timings from a run's artifacts with
     `node scripts/ci-tests.mjs times <dir>`.
2. **Merge gate.** Import `.github/rulesets/main.json` to require pull requests and all four checks
   on an up-to-date branch. The checked-in ruleset is a configuration artifact; verify its live status.
3. **Deploy** (`.github/workflows/deploy.yml`) requires repository variable `DEPLOY_ENABLED=true`.
   Automatic deploys accept only successful CI runs from pushes to this repository's `main` and check
   that the selected commit still matches `main` before proceeding. Manual dispatch is restricted to
   `main`. Runs are serialized, and the monthly refresh skips while one is queued or running.
4. **Release.** One image holds the API and the web app ([Confidential Space runbook › Deploying](../../infra/confidential-space/README.md#deploying)).
   Build it from the commit and push it. It records its commit (`ALCOVE_COMMIT`, reported by `/health` and
   `/v1/attestation`), carries ffmpeg for shared screens' video (ffmpeg-static's binary, pinned in
   `apps/api/package.json`, copied to `/app/bin/ffmpeg`, `FFMPEG_PATH`, so the image changes when that pin does) and the
   Cloud SQL Auth Proxy, and holds the web app built against `https://api.alcove.solutions`, with the CSP
   `apps/web/scripts/csp.mjs` writes for that origin (inline scripts by hash, nothing third-party but LiveKit and
   Sigstore's public log, Rekor, which the app reads to check the server). Sign it
   with cosign and the Cloud KMS key `alcove-image-signing`, which records it, with its commit, in Sigstore's public log.
   Execute the migration job, which gets only `DATABASE_URL`, and wait. Roll the group onto the image, a new VM first
   (refused up front when the region's C3 quota can't hold it), and, in a job with no Google credentials, check it
   through the load balancer's address: the attestation the app checks, that the TLS key is the attested
   one, `/health`, and the commit and image. The migration job applies only the migrations
   the database hasn't had, and refuses one whose applied migrations were since edited or removed, so such a
   deploy stops before the new API starts and the previous release keeps serving (migrations only move
   forward: restore the file and put the change in a new one). The API refuses the same at start, so a rollback can't
   go back past a release that added a migration ([Confidential Space runbook › Rolling back](../../infra/confidential-space/README.md#rolling-back)).
5. **Refresh.** On the 3rd of each month (`.github/workflows/refresh.yml`) the same image moves onto Google's newest
   Confidential Space image, which Google requires for attestation to keep working. It skips while a deploy is queued
   or running.

The static build emits `dist/client/index.html` through TanStack's SPA prerender output path `/index`.
The API serves `dist/client` from its image (`WEB_DIR`) by the rules Cloudflare Pages applied: a file that exists, then
`<path>/index.html`, then `<path>.html`, and otherwise the shell for client routes, with the headers in `_headers`;
the build includes no catch-all `_redirects` or top-level `404.html`. The shell is the root route
alone, so app addresses hydrate it and then render their own routes. An address no other route takes
matches the catch-all `routes/$.tsx` (Nothing here, with the Drive offered), not a not-found component on
the root route, which would render where the shell has none and fail hydration (React error #418).
The public privacy policy is prerendered as `privacy.html` so it can be read without JavaScript.
The API redirects `www` to the apex.

**Opening offline.** A service worker, `apps/web/public/sw.js`, keeps the build in the browser, so the app's
files load without a connection once the browser has opened Alcove online. The web app's `build` script ends with
`apps/web/scripts/precache.mjs`, which writes the shell and asset list into `dist/client/sw.js`. The worker does
not precache extra prerendered documents or on-demand camera assets. The version is hashed from the build's
contents. Nobody maintains the list by hand, and the script refuses a build it has already written into. The app registers the worker from its root route
once the page has loaded, in production builds only (`apps/web/src/lib/serviceWorker.ts`), and logs a failed
registration or install as a warning.

- **Install** fetches every file in the list, and caches them once all have arrived. The shell is requested
  as `/`, the address the app loads it at. If any file fails to arrive, nothing is cached, the
  install fails and the previous worker stays. HTML under any name but the shell's counts as not arriving:
  the server answers a name it doesn't have with the shell, as a 200, so a deploy going live during an install
  can't leave that cached as the asset.
- **Page loads** go to the network first, with navigation preload. Without a connection they get the
  cached shell, which opens whichever screen was asked for. Nothing fetched is written back, so the
  cached shell always matches the assets cached with it.
- **Hashed files** under `/assets/` are served from the cache first. The build's other files (the
  favicon, the audio worklet, portraits) go to the network first and fall back to the cache.
- **Left alone:** `/api`, every other origin (the API's included) and every request but GET go straight
  to the network. Nothing from the API is cached.
- **Updates:** a new build's worker takes over as soon as it has cached everything. It deletes the caches
  of earlier versions (`alcove-app-<version>`).
- **Notifications:** browser notifications go through the worker's registration (`showNotification`, the only way
  Chrome on Android shows them), and a click on one reaches the worker. It closes the notification and asks each
  window where it is (a client's `url` stays the page it loaded, however far the app has moved inside it), brings
  forward the one already at that page, or else the one used last, and posts it `{ type: 'alcove.notification', open }`
  (`WorkerMessageSchema`). The page parses that and goes there through the router, so a call or a recording still
  asks before it's left; the worker never navigates a window. With no window it opens one at that page.

`sw.js` falls under the `/*` rule in `_headers` (`max-age=0, must-revalidate` and the CSP, whose
`worker-src 'self'` allows it), so the browser finds a new worker on the next page load. A shell served
from the cache keeps the headers it was cached with, its CSP included. Every screen's route asks the API for
the session before it opens. When that can't reach the API (no connection, or the request doesn't get through),
someone signed in on this browser carries on offline (`requireAccount` in `apps/web/src/lib/guards.ts`, from the
flag in `apps/web/src/lib/device.ts`): Record and the stage recorder work, and every other page shows **You're
offline** with the way to Record (`OfflinePage`, also the router's error page for any request that didn't get
through). A 401 still signs out. With no connection at all, queries aren't retried, so a page says so at once.
See [Calls and recordings › Recording without a connection](calls-and-recordings.md#recording-without-a-connection).

Only the release job and the monthly refresh job can request a GCP OIDC token, and they run only the deploy scripts and
pinned tools: the checks after them, which install and run workspace packages, are jobs of their own with no Google
credentials. Workload Identity Federation restricts the immutable repository and owner IDs, main ref, the two workflows
and the event types each may run on. GCP identifiers are repository variables; no Cloudflare credential is in GitHub (the
DNS token lives in Secret Manager). Automatic deployment requires no environment reviewer gate.

The API runs as one Confidential Space VM, c3-standard-4 (4 vCPUs, 16 GB), behind a proxy load balancer that closes a
connection after 3,600 seconds with nothing sent either way and gives a VM leaving the group 300 seconds to finish its
connections. The limits below were set when it ran on Cloud Run (one instance, one CPU, 2 GiB, a 300-second request
timeout, 1,000 requests at once, session affinity), and they still hold: every one fits inside the VM's room and the load
balancer's timeouts. An open tab holds a request for its stream of rings, so at Cloud Run's default of 80 they'd have
starved live calls. The API holds at most 300 of those streams, and 8 for any one account.
A live stream of a workspace or a document holds a request too, for as long as it's open: at most 8 of a workspace and 8 of
documents for any one person on an instance, where the next ends their oldest once it's been open 20 seconds, at most one
every 20 seconds (`LIVE_MAKE_ROOM_MS`), 64 of both from one client address (`LIVE_STREAMS_PER_ADDRESS`), and 500 of both together for everyone
(`LIVE_STREAMS_MAX`), past which they're refused with `503` and browsers try again, and the API lets go of each one after 280
seconds for the browser to open it again (`LIVE_STREAM_MS`; keep it under the load balancer's timeout). Cloud Run never told the API that a
browser closed a stream (HTTP/1 there didn't pass a disconnect on), so the browser says so itself, with `POST …/live/end` and the
name it gave the stream, and the API ends it then and there; it still does. To check it on the deployed app, open twenty documents from the
list in two minutes: none should stay on Reconnecting, and the log should have no "You have this open in too many windows"
warning with `kind: document`. Rings and these are
counted apart and come to 800 together, which leaves 200 requests for calls and everything else with both full. Raise one of
them only with that in mind. On Cloud Run, Node gave its heap about half of the container's memory, so 2 GiB was a
heap of about 1,120 MiB; Node gives it more on the VM's 16 GB. Documents are opened in worker threads with memory of their own, 640 MiB for the one that takes big
documents and 96 MiB for the rest (`DOC_HEAP_MB`, `DOC_WORKERS`), outside that heap, so keep the two inside the container
together: a document at its ceilings peaks at about 550 MiB in the big worker. What's on its way in and out is outside the heap
too, at most 128 MiB of updates and 64 MiB of documents (`DOC_SENDING_MB`), plus what's waiting for a worker, at most 128 MiB.
Before the limits were set from real blocks, a document at its item limit and an 8 MB one, in a 1 GiB container, peaked at
884 MiB, which is why Cloud Run's instance was 2 GiB. Set a process-wide `--max-old-space-size` on no instance: it overrides what a worker is
limited to. The bundle has a third file, `dist/live/docWorker.js`, which the image's `dist` already carries. Each instance holds one more Postgres connection, for `LISTEN`, once anyone streams from it, and
checks it every 15 seconds (`HUB_CHECK_MS`, `HUB_TIMEOUT_MS`); it needs to reach Postgres directly, as the Cloud SQL
Auth Proxy in the image does, because `LISTEN` doesn't work through a transaction-mode pooler.
Files in a workspace are shaped by the same limits. Cloud Run refused an HTTP/1 request or a response that said its length
over 32 MiB, so a file goes up in pieces of 4 MiB, an answer to a range sends at most 16 MiB, and a whole file over that
streams without a length ([Data and storage › Media](data-and-storage.md#media)). The API ends a read itself at 280 seconds
(`MEDIA_READ_MS`), inside the timeout Cloud Run had: a player asks on from where it got to, and so does a browser's download, with the
file's `ETag` (`If-Range`). Files pass through
this one process, so what they hold in it and what they take of its core are limited (`MEDIA_LIMITS` in `features/workspaces/media.ts`),
and past those limits a request is refused rather than taken on. At most 96 requests at once are files. The limits were set
for 1 GiB and stayed when the instance went to 2 GiB, because the rest is for documents' worker threads. Measured on the built
server with a 1,120 MiB heap and nothing else running, 920 pieces sent at once and 80 readers who stopped took it from 150 MiB
to at most 840 MiB. With 20 people reading all their limits allow, a call's poll took 25 ms at the median, against 8 ms with
nobody reading. Change the limits with the instance's memory, and measure again.
The VM's CPU is there between requests for background work, as Cloud Run's was kept: sweeping ended sessions,
physical-deletion cleanup, and writing notes after a call or room recording stops. Sessions live in Postgres, so a restart
signs nobody out, and notes jobs left behind by a restart are picked up by the next maintenance run.

**Rolling back past the release that added files deletes them.** The release before it doesn't know
`workspace_media_pieces`, so its maintenance takes every object of a file older than 24 hours for an orphan, and deletes it at its
next run, within 5 minutes of starting. Nothing brings an object back. Fix forward instead. If a rollback can't be avoided, copy the
object store first, and restore it once a release that knows files is back: the rows stay, so they'd find their objects again.

**Nothing rolls back past the release that brought plans.** It added migrations, and the release before it (`a221e1f1d`,
with credits) refuses at start a database that applied migrations it doesn't have. While the rollout still has its VM
serving, it can't open the deposit records plans write, and knows nothing of Pro, more notes, teams or who pays for a
workspace. Fix forward ([Plans and usage › How it upgrades](plans-and-usage.md#how-it-upgrades)).

NEAR AI has its own deployment switch. With `NEAR_AI_ENABLED` true (or unset) the API reads `NEAR_AI_API_KEY` from
`alcove-near-ai-api-key` (the migration job doesn't need it), and runs
with `NEAR_AI_BASE_URL=https://cloud-api.near.ai/v1` and the default models, speech endpoint and roots
([Notes and inference › Models and requests](notes-and-inference.md#models-and-requests)). With the flag false
it isn't read and no placeholder secret version is needed: the API keeps recordings but
doesn't transcribe them, notes wait, and `/health` reports `inference: missing`.

Top-ups are on in production, which runs with `TREASURY_INTENTS_ACCOUNT=alcove-treasury.near`,
the NEAR account whose Intents balance receives every top-up and refund, and without `ONECLICK_API_KEY`, so 1Click
quotes at its own fee ([Plans and usage](plans-and-usage.md)). The migration job doesn't need either. To turn
top-ups off, take the setting out of `infra/confidential-space/env.sh` and redeploy: nothing is checked or added meanwhile, and once it's back the watcher
picks up every deposit it still watches.

With NEAR AI enabled the API also reaches, over HTTPS through Cloud NAT, the models' own endpoints
(`whisper-large-v3.completions.near.ai` and `deepseek-v4-1-flash.completions.near.ai`, and the host of any other private model chosen), where everything with
content goes sealed, and the services that verify them before anything is sent: Intel's
`api.trustedservices.intel.com` and `certificates.trustedservices.intel.com`, and NVIDIA's
`nras.attestation.nvidia.com` ([Notes and inference › Services verification depends on](notes-and-inference.md#services-verification-depends-on)).
None of them needs a credential. If one can't be reached, notes wait and clips aren't transcribed, rather
than going unverified.

Google provider credentials have a separate deployment switch. With `GOOGLE_AUTH_ENABLED` true (or unset) the API reads
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from `alcove-google-client-id` and
`alcove-google-client-secret` (the migration job needs only the database). Bootstrap creates these
secret resources, and `infra/confidential-space/setup.sh` lets the attested identity read them; credential versions are
populated separately. An installation without them sets the flag false and needs no Google secret values; the Google
button then explains that sign-in isn't set up. The API also needs `API_URL`, its public base URL, from which the
Google redirect URI is built.

The load balancer in front of the VMs keeps no request logs, because raw URLs can contain call codes or OAuth callback
queries. The GCP `_Default` sink still excludes the request logs of Cloud Run's `alcove-api`, for the same reason; the
service was deleted on 2026-11-13, so the exclusion matches nothing now. Application structured logs remain
([Logging and errors › Where production logs are](logging-and-errors.md#where-production-logs-are)). The exclusion is
configured outside bootstrap and needs separate verification; additional log sinks must also avoid retaining raw
request URLs.

## Changing a limit

Some limits can change while the service runs, with no release and no restart: what each plan brings and costs, what AI
costs and when it stops, how long a call runs and how many people it takes, and what files can take up
([Plans and usage](plans-and-usage.md)). Each has a name, a default that holds while nothing's set, and a floor and a ceiling
in code (`apps/api/src/limits.ts`) that hold whatever's set, so a typo can't make anything unsafe. A value is a row in
`service_limits`, and each instance reads them again every 30 seconds (`LIMITS_CACHE_MS`), so a change is in force
everywhere within a minute.

| Limit | Default | Floor | Ceiling | Measures |
| --- | --- | --- | --- | --- |
| `plan.free.notes_minutes` | 300 | 0 | 60,000 | Free: the minutes of notes a period brings, reckoned at `ai.hour_micro_usd` an hour. |
| `plan.free.storage_bytes` | 10 GiB | 0 | 1 TiB | Free: what an account stores, its uploads and its recordings. |
| `plan.free.file_bytes` | 512 MiB | 0 | 512 MiB | Free: one file. |
| `plan.pro.notes_minutes` | 3,000 | 0 | 600,000 | Pro: the minutes of notes a period (a month of Pro) brings, reckoned at `ai.hour_micro_usd` an hour. |
| `plan.pro.storage_bytes` | 100 GiB | 0 | 10 TiB | Pro: what an account stores, its uploads and its recordings. Held this high for `plan.grace_seconds` after Pro ends. |
| `plan.pro.file_bytes` | 512 MiB | 0 | 512 MiB | Pro: one file. |
| `plan.pro.price_micro_usd` | $20 | $0 | $10,000 | Pro: one period. |
| `plan.pro.yearly_price_micro_usd` | $16 | $0 | $10,000 | Pro: one period, bought `plan.pro.yearly_from_months` or more at once. None while it's 0 or not below `plan.pro.price_micro_usd`. |
| `plan.pro.yearly_from_months` | 12 | 1 | 120 | The fewest months of Pro one purchase buys at `plan.pro.yearly_price_micro_usd`. None while it's more than `plan.pro.max_months`. |
| `plan.pro.max_months` | 12 | 1 | 120 | The most months of Pro one purchase buys. |
| `plan.pro.remind_seconds` | 7 d | 0 | 30 d | How long before Pro ends its owner is told, and a month is bought if renewing is on. |
| `plan.pro.remind_again_seconds` | 1 d | 0 | 30 d | How long before Pro ends its owner is told again, and a month is bought if renewing will buy one by then. None while it's not below `plan.pro.remind_seconds`. |
| `plan.team.price_micro_usd` | $40 | $0 | $10,000 | Team: one license, a person for one period. |
| `plan.team.yearly_price_micro_usd` | $32 | $0 | $10,000 | Team: a license for a year, a person for one of its `plan.team.yearly_periods` periods. None while it's 0 or not below `plan.team.price_micro_usd`. |
| `plan.team.yearly_periods` | 12 | 0 | 120 | Team: how many periods a license for a year covers, at `plan.team.yearly_price_micro_usd` each. None while it's 0 or 1. |
| `plan.team.notes_minutes` | 3,000 | 0 | 600,000 | Team: the minutes of notes a license's period brings its member, reckoned at `ai.hour_micro_usd` an hour. |
| `plan.team.storage_bytes` | 100 GiB | 0 | 10 TiB | Team: the storage each live license adds to its team's pool; also what someone who leaves a team is held to through `plan.grace_seconds`. |
| `plan.team.file_bytes` | 512 MiB | 0 | 512 MiB | Team: one file. |
| `plan.hours.pack_minutes` | 600 | 1 | 60,000 | More notes: the minutes one pack adds to the period it's bought in, reckoned at `ai.hour_micro_usd` an hour. |
| `plan.hours.price_micro_usd` | $15 | $0 | $10,000 | More notes: one pack. At 0, more notes aren't offered. |
| `plan.hours.max_packs` | 5 | 1 | 100 | More notes: the most packs one purchase buys. |
| `plan.period_seconds` | 30 d | 1 m | 365 d | A plan's period: notes renew, and paid time runs, in these. A change applies from each account's next period (below). |
| `plan.grace_seconds` | 15 d | 0 | 90 d | Once an account is over its plan's limits: how long until what's over stops taking more. |
| `ai.hour_micro_usd` | $0.50 | $0.000001 | $100 | What an hour of notes is reckoned at, to give the AI allowance as time. |
| `ai.stop_micro_usd` | $0.005 | $0 | $10 | What's left of an allowance when transcription and every AI request stop. |
| `ai.warn_seconds` | 5 m | 0 | 1 h | Notes left, at a call's own pace, when its organizer is told. |
| `ai.fallback_input_micro_usd` | $1 | $0 | $100 | A million input tokens of a model NEAR AI lists no price for. |
| `ai.fallback_output_micro_usd` | $4 | $0 | $100 | A million output tokens of a model NEAR AI lists no price for. |
| `ai.image_tokens` | 1,500 | 0 | 100,000 | The input tokens one image is taken to be at most, before NEAR AI says. |
| `ai.guests_call_percent` | 10 | 0 | 100 | The most guests in one call spend between them of its organizer's allowance for the period, in percent: their questions, catch-ups, AI on the call's documents and boards, captions in another language and live notes of their own. |
| `call.max_seconds` | 10 h | 10 m | 48 h | The longest a call runs: it ends then, everyone told 5 minutes before. |
| `call.max_people` | 100 | 2 | 1,000 | The most people in a call at once. Asking to be let in takes no place: someone who asked is let in only while there's room. |
| `call.asks_per_address` | 10 | 1 | 1,000 | The most asks to join one call waiting at once from one network (an address, or an IPv6 /64), so nobody can fill its host's list of them. |
| `team.max_licenses` | 500 | 1 | 100,000 | The most team licenses one purchase buys. |
| `team.low_licenses` | 5 | 0 | 100,000 | Unconsumed licenses below which a team's admin is told they're running low. |
| `team.invite_seconds` | 1 d | 1 m | 30 d | How long a link to join a team works, once. |
| `workspaces.max_made` | 1,000 | 1 | 100,000 | The most workspaces one account makes, to stop one from making them without end. |
| `media.account_day_bytes` | 20 GiB | 0 | 200 GiB | What one person uploads in a day (UTC), in every workspace. |
| `media.others_day_bytes` | 2 GiB | 0 | 200 GiB | What someone signed in adds in a day (UTC) to another account's storage, through the workspaces it pays for. Someone licensed on the same team adds to its pool as to their own. |
| `media.guests_day_bytes` | 256 MiB | 0 | 200 GiB | What guests in calls add between them in a day (UTC) to the storage of the account whose workspaces they work in. |
| `media.payer_reserve_bytes` | 1 GiB | 0 | 1 TiB | What's kept of an account's storage for its own notes and recordings: uploads by anyone else stop once its room would fall below this. |
| `workspaces.payer_grace_seconds` | 15 d | 0 | 90 d | When payment for a workspace moves to one of its admins because whoever paid for it left: how long until the files it held then count against their storage. |

Zero is a value: none. A file size or a day's uploads at 0 stops every upload, with "Files can’t be uploaded right now."; storage
at 0 says storage is full; notes at 0 brings none. Every plan's file limit has the same ceiling, 512 MiB
(`WHOLE_DOWNLOAD_BYTES`), the most that can be read whole for now: a whole file is read in one response, which is cut at
280 seconds, so it takes about 15 Mbit/s to download 512 MiB in one answer. A file limit can be lowered without a deploy,
not raised past that; Pro's and Team's 2 GiB wait for downloads that pick up where they stopped. Slower, a download picks
up where it stopped when the browser resumes it (by itself, or with its Resume), asking for the rest with the file's `ETag`.
Each account is held to its own plan's limits, Free's, Pro's or, licensed on a team, Team's (with the team's pool for its
storage), so a change to a plan's limit reaches only the accounts on that plan; the day's uploads are the same for everyone,
guests in a call included. Lowering one deletes nothing: it refuses the next upload, and the next piece of one already going
([Data and storage › Media](data-and-storage.md#media)). What happens to an account over its plan's limits is in
[Plans and usage › Over the limit](plans-and-usage.md#over-the-limit-the-grace).

Changing `plan.period_seconds` applies from each account's next period. Each account's AI meter keeps the period it's in
(its `from` and `to`), and an account on Free runs its periods on from that one, each at the length the limit says when it
begins, so a period that has begun runs to its end as it began, with what's been spent and any stop. Months of Pro and
team licenses keep the length they were bought or taken with. An account the meter hasn't seen on Free since it started
counts its periods from when it began, at the length in force.

`media.file_bytes` and `media.workspace_bytes` are gone: a file's size and what's stored are each plan's now, and storage is
counted for each account, not each workspace. A row for either is ignored with `service limit ignored` at warn, and what it
said isn't carried over to `plan.free.file_bytes` or `plan.free.storage_bytes`. Delete the row.

From a checkout, against whichever database `DATABASE_URL` names, `.env` locally or Cloud SQL through its proxy, as `migrate` is:

```
pnpm --filter @alcove/server limits list
pnpm --filter @alcove/server limits set plan.free.storage_bytes 20GiB
pnpm --filter @alcove/server limits set call.max_seconds 12h
pnpm --filter @alcove/server limits set ai.hour_micro_usd '$0.60'
```

`set` takes a whole number. Bytes may have a unit (`KiB`, `MiB`, `GiB`, `TiB`), as `512MiB` or as `list` writes it,
`512 MiB`; time may have one too (`s`, `m`, `h`, `d`), as `30d` or `10 h`; and money is in dollars, `$0.50` or `$20`, up to
six places (quote it in a shell, which reads `$0` as a variable). Minutes and counts are whole numbers. It refuses a name
that isn't a limit and a value outside its bounds, at warn, and logs `service limit set` with the old value and the new.
The image has it as `dist/limits-cli.js`, beside `dist/migrate-cli.js`. Or from Cloud SQL's console, in the unit it's
kept in: bytes, seconds, micro-USD ($0.50 is 500000), minutes or a count:

```sql
INSERT INTO service_limits (name, value) VALUES ('plan.free.storage_bytes', 21474836480) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = now();
```

`DELETE FROM service_limits WHERE name = 'plan.free.storage_bytes';` puts a limit back to its default. Each instance logs `service
limit changed`, with the old value and the new, when it sees a change, however it was made, and the first time it reads the
limits, for every one that isn't its default. If it can't read them, it keeps what was in force, says so at warn, and tries
again next time. A row it can't use, a name that isn't a limit or a value below zero, is ignored with `service limit
ignored` at warn, and its limit keeps its default. A value past its bounds is held to them, with `service limit clamped`.

## Changing a feature flag

Feature flags switch new features on for everyone, for hand-picked groups or for individual people, with no release and no
restart. Locally, `pnpm --filter @alcove/server feature-flags …` with `DATABASE_URL` and `KMASTER` from `.env`; in production,
through the API itself, with the operator token whose SHA-256 is `OPERATOR_TOKEN_SHA256` in
`infra/confidential-space/env.sh` (`POST /v1/operator/feature-flags`, [Feature flags › In production](feature-flags.md#in-production)),
since addresses are hashed with a key that only exists inside the VM. Each instance reads the flags
again every 30 seconds (`FEATURE_FLAGS_CACHE_MS`). Everything else, building behind a flag, every command and retiring a flag, is in
[Feature flags](feature-flags.md).

## Support's billing

Support adds dollars to an account's balance, and says where its plan stands, with `billing` ([Plans and usage ›
Support](plans-and-usage.md#support)). Locally, `pnpm --filter @alcove/server billing …` with `DATABASE_URL`, `KSERVICE` and
`KMASTER` from `.env`. In production there's no job for it: the API runs in Confidential Space, and `KSERVICE` is in its
server keys, sealed under the master only the VM gets ([Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing)).
The old `alcove-kservice` secret, which held the same key, was deleted when the old keys were retired (2026-11-13), so
nothing outside the VM has it. Production's support needs a way in through the API, as feature flags have (the operator
route), which isn't built: until it is, support can't add a credit in production. Built, it names a top-up by its
reference or its ID, never an address, and prints no amount, history or address, as the CLI does.

## Acceptance

These journeys describe existing coverage and release checks still required. Passing local integration
tests does not establish that production DNS, credentials, storage or the real Google round trip work. Accept a
release only after the image running matches the commit, all three public hostnames
have valid HTTPS, web deep links/security headers work, and an account/recording flow proves private
object upload, playback and physical deletion in the deployed environment, and, with NEAR AI enabled, a
live transcript and written notes.

| Journey | Existing coverage or remaining requirement |
| --- | --- |
| Microsoft and SSO demo sign-in; one account per sign-in subject; several sessions; sign-out; sessions survive a restart; Secure host-only cookies | API integration tests |
| People search, the company directory and team invites | API integration tests |
| Schedule, edit, change notes, cancel; a retried mutation applies once | API integration tests |
| Instant call with notes on, off and on again, chat, screen sharing and mic state; leave; play the recording | API integration tests (audio bytes match exactly); real-browser check with fake media |
| A call without notes leaves no note | API integration tests |
| Notes go to everyone invited when the call ends; anyone with them shares them on; removing versus deleting | API integration tests |
| Room recording: rename, pause refuses audio, stop, discard | API integration tests |
| Live transcript and written notes: clips transcribed while notes are on, retried clips kept once, silence dropped, notes written and charged when the recording stops, retries up to the third failure, asking about one note and across notes | API integration tests against a local NEAR AI stand-in; verify against NEAR AI Cloud with `NEAR_AI_ENABLED=true` on each release |
| What the transcript isn't sure of, marked live, in catch-up and in the notes; correcting lines (the organizer any, anyone else the words of their own); writing the notes again with the notes readable meanwhile, what people settled kept once, charged once; the notes recording mixing everyone the organizer's browser hears, silent in breakout rooms | API integration tests against a local NEAR AI stand-in; real-browser check with fake media, the stored recording heard back through Whisper |
| Verified private inference: each model's TDX quote (Intel collateral, TCB status, debug), OS image (MRTD and RTMR0–2 of a published dstack image), report data with a fresh nonce, RTMR3, measured compose, NVIDIA GPU verdict and OHTTP key checked before anything is sent; every request sealed by Oblivious HTTP to the model's attested key at its own endpoint, its reply sealed the same way; nothing sent when any check fails, each refusal logged with its code; notes waiting through a verification outage; a changed key verified again; a verification that runs out made again; the evidence kept with the note and shown on its page | API integration tests against stand-ins for NEAR AI, Intel's certification service and NVIDIA's attestation service under test roots, with the same verification code and the same measured images; the canary test shows nothing crosses the wire readable. Checked against NEAR AI Cloud, Intel and NVIDIA on 3 November 2026 (both models' evidence, the images reproduced with dstack-mr, a real transcription and notes); repeat on each release, and measure new images when NEAR AI moves |
| Cross-owner isolation (calls, notes, audio, transcripts, recordings, asking) and origin checks | API integration tests |
| At-rest leakage: canaries (including speech and a Google account's details) and refresh tokens absent from every table, object and log line, in plain, hex, base64 and base64url | API integration tests |
| Deletion of a note, a meeting or a whole account removes rows, receipts and objects; a call set not to keep its transcript or recording leaves no revision, row, receipt or object of it; maintenance removes ended sessions and orphaned objects and retries refused deletes | API integration tests |
| Files in a workspace: uploaded in pieces and read back whole and by range, a failed piece tried again, an upload carrying on through a lost connection, a dropped upload swept, a reader who loses the document or a guest whose seat ends refused on their next range, a seat reaching only its document's files, the bytes and name absent from every table, object and log line, deleted physically by an editor or when their last document goes, what a process takes on limited, however many ask at once, a read that stopped giving way to someone waiting, a piece that stopped arriving cut, a room opening one board all seeing it, and storage limits, the same for guests as for anyone, changed in the database and in force within the cache window, and refusing without deleting | API integration tests. Play a video over 32 MiB against the deployed API on each release, in Chrome and Safari, pausing it for over 5 seconds while someone waits for a read and playing on: local servers have no response limit, and tests have no player |
| Feature flags: off by default; on for everyone, signed in or not, for the members of groups and for people granted directly, all at once; an address matched however it's typed, and granted before its owner signs up; a deleted group taking its members and grants; a name the code doesn't know ignored; a change in force within the cache window with no restart, and what was in force kept when they can't be read; a deleted account's address gone from groups and grants; the CLI and the logs never repeating an address or its hash | API integration tests. After the first deploy in Confidential Space, send `["list"]` to the operator route once: it lists the flags, which shows the route is on and reaches the database |
| A failed request's ID leads to its log lines; browser reports reach the server log | API integration tests |
| More calls ending at once than there are database connections; a call from start to end, a hand-off and the notes on one connection; a request with no connection to be had fails in 10 seconds | API integration tests |
| Sign in with Google: identity-only scopes, PKCE, state, nonce, signature, audience, expiry, verified email, refusals | API integration tests against a local OpenID provider; verify the real Google round trip on each release |
| Google Calendar: explicit consent with the signed-in Google account, existing connections across sign-in, the coming week's meetings, scheduled calls placed, changed and cancelled with Google's invitations, an organizer's own event made an Alcove call, when people are busy (a private calendar and a missing scope reading as unknown), expired and withdrawn access | API integration tests against a local Calendar stand-in; verify with a real calendar on each release, a Gmail guest's private calendar included |
| Calls that repeat on Google Calendar: one recurring event and one invitation, a series across a change of the clocks, one call changed or cancelled, this and later calls from the first call and from a later one, a call made to repeat, and cancelling the whole series | API integration tests against a local Calendar stand-in, which expands rules as its authors understand Google to. Verify with a real calendar on each release that touches them: the stand-in can't show that Google accepts a single event turned recurring by `PATCH`, or a recurring event ended early with `recurrence` alone |
| Real Microsoft and SSO sign-in | **Not implemented** (demo stand-ins in `apps/api/src/demo.ts`) |
| Public DNS, certificates, CORS, CSP, deep links, JavaScript/CSS asset responses and deployed commit; a signed-in session contacts only Alcove's two origins, and pages carry no inserted beacon | Verify for each public release; assets must not redirect to the SPA shell |
| The app opens offline: after one visit online, a reload without a connection gets the shell and its assets from the service worker, and a new release's worker replaces the previous cache | Verified by hand with headless Chrome against `wrangler pages dev` of a production build (offline through the DevTools protocol, then with the server stopped), when Cloudflare Pages served the app; verify against the deployed app, which the API now serves, for each public release |
| Recording without a connection: cut the connection mid-recording, keep recording and finish; reload offline (Record lists it under **On this device**); reconnect, and it uploads once, in order, into one note; close the tab mid-upload and reopen it, and it still ends as one note; with the recording's account signed out another way and someone else signed in on the browser, nothing uploads into their account and it stays on the device until its own account signs in | Verified by hand with headless Chrome against a production build served with the API behind `/api` (offline through the DevTools protocol), reading the API log; verify for each public release |
| Browser notifications: in a production build a reminder, notes ready and a share go through the service worker, one tab shows them (the next takes over when it closes), each once, a burst as one, a reminder survives a sleep, and a click opens the right page in the right window | Verified by hand with headless Chrome against a production build (`notificationclick` dispatched in the worker, since headless Chrome has no notification to click); verify a real click on each release |
| The model code NEAR AI runs pinned to published provenance | **Not implemented**: the OS image is pinned, but its compose manager starts model code NEAR AI chooses |
| Multi-party end-to-end encrypted calls: keys only in browsers, commits only from the browser that hosts (the organizer's, or a stand-in's), a new key with every join and leave, chat unreadable to the server and to later joiners, media unreadable without the key (LiveKit included), asking to join, no names to LiveKit | API integration tests against a real LiveKit server, with MLS clients and encrypted media; verify two browsers on each release |
| Invitation emails from Alcove | **Not implemented** (with a connected Google Calendar, Google sends the invitations) |
| Attested confidential compute, with the master key released only to it | **Working** since 2026-11-13: production runs in Confidential Space and reports `tee: confidential-space`, every account's root key is wrapped under the TEE's master, and the keys from before it are retired and deleted. Every deploy and monthly refresh checks the server through the load balancer with `infra/confidential-space/verify-server.ts` (the attestation token and the image's signed entry in Rekor, as the app checks them; the TLS key the server presents is the attested one; the commit and image deployed). Staging tries a release first, its first start included, on its own empty database with nothing of production's ([Confidential Space runbook › Staging](../../infra/confidential-space/README.md#staging)). The project's Owners can still use the Cloud KMS key that wraps the master, and every use is in Cloud KMS's audit log ([Known limits](../../infra/confidential-space/README.md#known-limits)). See [Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing) |

The public beta uses verified Google sign-in. The API and website disable demo sign-in in production.
Demo accounts are available in local and Storybook builds.

The Google provider is the external app `Alcove` and the web client `AlcoveWeb`. Sign-in asks for
`openid email profile`. The Calendar connection asks for events and free/busy access with a refresh
token when someone chooses **Connect Google Calendar**. Existing Calendar connections keep their
grants, including connections made before free/busy was added. Drive exports use separate consent for
per-file access. See [Google provider preparation](../../infra/README.md#google-provider-preparation)
for callback URLs, scopes and verification. Automated tests exercise the real API over HTTP.
