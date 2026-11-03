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

- [ ] Fix bootstrap edition, database secret generation/recovery, narrowly scoped IAM, and workspace credential exclusions. Verify shell syntax and run against the new project.
- [ ] Fix deploy event trust checks, explicit project selection, background CPU, initial health checks and optional inference-key handling. Verify configuration, build and existing integration suite.
- [ ] Configure Cloudflare zone, private storage and Pages; delegate nameservers at GoDaddy after checking imported records.
- [ ] Configure GitHub production settings and main-restricted identity, then publish changes using the isolated repository identity.
- [ ] Run an actual deployment, configure the API hostname, verify DNS/TLS, web deep links, API health, CORS and storage access; record precise live state in deployment docs.
