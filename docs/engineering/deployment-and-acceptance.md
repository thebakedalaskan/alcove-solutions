# Deployment and acceptance

[Docs home](../README.md) · [System architecture](system-architecture.md) · [infra/README.md](../../infra/README.md)

## Environments

| | Local | Production (prepared, not yet live) |
| --- | --- | --- |
| Web | Vite dev server on `:3000` | Cloudflare Pages (`app.<domain>`), static SPA with CSP and security headers |
| API | `tsx watch` on `:8787`, proxied at `/api` | Cloud Run `alcove-api` (one instance), image from `apps/api/Dockerfile` |
| Database | Postgres 17 in Docker | Cloud SQL Postgres 17, SSL required, backups |
| Objects | RustFS in Docker | Cloudflare R2 |
| Secrets | `.env` (gitignored), including `KMASTER` and `KSERVICE` | Secret Manager: `DATABASE_URL`, `KSERVICE`, `NEAR_AI_API_KEY`, R2 keys. `KMASTER` must be released only to the attested confidential VM; the prepared pipeline doesn't provide it yet. |

Run everything locally with `pnpm install && pnpm dev`. Setup steps for production are in `infra/README.md`
(`infra/bootstrap-gcp.sh` creates the GCP side).

## Pipeline

1. **CI** (`.github/workflows/ci.yml`) on every pull request and push to `main`, as four checks:
   - **Policy:** integration tests only; strict typing (no `any`, assertions, non-null or suppressions).
   - **Typecheck:** every package, with the strictest compiler flags.
   - **Build:** web, API bundle and the API container.
   - **Integration tests:** the API against real Postgres and an S3-compatible store, signing in through the
     API the way the web app does.
2. **Merge gate.** `.github/rulesets/main.json` requires pull requests and all four checks on an up-to-date branch.
   Import it once in the repository settings.
3. **Deploy** (`.github/workflows/deploy.yml`) after CI succeeds on `main`, only when `DEPLOY_ENABLED=true`:
   - Build and push the image.
   - Run migrations as a Cloud Run job.
   - Deploy the API and run its health check.
   - Build the web app against `API_ORIGIN` and deploy it to Pages.

   GitHub authenticates to GCP with Workload Identity Federation limited to `main` of this repository, so no
   long-lived keys are involved.

## Acceptance

| Journey | Evidence |
| --- | --- |
| Sign in with Google, Microsoft or SSO (demo identities); one account per sign-in subject; several sessions; sign-out; sessions survive a restart | API integration tests |
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
| Real Google, Microsoft and SSO sign-in | **Not implemented** (demo stand-ins in `apps/api/src/demo.ts`) |
| Transcription and note writing | **Not implemented** (NEAR AI configured, not called) |
| Multi-party end-to-end encrypted calls | **Not implemented** |
| Invitation emails | **Not implemented** |
| Attested confidential compute, with `KMASTER` released only to it | **Required before real users**, see [Privacy › Production requirements](privacy-keys-and-sessions.md#production-requirements) |
