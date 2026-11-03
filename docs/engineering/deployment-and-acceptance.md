# Deployment and acceptance

[Docs home](../README.md) · [System architecture](system-architecture.md) · [Deployment runbook](../../infra/README.md)

## Environment and current status

The target is the apex `https://alcove.solutions`, with API `https://api.alcove.solutions`. As of
November 3, 2026, GCP backing resources, GitHub variables and the Pages project exist. The GoDaddy
nameserver change to Cloudflare has been submitted; public DNS, TLS and a complete deployment still
need verification. `DEPLOY_ENABLED=false` keeps deployment disabled during setup. This is not yet a
verified live release.

| | Local | Deployment target |
| --- | --- | --- |
| Web | Vite on `:3000` | Cloudflare Pages `alcove-web`, assigned hostname `alcove-web-bt8.pages.dev`, custom domain `alcove.solutions` |
| API | `tsx watch` on `:8787`, proxied at `/api` | Cloud Run `alcove-api`, project `alcove-solutions`, `us-central1`, native mapping for `api.alcove.solutions` |
| Database | Postgres 17 in Docker | Cloud SQL `alcove-db`, Postgres 17 Enterprise; SSL, 03:00 UTC daily backup window, seven retained backups, PITR |
| Objects | RustFS in Docker | Private Cloudflare R2 `alcove-objects`, accessed through the API |
| Secrets | `.env`, gitignored | GCP Secret Manager for database/service/storage credentials; optional inference/provider secrets |
| DNS | Localhost | GoDaddy registrar; Cloudflare nameservers `johnny.ns.cloudflare.com` and `maleah.ns.cloudflare.com` |

Run locally with `pnpm install && pnpm dev`. The [runbook](../../infra/README.md) contains bootstrap,
credential setup, the fifteen repository variables, domain mapping and release verification. Native
Cloud Run domain mapping is a Preview feature selected for this demo; Google recommends an external
Application Load Balancer for production custom domains. See
[Google's domain guidance](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

## Pipeline

1. **CI** (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main`, as four checks:
   - **Policy:** integration tests only and strict typing; no `any`, assertions, non-null or suppressions.
   - **Typecheck:** every package with strict compiler flags.
   - **Build:** web, API bundle and API container.
   - **Integration tests:** the real API against Postgres and an S3-compatible store, with software
     WebAuthn verification.
2. **Merge gate.** Import `.github/rulesets/main.json` to require pull requests and all four checks
   on an up-to-date branch. The checked-in ruleset is a configuration artifact; verify its live status.
3. **Deploy** (`.github/workflows/deploy.yml`) requires repository variable `DEPLOY_ENABLED=true`.
   Automatic deploys accept only successful CI runs from pushes to this repository's `main` and check
   that the selected commit still matches `main` before proceeding. Manual dispatch is restricted to
   `main`. Runs are serialized.
4. **API release.** Build and push the commit-SHA image; execute the migration job and wait; deploy
   Cloud Run; check health through its service URL. Checking `run.app` first avoids making the initial
   deployment depend on an API domain mapping that needs the service to exist.
5. **Web release.** Build against `https://api.alcove.solutions`, add that origin to the CSP and
   publish the static SPA to Pages production branch `main`.

Only the API deployment job can request a GCP OIDC token. Workload Identity Federation restricts the
immutable repository and owner IDs, main ref, deploy workflow and permitted event types. GCP and
Cloudflare account identifiers are repository variables; `CLOUDFLARE_API_TOKEN` is a secret in the
`production` environment. Automatic deployment requires no environment reviewer gate.

Cloud Run uses one instance, session affinity, gen2, one CPU, 512 MiB, port 8080 and a 300-second timeout.
CPU remains allocated between requests for background session/key expiry and physical-deletion
cleanup. Restarting ends unlocked sessions. `NEAR_AI_ENABLED=false` omits the unused inference-key
binding; no fake key is needed.

The GCP `_Default` sink excludes managed request logs for `alcove-api` because raw URLs can contain
call codes or OAuth callback queries. Application structured logs remain. The exclusion is configured
outside bootstrap and needs separate verification; additional log sinks must also avoid retaining
those raw entries.

## Acceptance

These journeys describe existing coverage and release checks still required. Passing local integration
tests does not establish that production DNS, credentials, storage or browser passkeys work. Accept a
release only after the intended API image and Pages deployment match the commit, both public hostnames
have valid HTTPS, web deep links/security headers work, and an account/recording flow proves private
object upload, playback and physical deletion in the deployed environment.

| Journey | Existing coverage or remaining requirement |
| --- | --- |
| Create account with passkey; lock/unlock; step-up; add/remove passkey | API integration suite; verify a real browser at `alcove.solutions` for release |
| Schedule, edit, change notes, cancel | API integration suite |
| Single-participant call with camera, mic, screen share and chat; record, leave, play audio | API integration suite checks exact audio bytes; verify deployed permissions and playback |
| Room recording: pause refuses audio, stop, discard | API integration suite |
| Cross-owner isolation for calls, notes, audio and recordings | API integration suite |
| At-rest leakage: canaries absent from tables/objects in plain, hex, base64 and base64url | API integration suite |
| Physical row/receipt/object deletion and orphan maintenance | API integration suite; verify deployed R2 credentials and background CPU |
| Public DNS, certificates, CORS, CSP, deep links and deployed commit | Pending live release verification |
| Transcription and note writing | **Not implemented**; inference-key binding disabled |
| Multi-party end-to-end encrypted calls | **Not implemented** |
| Attested confidential compute | **Required before real users**; Cloud Run is not a TEE. See [Privacy › Production requirements](privacy-keys-and-sessions.md#production-requirements) |

Google OAuth client provisioning and provider credentials require their own runtime wiring and
acceptance evidence; provisioning a client does not prove a working sign-in or integration flow.
Keep client secrets in Secret Manager and out of documentation. Automated tests must remain API
integration tests; the repository forbids a browser test suite.
