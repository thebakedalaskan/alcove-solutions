# Deploying Alcove

The target is `https://alcove.solutions`, with API `https://api.alcove.solutions`. GoDaddy remains the
registrar; Cloudflare provides DNS and Pages. GCP project `alcove-solutions` in `us-central1` holds
Cloud Run, Cloud SQL, Artifact Registry and Secret Manager.

Pages project `alcove-web` uses the assigned hostname `alcove-web-bt8.pages.dev`. Accept a public
release only after verifying the deployed API and web commits, public HTTPS and the acceptance
journeys below. A healthy API service URL alone does not establish that the public domains work.

```text
GoDaddy registrar → Cloudflare DNS
  alcove.solutions ─────► Cloudflare Pages: alcove-web (static SPA)
  api.alcove.solutions ─► Cloud Run domain mapping → alcove-api
                                                     │
                                  Cloud SQL Postgres 17 + private R2 objects
                                                     │
                                      Secret Manager runtime credentials
```

## GCP setup and recovery

Use the dedicated `alcove` gcloud configuration. The script passes an explicit project to every
command and does not change the default gcloud project:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove \
  PROJECT_ID=alcove-solutions REGION=us-central1 \
  GITHUB_REPO=thebakedalaskan/the-privacy-suite \
  ./infra/bootstrap-gcp.sh
```

The project must already exist and have billing linked. The script enables APIs and creates or reuses:

- Artifact Registry repository `alcove` in `us-central1`.
- Cloud SQL `alcove-db`, database/user `alcove`: Postgres 17 Enterprise, one CPU, 3840 MB RAM, SSL
  required, automatic storage growth, daily backup window starting at **03:00 UTC**, seven retained
  backups and point-in-time recovery. Existing instances are checked too; drift is repaired and setup
  stops if the resulting backup settings do not match.
- Secret Manager entries `alcove-database-url`, `alcove-kservice`, `alcove-objects-access-key`,
  `alcove-objects-secret-key`, optional `alcove-near-ai-api-key`, and optional Google provider entries
  `alcove-google-client-id` and `alcove-google-client-secret`.
- Runtime account `alcove-api@alcove-solutions.iam.gserviceaccount.com`, with Cloud SQL access and
  access to those secrets. The deploy account can publish to the `alcove` registry, manage Cloud Run,
  and act as this runtime account.
- Workload Identity Federation restricted to repository ID `1442472668`, owner ID `280182442`, this
  repository's deploy workflow on `main`, and its workflow-run/manual-dispatch events. No GCP
  service-account key file is needed.

Database passwords are persisted in Secret Manager before creating the SQL user. A rerun reuses that
password and repairs the original empty-host socket URL without rotating it. If the user exists but
its secret has no version, restore the current password through `ALCOVE_DB_PASSWORD`; the script
refuses to invent a replacement. A disabled latest secret version must be restored explicitly. IAM
bindings retry briefly to allow new service accounts to propagate.

## Cloudflare storage and DNS

Create or verify private R2 bucket `alcove-objects` and a credential scoped to its object operations.
Add its access key and secret key as versions of `alcove-objects-access-key` and
`alcove-objects-secret-key` in Secret Manager, using the commands printed by bootstrap. Never put
credential values in repository files or command output. `OBJECTS_ENDPOINT` is the account's
`https://<account-id>.r2.cloudflarestorage.com` endpoint; browsers use the API rather than public R2 URLs.

Cloudflare assigned these nameservers to `alcove.solutions`:

```text
johnny.ns.cloudflare.com
maleah.ns.cloudflare.com
```

The change was submitted at GoDaddy. Confirm Cloudflare reports the zone active and public resolvers
return both nameservers before treating delegation as complete. Preserve existing mail and verification
records. Add `alcove.solutions` as a custom domain of Pages project `alcove-web`; use its actual assigned
hostname, `alcove-web-bt8.pages.dev`, wherever setup requests the project hostname. Configure
`www.alcove.solutions` to redirect to the apex using a Cloudflare zone Single Redirect, preserving the
path and query string.

