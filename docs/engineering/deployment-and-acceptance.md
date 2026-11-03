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
   deploy Cloud Run; check `/health` through its service URL. The migration job refuses a database built
   from a different version of the schema (it changes in place): reset that database first. Checking `run.app` first avoids making the initial
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

Only the API deployment job can request a GCP OIDC token. Workload Identity Federation restricts the
immutable repository and owner IDs, main ref, deploy workflow and permitted event types. GCP and
Cloudflare account identifiers are repository variables; `CLOUDFLARE_API_TOKEN` is a secret in the
`production` environment. Automatic deployment requires no environment reviewer gate.

Cloud Run uses one instance, session affinity, gen2, one CPU, 512 MiB, port 8080 and a 300-second timeout.
CPU remains allocated between requests for background work: sweeping ended sessions, physical-deletion
cleanup, and writing notes after a call or room recording stops. Sessions live in Postgres, so a restart
signs nobody out, and notes jobs left behind by a restart are picked up by the next maintenance run.

NEAR AI has its own deployment switch. `NEAR_AI_ENABLED=true` binds `NEAR_AI_API_KEY` from
`alcove-near-ai-api-key` into the API service (the migration job doesn't need it); the service is deployed
with `NEAR_AI_BASE_URL=https://cloud-api.near.ai/v1` and the default models, speech endpoint and roots
([Notes and inference › Models and requests](notes-and-inference.md#models-and-requests)). With the flag false
or unset there is no binding and no placeholder secret version is needed: the API keeps recordings but
doesn't transcribe them, notes wait, and `/health` reports `inference: missing`.

With NEAR AI enabled the API also reaches, over HTTPS, the services that verify it before anything is sent:
`whisper-large-v3.completions.near.ai` (the speech model's own endpoint), Intel's
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
| Live transcript and written notes: clips transcribed while notes are on, retried clips kept once, silence dropped, notes written and charged when the recording stops, retries up to the third failure, asking | API integration tests against a local NEAR AI stand-in; verify against NEAR AI Cloud with `NEAR_AI_ENABLED=true` on each release |
| Verified private inference: each model's TDX quote (Intel collateral, TCB status, debug), report data with a fresh nonce, RTMR3, measured compose, NVIDIA GPU verdict and OHTTP key checked before anything is sent; speech by Oblivious HTTP to Whisper's attested key, transcripts end-to-end encrypted to the notes model's, reply signatures checked; nothing sent when any check fails, each refusal logged with its code; a changed key verified again; a verification that runs out made again; the evidence kept with the note and shown on its page | API integration tests against stand-ins for NEAR AI, Intel's certification service and NVIDIA's attestation service under test roots, with the same verification code; the canary test shows nothing crosses the wire readable. Checked against NEAR AI Cloud, Intel and NVIDIA on 3 November 2026 (both models, a real transcription and notes, NEAR AI's Verification Center accepting the note's receipt); repeat on each release |
| Cross-owner isolation (calls, notes, audio, transcripts, recordings, asking) and origin checks | API integration tests |
| At-rest leakage: canaries (including speech and a Google account's details) and refresh tokens absent from every table, object and log line, in plain, hex, base64 and base64url | API integration tests |
| Deletion removes rows, receipts and objects; maintenance removes ended sessions and orphaned objects | API integration tests |
| A failed request's ID leads to its log lines; browser reports reach the server log | API integration tests |
| Sign in with Google: PKCE, state, nonce, signature, audience, expiry, verified email; refusals | API integration tests against a local OpenID provider; verify the real Google round trip on each release |
| Google Calendar: the coming week's meetings, scheduled calls placed, changed and cancelled with Google's invitations, an organizer's own event made an Alcove call, expired and withdrawn access | API integration tests against a local Calendar stand-in; verify with a real calendar on each release |
| Real Microsoft and SSO sign-in | **Not implemented** (demo stand-ins in `apps/api/src/demo.ts`) |
| Public DNS, certificates, CORS, CSP, deep links, JavaScript/CSS asset responses and deployed commit; a signed-in session contacts only Alcove's two origins, and pages carry no inserted beacon | Verify for each public release; assets must not redirect to the SPA shell |
| Model builds pinned to published image provenance | **Not implemented**: measurements are checked for consistency, not against approved builds |
| Multi-party end-to-end encrypted calls | **Not implemented** |
| Invitation emails from Alcove | **Not implemented** (with a connected Google Calendar, Google sends the invitations) |
| Attested confidential compute, with `KMASTER` released only to it | **Required before real users**; Cloud Run is not a TEE. Inside dstack: keys from its key service and refused from the environment, and `/v1/attestation` binding a nonce and the build, in API integration tests against a local dstack stand-in. See [Privacy › Moving to confidential computing](privacy-keys-and-sessions.md#moving-to-confidential-computing) |

The Google provider is the external Testing app `Alcove` with its test users and the web client
`AlcoveWeb`, whose redirect URIs are `$API_URL/v1/auth/google/callback` locally and in production.
Sign-in asks for `openid email profile` and the Calendar events scope
(`https://www.googleapis.com/auth/calendar.events`), with offline access for a refresh token. Keep
credential values and test-user addresses out of documentation. Automated tests must remain API
integration tests; the repository forbids a browser test suite.
