# Alcove in Confidential Space

Everything in Alcove that can see plaintext runs in Google Cloud Confidential Space, on Intel TDX: the API, TLS, and the
web app's files. Its master key is made inside the VM and kept wrapped by a Cloud KMS key that only an attested, signed
Alcove image can use (and the project's Owners: [Known limits](#known-limits)). This page is how that's set up and run.
The design is in [the plan](../../docs/superpowers/plans/2026-11-12-dstack-gcp-tee.md), and what the API does with its
keys in [Privacy › Moving to confidential computing](../../docs/engineering/privacy-keys-and-sessions.md#moving-to-confidential-computing).
Google's facts below are from the Confidential Space docs as of 2026-11-10 and the launcher's source
(google/go-tpm-tools); [Sources](#sources) lists them.

```text
Cloudflare DNS, DNS only (never proxied)
  alcove.solutions, www, api ──► alcove-api-ip, a regional external proxy Network Load Balancer (us-central1)
                                   443 ─► 8443  TLS, after a PROXY v1 line with the browser's address
                                    80 ─► 8080  /health, and redirects to https
                                     │
                         alcove-api: a managed instance group in us-central1-a, one VM at a time
                           c3-standard-4, Intel TDX, Confidential Space's production image, as alcove-cs
                           one container: the API and the web app, as the image's unprivileged user
                             ├─ Cloud SQL Auth Proxy ─► Cloud SQL alcove-db (ciphertext only)
                             ├─ Cloud KMS alcove-master and Secret Manager ◄─ only an attested, signed image, as alcove-cs
                             └─ through Cloud NAT: Let's Encrypt, Cloudflare's API, R2, LiveKit, NEAR AI
GitHub Actions (deploy.yml): build ─► cosign + Cloud KMS ─► Rekor ─► migrations (Cloud Run job) ─► deploy.sh
                             then, in a job with no Google credentials: verify-server.ts
```

## The pieces

| Piece | Name | What it's for |
| --- | --- | --- |
| Image | `us-central1-docker.pkg.dev/alcove-solutions/alcove/api@sha256:…` | The API and the web app ([apps/api/Dockerfile](../../apps/api/Dockerfile)), always run by digest. |
| Signing key | Cloud KMS `alcove/alcove-image-signing`, version 1, EC P-256 | CI signs each image with it. key_id `5e8288b4…77a2aae` |
| Master key | Cloud KMS `alcove/alcove-master` | Wraps the master key production's VM makes; only production's attested VMs may encrypt or decrypt with it. |
| Workload Identity | pool `alcove`, provider `confidential-space` | Turns the launcher's attestation token into Google credentials, only for a token that passes [the policy](#the-attestation-policy), and maps the account the VM runs as to `attribute.service_account`, so each environment's attested VMs are a principal set of their own. |
| VM service account | `alcove-cs` | Pulls the image and its signatures, writes logs, gets attestation tokens, and reaches Cloud SQL. Opens no secrets: its attested VMs do, as production's principal set. |
| Deploy account | `alcove-deploy` (bootstrap-gcp.sh) | Custom role `alcoveDeployer` (instance templates, the groups, their backends, the region's quota), `iam.serviceAccountUser` on each environment's VM account, `cloudkms.signerVerifier` and `cloudkms.viewer` on the signing key (cosign looks the key up before it signs), `artifactregistry.writer`, `run.developer`, and `compute.instanceAdmin.v1` (a group makes its VMs as the caller). |
| Network | `default`, proxy-only subnet `alcove-proxy-only` (`10.120.0.0/23`), `alcove-router`/`alcove-nat` | The VMs have no external address; outbound traffic goes through Cloud NAT, and Google's APIs stay on Google's network. |
| Firewall | `alcove-allow-lb-proxies`, `alcove-allow-health-checks` | tcp:8080 and 8443 to the `alcove-api` tag, from the proxy-only subnet and from Google's probes (`35.191.0.0/16`, `130.211.0.0/22`). |
| Address | `alcove-api-ip` | The static IPv4 the DNS names point at. |
| Health checks | `alcove-api-lb` (every 5 s), `alcove-api-heal` (every 30 s, four failures) | HTTP `/health` on 8080, with the API's host name. The edge answers it itself, 200 once it serves TLS and 503 before, without touching the API or the database. The second judges autohealing, more slowly, since it replaces a VM. |
| Load balancer | `alcove-api-https`, `alcove-api-http`: a backend service, target TCP proxy and forwarding rule each | A target proxy has one backend service and a backend service one named port, so each port has its own. 443's proxy sends a PROXY v1 line; 80's doesn't. Idle timeout 3600 s, draining 300 s, client-IP affinity on 443. |
| Group | `alcove-api` in `us-central1-a` | One VM. Updates add the new VM first and remove the old one once it's healthy (surge 1, unavailable 0); autohealing waits 600 s for a new VM. |
| Templates | `alcove-api-<UTC time>-<digest prefix>` | One per rollout: c3-standard-4, TDX, `TERMINATE` on maintenance, Secure Boot, a 20 GB Balanced PD, the newest Confidential Space image by name, the account it runs as, and the image and its environment in metadata. deploy.sh keeps the newest five. |

Staging has its own of everything that holds or reaches data, with `-staging` in each name: its VMs' account
(`alcove-cs-staging`), master key (`alcove-master-staging`), secrets, database, bucket, address, load balancer and group.
It shares the network, the key ring and signing key, the Workload Identity pool and provider, and the deploy account
([Staging](#staging)).

Why some choices:

- **A proxy load balancer, not a passthrough one.** A passthrough Network Load Balancer delivers packets addressed to its
  own IP, which Google's guest agent makes a VM accept by adding a local route. Confidential Space's production image
  disables the guest agent, so nothing adds the route. The proxy load balancer connects to each VM's own address instead.
  The PROXY v1 line on 443 gives the API each browser's address, which it uses for rate limits.
- **Ports 8080 and 8443.** The container shares the VM's network. The image runs as its unprivileged user, and containerd's
  default spec sets `no_new_privs` and gives a non-root user no capabilities, so it can't bind ports below 1024. The load
  balancer's 80 and 443 forward to 8080 and 8443, the image's `HTTP_PORT` and `HTTPS_PORT`, which it `EXPOSE`s:
  Confidential Space opens only the ports an image exposes.
- **The Cloud SQL Auth Proxy in the image.** Cloud SQL takes only connections presenting its client certificates. The
  entrypoint ([apps/api/entrypoint.sh](../../apps/api/entrypoint.sh)) runs the proxy beside the API, as the VM's
  service account, on the socket Cloud Run gave (`/cloudsql/<instance>`), so `DATABASE_URL` is the same everywhere.
  Without `CLOUDSQL_INSTANCE` the image runs as it always did: the API alone, on 8080.
- **One zone.** A regional group can only surge by at least its number of zones, so `maxSurge=1` needs a zonal one.
  c3-standard VMs with TDX are in us-central1-a, -b and -c.
- **A named Confidential Space image in each template.** deploy.sh resolves the `confidential-space` family to its newest
  image and names it, so a template says what it boots, and a repaired VM boots the same. The monthly refresh moves on.
- **An account per environment.** The provider can't tell production's image from a branch build signed for staging: both
  are signed with the same key. The account a VM runs as is what tells them apart, so each environment's keys and secrets
  are granted to its own account's attested VMs alone.

## Settings

[env.sh](env.sh) holds every name, and what each environment's VMs run with: run `infra/confidential-space/env.sh
production` to see it. Nothing in it is secret, and nothing secret may be added, because every variable of the container's
environment (the template's `tee-env-*`, the image's `ENV`, and `HOSTNAME`) is in the attestation token's claims, which the
launcher writes to Cloud Logging at every refresh. The API reads its secrets from Secret Manager at startup with the attested
identity, by the names in `SECRETS` (`ENV=secret`), and the old keys by `LEGACY_SECRETS` while they're carried.

The image accepts exactly the variables named in its `tee.launch_policy.allow_env_override` label; the launcher refuses to
start it with any other, and the VM powers off. deploy.sh checks env.sh against the Dockerfile's label before it changes
anything. Adding a variable means adding it to both.

Five of production's values were GitHub repository variables before env.sh and still are. The deploy workflow passes them;
a deploy by hand to production needs them exported (staging needs none, and a refresh reuses what the group's template has):

| Variable | Repository variable | Value |
| --- | --- | --- |
| `ALCOVE_LIVEKIT_URL` | `LIVEKIT_URL` | `wss://<project>.livekit.cloud` |
| `ALCOVE_OBJECTS_ENDPOINT` | `OBJECTS_ENDPOINT` | Production's R2 endpoint, `https://<account>.r2.cloudflarestorage.com` |
| `ALCOVE_GOOGLE_SIGNUP_MODE` | `GOOGLE_SIGNUP_MODE` | `testers` (the default) or `public` |
| `ALCOVE_NEAR_AI_ENABLED` | `NEAR_AI_ENABLED` | `true` (the default): whether production reads `alcove-near-ai-api-key` |
| `ALCOVE_GOOGLE_AUTH_ENABLED` | `GOOGLE_AUTH_ENABLED` | `true` (the default): whether production reads the Google client and tester list |

They're prefixed so a local `.env` (`LIVEKIT_URL=ws://127.0.0.1:7880`) can't leak into a deployment.

Staging has nothing of production's. Besides its names and `TLS_HOSTS` (`staging.alcove.solutions,api.staging.alcove.solutions`),
it differs in:

- **Its database**, `alcove-db-staging`, which starts empty, by `alcove-database-url-staging`, with a password of its own.
- **Its bucket**, `alcove-objects-staging`, through Cloud Storage's S3 interoperability, by an HMAC key in
  `alcove-objects-staging-access-key` and `-secret-key`.
- **Its old keys to carry**, `alcove-kmaster-staging` and `alcove-kservice-staging`, made fresh, so its first start carries
  them as production's does.
- **Its Cloudflare token**, `alcove-cloudflare-dns-token-staging`.
- **No LiveKit.** `LIVEKIT_URL` is `wss://livekit.invalid`, a name that never resolves, and `alcove-livekit-api-key-staging`
  and `-secret-staging` hold placeholders that open nothing (the API won't start without a key and secret). Joining a
  call fails there, and its upkeep can't reach anyone's rooms.
- **No NEAR AI**: recordings are kept, and their notes wait.
- **Demo sign-in on and Google sign-in off** (Google's client doesn't list staging's callback), and **credit top-ups off**.

## What's signed

CI signs each image with cosign **v2** (`v2.6.5`, pinned by checksum) and the Cloud KMS key, with these annotations, and
cosign records the signature in Sigstore's public log, Rekor:

```sh
cosign sign --key gcpkms://projects/alcove-solutions/locations/us-central1/keyRings/alcove/cryptoKeys/alcove-image-signing/cryptoKeyVersions/1 \
  --tlog-upload=true -a commit=<40 hex> \
  -a dev.cosignproject.cosign/sigalg=ECDSA_P256_SHA256 -a dev.cosignproject.cosign/pub=<PUB> \
  us-central1-docker.pkg.dev/alcove-solutions/alcove/api@sha256:<digest>
```

- **Where.** cosign v2 stores the signature beside the image, as the tag `sha256-<digest>.sig`, which is the only place the
  launcher looks (VM metadata `tee-signed-image-repos` names the repository). cosign v3 stores signatures as OCI 1.1
  referrers by default, which the launcher never finds.
- **pub and sigalg** are how Confidential Space checks the signature: the launcher passes the signed payload to the
  attestation service, which reads the public key from `dev.cosignproject.cosign/pub` and the algorithm from
  `dev.cosignproject.cosign/sigalg`. `PUB` is the base64 of the public key's PEM, exactly as `openssl pkey -pubin
  -outform PEM` writes it (its trailing newline included), with the `=` padding removed (cosign refuses a second `=` in an
  annotation). For our key:
  `LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFVng2UGlhSXljV3pISWI3ZXNwQUFRT3EyUUJMTQpkUVFPWEoyZmJ5MGkvdWR0bFNYc1ZCb2RKSVdFTDJ6YjQwMitjSVhwNnFMMno2M3N0cFFXbFpNVWFnPT0KLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg`.
- **The payload**, byte for byte (Go's `encoding/json`: keys in order, no spaces), which is what Rekor's entry hashes and what
  the web app rebuilds to find the entry:

  ```text
  {"critical":{"identity":{"docker-reference":"us-central1-docker.pkg.dev/alcove-solutions/alcove/api"},"image":{"docker-manifest-digest":"sha256:<digest>"},"type":"cosign container image signature"},"optional":{"commit":"<40 hex>","dev.cosignproject.cosign/pub":"<PUB>","dev.cosignproject.cosign/sigalg":"ECDSA_P256_SHA256"}}
  ```

- **key_id.** The launcher reports a verified signature as `{key_id, signature, signature_algorithm}` in the token's
  `submods.container.image_signatures`, where `key_id` is the lowercase hex SHA-256 of the key's DER
  SubjectPublicKeyInfo (`openssl pkey -pubin -outform DER | openssl sha256`):
  `5e8288b46ed52d4edf86e785c4a9d7ab5c9a3dc839cc74a47fdf89be977a2aae`. env.sh pins it; setup.sh and sign.sh check Cloud
  KMS still has that key.

[sign.sh](sign.sh) signs, then checks all three: `cosign verify` against our key and Rekor; the `.sig` beside the image holds
exactly that payload; and Rekor's index finds an entry by the payload's SHA-256, for that signature, signed by our key.

## The attestation policy

The provider accepts a token from Google Cloud Attestation (`https://confidentialcomputing.googleapis.com`, audience
`https://sts.googleapis.com`) only when:

| Claim | Must be | Because |
| --- | --- | --- |
| `swname` | `CONFIDENTIAL_SPACE` | Confidential Space, not an ordinary VM. A revoked image reports `GCE`. |
| `submods.confidential_space.support_attributes` | contains `STABLE` | A production image, still supported (about six months). Debug images have no support attributes. |
| `hwmodel` | `GCP_INTEL_TDX` | Intel TDX. |
| `dbgstat` | `disabled-since-boot` | No debugging since boot. |
| `swversion[0]` | at least `261001` | Images before 261001 still trust certificate authorities Google removed as compromised. |
| `submods.gce.project_number` | `745505907878` | Our project: otherwise anyone's Confidential Space VM running a copy of the image would do. |
| `google_service_accounts` | exactly one, `alcove-cs@…` or `alcove-cs-staging@…` | One of the environments' own VMs. The provider maps it to `attribute.service_account`. |
| `submods.container.image_reference` | starts with `…/alcove/api@sha256:` | Our repository, by digest. |
| `submods.container.image_signatures` | holds `ECDSA_P256_SHA256:<our key_id>` | An image signed with our key. Any signed image passes, so a release needs no change here. |

The subject is `gcpcs::<image digest>::<project number>::<instance id>`, and `image_digest` and `service_account` are mapped
too: the audit logs say which image used a key, and each environment's VMs are a principal set of their own,
`principalSet://iam.googleapis.com/projects/745505907878/locations/global/workloadIdentityPools/alcove/attribute.service_account/<the VM's account>`.
Production's (`alcove-cs@alcove-solutions.iam.gserviceaccount.com`) may encrypt and decrypt with `alcove-master` (encrypt
too, or whoever could encrypt could plant a master of their choosing in the database) and read exactly the secrets in
production's `SECRETS`, plus `alcove-kmaster` and `alcove-kservice` while they're carried. Staging's
(`alcove-cs-staging@…`) may use only `alcove-master-staging` and staging's own secrets. Nothing is granted to the whole pool
or to the other environment: setup.sh takes any such grant away. So a staging VM, whatever image it runs, gets nothing of
production's.

## The Cloudflare token

Production's API orders its certificates through Cloudflare's DNS (dns-01) with `alcove-cloudflare-dns-token`, and dns.sh
changes records with it. Make it in Cloudflare › My Profile › API Tokens › Create Token › Custom token, with the permissions
Zone › DNS › Edit and Zone › Zone › Read, and the zone resources Include › Specific zone › alcove.solutions, nothing else.
Add it as a version of the secret without printing it:

```sh
printf %s "$CLOUDFLARE_DNS_TOKEN" | gcloud --project=alcove-solutions secrets versions add alcove-cloudflare-dns-token --data-file=-
```

bootstrap-gcp.sh makes the secret, and setup.sh fails until it has a version, since the API can't start without it.
Staging's is a second token, made the same way ([Staging](#staging)).

## First setup

Production, once. Use the `alcove` gcloud configuration (`CLOUDSDK_ACTIVE_CONFIG_NAME=alcove`) for every command here.

1. Run `infra/bootstrap-gcp.sh` again ([infra/README.md](../README.md#gcp-setup-and-recovery)): it lets `refresh.yml` through
   the GitHub provider, gives the deploy account `run.developer`, and makes the secret for the Cloudflare token. Remove its
   old `run.admin` binding by hand:
   `gcloud --project=alcove-solutions projects remove-iam-policy-binding alcove-solutions
   --member=serviceAccount:alcove-deploy@alcove-solutions.iam.gserviceaccount.com --role=roles/run.admin`.
2. Add the Cloudflare token ([The Cloudflare token](#the-cloudflare-token)).
3. `infra/confidential-space/setup.sh production --dry-run`, read it (every grant to the pool goes to production's
   principal set), then run it without `--dry-run`. It enables the Compute Engine API, which makes the `default` network,
   and sets up everything in [The pieces](#the-pieces) but the group. It prints the static address. Having done everything
   else, it fails while a secret the API reads has no version.
4. Staging, for a trial first ([Staging](#staging)), deleted before the merge: production's rollouts need its quota.
5. Ask the user, before merging, since the merge commits to the switch. The first deploy migrates the database with
   migrations Cloud Run's release doesn't have, and every release's API refuses, at start, a database that applied a
   migration it doesn't know. From then on Cloud Run's `alcove-api` serves only while its running instance lasts: any
   restart leaves it down. So the switch follows the deploy at once, and nothing else merges to `main` from this merge until
   the switch is done: each merge would migrate the database again and reach only the group nobody uses yet.
6. Merge. The deploy workflow builds, signs, migrates and makes the group, and its check job verifies it through the load
   balancer's address with verify-server.ts. DNS still points at Cloud Run and Pages.
7. As soon as the check passes, switch DNS: `infra/confidential-space/dns.sh production` shows the change, and `--switch`
   makes it, saving what was there to `dns-rollback-production-<time>.json`. Keep that file until the switch is confirmed.
   Then `verify-server.ts https://api.alcove.solutions --web https://alcove.solutions` without `--connect`. Merges can go on.
8. In Cloud Logging (below), wait for `owners rewrapped` with `failed: 0, remaining: 0`. Until then, an account not yet
   re-wrapped opens through the old master, which is still carried.
9. Until the user confirms the switch, leave what the way back needs as it is: Cloud Run's `alcove-api`, the zone's Single
   Redirect for www (it does nothing while www is DNS only), Universal SSL on, and no CAA record
   ([Rolling back](#rolling-back)).
10. Once the user confirms: scale Cloud Run's `alcove-api` to zero (`gcloud run services update alcove-api
    --region=us-central1 --min=0 --max=1`), remove the zone's Single Redirect for www (the API redirects www itself), pin
    certificate issuance ([Certificates](#certificates)), then [The old keys](#the-old-keys).

## Deploying

Every push to `main` that passes CI deploys ([.github/workflows/deploy.yml](../../.github/workflows/deploy.yml)):
`build.sh production <sha>`, `sign.sh <image> <sha>`, the migration job (Cloud Run, keyless, as before), `deploy.sh <image>
production`, and then, in a job of its own with no Google credentials, `verify-server.ts` through the load balancer's
address, requiring that commit and image. The job that holds the deploy account, which can sign images and roll the group,
runs only these scripts and pinned tools; the check installs and runs workspace packages, so it gets no credentials.

By hand, with the [Settings](#settings) exported, Docker able to push (`gcloud auth configure-docker
us-central1-docker.pkg.dev`, once), and Application Default Credentials that may sign, since cosign reaches Cloud KMS
through them (`gcloud auth application-default login`):

```sh
COMMIT="$(git rev-parse HEAD)"
IMAGE="$(infra/confidential-space/build.sh production "$COMMIT" | sed -n 's/^image=//p')"
infra/confidential-space/sign.sh "$IMAGE" "$COMMIT"
infra/confidential-space/deploy.sh "$IMAGE" production    # prints image=, instance=, template= and address=
pnpm --filter @alcove/confidential-space exec tsx verify-server.ts https://api.alcove.solutions \
  --web https://alcove.solutions --commit "$COMMIT" --digest "${IMAGE#*@}"
```

build.sh refuses a checkout that isn't exactly that commit, unchanged. deploy.sh first checks the region's C3 quota
(`C3_CPUS`, 8 vCPUs) can hold the VM a rollout adds, and refuses up front, naming what else holds it, when it can't. Then it
makes a template, rolls the group (the new VM first; the old one drains for up to 300 s and goes once the new one is
healthy), waits until the group is stable and both backend services call the new VM healthy (up to about an hour), and
keeps the newest five templates. A deploy takes the place of a rollout that hasn't finished. build.sh and deploy.sh print
only their key=value lines on stdout, so `>> "$GITHUB_OUTPUT"` takes them; everything else, gcloud's and docker's output
included, goes to stderr. Every script takes `--dry-run`, which prints each command that would change something and runs
only the ones that read.

## Rolling back

- **A release.** Migrations only move forward, and every release's API refuses, at start, a database that applied a
  migration it doesn't have ([Data and storage › Changing what's stored](../../docs/engineering/data-and-storage.md#changing-whats-stored)).
  So a release goes back only to one with the same migrations; past a release that added one, fix forward. It also needs
  the same `CS_LEGACY`: a template made while the old keys were carried passes `LEGACY_SECRETS`, which the API refuses once
  they're retired. Within that, roll onto one of the five kept templates, which hold the environment and account their
  image was deployed with: `gcloud --project=alcove-solutions compute instance-groups managed rolling-action start-update
  alcove-api --zone=us-central1-a --version=template=<template> --max-surge=1 --max-unavailable=0`. (`deploy.sh` with an
  earlier image would make its template from this checkout's env.sh, which that image's label may not allow.)
- **The switch.** Back to Cloud Run and Pages only while Cloud Run's instance from before the first deploy is still running,
  since it can't start again on the migrated database, and only while `LEGACY_SECRETS` is set: Cloud Run opens what the
  TEE wrote only because new accounts then get an envelope under the old master too, and the index key, the photo token
  key and `KSERVICE` are the old ones (the TEE checks the old master on five accounts, and `KSERVICE` on billing, before it
  seals them). Before step 10 of [First setup](#first-setup) nothing else has changed:
  `dns.sh production --rollback-file dns-rollback-production-<time>.json` puts the apex, www and api back. If issuance was
  already pinned or the www redirect removed, undo those first, in Cloudflare's dashboard: delete the CAA record on the apex
  (it lets only the TEE's ACME account issue, so neither Cloudflare's edge certificate nor Google's for Cloud Run's domain
  mapping could be issued or renewed), turn Universal SSL back on (SSL/TLS › Edge Certificates; the restored proxied records
  need it), and add back the Single Redirect from www to the apex. Once Cloud Run is scaled to zero, or the old master is
  retired, there's no going back.

## Staging

A trial of a release, its first start included, on its own empty database and with nothing of production's
([Settings](#settings)): no key, secret, database, bucket or LiveKit room of production's is open to it. It's deleted
afterwards. Production's rollouts need its quota: `C3_CPUS` is 8 vCPUs, production's VM and the one a rollout adds, and
deploy.sh refuses while staging's VM holds the rest.

1. Make staging's Cloudflare token as production's ([The Cloudflare token](#the-cloudflare-token)), with an end date a few
   days out (Cloudflare's TTL), since a token reaches the whole zone.
2. `infra/confidential-space/setup.sh staging`: its account, key, database, bucket, old keys and LiveKit placeholders, the
   secret for its token, its load balancer, and the grants, to staging's principal set alone. It fails at the end until the
   token has a version: `printf %s "$CLOUDFLARE_DNS_TOKEN_STAGING" | gcloud --project=alcove-solutions secrets versions add
   alcove-cloudflare-dns-token-staging --data-file=-`, then run it again. It refuses a staging database it didn't make, or
   one with production's password (a copy of production's): delete it first (step 6).
3. Build and sign a commit for staging: `build.sh staging <sha>`, then `sign.sh <image> <sha>`. Signing puts it in Rekor as
   Alcove's, and production's policy would take it too: sign only a commit you'd release, such as a reviewed pull request's
   head.
4. `deploy.sh <image> staging` makes the group. `dns.sh staging` points `staging.` and `api.staging.` at it.
5. Expect `old master opens the accounts` (`checked: 0`), `server keys sealed` (`carried: true`) and `owners rewrapped`;
   `verify-server.ts https://api.staging.alcove.solutions --web https://staging.alcove.solutions --commit <sha> --digest
   <digest> --skip-livekit`; and a smoke flow: demo sign-in, schedule a call, a recording on Record that uploads and plays
   back. Joining a call fails there.
6. Delete it, in this order:

   ```sh
   infra/confidential-space/dns.sh staging --delete
   gcloud --project=alcove-solutions compute forwarding-rules delete alcove-api-staging-https alcove-api-staging-http --region=us-central1
   gcloud --project=alcove-solutions compute target-tcp-proxies delete alcove-api-staging-https alcove-api-staging-http --region=us-central1
   gcloud --project=alcove-solutions compute backend-services delete alcove-api-staging-https alcove-api-staging-http --region=us-central1
   gcloud --project=alcove-solutions compute instance-groups managed delete alcove-api-staging --zone=us-central1-a
   gcloud --project=alcove-solutions compute health-checks delete alcove-api-staging-lb alcove-api-staging-heal --region=us-central1
   gcloud --project=alcove-solutions compute addresses delete alcove-api-staging-ip --region=us-central1
   gcloud --project=alcove-solutions compute instance-templates list --filter='name ~ ^alcove-api-staging-' --format='value(name)'  # delete each
   gcloud --project=alcove-solutions storage rm --recursive gs://alcove-objects-staging
   gcloud --project=alcove-solutions storage hmac list --service-account=alcove-objects-staging@alcove-solutions.iam.gserviceaccount.com  # deactivate, then delete each
   gcloud --project=alcove-solutions iam service-accounts delete alcove-objects-staging@alcove-solutions.iam.gserviceaccount.com
   gcloud --project=alcove-solutions sql instances delete alcove-db-staging
   for secret in alcove-database-url-staging alcove-objects-staging-access-key alcove-objects-staging-secret-key \
     alcove-livekit-api-key-staging alcove-livekit-api-secret-staging alcove-kmaster-staging alcove-kservice-staging \
     alcove-cloudflare-dns-token-staging; do
     gcloud --project=alcove-solutions secrets delete "$secret"
   done
   gcloud --project=alcove-solutions iam service-accounts delete alcove-cs-staging@alcove-solutions.iam.gserviceaccount.com
   ```

   Then delete staging's token in Cloudflare. Cloud KMS keys can't be deleted: `alcove-master-staging` stays, unused, for
   the next staging (the master it wrapped went with the database).

## The old keys

Before Confidential Space, `KMASTER` and `KSERVICE` lived in Secret Manager (`alcove-kmaster`, `alcove-kservice`). env.sh's
`CS_LEGACY` says what happens to them:

- **`carry`** (staging, its own, whenever it's made; production until 2026-11-13). The API reads them once at startup with
  the attested identity (`LEGACY_SECRETS`), checks the old master opens existing accounts, seals the index key and
  `KSERVICE` under its own master in the database, and re-wraps every account's root key under it in the background,
  logging `owners rewrapped` with `{ rewrapped, failed, remaining }`. Accounts made meanwhile get an envelope under both
  masters.
- **`retired`** (production since 2026-11-13), only once `remaining` is 0, the switch is confirmed and the user agrees: set `CS_LEGACY=retired` for
  production in env.sh and merge. The deploy runs with `RETIRE_LEGACY_KMASTER=true` and no `LEGACY_SECRETS`; the API
  refuses while any account lacks the new envelope, then forgets the old master for good. Then delete the secrets
  (`gcloud --project=alcove-solutions secrets delete alcove-kmaster` and `alcove-kservice`, which takes their grants with
  them). Delete Cloud Run's `alcove-api` service, the `alcove-feature-flags` job and the Pages project `alcove-web`, with
  the repository's `CLOUDFLARE_*` variables and secret. In infra/bootstrap-gcp.sh, stop making the two secrets, and grant
  the Cloud Run runtime account, which then only runs the migration job, `alcove-database-url` alone; remove its other
  secret bindings by hand. Feature flags are switched through the API
  ([Feature flags › In production](../../docs/engineering/feature-flags.md#in-production)).

## Refreshing

Google attests only recent Confidential Space images: since 2026-11-09 it issues no tokens to images older than 260701
(security bulletin GCP-2026-071), and `STABLE` lasts about six months. A VM left on an old image would lose its tokens at a
refresh, and then, at its next start, couldn't unwrap the master. [refresh.yml](../../.github/workflows/refresh.yml) runs
`deploy.sh --refresh production` on the 3rd of each month, and on demand: the image the group runs, by digest, as the same
account and with the same environment as the group's template, in a new template on the newest Confidential Space image,
rolled out like a deploy, then checked with verify-server.ts in a job with no Google credentials. By hand:
`deploy.sh --refresh production`.

- It refuses a group that hasn't settled (a rollout in progress or stalled), whose template may be an image that never
  came up.
- It runs in a concurrency group of its own, and skips with a notice while a deploy is queued or running: a deploy moves the
  group onto the newest image anyway, and a refresh waiting in the deploys' group would cancel the next deploy waiting
  there.
- A deploy that starts while a refresh rolls takes its place: the group ends on the deploy's template, also on the newest
  image, and the refresh fails with nothing left to do.

## Certificates

The API orders certificates for `TLS_HOSTS` from Let's Encrypt (`ACME_DIRECTORY`) by dns-01, through Cloudflare with the
token in `alcove-cloudflare-dns-token` (staging's, its own), and keeps them in Postgres; one instance renews. Its TLS key and
its ACME account key derive from the master, so they're the same on every VM, and only the VM can order a certificate for
our account.

Once the user has confirmed the switch (step 10 of [First setup](#first-setup)), pin issuance to that account:
`infra/confidential-space/dns.sh production caa https://acme-v02.api.letsencrypt.org/acme/acct/<number>`, with the
account URI the API registered. The record is on the apex, so every name under it inherits it. Cloudflare adds CAA records
of its own for its certificate authorities, hidden from the dashboard, while Universal SSL is on, which would undo the pin:
dns.sh prints what resolvers see, and warns about any other issuer. Turn Universal SSL off for the zone (nothing is proxied
any more), then run it again. Certificate Transparency logs publish every certificate for our names; one whose key isn't
the attested one means someone else got one.

Staging has its own database, so its own master and its own ACME account. The apex record would stop it renewing (a CA
uses the nearest name's CAA records, and `staging.alcove.solutions` has none of its own), so set it once staging is gone,
or give staging its own first: `dns.sh staging caa <staging's account URI>`.

## Logs

The container's stdout and stderr go to Cloud Logging (`tee-container-log-redirect=cloud_logging`, which the image allows
with `tee.launch_policy.log_redirect=always`), as resource `gce_instance` and log `confidential-space-launcher`. The
launcher sends each line through journald: on image 261001 (seen on staging, 13 Nov) an entry's `jsonPayload` holds the
journald fields and the line itself, unparsed, in `jsonPayload.message`. The API writes one JSON object per line to stdout
with pino's numeric `level` (30 info, 40 warn, 50 error) and a `severity`, but as the line is a string there, filter on
its text: `jsonPayload.message:"\"level\":50"` for errors. The launcher's own lines carry `jsonPayload.MESSAGE`.

```sh
gcloud --project=alcove-solutions logging read \
  'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher"' --limit=50
# the API's warnings and errors
gcloud --project=alcove-solutions logging read \
  'resource.type="gce_instance" AND logName="projects/alcove-solutions/logs/confidential-space-launcher" AND (jsonPayload.message:"\"level\":40" OR jsonPayload.message:"\"level\":50")' --limit=50
```

The launcher logs there too, whatever the container does: its start (with its build), the image's labels and exposed
ports, and the full claims of each attestation token it refreshes, environment included. The production image has no SSH;
a workload that fails shows only "workload finished with a non-zero return code", so the API's own log lines are what to
read. `gcloud compute instances get-serial-port-output <instance> --zone=us-central1-a` shows the VM's boot. The load
balancer keeps no request logs, so it logs no client addresses either.

## Known limits

- **The project's Owners can use the master key.** The basic Owner role holds `cloudkms.cryptoKeyVersions.useToDecrypt` and
  `useToEncrypt` on every key in `alcove-solutions`, and IAM deny policies, which could take that away, need an
  organization, which the project isn't in. So the master is the TEE's alone against everyone but the project's Owners: an
  Owner could decrypt `server_keys` row `master` with `alcove-master`, or plant a master of their own. Every use is on
  record: Cloud KMS's Data Access audit logs (Data Read and Data Write) are on for the project since 2026-11-13, and
  setup.sh warns if they're off or exempt anyone. Any use of `alcove-master` but by production's attested VMs is one to
  explain:

  ```sh
  gcloud --project=alcove-solutions logging read 'resource.type="cloudkms_cryptokey" AND resource.labels.crypto_key_id="alcove-master"' \
    --format='table(timestamp, protoPayload.methodName, protoPayload.authenticationInfo.principalEmail, protoPayload.authenticationInfo.principalSubject)'
  ```

  The next step is to move the keys and the Workload Identity pool to a project of their own, administered only through
  CI.
- **Whoever administers IAM is trusted.** Whoever can change the provider's condition or a key's IAM policy can let
  another image use a master key. Those changes are in the Admin Activity audit log (provider updates, `SetIamPolicy`),
  which can't be turned off: keep IAM in this project to few people, and watch for them.
- **Signing isn't tied to Rekor.** The launcher finds a signature beside the image, and the attestation service checks it
  against the key in its payload: Rekor plays no part, so an image signed without uploading to Rekor passes the provider
  too (the app wouldn't call it verified). Only the deploy account, which only CI's runs on `main` can use, and the
  project's Owners may sign with the key, and each signature is in Cloud KMS's Data Access log as `AsymmetricSign`: one
  not made by `alcove-deploy` is one to explain.
- **The operator sets the environment.** `tee-env-*` values are the operator's (they're in the token's claims and the
  launcher's log, so they're visible, but nothing checks them): which database, KMS key and bucket the image uses, for one.
  The image only allows the names in its label.
- **A browser can't check the TLS key.** JavaScript can't see its own connection's certificate, so the `spki:` nonce is
  checked by verify-server.ts after each deploy and by watching Certificate Transparency, not by the app. The CAA record
  pins issuance to our ACME account, whose key only the VM holds.
- **Attestation quota.** Google Cloud Attestation allows 5 requests a second per project per region, and a token costs two.
  The API holds one token and refreshes it when it's 10 minutes old; every browser gets that one.
- **Maintenance stops a TDX VM.** TDX VMs don't live-migrate: a host maintenance event stops the VM, with 7 days' notice
  (`curl -H Metadata-Flavor:Google http://metadata.google.internal/computeMetadata/v1/instance/maintenance-event`), and the
  group recreates it. With one VM, that's a few minutes without the API. TDX VMs can't use reservations, so capacity in
  the zone isn't guaranteed either.
- **Boots are slow.** A TDX VM boots, the launcher pulls the image and attests, and the API reads its secrets and unwraps
  its master: autohealing gives a new VM 600 s, and a rollout takes minutes. Google doesn't document boot times; the
  launcher logs "Boot completed" and "Workload setup completed" with their durations, to tune by. A crash reboots the whole VM
  (`tee-restart-policy=OnFailure`, about 2 minutes, a fresh pull and a fresh attestation). Never use `gcloud compute
  instances reset`, which counts against the vTPM's lockout; stop and start instead.
- **Health is TLS's.** The health checks' `/health` on 8080 is the edge's own answer, 200 once it serves TLS, without
  touching the API or the database. A Cloud SQL outage takes no VM out of the load balancer and replaces none, which
  couldn't help; the API's own `/health`, over 443, runs `SELECT 1` and says whether LiveKit is reachable, and
  verify-server.ts reads that one.
- **One rollout fits the quota.** `C3_CPUS` in us-central1 is 8 vCPUs: production's VM and the one a rollout adds. While
  staging's VM runs, production can't roll out (deploy.sh refuses up front): delete staging first, or raise the quota.
- **Staging's Cloudflare token reaches the whole zone.** Cloudflare scopes a DNS token to a zone, not to names, so staging's
  could change production's records. Give it an end date, delete it with staging, and run on staging only commits you'd
  release.
- **Debug images differ.** The debug image keeps the guest agent and SSH, has no support attributes and reports another
  `dbgstat`, so this provider refuses it, and things that work there may not on production images. Test on production
  images.
- **Signature changes take a while to be seen.** The launcher fetches signatures at launch and at each default token
  refresh (about hourly).
- **IPv4 only.** The load balancer has one IPv4 address, and the names have no AAAA records.

## Sources

- Confidential Space: [overview](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/confidential-space-overview),
  [images](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/confidential-space-images),
  [deploy workloads](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/deploy-workloads),
  [create workloads (launch policies, ports)](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/create-customize-workloads),
  [token claims](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/token-claims),
  [attestation assertions](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/attestation-assertions),
  [grant access](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/create-grant-access-confidential-resources),
  [connect external resources](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/connect-external-resources),
  [monitoring](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/monitor-debug),
  [security bulletins](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/security-bulletins),
  and the [signed container image codelab](https://codelabs.developers.google.com/signed-container-image-codelab).
- The launcher: [google/go-tpm-tools](https://github.com/google/go-tpm-tools/tree/main/launcher), notably
  `spec/launch_policy.go` (the env allow list), `container_spec.go` and `container_runner.go` (what's measured and logged),
  `internal/logging/logging.go` (how a container's lines get their `severity`), and `internal/signaturediscovery` (the
  `.sig` tag).
- Workload Identity Federation: [attribute mappings and conditions](https://docs.cloud.google.com/iam/docs/workload-identity-federation)
  and [principal identifiers](https://docs.cloud.google.com/iam/docs/principal-identifiers).
- Load balancing: [external proxy Network Load Balancer](https://docs.cloud.google.com/load-balancing/docs/tcp),
  [the regional one with instance groups](https://docs.cloud.google.com/load-balancing/docs/tcp/set-up-ext-reg-tcp-proxy-migs),
  [backend service timeouts](https://docs.cloud.google.com/load-balancing/docs/backend-service),
  [health checks](https://docs.cloud.google.com/load-balancing/docs/health-check-concepts),
  [autohealing](https://docs.cloud.google.com/compute/docs/instance-groups/autohealing-instances-in-migs),
  [rolling updates](https://docs.cloud.google.com/compute/docs/instance-groups/rolling-out-updates-to-managed-instance-groups).
- cosign: [v2.6.5's `sign`](https://github.com/sigstore/cosign/blob/v2.6.5/doc/cosign_sign.md) and the payload format in
  [sigstore/sigstore's payload.go](https://github.com/sigstore/sigstore/blob/v1.10.3/pkg/signature/payload/payload.go).
- Cloudflare: [batch DNS changes](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/batch/),
  [CAA records and Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/caa-records/).
- containerd's [default spec](https://github.com/containerd/containerd/blob/20812afa9f47dead10433a27b89cfd0e19aa3a81/pkg/oci/spec.go)
  (`NoNewPrivileges`, capabilities).
