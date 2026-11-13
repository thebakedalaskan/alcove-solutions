#!/usr/bin/env bash
# shellcheck disable=SC2034 # The values here are read by the scripts that source this file, not by this file.
# Alcove in Confidential Space, described once: the names of its resources, and the environment and secrets each
# deployment runs with. setup.sh, build.sh, sign.sh, deploy.sh and dns.sh source this file, and the deploy workflows run
# them, so changing a value here changes it everywhere. To see what an environment's VMs get:
#   infra/confidential-space/env.sh production
#
# Nothing here is secret, and nothing secret may be added. Every variable of the container's environment (these, the
# image's ENV and HOSTNAME) is in the attestation token's claims, and the launcher writes those claims to Cloud Logging
# each time it refreshes the token. So the environment carries names and flags only. Secrets are read from Secret Manager
# when the API starts, with the attested identity, by the names in SECRETS (and LEGACY_SECRETS while the old keys are
# carried; see README.md › The old keys). The image only accepts the names in its
# "tee.launch_policy.allow_env_override" label (apps/api/Dockerfile), and refuses to launch with any other.
#
# Five of production's values live in GitHub repository variables, because they did before this file: the deploy
# workflow passes them, and a run by hand for production needs them exported (they aren't secret). Staging needs none.
#   ALCOVE_LIVEKIT_URL        the LiveKit Cloud project's wss:// URL (repository variable LIVEKIT_URL)
#   ALCOVE_OBJECTS_ENDPOINT   production's Cloudflare R2 S3 endpoint (repository variable OBJECTS_ENDPOINT)
#   ALCOVE_GOOGLE_SIGNUP_MODE testers (default) or public (repository variable GOOGLE_SIGNUP_MODE)
#   ALCOVE_NEAR_AI_ENABLED, ALCOVE_GOOGLE_AUTH_ENABLED  true (default) or false, whether production reads those secrets
# They're prefixed so a local .env (LIVEKIT_URL=ws://127.0.0.1:7880 ...) can't leak into a deployment.

CS_PROJECT=alcove-solutions
CS_PROJECT_NUMBER=745505907878
CS_REGION=us-central1
# One zone: a zonal group can roll with a surge of one VM (a regional one needs a surge of at least its zone count), and
# c3-standard machines with TDX are in us-central1-a, -b and -c.
CS_ZONE=us-central1-a

# Networking, shared by production and staging.
CS_NETWORK=default
CS_SUBNET=default
# The regional external proxy Network Load Balancer's Envoy proxies connect to the VMs from here. Outside 10.128.0.0/9,
# which an auto-mode VPC keeps for its own subnets. setup.sh reuses an active proxy-only subnet if the region has one.
CS_PROXY_SUBNET=alcove-proxy-only
CS_PROXY_SUBNET_RANGE=10.120.0.0/23
CS_ROUTER=alcove-router
CS_NAT=alcove-nat
CS_TAG=alcove-api
# Google's health check probes, for regional external proxy Network Load Balancers and for autohealing.
CS_HEALTH_CHECK_RANGES=35.191.0.0/16,130.211.0.0/22

# The VMs. The container runs as the image's unprivileged user, which can't bind ports below 1024 (containerd's default
# spec sets no_new_privs and gives a non-root user no capabilities), so it listens on 8080 (plain HTTP: /health, and
# redirects) and 8443 (TLS, after a PROXY v1 line), and the load balancer's 80 and 443 forward to them (named ports
# http and https). These are the image's EXPOSEd ports and its HTTP_PORT and HTTPS_PORT.
CS_MACHINE_TYPE=c3-standard-4
# Every C3 VM in the region counts against one quota, C3_CPUS. A rollout adds a VM before it removes one, so a group of
# one needs room for two: deploy.sh checks there is before it changes anything.
CS_CPU_QUOTA=C3_CPUS
CS_IMAGE_PROJECT=confidential-space-images
CS_IMAGE_FAMILY=confidential-space
CS_BOOT_DISK_SIZE=20GB
CS_HTTP_PORT=8080
CS_HTTPS_PORT=8443
# How long a new VM has before autohealing judges it: a TDX VM boots, the launcher pulls the image and gets its first
# attestation token, and the API reads its secrets, unwraps its master and maybe orders a certificate.
CS_INITIAL_DELAY=600
# The proxy's idle timeout (for a proxy Network Load Balancer, the backend service timeout is how long a connection
# may carry nothing either way), and how long a VM leaving the group keeps its connections.
CS_LB_TIMEOUT=3600s
CS_DRAINING_TIMEOUT=300s

