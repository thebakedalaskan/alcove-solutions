# Deploying Alcove

The target is `https://alcove.solutions`, with API `https://api.alcove.solutions`. GoDaddy remains the
registrar; Cloudflare provides DNS, as DNS-only records. GCP project `alcove-solutions` in `us-central1` holds
the Confidential Space VMs, Cloud SQL, Artifact Registry, Cloud KMS, Secret Manager, and the migration job.

The API and the web app run together in one container, in Google Cloud Confidential Space on Intel TDX: the only
place that holds the master key or ends TLS. Accept a public release only after verifying the deployed commit, public
HTTPS and the acceptance journeys below. A healthy VM alone does not establish that the public domains work.

```text
GoDaddy registrar → Cloudflare DNS, DNS only
  alcove.solutions, www, api ─► alcove-api-ip: regional external proxy Network Load Balancer
                                 443 → 8443 (TLS ends in the VM) and 80 → 8080 (/health, redirects)
                                  │
                       alcove-api: one Confidential Space VM (c3-standard-4, Intel TDX), us-central1-a
                         the API and the web app, in one signed image
                                  │
                 Cloud SQL Postgres 17 + private R2 objects (ciphertext only)
                 Cloud KMS alcove-master + Secret Manager, for an attested, signed image only
```

[confidential-space/README.md](confidential-space/README.md) is the runbook for everything in that picture: its pieces,
the attestation policy, first setup, deploys, rollbacks, staging, the monthly image refresh, certificates, and retiring the
keys from before. This page covers the project around it.

## GCP setup and recovery

Use the dedicated `alcove` gcloud configuration. The scripts pass an explicit project to every
command and do not change the default gcloud project. First the project's base:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove \
  PROJECT_ID=alcove-solutions REGION=us-central1 \
  GITHUB_REPO=thebakedalaskan/alcove-solutions \
  ./infra/bootstrap-gcp.sh
```

The project must already exist and have billing linked. The script enables APIs and creates or reuses:

- Artifact Registry repository `alcove` in `us-central1`.
- Cloud SQL `alcove-db`, database/user `alcove`: Postgres 17 Enterprise, one CPU, 3840 MB RAM, SSL
  required, automatic storage growth, daily backup window starting at **03:00 UTC**, seven retained
  backups and point-in-time recovery. Existing instances are checked too; drift is repaired and setup
  stops if the resulting backup settings do not match.
- Secret Manager entries `alcove-database-url`, `alcove-objects-access-key`, `alcove-objects-secret-key`,
  `alcove-livekit-api-key`, `alcove-livekit-api-secret`, optional `alcove-near-ai-api-key`, and optional Google
  provider entries `alcove-google-client-id`, `alcove-google-client-secret` and `alcove-google-signup-testers`.
  `alcove-cloudflare-dns-token` holds the Cloudflare token
  ([The Cloudflare token](confidential-space/README.md#the-cloudflare-token) says how to make it); only Confidential
  Space's attested production VMs read it. The keys from before Confidential Space, `alcove-kmaster` and
  `alcove-kservice`, were retired and deleted on 2026-11-13 ([The old keys](confidential-space/README.md#the-old-keys)).
- Runtime account `alcove-api@alcove-solutions.iam.gserviceaccount.com`, which runs the migration job, with Cloud SQL
  access and `alcove-database-url` alone. Cloud Run's API service ran as it until 2026-11-13. The deploy account
  `alcove-deploy` can publish to the `alcove` registry, deploy and run Cloud Run jobs (`run.developer`), and act as this
  runtime account.
- Workload Identity Federation restricted to repository ID `1442472668`, owner ID `280182442`, `main`, and two
  workflows: `deploy.yml` on its workflow-run and manual-dispatch events, and `refresh.yml` on its schedule and manual
  dispatch. No GCP service-account key file is needed.

Database passwords are persisted in Secret Manager before creating the SQL user. A rerun reuses that
password and repairs the original empty-host socket URL without rotating it. If the user exists but
its secret has no version, restore the current password through `ALCOVE_DB_PASSWORD`; the script
refuses to invent a replacement. A disabled latest secret version must be restored explicitly. IAM
bindings retry briefly to allow new service accounts to propagate.

Then Confidential Space: `infra/confidential-space/setup.sh production` (with `--dry-run` first) makes the network, the
Cloud KMS keys, the Workload Identity pool that only an attested, signed image passes, the VMs' service account, the
deploy account's grants, and the load balancer, and grants production's master key and secrets to production's attested
VMs alone ([its First setup](confidential-space/README.md#first-setup)). Two of those secrets, the treasury's NEAR key
and 1Click's partner key for top-ups, neither script makes: a person adds them, and setup.sh grants each once it exists
([The top-up secrets](confidential-space/README.md#the-top-up-secrets)).

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

Preserve existing mail and verification records. The apex, `www` and `api` are DNS-only A records for the load
balancer's address, which `infra/confidential-space/dns.sh production --switch` sets (and puts back from the file it saves,
with `--rollback-file`). They're never proxied: TLS ends inside the VM, so Cloudflare must pass connections through
untouched. The API redirects `www` to the apex itself. The script changes only those names' address records, and a CAA
record that lets only Let's Encrypt, for only the VM's ACME account, issue certificates
([Certificates](confidential-space/README.md#certificates)). It reads its Cloudflare token (Zone › DNS › Edit and
Zone › Zone › Read on the zone, made as [The Cloudflare token](confidential-space/README.md#the-cloudflare-token) says)
from `alcove-cloudflare-dns-token` each run; production's API orders its certificates with the same token.

The web app is no longer on Cloudflare Pages, and the API no longer has a Cloud Run domain mapping: the image carries
the web app, built for its API's origin with its Content-Security-Policy, and the API serves it.

## GitHub configuration

Use repository `thebakedalaskan/alcove-solutions` and its isolated GitHub identity. In Settings ›
Environments, create `production` and restrict deployments to `main`. Required reviewers pause every
deployment, so leave that requirement off for automatic deployment after CI.

Identifiers and nonsecret settings below belong in **repository variables**, including the deployment
switch; environment-scoped variables are unavailable to the early job condition. Everything else a deployment runs
with is in [infra/confidential-space/env.sh](confidential-space/env.sh).

| Repository variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `alcove-solutions` |
| `GCP_REGION` | `us-central1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | full provider resource printed by bootstrap |
| `GCP_DEPLOY_SERVICE_ACCOUNT` | `alcove-deploy@alcove-solutions.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | `alcove-api@alcove-solutions.iam.gserviceaccount.com`, which the migration job runs as |
| `GCP_CLOUDSQL_INSTANCE` | `alcove-solutions:us-central1:alcove-db` |
| `OBJECTS_ENDPOINT` | account's R2 S3 endpoint |
| `LIVEKIT_URL` | the LiveKit Cloud project's URL, `wss://<project>.livekit.cloud` |
| `GOOGLE_SIGNUP_MODE` | `testers` (also when unset) or `public` |
| `NEAR_AI_ENABLED` | `true` (also when unset) once the inference key has a version; `false` leaves it out |
| `GOOGLE_AUTH_ENABLED` | `true` (also when unset) once both Google credential versions exist; `false` leaves them out |
| `DEPLOY_ENABLED` | `false` during setup; `true` when ready to deploy |

