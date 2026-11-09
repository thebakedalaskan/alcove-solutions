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
  `alcove-objects-secret-key`, `alcove-livekit-api-key`, `alcove-livekit-api-secret`, optional
  `alcove-near-ai-api-key`, and optional Google provider entries
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
| `LIVEKIT_URL` | the LiveKit Cloud project's URL, `wss://<project>.livekit.cloud` |
| `NEAR_AI_ENABLED` | `false` on a new installation; `true` once the inference key has a version |
| `GOOGLE_AUTH_ENABLED` | `false` on a new installation; `true` only after both Google credential versions exist |
| `DEPLOY_ENABLED` | `false` during setup; `true` when ready to deploy |

Store `CLOUDFLARE_API_TOKEN` as a **production environment secret**, with Pages edit permission for the
intended account. R2 credentials stay in GCP Secret Manager. `NEAR_AI_ENABLED=false` omits the inference
key from Cloud Run, so its secret needs no placeholder version; recordings are then kept but not
transcribed, and their notes wait. Add the NEAR AI Cloud key as a version of `alcove-near-ai-api-key`
(from a private environment variable, never a file in the repository), then set `NEAR_AI_ENABLED=true`:
the next deployment binds it, and `/health` reports `inference: configured`.

Import `.github/rulesets/main.json` through Settings › Rules › Rulesets to require a pull request and
the four CI checks (Policy, Typecheck, Build, Integration tests) on an up-to-date branch. The file also
forbids force pushes and deletion. Its presence in the repository does not prove the live rule is active.

## LiveKit Cloud (calls)

Calls' audio, video and chat delivery go through a LiveKit Cloud project. The API needs its URL, key
and secret; without them it doesn't start.

1. Create a project at cloud.livekit.io. Its URL (`wss://<project>.livekit.cloud`) is the repository
   variable `LIVEKIT_URL`.
2. Settings › API keys › create a key. Add the key and secret as versions of `alcove-livekit-api-key`
   and `alcove-livekit-api-secret`, from private environment variables (bootstrap prints the commands).
   The secret must be at least 32 characters.
3. Settings › Webhooks › add `https://api.alcove.solutions/hooks/livekit`, signed with that same key.
   The API ends a call when the organizer's connection is gone for 25 s, or when its room finishes
   (20 s after everyone has left). It takes anyone else out when LiveKit says they've left, or when they
   aren't in the room 90 s after being let in. Webhooks carry this, and upkeep catches anything they miss.
4. Only the API issues join tokens, and only for rooms it created, so the project's other defaults
   can stay as they are.

`/health` reports `livekit: reachable` once the API can reach the project, and the deploy's health
check requires it. The web app's CSP allows the LiveKit host (and `*.livekit.cloud`, where media
servers live) in `connect-src`.

## Google provider preparation

The external OAuth app `Alcove` in `alcove-solutions` uses the web client `AlcoveWeb`. Enable the
Google Calendar and Drive APIs and declare the requested scopes in **Google Auth Platform → Data Access**.

| Flow | Scopes |
| --- | --- |
| Sign in with Google | `openid`, `email`, `profile` |
| Connect Google Calendar | Identity scopes, `https://www.googleapis.com/auth/calendar.events.owned`, `https://www.googleapis.com/auth/calendar.events.freebusy` |
| Connect Google Drive | `https://www.googleapis.com/auth/drive.file` |

Register `https://api.alcove.solutions/v1/auth/google/callback` for sign-in and Calendar, and
`https://api.alcove.solutions/v1/drive/callback` for Drive. Register the corresponding local callback
URIs on a development OAuth client. Keep credentials and tester addresses out of documentation.

Verify ownership of `alcove.solutions` in Search Console and set the app homepage and
`https://alcove.solutions/privacy` in **Branding**. Google allows basic identity requests from accounts outside
its test-user list even when the OAuth app is in Testing. The Cloud Run beta disables the demo providers on the API
and web. The workflow defaults to `GOOGLE_SIGNUP_MODE=testers` and binds `GOOGLE_SIGNUP_TESTERS` from
`alcove-google-signup-testers`, one approved email per line. This admits returning Google accounts and checks
verified emails for new ones. For the public beta, set repository variable `GOOGLE_SIGNUP_MODE=open` after the
updated website and privacy policy are live, and apply the same setting to the running API.
See the [deployment and acceptance requirements](../docs/engineering/deployment-and-acceptance.md) for what the beta
provides and the remaining confidential-compute work. Keep `calendar.events` declared while a deployed release
still requests it. New requests use `calendar.events.owned`, and existing Calendar grants still work.