# The image, and who may run it.
CS_REPOSITORY=alcove
CS_IMAGE_REPO="$CS_REGION-docker.pkg.dev/$CS_PROJECT/$CS_REPOSITORY/api"
CS_KEYRING=alcove
CS_SIGNING_KEY=alcove-image-signing
CS_SIGNING_KEY_VERSION=1
CS_SIGNING_ALGORITHM=ECDSA_P256_SHA256
# The launcher's key_id for the signing key: the lowercase hex SHA-256 of its DER SubjectPublicKeyInfo
# (openssl pkey -pubin -outform DER | openssl sha256). setup.sh and sign.sh check Cloud KMS still has this key.
CS_SIGNING_KEY_ID=5e8288b46ed52d4edf86e785c4a9d7ab5c9a3dc839cc74a47fdf89be977a2aae
CS_POOL=alcove
CS_PROVIDER=confidential-space
CS_DEPLOY_SA_NAME=alcove-deploy
CS_DEPLOYER_ROLE=alcoveDeployer
# Each environment's VMs run as an account of their own (cs_env), and the provider maps that account to the attribute
# service_account. So each environment has a principal set of its own, and production's keys and secrets are granted to
# production's alone: a staging VM, whatever it runs, gets nothing of production's. The provider admits a token from a
# VM running as exactly one of these.
CS_RUNTIME_SAS=("alcove-cs@$CS_PROJECT.iam.gserviceaccount.com" "alcove-cs-staging@$CS_PROJECT.iam.gserviceaccount.com")

# DNS and certificates.
CS_DOMAIN=alcove.solutions
CS_CLOUDFLARE_ZONE=a96d9d49874e54172ee6b923d7daa57a
# Production's Cloudflare token: Zone › DNS › Edit and Zone › Zone › Read on the zone (README.md › First setup). dns.sh
# changes records with it, for either environment, and production's API orders its certificates with it. Staging's
# API has a token of its own (cs_env).
CS_DNS_TOKEN_SECRET=alcove-cloudflare-dns-token
CS_ACME_DIRECTORY=https://acme-v02.api.letsencrypt.org/directory

# The SHA-256 of the operator token that switches feature flags (POST /v1/operator/feature-flags). A hash, never the token.
CS_OPERATOR_TOKEN_SHA256=17041d165d94f04dd885afcefa118a0d51ac299cc633fc1a566161b1a9581b08

CS_DEPLOY_SA="$CS_DEPLOY_SA_NAME@$CS_PROJECT.iam.gserviceaccount.com"
CS_SIGNING_KEY_URI="gcpkms://projects/$CS_PROJECT/locations/$CS_REGION/keyRings/$CS_KEYRING/cryptoKeys/$CS_SIGNING_KEY/cryptoKeyVersions/$CS_SIGNING_KEY_VERSION"
CS_WIF_PROVIDER="projects/$CS_PROJECT_NUMBER/locations/global/workloadIdentityPools/$CS_POOL/providers/$CS_PROVIDER"
# Every identity the pool hands out is a principal under this, and every principal set of it starts with it.
CS_POOL_PRINCIPALS="iam.googleapis.com/projects/$CS_PROJECT_NUMBER/locations/global/workloadIdentityPools/$CS_POOL"

