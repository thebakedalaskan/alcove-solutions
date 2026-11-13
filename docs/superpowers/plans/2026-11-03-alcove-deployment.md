# Alcove deployment implementation plan

> **Note (November 2026):** the passkeys, session lock and lock/unlock journey this plan mentions were removed
> when the app moved to Google sign-in (OpenID Connect). The open acceptance items now use a Google sign-in
> and recording journey; see [Deployment and acceptance](../../engineering/deployment-and-acceptance.md).

> **For agentic workers:** Execute the infrastructure tasks in this chat; use independent reviewers for the deployment configuration and runtime verification.

**Goal:** Deploy the current app to https://alcove.solutions and its API to https://api.alcove.solutions automatically after successful CI on main.

**Architecture:** Keep GoDaddy as registrar, delegate DNS to Cloudflare, and use Cloudflare Pages and private R2 storage. Create the separate GCP project `alcove-solutions` for Cloud Run, Cloud SQL, Artifact Registry and Secret Manager. GitHub authenticates through main-restricted Workload Identity Federation.

**Tech stack:** Existing pnpm monorepo, GitHub Actions, GCP, Cloudflare.

**Spec:** User's November 3 setup request and infra/README.md.

## Constraints

- Preserve repository-specific thebakedalaskan GitHub identity and credentials.
- No secrets in source or output. Use GCP Secret Manager and GitHub encrypted secrets.
- Keep the API single-instance, with CPU for its background expiry and deletion tasks.
- Keep strict typing and integration-only test policy; do not change product features.
- Cloud Run hosting does not implement the outstanding confidential-compute or AI features.

## Review focus

- Untrusted PR workflows must never obtain production deployment credentials.
- A fresh project must bootstrap successfully, with a valid Cloud SQL socket URL and recoverable secret setup.
- A first deployment must succeed before the custom API hostname is provisioned.
- Browser cookies, passkeys, CORS and CSP must use the final domain.
- DNS delegation must preserve existing non-hosting records and HTTPS must be verified.

## Tasks

- [x] Fix bootstrap edition, database secret generation/recovery, backups/PITR, scoped IAM, bounded IAM retries and workspace credential exclusions; apply the setup to `alcove-solutions`.
- [x] Configure trusted main-push deployment, current-commit checks, explicit project selection, singleton background CPU and optional provider credentials.
- [x] Configure Cloudflare zone, private R2 storage and Pages project `alcove-web`; submit the GoDaddy nameserver change.
- [x] Configure GitHub production variables/secrets and main-restricted Workload Identity Federation; publish infrastructure changes through the isolated repository identity.
- [x] Prepare Google Calendar/People APIs, external testing app and OAuth client; store client credentials in Secret Manager and support optional binding to the API and migration job. Google application auth flows remain outside this setup task.
- [x] Deploy the API and run migrations; verify `/health` through the deployed `run.app` URL.
- [x] Replace the incompatible Pages publishing action with pinned `pnpm dlx wrangler@4.157.0`, step-scoped credentials and commit attribution.
- [x] Configure the SPA shell as `index.html` and remove the asset-intercepting Pages redirect file.
- [x] Verify the publisher change through CI and an automatic API + Pages deployment without changing workspace dependencies: commit `bd0928e`, Deploy run `41669226228`.
- [x] Rebuild and verify the native SPA fallback through a deployment: root and deep links load, and real JavaScript/CSS assets keep their own responses without redirect loops.
- [x] Configure and verify a Cloudflare zone Single Redirect from www to the apex, preserving paths and query strings.
- [x] Verify active main ruleset `26463921`: pull requests, all four required CI checks on an up-to-date branch, and no bypass actors. The deployment workflow and GCP identity remain restricted to main.
- [x] Confirm Cloudflare DNS delegation and preservation of existing non-hosting records; verify the API CNAME through public DNS and active apex/www Pages domain configuration.
- [x] Finish public API certificate provisioning and verify HTTPS at `api.alcove.solutions`: `/health` returns 200.
- [x] Verify public web HTTPS, native SPA routes, asset responses and security headers; render the welcome page in a real browser.
- [x] Match API and Pages releases to the same intended commit, `bd0928e`.
- [x] Reproduce the HTTPS session-lock and stale-cookie failures, preserve the secure attribute on cookie deletion, and pass all 23 integration tests and five package type checks.
- [ ] Deploy the secure-cookie fix and repeat the public lock/unlock journey.
- [ ] Complete the public-origin CORS/account/recording journey and prove private R2 upload, playback and physical deletion through the deployed API.
- [ ] Record final acceptance evidence after the deployed user and storage journeys pass.

## Progress snapshot — 2026-11-03 16:04 UTC

Automatic [Deploy run 41669226228](https://github.com/thebakedalaskan/alcove-solutions/actions/runs/41669226228)
succeeded for both API and web at commit `bd0928e`. The custom API hostname returns HTTPS 200 for
`/health`, the web welcome page renders in a real browser, and main ruleset `26463921` is active with
the required merge protections. DNS, native SPA routing, assets and the www redirect are verified.

Full user-flow acceptance remains open. The production account journey exposed an HTTPS session-lock
cookie bug; integration regressions and the minimal secure-cookie correction pass locally on
`codex/alcove-secure-session`. Account lock/unlock, recording and private R2 storage acceptance must
be rerun after that fix deploys. Successful infrastructure deployment is not final user-flow acceptance.
