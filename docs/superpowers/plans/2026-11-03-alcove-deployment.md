# Alcove deployment implementation plan

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
- [ ] Verify the publisher change through CI and an actual Pages deployment without changing workspace dependencies.
- [ ] Rebuild and verify the native SPA fallback through a deployment: root and deep links load, and real JavaScript/CSS assets keep their own responses without redirect loops.
- [ ] Configure and verify a Cloudflare zone Single Redirect from www to the apex, preserving paths and query strings.
- [ ] Verify the live main ruleset and production environment restrictions against the intended merge/deployment policy.
- [x] Confirm Cloudflare DNS delegation and preservation of existing non-hosting records; verify the API CNAME through public DNS and active apex/www Pages domain configuration.
- [ ] Finish public API certificate provisioning and verify HTTPS at `api.alcove.solutions`.
- [ ] Verify both public domains, HTTPS, web deep links/security headers, CORS and deployed storage/account/recording journeys.
- [ ] Match API and Pages releases to the intended commit and record final acceptance evidence in deployment docs.

API service health is established through `run.app`. Custom-domain certificate readiness, Pages
publication and the complete public release remain open until the checks above pass.