# cs_env <production|staging>: the names one environment's resources go by, and the settings its VMs run with.
cs_env() {
  case "${1:-}" in
    production)
      CS_ENV=production
      CS_SUFFIX=''
      CS_HOSTS=(alcove.solutions www.alcove.solutions api.alcove.solutions)
      CS_WEB_ORIGIN=https://alcove.solutions
      CS_API_URL=https://api.alcove.solutions
      CS_CLOUDSQL_INSTANCE="$CS_PROJECT:$CS_REGION:alcove-db"
      CS_DATABASE_URL_SECRET=alcove-database-url
      CS_OBJECTS_ENDPOINT="${ALCOVE_OBJECTS_ENDPOINT:-}"
      CS_OBJECTS_BUCKET=alcove-objects
      CS_OBJECTS_ACCESS_KEY_SECRET=alcove-objects-access-key
      CS_OBJECTS_SECRET_KEY_SECRET=alcove-objects-secret-key
      CS_LIVEKIT_URL="${ALCOVE_LIVEKIT_URL:-}"
      CS_LIVEKIT_KEY_SECRET=alcove-livekit-api-key
      CS_LIVEKIT_SECRET_SECRET=alcove-livekit-api-secret
      CS_ACME_TOKEN_SECRET="$CS_DNS_TOKEN_SECRET"
      CS_DEMO_AUTH=false
      CS_GOOGLE_AUTH="${ALCOVE_GOOGLE_AUTH_ENABLED:-true}"
      CS_GOOGLE_SIGNUP_MODE="${ALCOVE_GOOGLE_SIGNUP_MODE:-testers}"
      CS_NEAR_AI="${ALCOVE_NEAR_AI_ENABLED:-true}"
      CS_TREASURY_ACCOUNT=alcove-treasury.near
      # The KMASTER and KSERVICE from before Confidential Space, which production's accounts were made under, were carried
      # (carry: the API read them once, LEGACY_SECRETS, and re-wrapped every account under its own master), then retired on
      # 2026-11-13, once all 28 accounts had moved and the user confirmed the switch: every deploy forgets the old master
      # (RETIRE_LEGACY_KMASTER), and their secrets, alcove-kmaster and alcove-kservice, are deleted (README.md › The old keys).
      CS_LEGACY=retired
      ;;
    staging)
      CS_ENV=staging
      CS_SUFFIX=-staging
      CS_HOSTS=(staging.alcove.solutions api.staging.alcove.solutions)
      CS_WEB_ORIGIN=https://staging.alcove.solutions
      CS_API_URL=https://api.staging.alcove.solutions
      # Staging has nothing of production's (README.md › Staging). Its own database, which starts empty, with a password of
      # its own: setup.sh makes both.
      CS_CLOUDSQL_INSTANCE="$CS_PROJECT:$CS_REGION:alcove-db-staging"
      CS_DATABASE_URL_SECRET=alcove-database-url-staging
      # Its own bucket, through Cloud Storage's S3 interoperability, by an HMAC key setup.sh makes.
      CS_OBJECTS_ENDPOINT=https://storage.googleapis.com
      CS_OBJECTS_BUCKET=alcove-objects-staging
      CS_OBJECTS_ACCESS_KEY_SECRET=alcove-objects-staging-access-key
      CS_OBJECTS_SECRET_KEY_SECRET=alcove-objects-staging-secret-key
      # No LiveKit: joining a call fails there, and its upkeep can't touch anyone's rooms. The API needs a URL, key and
      # secret to start, so it gets a name that never resolves (.invalid is reserved for that) and placeholders setup.sh
      # makes, which open nothing.
      CS_LIVEKIT_URL=wss://livekit.invalid
      CS_LIVEKIT_KEY_SECRET=alcove-livekit-api-key-staging
      CS_LIVEKIT_SECRET_SECRET=alcove-livekit-api-secret-staging
      # Its own Cloudflare token, for its certificates (README.md › Staging; a token reaches the whole zone).
      CS_ACME_TOKEN_SECRET="$CS_DNS_TOKEN_SECRET-staging"
      # Demo sign-in, since Google's OAuth client doesn't list staging's callback.
      CS_DEMO_AUTH=true
      CS_GOOGLE_AUTH=false
      CS_GOOGLE_SIGNUP_MODE=testers
      # No NEAR AI key of its own: recordings are kept, and their notes wait.
      CS_NEAR_AI=false
      # Credit top-ups stay off: they'd watch production's treasury.
      CS_TREASURY_ACCOUNT=''
      # Old keys of its own, made fresh by setup.sh, so its first start carries them as production's does.
      CS_LEGACY_KEY_SECRETS=(alcove-kmaster-staging alcove-kservice-staging)
      CS_LEGACY=carry
      ;;
    *)
      printf 'unknown environment "%s": production or staging\n' "${1:-}" >&2
      return 2
      ;;
  esac
  CS_MIG="alcove-api$CS_SUFFIX"
  CS_TEMPLATE_PREFIX="alcove-api$CS_SUFFIX"
  CS_ADDRESS="alcove-api$CS_SUFFIX-ip"
  CS_HC_LB="alcove-api$CS_SUFFIX-lb"
  CS_HC_HEAL="alcove-api$CS_SUFFIX-heal"
  # One backend service, target proxy and forwarding rule per port: a target TCP proxy has one backend service, and a
  # backend service sends to one named port. 443 carries a PROXY v1 line, so the API sees each browser's address; 80
  # doesn't, because it only answers /health (also probed without one) and redirects.
  CS_HTTPS="alcove-api$CS_SUFFIX-https"
  CS_HTTP="alcove-api$CS_SUFFIX-http"
  # The environment's own identity: the account its VMs run as, the principal set that account's attested VMs are, and
  # the Cloud KMS key that wraps its master.
  CS_RUNTIME_SA_NAME="alcove-cs$CS_SUFFIX"
  CS_RUNTIME_SA="$CS_RUNTIME_SA_NAME@$CS_PROJECT.iam.gserviceaccount.com"
  CS_PRINCIPAL_SET="principalSet://$CS_POOL_PRINCIPALS/attribute.service_account/$CS_RUNTIME_SA"
  CS_MASTER_KEY="alcove-master$CS_SUFFIX"
  CS_KMS_MASTER_KEY="projects/$CS_PROJECT/locations/$CS_REGION/keyRings/$CS_KEYRING/cryptoKeys/$CS_MASTER_KEY"
}