The web build uses TanStack's `spa.prerender.outputPath: '/index'` to emit
`apps/web/dist/client/index.html`. Pages serves this root shell for client routes that do not match
static assets, while serving JavaScript, CSS and other real assets directly. Keep the build free of a
top-level `404.html` and catch-all `_redirects` rules so Pages' native SPA fallback applies. See
[Cloudflare's SPA serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

The API uses a **native Cloud Run domain mapping**, created after the first API deployment:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions \
  beta run domain-mappings create --service=alcove-api \
  --domain=api.alcove.solutions --region=us-central1

CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions \
  beta run domain-mappings describe --domain=api.alcove.solutions \
  --region=us-central1 --format='yaml(status.conditions,status.resourceRecords)'
```

Verify ownership of `alcove.solutions` with Google first if requested. Add the exact DNS records
returned by the mapping to Cloudflare, using DNS-only records while Google's certificate provisions.
A CNAME to an arbitrary `run.app` hostname does not replace domain mapping. Wait for mapping and
certificate readiness, then verify `https://api.alcove.solutions/health`.

Google lists native domain mappings as Preview and does not recommend them for production. This is
the selected demo setup in supported region `us-central1`; a production rollout should move custom-domain
routing to the recommended external Application Load Balancer or another supported front end. See
[Google's domain mapping guidance](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

## GitHub configuration

Use repository `thebakedalaskan/the-privacy-suite` and its isolated GitHub identity. In Settings ›
Environments, create `production` and restrict deployments to `main`. Required reviewers pause every
deployment, so leave that requirement off for automatic deployment after CI.

Identifiers and nonsecret settings below belong in **repository variables**, including the deployment
switch; environment-scoped variables are unavailable to the early job condition.

| Repository variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `alcove-solutions` |
| `GCP_REGION` | `us-central1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | full provider resource printed by bootstrap |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `alcove-deploy@alcove-solutions.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `alcove-api@alcove-solutions.iam.gserviceaccount.com` |
| `GCP_CLOUDSQL_INSTANCE` | `alcove-solutions:us-central1:alcove-db` |
| `CLOUDFLARE_ACCOUNT_ID` | account identifier, not an API token |
| `CLOUDFLARE_PAGES_PROJECT` | `alcove-web` |
| `OBJECTS_ENDPOINT` | account's R2 S3 endpoint |
| `OBJECTS_BUCKET` | `alcove-objects` |
| `WEB_ORIGIN` | `https://alcove.solutions` |
| `API_ORIGIN` | `https://api.alcove.solutions`; also the API's `API_URL`, from which Google's redirect URI is built |
| `NEAR_AI_ENABLED` | `false` |
| `GOOGLE_AUTH_ENABLED` | `false` on a new installation; `true` only after both Google credential versions exist |
| `DEPLOY_ENABLED` | `false` during setup; `true` when ready to deploy |

Store `CLOUDFLARE_API_TOKEN` as a **production environment secret**, with Pages edit permission for the
intended account. R2 credentials stay in GCP Secret Manager. `NEAR_AI_ENABLED=false` omits the inference
key from Cloud Run, so its unused secret needs no placeholder version. Enable it only after a real key
exists and inference is implemented.

Import `.github/rulesets/main.json` through Settings › Rules › Rulesets to require a pull request and
the four CI checks (Policy, Typecheck, Build, Integration tests) on an up-to-date branch. The file also
forbids force pushes and deletion. Its presence in the repository does not prove the live rule is active.

## Google provider preparation

Calendar and People APIs have been enabled separately in `alcove-solutions`. The external OAuth app
`Alcove` is in Testing with three test users and the configured scopes `openid`, `email`, `profile`,
`calendar.events` and `directory.readonly`. Web client `AlcoveWeb` has local and
`api.alcove.solutions` callback URIs registered. Keep client credential values and test-user addresses
out of documentation.

Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as versions of `alcove-google-client-id` and
`alcove-google-client-secret` in Secret Manager. Bootstrap creates the secret resources and grants the
runtime account access; it does not create credential versions or the OAuth application. Commands to
add versions from private environment variables are printed by bootstrap.

Set repository variable `GOOGLE_AUTH_ENABLED=true` only after both latest versions are enabled. This
binds both values into the API service and migration job on the next deployment. New installations
default to `false` or an unset variable, omit both bindings and require no placeholder values; the
Google button then explains that sign-in isn't set up. Sign-in with Google is implemented (OpenID
Connect with PKCE, `/v1/auth/google` and `/v1/auth/google/callback`) and asks for `openid email
profile`. The redirect URI registered for production must be `https://api.alcove.solutions/v1/auth/google/callback`.

## Schema changes

Alcove's schema changes in place: `apps/api/migrations/` always describes today's database, and there are
no data migrations. The migration job keeps a checksum of every file it applied and refuses a database
built from a different version, so a deploy that changes the schema stops before the new API starts.
Reset the production database first, after taking a backup:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions sql backups create --instance=alcove-db --description="before schema reset"
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions sql databases delete alcove --instance=alcove-db
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions sql databases create alcove --instance=alcove-db
```

Then re-run the deploy (Actions › Deploy › Run workflow); its migration job builds the new schema.

## Deployment and verification

Once credentials are populated, set repository variable `DEPLOY_ENABLED=true`. Merges to `main` run CI.
Deploy accepts successful CI only when it came from a push to this repository's `main`, and skips a
commit if it no longer matches `main` when deployment preparation runs. Manual dispatch on `main` is
available for setup and recovery. Production deployments run serially.

Each deployment:

1. Builds the API container and pushes its commit-SHA tag to Artifact Registry.
2. Runs `alcove-migrate` once and waits for success before changing the API.
3. Deploys `alcove-api`: gen2, port 8080, one CPU, 512 MiB, 300-second request timeout, min/max one
   instance, session affinity, and CPU between requests for key expiry and object cleanup.
4. Checks `/health` at the deployed service's `run.app` URL, allowing the first deployment to finish
   before custom-domain provisioning.
5. Builds the web app against `API_ORIGIN`, adds that origin to the CSP, and publishes
   `apps/web/dist/client` to Pages production branch `main` using `pnpm dlx wrangler@4.157.0`.
   The publisher receives its token/account/project through step-scoped environment variables and
   attributes the deployment to the verified Git commit without changing workspace dependencies.

Cloud Run reserves some URL paths ending in `z`, so the public health probe uses `/health`.
See [Google's reserved-path guidance](https://docs.cloud.google.com/run/docs/known-issues#reserved-url-paths).

The service health check does not establish that public domains work. Before recording a release as
live, verify DNS delegation, both HTTPS certificates, API health at the custom domain, CORS for the
apex web origin, Pages security headers and deep links, JavaScript/CSS asset responses without redirect
loops, and a Google sign-in and recording flow that
uploads, reads and physically deletes encrypted objects. Match both deployments to the intended Git
commit. Use the existing integration suite for automated checks; no browser test suite is permitted.

GCP's `_Default` logging sink has an exclusion for `alcove-api` managed Cloud Run request logs, which
otherwise contain raw URLs and can expose call codes or OAuth callback queries. Application structured
logs remain available. This setting is configured outside bootstrap: verify it separately and apply
an equivalent exclusion to any future sink that would retain those entries. Inspect settings without
reading request-log contents:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions \
  logging sinks describe _Default --format='yaml(exclusions)'
```

Cloud Run is not a confidential VM: until the API runs in an attested VM that alone can read
`KMASTER`, whoever operates the service could open accounts. Sessions live in Postgres, so restarts
sign nobody out. Outstanding confidential-compute, multi-party media and inference work is tracked in
[deployment and acceptance](../docs/engineering/deployment-and-acceptance.md).