In **Audience**, publish the external app. In **Verification Center**, submit the Calendar permissions with an
English-language screen recording of the Google consent screen and the features it enables. Show how
`calendar.events.owned` reads upcoming events on the primary calendar and creates, edits and cancels the events
for scheduled Alcove calls. Show how `calendar.events.freebusy` checks availability when picking a time. Show
Drive's separate `drive.file` consent and a selected export being uploaded. Include the option to disconnect
from Settings. Calendar consent can show Google's unverified-app warning and hit its new-user cap while
sensitive permissions are under review. See [Google's audience rules](https://support.google.com/cloud/answer/15549945)
and [verification requirements](https://support.google.com/cloud/answer/13464321).

Store `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as versions of `alcove-google-client-id` and
`alcove-google-client-secret` in Secret Manager. Bootstrap creates the secret resources and grants the
runtime account access; it does not create credential versions or the OAuth application. Commands to
add versions from private environment variables are printed by bootstrap.

Set repository variable `GOOGLE_AUTH_ENABLED=true` only after both latest versions are enabled. This
binds both values into the API service on the next deployment (the migration job gets only the database URL). New installations
default to `false` or an unset variable, omit both bindings and require no placeholder values; the
Google button then explains that sign-in isn't set up. Sign-in uses OpenID Connect with PKCE.
Only explicit Calendar and Drive connections request offline access for their own refresh tokens.

## Schema changes

Migrations only move forward, and nothing resets the production database
([Changing what's stored](../docs/engineering/data-and-storage.md#changing-whats-stored)). Each schema change is a
new file in `apps/api/migrations/`, which the migration job applies before the new API starts, while the
previous one still serves. The job keeps a checksum of every file it applied and refuses a database whose
applied files were since edited or removed. A deploy like that stops there, production keeps running the
previous release, and the fix goes in the repository (restore the file, make the change in a new one).

`alcove-db` keeps a backup a day for seven days, with point-in-time recovery over the same week. Before a
migration that rewrites or removes data, take one on demand as well:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions sql backups create --instance=alcove-db --description="before 0002_what_it_does"
```

## Deployment and verification

Once credentials are populated, set repository variable `DEPLOY_ENABLED=true`. Merges to `main` run CI.
Deploy accepts successful CI only when it came from a push to this repository's `main`, and skips a
commit if it no longer matches `main` when deployment preparation runs. Manual dispatch on `main` is
available for setup and recovery. Production deployments run serially.

Each deployment:

1. Builds the API container, recording its commit in `ALCOVE_COMMIT`, and pushes its commit-SHA tag to
   Artifact Registry.
2. Runs `alcove-migrate` once, with only `DATABASE_URL`, and waits for success before changing the API.
3. Deploys `alcove-api`: gen2, port 8080, one CPU, 2 GiB, 300-second request timeout, 1,000 requests at once,
   min/max one instance, session affinity, and CPU between requests for key expiry and object cleanup.
4. Checks `/health` at the deployed service's `run.app` URL, allowing the first deployment to finish
   before custom-domain provisioning, and requires `livekit: reachable`.
5. Builds the web app against `API_ORIGIN`, writes the CSP for that origin and the LiveKit host with
   `apps/web/scripts/csp.mjs` (inline scripts allowed only by the hash of what the build produced; nothing
   third-party but LiveKit), and publishes
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
`KMASTER`, whoever operates the service could open accounts. The API is ready to move to one
(`TEE=dstack`); the steps are in
[Privacy › Moving to confidential computing](../docs/engineering/privacy-keys-and-sessions.md#moving-to-confidential-computing). Sessions live in Postgres, so restarts
sign nobody out. Outstanding confidential-compute, call-notes and inference work is tracked in
[deployment and acceptance](../docs/engineering/deployment-and-acceptance.md).