# cs_secrets: the Secret Manager names an environment's API reads (after cs_env): CS_SECRETS as ENV=secret, and
# CS_LEGACY_SECRETS, the old keys while they're carried.
cs_secrets() {
  local bad=()
  [[ "$CS_GOOGLE_SIGNUP_MODE" =~ ^(open|testers|public)$ ]] || bad+=("ALCOVE_GOOGLE_SIGNUP_MODE must be open, testers or public")
  [[ "$CS_GOOGLE_AUTH" =~ ^(true|false)$ ]] || bad+=("ALCOVE_GOOGLE_AUTH_ENABLED must be true or false")
  [[ "$CS_NEAR_AI" =~ ^(true|false)$ ]] || bad+=("ALCOVE_NEAR_AI_ENABLED must be true or false")
  if ((${#bad[@]})); then
    printf '%s\n' "${bad[@]}" >&2
    return 1
  fi

  CS_SECRETS=(
    "DATABASE_URL=$CS_DATABASE_URL_SECRET"
    "OBJECTS_ACCESS_KEY=$CS_OBJECTS_ACCESS_KEY_SECRET"
    "OBJECTS_SECRET_KEY=$CS_OBJECTS_SECRET_KEY_SECRET"
    "LIVEKIT_API_KEY=$CS_LIVEKIT_KEY_SECRET"
    "LIVEKIT_API_SECRET=$CS_LIVEKIT_SECRET_SECRET"
    # Let's Encrypt's dns-01 challenges, through Cloudflare (DNS edit on the zone).
    "CLOUDFLARE_API_TOKEN=$CS_ACME_TOKEN_SECRET"
  )
  if [[ "$CS_NEAR_AI" == true ]]; then CS_SECRETS+=(NEAR_AI_API_KEY=alcove-near-ai-api-key); fi
  if [[ "$CS_GOOGLE_AUTH" == true ]]; then
    CS_SECRETS+=(GOOGLE_CLIENT_ID=alcove-google-client-id GOOGLE_CLIENT_SECRET=alcove-google-client-secret)
    if [[ "$CS_GOOGLE_SIGNUP_MODE" == testers ]]; then CS_SECRETS+=(GOOGLE_SIGNUP_TESTERS=alcove-google-signup-testers); fi
  fi
  # The old keys, read once to carry accounts over, and only while they're carried.
  CS_LEGACY_SECRETS=()
  if [[ "$CS_LEGACY" == carry ]]; then CS_LEGACY_SECRETS=("${CS_LEGACY_KEY_SECRETS[@]}"); fi
}

# cs_settings: everything an environment's VMs run with (after cs_env): its secrets (cs_secrets), CS_TEE_ENV, the
# tee-env-* metadata, and CS_BUILD_ARGS, what its web app is built with.
cs_settings() {
  local bad=()
  [[ "$CS_LIVEKIT_URL" =~ ^wss://[A-Za-z0-9.-]+$ ]] || bad+=("ALCOVE_LIVEKIT_URL must be the LiveKit Cloud project's URL, wss://<project>.livekit.cloud (repository variable LIVEKIT_URL)")
  [[ "$CS_OBJECTS_ENDPOINT" =~ ^https://[A-Za-z0-9.-]+$ ]] || bad+=("ALCOVE_OBJECTS_ENDPOINT must be production's R2 endpoint, https://<account>.r2.cloudflarestorage.com (repository variable OBJECTS_ENDPOINT)")
  if ((${#bad[@]})); then
    printf '%s\n' "${bad[@]}" >&2
    return 1
  fi
  cs_secrets || return 1

  local hosts secrets legacy
  hosts="$(IFS=,; printf '%s' "${CS_HOSTS[*]}")"
  secrets="$(IFS=,; printf '%s' "${CS_SECRETS[*]}")"
  legacy="$(IFS=,; printf '%s' "${CS_LEGACY_SECRETS[*]}")"
  CS_TEE_ENV=(
    TEE=confidential-space
    "GCP_PROJECT=$CS_PROJECT"
    "KMS_MASTER_KEY=$CS_KMS_MASTER_KEY"
    "WIF_PROVIDER=$CS_WIF_PROVIDER"
    "SECRETS=$secrets"
  )
  if [[ "$CS_LEGACY" == carry ]]; then
    CS_TEE_ENV+=("LEGACY_SECRETS=$legacy" RETIRE_LEGACY_KMASTER=false)
  else
    CS_TEE_ENV+=(RETIRE_LEGACY_KMASTER=true)
  fi
  CS_TEE_ENV+=(
    "CLOUDSQL_INSTANCE=$CS_CLOUDSQL_INSTANCE"
    "TLS_HOSTS=$hosts"
    "ACME_DIRECTORY=$CS_ACME_DIRECTORY"
    "CLOUDFLARE_ZONE=$CS_CLOUDFLARE_ZONE"
    "WEB_ORIGIN=$CS_WEB_ORIGIN"
    "API_URL=$CS_API_URL"
    "LIVEKIT_URL=$CS_LIVEKIT_URL"
    "OBJECTS_ENDPOINT=$CS_OBJECTS_ENDPOINT"
    "OBJECTS_BUCKET=$CS_OBJECTS_BUCKET"
    "GOOGLE_SIGNUP_MODE=$CS_GOOGLE_SIGNUP_MODE"
    "DEMO_AUTH_ENABLED=$CS_DEMO_AUTH"
    NEAR_AI_BASE_URL=https://cloud-api.near.ai/v1
    "OPERATOR_TOKEN_SHA256=$CS_OPERATOR_TOKEN_SHA256"
    LOG_FORMAT=json
    LOG_LEVEL=info
  )
  if [[ -n "$CS_TREASURY_ACCOUNT" ]]; then CS_TEE_ENV+=("TREASURY_INTENTS_ACCOUNT=$CS_TREASURY_ACCOUNT"); fi

  # The web app is built for its API's origin, with that origin and LiveKit's host in its Content-Security-Policy.
  CS_BUILD_ARGS=(
    "WEB_API_URL=$CS_API_URL"
    "WEB_LIVEKIT_URL=$CS_LIVEKIT_URL"
    "WEB_DEMO_AUTH_ENABLED=$CS_DEMO_AUTH"
  )
}

# Run, rather than sourced: print an environment's settings, for review.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  cs_env "${1:-}" || exit 2
  cs_settings || exit 1
  printf '%s VMs: %s in %s, behind %s, as %s\n\n' "$CS_ENV" "$CS_MIG" "$CS_ZONE" "$CS_ADDRESS" "$CS_RUNTIME_SA"
  printf 'Environment (tee-env-*):\n'
  printf '  %s\n' "${CS_TEE_ENV[@]}"
  printf '\nSecrets the API reads (ENV=secret), granted to %s alone:\n' "$CS_PRINCIPAL_SET"
  printf '  %s\n' "${CS_SECRETS[@]}" ${CS_LEGACY_SECRETS[@]+"${CS_LEGACY_SECRETS[@]/#/legacy: }"}
  printf '\nWeb build:\n'
  printf '  %s\n' "${CS_BUILD_ARGS[@]}"
fi
