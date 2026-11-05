# Deployment and acceptance

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Deployment runbook](../../infra/README.md)

## Environments

The target is the apex `https://alcove.solutions`, with API `https://api.alcove.solutions`. Acceptance
requires matching deployed commits, valid public HTTPS and the user journeys below. A successful
`/health` request through the API's `run.app` URL establishes service health; public-domain access
requires its own verification.

| | Local | Deployment target |
| --- | --- | --- |
| Web | Vite on `:3000` | Cloudflare Pages `alcove-web`, assigned hostname `alcove-web-bt8.pages.dev`, custom domain `alcove.solutions` |
| API | `tsx watch` on `:8787`, proxied at `/api` | Cloud Run `alcove-api`, project `alcove-solutions`, `us-central1`, native mapping for `api.alcove.solutions` |
| Database | Postgres 17 in Docker | Cloud SQL `alcove-db`, Postgres 17 Enterprise; SSL, 03:00 UTC daily backup window, seven retained backups, PITR |
| Objects | RustFS in Docker | Private Cloudflare R2 `alcove-objects`, accessed through the API |
| Secrets | `.env`, gitignored | GCP Secret Manager: database, `KMASTER`, `KSERVICE` and storage credentials; optional inference and Google credentials. The privacy promise needs `KMASTER` released only to an attested confidential VM, which Cloud Run is not; the API is ready to move to one ([Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing)) |
| DNS | Localhost | GoDaddy registrar; Cloudflare nameservers `johnny.ns.cloudflare.com` and `maleah.ns.cloudflare.com` |

