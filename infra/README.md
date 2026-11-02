# Deploying Alcove

Merges to `main` run CI. When CI passes, `.github/workflows/deploy.yml` deploys the API to Cloud Run and
the web app to Cloudflare Pages. The deploy job does nothing until the repository variable
`DEPLOY_ENABLED` is `true`, so it is safe to merge before the infrastructure exists.

```
                      Cloudflare (DNS, TLS, proxy)
   app.<domain> ──────► Cloudflare Pages  (apps/web, static SPA)
   api.<domain> ──────► Cloud Run: alcove-api  (apps/api)
                              │            │
                Cloud SQL Postgres 17     Cloudflare R2  (ciphertext objects)
                (D01, ciphertext rows)    (O01)
                              │
                       Secret Manager: DATABASE_URL, KSERVICE, NEAR_AI_API_KEY, R2 keys
```

## One-time setup

1. **GCP project.** Create a project with billing, then run
   `PROJECT_ID=… REGION=us-central1 GITHUB_REPO=thebakedalaskan/the-privacy-suite ./infra/bootstrap-gcp.sh`.
   It enables the APIs, creates Artifact Registry, Cloud SQL (Postgres 17, SSL required, backups on),
   the secrets (generating `KSERVICE`), a runtime and a deploy service account, and Workload Identity
   Federation restricted to `main` of this repository. It prints the GitHub values to add.
2. **Cloudflare R2.** Create a bucket (e.g. `alcove-objects`) and an R2 API token scoped to it. Add the
   keys to Secret Manager as the script prints. `OBJECTS_ENDPOINT` is
   `https://<account-id>.r2.cloudflarestorage.com`.
3. **Domain.** Add the domain to Cloudflare. Create the Pages project (e.g. `alcove-web`) with custom
   domain `app.<domain>`. Map `api.<domain>` to the Cloud Run service (Cloud Run domain mapping, or a
   proxied CNAME to the service URL).
4. **GitHub.** In Settings › Environments create `production` (optionally with required reviewers),
   add the secrets and variables below, then set `DEPLOY_ENABLED=true`.

| Kind | Name | Value |
| --- | --- | --- |
| secret | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` | printed by the bootstrap script |
| secret | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | token with Pages edit permission |
| variable | `GCP_PROJECT_ID`, `GCP_REGION`, `GCP_RUNTIME_SERVICE_ACCOUNT`, `GCP_CLOUDSQL_INSTANCE` | printed by the bootstrap script |
| variable | `OBJECTS_ENDPOINT`, `OBJECTS_BUCKET` | R2 endpoint and bucket |
| variable | `WEB_ORIGIN` | `https://app.<domain>` |
| variable | `API_ORIGIN` | `https://api.<domain>` |
| variable | `RP_ID` | `<domain>` (the passkey relying party; covers both subdomains) |
| variable | `CLOUDFLARE_PAGES_PROJECT` | e.g. `alcove-web` |
| variable | `DEPLOY_ENABLED` | `true` once everything above exists |

## What a deploy does

1. Builds `apps/api/Dockerfile`, tagged with the commit SHA, and pushes it to Artifact Registry.
2. Runs migrations as the Cloud Run job `alcove-migrate` and waits for it.
3. Deploys `alcove-api`, then calls `/healthz`.
4. Builds the web app against `API_ORIGIN`, adds a content security policy for that origin, and
   deploys `apps/web/dist/client` to Pages.

## Constraints to know

- **One API instance.** Unlocked owner roots live only in the API process's memory (docs:
  privacy-keys-and-sessions › Active delegation), so the service runs with exactly one instance.
  Scaling out needs either sticky sessions with re-unlock on failover or the confidential-VM design
  in the engineering docs. Restarting the service locks every owner, by design.
- **Not yet confidential.** Cloud Run is not a TEE. The engineering docs' attestation and HPKE
  channel are required before real users; see `docs/engineering/deployment-and-acceptance.md`.
- **Passkeys are bound to `RP_ID`.** Changing the domain later invalidates every passkey.
