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
| Secrets | `.env`, gitignored | GCP Secret Manager: database, `KMASTER`, `KSERVICE` and storage credentials; optional inference and Google credentials. The privacy promise needs `KMASTER` released only to an attested confidential VM, which Cloud Run is not |
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
     the web app does, with a local OpenID provider standing in for Google.
2. **Merge gate.** Import `.github/rulesets/main.json` to require pull requests and all four checks
   on an up-to-date branch. The checked-in ruleset is a configuration artifact; verify its live status.
3. **Deploy** (`.github/workflows/deploy.yml`) requires repository variable `DEPLOY_ENABLED=true`.
   Automatic deploys accept only successful CI runs from pushes to this repository's `main` and check
   that the selected commit still matches `main` before proceeding. Manual dispatch is restricted to
   `main`. Runs are serialized.
4. **API release.** Build and push the commit-SHA image; execute the migration job and wait; deploy
   Cloud Run; check `/health` through its service URL. The migration job refuses a database built
   from a different version of the schema (it changes in place): reset that database first. Checking `run.app` first avoids making the initial
   deployment depend on an API domain mapping that needs the service to exist.
5. **Web release.** Build against `https://api.alcove.solutions`, add that origin to the CSP and
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
CPU remains allocated between requests for maintenance: sweeping ended sessions and physical-deletion
cleanup. Sessions live in Postgres, so a restart signs nobody out. `NEAR_AI_ENABLED=false` omits the unused inference-key
binding; no fake key is needed.

Google provider credentials have a separate deployment switch. `GOOGLE_AUTH_ENABLED=true` binds
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from `alcove-google-client-id` and
`alcove-google-client-secret` into both the API service and migration job. Bootstrap creates these
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
object upload, playback and physical deletion in the deployed environment.

| Journey | Existing coverage or remaining requirement |
| --- | --- |
| Microsoft and SSO demo sign-in; one account per sign-in subject; several sessions; sign-out; sessions survive a restart; Secure host-only cookies | API integration tests |
| People search, the company directory and team invites | API integration tests |
| Schedule, edit, change notes, cancel; a retried mutation applies once | API integration tests |
| Instant call with notes on, off and on again, chat, screen sharing and mic state; leave; play the recording | API integration tests (audio bytes match exactly); real-browser check with fake media |
| A call without notes leaves no note | API integration tests |
| Notes go to everyone invited when the call ends; anyone with them shares them on; removing versus deleting | API integration tests |
| Room recording: rename, pause refuses audio, stop, discard | API integration tests |
| Cross-owner isolation (calls, notes, audio, recordings) and origin checks | API integration tests |
| At-rest leakage: canaries absent from every table, object and log line, in plain, hex, base64 and base64url | API integration tests |
| Deletion removes rows, receipts and objects; maintenance removes ended sessions and orphaned objects | API integration tests |
| A failed request's ID leads to its log lines; browser reports reach the server log | API integration tests |
| Sign in with Google: PKCE, state, nonce, signature, audience, expiry, verified email; refusals | API integration tests against a local OpenID provider; verify the real Google round trip on each release |
| Real Microsoft and SSO sign-in | **Not implemented** (demo stand-ins in `apps/api/src/demo.ts`) |
| Public DNS, certificates, CORS, CSP, deep links, JavaScript/CSS asset responses and deployed commit | Verify for each public release; assets must not redirect to the SPA shell |
| Transcription and note writing | **Not implemented** (NEAR AI configured, not called) |
| Multi-party end-to-end encrypted calls | **Not implemented** |
| Invitation emails | **Not implemented** |
| Attested confidential compute, with `KMASTER` released only to it | **Required before real users**; Cloud Run is not a TEE. See [Privacy › Production requirements](privacy-keys-and-sessions.md#production-requirements) |

The Google provider is the external Testing app `Alcove` with its test users and the web client
`AlcoveWeb`, whose redirect URIs are `$API_URL/v1/auth/google/callback` locally and in production.
Sign-in asks for `openid email profile` only. Keep credential values and test-user addresses out of
documentation. Automated tests must remain API integration tests; the repository forbids a browser
test suite.