Run locally with `pnpm install && pnpm dev`. The [runbook](../../infra/README.md) contains bootstrap,
credential setup, repository variables, domain mapping and release verification. Native
Cloud Run domain mapping is a Preview feature selected for this demo; Google recommends an external
Application Load Balancer for production custom domains. See
[Google's domain guidance](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

## Pipeline

1. **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`, as four checks:
   - **Policy:** integration tests only and strict typing; no `any`, assertions, non-null or suppressions.
   - **Typecheck:** every package with strict compiler flags.
   - **Build:** web, API bundle and API container.
   - **Integration tests:** the real API against Postgres and an S3-compatible store, signing in the way
     the web app does, with local stand-ins for Google (an OpenID provider and the Calendar API) and for
     NEAR AI Cloud.
2. **Merge gate.** Import `.github/rulesets/main.json` to require pull requests and all four checks
   on an up-to-date branch. The checked-in ruleset is a configuration artifact; verify its live status.
3. **Deploy** (`.github/workflows/deploy.yml`) requires repository variable `DEPLOY_ENABLED=true`.
   Automatic deploys accept only successful CI runs from pushes to this repository's `main` and check
   that the selected commit still matches `main` before proceeding. Manual dispatch is restricted to
   `main`. Runs are serialized.
4. **API release.** Build and push the commit-SHA image, which records its commit (`ALCOVE_COMMIT`, reported
   by `/health` and `/v1/attestation`); execute the migration job, which gets only `DATABASE_URL`, and wait;
   deploy Cloud Run; check `/health` through its service URL. The migration job applies only the migrations
   the database hasn't had, and refuses one whose applied migrations were since edited or removed, so such a
   deploy stops before the new API starts and the previous release keeps serving (migrations only move
   forward: restore the file and put the change in a new one). Checking `run.app` first avoids making the initial
   deployment depend on an API domain mapping that needs the service to exist.
5. **Web release.** Build against `https://api.alcove.solutions`, write the CSP for that origin with
   `apps/web/scripts/csp.mjs` (inline scripts by hash, nothing third-party) and
   publish the static SPA to Pages production branch `main` with pinned `pnpm dlx wrangler@4.157.0`.
   Credentials are scoped to the publishing step's environment; the verified SHA supplies commit
   attribution. Publishing does not add a workspace dependency.

The static build emits `dist/client/index.html` through TanStack's SPA prerender output path `/index`.
Pages' native SPA fallback serves the shell for client routes while matching existing assets directly;
the deployment includes no catch-all `_redirects` or top-level `404.html`. Manage the www-to-apex
redirect as a Cloudflare zone Single Redirect. See
[Cloudflare's SPA serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

**Opening offline.** A service worker, `apps/web/public/sw.js`, keeps the build in the browser, so the app's
files load without a connection once the browser has opened Alcove online. The web app's `build` script ends with
`apps/web/scripts/precache.mjs`, which writes the list of every file in `dist/client` (all but `_headers`)
into `dist/client/sw.js`, with a version hashed from their contents. Nobody maintains the list by hand, and
the script refuses a build it has already written into. The app registers the worker from its root route
once the page has loaded, in production builds only (`apps/web/src/lib/serviceWorker.ts`), and logs a failed
registration or install as a warning.

- **Install** fetches every file in the list, and caches them once all have arrived. The shell is requested
  as `/`, because Pages redirects `/index.html` there. If any file fails to arrive, nothing is cached, the
  install fails and the previous worker stays. HTML under any name but the shell's counts as not arriving:
  Pages answers a name it doesn't have with the shell, as a 200, so a deploy going live during an install
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

Only the API deployment job can request a GCP OIDC token. Workload Identity Federation restricts the
immutable repository and owner IDs, main ref, deploy workflow and permitted event types. GCP and
Cloudflare account identifiers are repository variables; `CLOUDFLARE_API_TOKEN` is a secret in the
`production` environment. Automatic deployment requires no environment reviewer gate.

Cloud Run uses one instance, session affinity, gen2, one CPU, 1 GiB, port 8080, a 300-second timeout and 500
requests at once: an open tab holds one for its stream of rings, so at the default of 80 they'd starve live calls.
The API holds at most 300 of those streams, and 8 for any one account, so the rest are always there for calls.
A live stream of a workspace or a document holds a request too, for as long as it's open: at most 8 of a workspace and 16 of
documents for any one person on an instance, and 300 of both together for everyone (`LIVE_STREAMS_MAX`), past which they're
refused with `503` and browsers try again, and the API lets go of each one after 280 seconds for the browser to open it again
(`LIVE_STREAM_MS`; keep it under the timeout). Node gives its heap about half of the container's memory, so 1 GiB is a
heap of about 560 MiB. Each instance holds one more Postgres connection, for `LISTEN`, once anyone streams from it, and
checks it every 15 seconds (`HUB_CHECK_MS`, `HUB_TIMEOUT_MS`); it needs to reach Postgres directly, as Cloud SQL's
connector does, because `LISTEN` doesn't work through a transaction-mode pooler.
CPU remains allocated between requests for background work: sweeping ended sessions, physical-deletion
cleanup, and writing notes after a call or room recording stops. Sessions live in Postgres, so a restart
signs nobody out, and notes jobs left behind by a restart are picked up by the next maintenance run.

NEAR AI has its own deployment switch. `NEAR_AI_ENABLED=true` binds `NEAR_AI_API_KEY` from
`alcove-near-ai-api-key` into the API service (the migration job doesn't need it); the service is deployed
with `NEAR_AI_BASE_URL=https://cloud-api.near.ai/v1` and the default models, speech endpoint and roots
([Notes and inference › Models and requests](notes-and-inference.md#models-and-requests)). With the flag false
or unset there is no binding and no placeholder secret version is needed: the API keeps recordings but
doesn't transcribe them, notes wait, and `/health` reports `inference: missing`.

With NEAR AI enabled the API also reaches, over HTTPS, the models' own endpoints
(`whisper-large-v3.completions.near.ai` and `glm-5-3-flash.completions.near.ai`), where everything with
content goes sealed, and the services that verify them before anything is sent: Intel's
`api.trustedservices.intel.com` and `certificates.trustedservices.intel.com`, and NVIDIA's
`nras.attestation.nvidia.com` ([Notes and inference › Services verification depends on](notes-and-inference.md#services-verification-depends-on)).
None of them needs a credential. If one can't be reached, notes wait and clips aren't transcribed, rather
than going unverified.

Google provider credentials have a separate deployment switch. `GOOGLE_AUTH_ENABLED=true` binds
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from `alcove-google-client-id` and
`alcove-google-client-secret` into the API service (the migration job needs only the database). Bootstrap creates these
secret resources and grants runtime access; credential versions are populated separately. New
installations leave the flag false or unset and need no Google secret values; the Google button then
explains that sign-in isn't set up. The API also needs `API_URL`, its public base URL, from which the
Google redirect URI is built.

The GCP `_Default` sink excludes managed request logs for `alcove-api` because raw URLs can contain
call codes or OAuth callback queries. Application structured logs remain. The exclusion is configured
outside bootstrap and needs separate verification; additional log sinks must also avoid retaining
those raw entries.

## Acceptance

These journeys describe existing coverage and release checks still required. Passing local integration
tests does not establish that production DNS, credentials, storage or the real Google round trip work. Accept a
release only after the intended API image and Pages deployment match the commit, both public hostnames
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
| A failed request's ID leads to its log lines; browser reports reach the server log | API integration tests |
| More calls ending at once than there are database connections; a call from start to end, a hand-off and the notes on one connection; a request with no connection to be had fails in 10 seconds | API integration tests |
| Sign in with Google: PKCE, state, nonce, signature, audience, expiry, verified email; refusals | API integration tests against a local OpenID provider; verify the real Google round trip on each release |
| Google Calendar: the coming week's meetings, scheduled calls placed, changed and cancelled with Google's invitations, an organizer's own event made an Alcove call, when people are busy (a private calendar and a missing scope reading as unknown), expired and withdrawn access | API integration tests against a local Calendar stand-in; verify with a real calendar on each release, a Gmail guest's private calendar included |
| Calls that repeat on Google Calendar: one recurring event and one invitation, a series across a change of the clocks, one call changed or cancelled, this and later calls from the first call and from a later one, a call made to repeat, and cancelling the whole series | API integration tests against a local Calendar stand-in, which expands rules as its authors understand Google to. Verify with a real calendar on each release that touches them: the stand-in can't show that Google accepts a single event turned recurring by `PATCH`, or a recurring event ended early with `recurrence` alone |
| Real Microsoft and SSO sign-in | **Not implemented** (demo stand-ins in `apps/api/src/demo.ts`) |
| Public DNS, certificates, CORS, CSP, deep links, JavaScript/CSS asset responses and deployed commit; a signed-in session contacts only Alcove's two origins, and pages carry no inserted beacon | Verify for each public release; assets must not redirect to the SPA shell |
| The app opens offline: after one visit online, a reload without a connection gets the shell and its assets from the service worker, and a new release's worker replaces the previous cache | Verified by hand with headless Chrome against `wrangler pages dev` of a production build (offline through the DevTools protocol, then with the server stopped); verify for each public release |
| Recording without a connection: cut the connection mid-recording, keep recording and finish; reload offline (Record lists it under **On this device**); reconnect, and it uploads once, in order, into one note; close the tab mid-upload and reopen it, and it still ends as one note; with the recording's account signed out another way and someone else signed in on the browser, nothing uploads into their account and it stays on the device until its own account signs in | Verified by hand with headless Chrome against a production build served with the API behind `/api` (offline through the DevTools protocol), reading the API log; verify for each public release |
| Browser notifications: in a production build a reminder, notes ready and a share go through the service worker, one tab shows them (the next takes over when it closes), each once, a burst as one, a reminder survives a sleep, and a click opens the right page in the right window | Verified by hand with headless Chrome against a production build (`notificationclick` dispatched in the worker, since headless Chrome has no notification to click); verify a real click on each release |
| The model code NEAR AI runs pinned to published provenance | **Not implemented**: the OS image is pinned, but its compose manager starts model code NEAR AI chooses |
| Multi-party end-to-end encrypted calls: keys only in browsers, commits only from the browser that hosts (the organizer's, or a stand-in's), a new key with every join and leave, chat unreadable to the server and to later joiners, media unreadable without the key (LiveKit included), asking to join, no names to LiveKit | API integration tests against a real LiveKit server, with MLS clients and encrypted media; verify two browsers on each release |
| Invitation emails from Alcove | **Not implemented** (with a connected Google Calendar, Google sends the invitations) |
| Attested confidential compute, with `KMASTER` released only to it | **Required before real users**; Cloud Run is not a TEE. Inside dstack: keys from its key service and refused from the environment, and `/v1/attestation` binding a nonce and the build, in API integration tests against a local dstack stand-in. See [Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing) |

The Google provider is the external Testing app `Alcove` with its test users and the web client
`AlcoveWeb`, whose redirect URIs are `$API_URL/v1/auth/google/callback` locally and in production.
Sign-in asks for `openid email profile`, the Calendar events scope
(`https://www.googleapis.com/auth/calendar.events`) and free/busy on the calendars the account can see
(`https://www.googleapis.com/auth/calendar.events.freebusy`), with offline access for a refresh token. Both
scopes have to be on the consent screen, which is an operator step. Connections made before free/busy was added
read their own calendar and nobody else's until the person agrees again. Keep
credential values and test-user addresses out of documentation. Automated tests must remain API
integration tests; the repository forbids a browser test suite.