The deploy workflow passes the last five, prefixed `ALCOVE_`, to the scripts
([Settings](confidential-space/README.md#settings)); staging needs none, and the monthly refresh reuses what the group's
template has. `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_PAGES_PROJECT`, the
production secret `CLOUDFLARE_API_TOKEN`, `OBJECTS_BUCKET`, `WEB_ORIGIN` and `API_ORIGIN` are no longer read: delete
them once the switch is confirmed. With `NEAR_AI_ENABLED=false`, the API isn't given the inference key, so its secret
needs no placeholder version; recordings are then kept but not transcribed, and their notes wait. Add the NEAR AI Cloud
key as a version of `alcove-near-ai-api-key` (from a private environment variable, never a file in the repository): the
next deployment reads it, and `/health` reports `inference: configured`.

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

`/health` reports `livekit: reachable` once the API can reach the project, and the deploy's check
(`verify-server.ts`) requires it in production (staging has no LiveKit credentials, and is checked with `--skip-livekit`).
The web app's CSP allows the LiveKit host (and `*.livekit.cloud`, where media servers live) in `connect-src`.

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
its test-user list even when the OAuth app is in Testing. Production turns the demo providers off on the API and in the
web build. It defaults to `GOOGLE_SIGNUP_MODE=testers` and then reads `GOOGLE_SIGNUP_TESTERS` from
`alcove-google-signup-testers`, one approved email per line. This admits returning Google accounts and checks
verified emails for new ones. For the public beta, set repository variable `GOOGLE_SIGNUP_MODE=public` after the
updated website and privacy policy are live; the next deployment applies it. New accounts and
changes to a returning account’s email require a Gmail address or a verified Google Workspace identity,
because Alcove uses email to share calls and notes.
See the [deployment and acceptance requirements](../docs/engineering/deployment-and-acceptance.md) for what the beta
provides. Keep `calendar.events` declared while a deployed release
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
`alcove-google-client-secret` in Secret Manager. Bootstrap creates the secret resources; confidential-space/setup.sh lets
the attested identity read them. Neither creates credential versions or the OAuth application. Commands to
add versions from private environment variables are printed by bootstrap.

Set repository variable `GOOGLE_AUTH_ENABLED=false` while either latest version is missing, which leaves both out of
what the API reads (the migration job gets only the database URL); the Google button then explains that sign-in isn't set
up. Sign-in uses OpenID Connect with PKCE. Only explicit Calendar and Drive connections request offline access for their
own refresh tokens.

## Schema changes

Migrations only move forward, and nothing resets the production database
([Changing what's stored](../docs/engineering/data-and-storage.md#changing-whats-stored)). Each schema change is a
new file in `apps/api/migrations/`, which the migration job applies before the new API starts, while the
previous one still serves. The job keeps a checksum of every file it applied and refuses a database whose
applied files were since edited or removed. A deploy like that stops there, production keeps running the
previous release, and the fix goes in the repository (restore the file, make the change in a new one). The API
does the same at start, so no release starts on a database that applied a migration it doesn't have: a rollback
can't go back past a release that added one, and the fix goes forward
([Rolling back](confidential-space/README.md#rolling-back)).

`alcove-db` keeps a backup a day for seven days, with point-in-time recovery over the same week. Before a
migration that rewrites or removes data, take one on demand as well:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions sql backups create --instance=alcove-db --description="before 0002_what_it_does"
```

## Deployment and verification

Once credentials are populated, set repository variable `DEPLOY_ENABLED=true`. Merges to `main` run CI.
Deploy accepts successful CI only when it came from a push to this repository's `main`, and skips a
commit if it no longer matches `main` when deployment preparation runs. Manual dispatch on `main` is
available for setup and recovery. Deployments run one at a time, and the monthly image refresh skips while one is queued
or running ([Refreshing](confidential-space/README.md#refreshing)).

Each deployment ([.github/workflows/deploy.yml](../.github/workflows/deploy.yml)):

1. Builds the image for production from that commit (`confidential-space/build.sh`): the API, recording its commit in
   `ALCOVE_COMMIT`, and the web app built against `https://api.alcove.solutions` with its CSP (inline scripts allowed
   only by the hash of what the build produced; nothing third-party but LiveKit and Sigstore's public log, Rekor, which
   the app reads to check the server). Pushes it to Artifact Registry.
2. Signs it with cosign v2 and the Cloud KMS key `alcove-image-signing`, which records the signature, and the commit it
   names, in Sigstore's public log (`confidential-space/sign.sh`), and checks the signature is where Confidential Space
   and the web app look for it.
3. Runs `alcove-migrate` once, on that image, with only `DATABASE_URL`, and waits for success before changing the API.
4. Rolls the group onto the image (`confidential-space/deploy.sh`): a new VM first, the old one drained and removed
   once the new one is healthy. It refuses up front when the region's C3 quota can't hold the new VM.
5. In a job of its own with no Google credentials, checks the result through the load balancer's own address
   (`confidential-space/verify-server.ts`): the attestation the web app checks, that the TLS key the server presents is
   the attested one, that `/health` reaches LiveKit, and that it runs that commit and image.
6. Nothing else is deployed. Support's billing CLI (`dist/billing-cli.js`, [Plans and usage › Support](../docs/engineering/plans-and-usage.md#support))
   has no job: it needs `KSERVICE`, which the API keeps sealed in its server keys inside the TEE. Nothing outside the TEE
   has it: the old `alcove-kservice` secret was deleted when the old keys were retired (2026-11-13).

The deploy's check does not establish that public domains work. Before recording a release as
live, verify DNS, the HTTPS certificate on all three names, API health at the custom domain, CORS for the
apex web origin, the web app's security headers and deep links, JavaScript/CSS asset responses without redirect
loops, and a Google sign-in and recording flow that
uploads, reads and physically deletes encrypted objects. Use the existing integration suite for automated checks; no
browser test suite is permitted.

The VMs' logs go to Cloud Logging ([Logs](confidential-space/README.md#logs)). The load balancer keeps no request logs,
so no log holds a request's URL. GCP's `_Default` logging sink still has the exclusion `alcove-api-request-urls`, for the
request logs of Cloud Run's `alcove-api`, which held raw URLs that can expose call codes or OAuth callback queries; that
service was deleted on 2026-11-13, so it matches nothing now. Give any future service or sink that would keep request
URLs an equivalent exclusion. Inspect settings without reading request-log contents:

```sh
CLOUDSDK_ACTIVE_CONFIG_NAME=alcove gcloud --project=alcove-solutions \
  logging sinks describe _Default --format='yaml(exclusions)'
```

Sessions live in Postgres, so a new VM signs nobody out. Outstanding call-notes and inference work is tracked in
[deployment and acceptance](../docs/engineering/deployment-and-acceptance.md), and what the API does with its keys in
[Privacy › Moving to confidential computing](../docs/engineering/privacy-keys-and-sessions.md#moving-to-confidential-computing).
