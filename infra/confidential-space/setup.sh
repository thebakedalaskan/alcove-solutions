#!/usr/bin/env bash
# Sets up Alcove in Confidential Space on Google Cloud. Safe to run again: it makes what's missing and puts settings back
# where they drifted. Run it with the alcove gcloud configuration, which supplies the account:
#
#   CLOUDSDK_ACTIVE_CONFIG_NAME=alcove infra/confidential-space/setup.sh [production|staging] \
#     [--image <image>@sha256:<digest>] [--dry-run]
#
# It makes, for both environments: the APIs, the network (a proxy-only subnet for the load balancer, Cloud NAT, firewall),
# Cloud KMS's key ring and signing key, the Workload Identity pool and provider that only an attested, signed Alcove image
# satisfies, and the deploy account's grants. For the environment named (production by default): its VMs' service
# account, its master key, what its attested VMs may use (granted to its own principal set, and no other principal of the
# pool may use any of it), its static IP, health checks, load balancer, and with --image (a signed image) its managed
# instance group; otherwise the first deploy.sh makes the group. Staging also gets its own empty database, bucket, old
# keys and LiveKit placeholders: nothing of production's. Wherever the whole pool was granted something, it takes that
# away. Having done everything else, it fails while a secret the API reads has no version, but for the top-up secrets,
# which only a person makes: one of those that doesn't exist yet is reported with the command that adds it and granted
# once it does, and deploy.sh refuses to roll out without it. README.md says what each piece is for and when to run this.
set -euo pipefail
# shellcheck source=infra/confidential-space/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  printf 'usage: %s [production|staging] [--image <image>@sha256:<digest>] [--dry-run]\n' "$0" >&2
  exit 2
}
environment=production image=''
while (($#)); do
  case "$1" in
    --dry-run) CS_DRY_RUN=true ;;
    --image) image="${2:-}"; [[ -n "$image" ]] || usage; shift ;;
    --image=*) image="${1#--image=}" ;;
    production | staging) environment="$1" ;;
    *) usage ;;
  esac
  shift
done
cs_require gcloud jq openssl node
cs_env "$environment"
[[ " ${CS_RUNTIME_SAS[*]} " == *" $CS_RUNTIME_SA "* ]] || cs_die "$CS_RUNTIME_SA isn't in env.sh's CS_RUNTIME_SAS, the accounts the provider admits"
if [[ -n "$image" ]]; then
  cs_check_image "$image"
  cs_settings || cs_die "set the values above (README.md › Settings)"
  cs_check_env_allowed
else
  cs_secrets || cs_die "set the values above (README.md › Settings)"
fi
cs_banner "setup" "$CS_ENV"

exists() { "$@" --format='value(name)' >/dev/null 2>&1; }
latest_version() { cs_gc secrets versions list "$1" --filter=state=ENABLED --sort-by=~createTime --limit=1 --format='value(name)' 2>/dev/null || true; }

cs_say "APIs"
cs_gcm services enable compute.googleapis.com confidentialcomputing.googleapis.com cloudkms.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com logging.googleapis.com sqladmin.googleapis.com run.googleapis.com storage.googleapis.com

cs_say "Network: $CS_NETWORK, its proxy-only subnet, Cloud NAT (the VMs have no external address) and firewall"
exists cs_gc compute networks describe "$CS_NETWORK" || cs_gcm compute networks create "$CS_NETWORK" --subnet-mode=auto
proxy_range="$(cs_gc compute networks subnets list --network="$CS_NETWORK" --regions="$CS_REGION" \
  --filter='purpose=REGIONAL_MANAGED_PROXY AND role=ACTIVE' --format='value(ipCidrRange)' 2>/dev/null | head -n 1 || true)"
if [[ -z "$proxy_range" ]]; then
  cs_gcm compute networks subnets create "$CS_PROXY_SUBNET" --network="$CS_NETWORK" --region="$CS_REGION" \
    --purpose=REGIONAL_MANAGED_PROXY --role=ACTIVE --range="$CS_PROXY_SUBNET_RANGE"
  proxy_range="$CS_PROXY_SUBNET_RANGE"
fi
exists cs_gc compute routers describe "$CS_ROUTER" --region="$CS_REGION" ||
  cs_gcm compute routers create "$CS_ROUTER" --network="$CS_NETWORK" --region="$CS_REGION"
# Let's Encrypt, Cloudflare's API, LiveKit, NEAR AI, R2, 1Click and NEAR's RPC are reached through NAT; Google's APIs stay
# on Google's network.
exists cs_gc compute routers nats describe "$CS_NAT" --router="$CS_ROUTER" --region="$CS_REGION" ||
  cs_gcm compute routers nats create "$CS_NAT" --router="$CS_ROUTER" --region="$CS_REGION" \
    --nat-custom-subnet-ip-ranges="$CS_SUBNET" --auto-allocate-nat-external-ips --min-ports-per-vm=1024
firewall() {
  local name="$1" sources="$2" description="$3"
  if exists cs_gc compute firewall-rules describe "$name"; then
    cs_gcm compute firewall-rules update "$name" --allow="tcp:$CS_HTTP_PORT,tcp:$CS_HTTPS_PORT" \
      --source-ranges="$sources" --target-tags="$CS_TAG" --description="$description"
  else
    cs_gcm compute firewall-rules create "$name" --network="$CS_NETWORK" --direction=INGRESS \
      --allow="tcp:$CS_HTTP_PORT,tcp:$CS_HTTPS_PORT" --source-ranges="$sources" --target-tags="$CS_TAG" \
      --description="$description"
  fi
}
firewall alcove-allow-lb-proxies "$proxy_range" "From the load balancer proxies to the Alcove VMs"
firewall alcove-allow-health-checks "$CS_HEALTH_CHECK_RANGES" "From Google health checks to the Alcove VMs"

cs_say "Cloud KMS: key ring $CS_KEYRING, $CS_MASTER_KEY (wraps $CS_ENV's master) and $CS_SIGNING_KEY (signs images)"
exists cs_gc kms keyrings describe "$CS_KEYRING" --location="$CS_REGION" ||
  cs_gcm kms keyrings create "$CS_KEYRING" --location="$CS_REGION"
exists cs_gc kms keys describe "$CS_MASTER_KEY" --keyring="$CS_KEYRING" --location="$CS_REGION" ||
  cs_gcm kms keys create "$CS_MASTER_KEY" --keyring="$CS_KEYRING" --location="$CS_REGION" --purpose=encryption
if exists cs_gc kms keys describe "$CS_SIGNING_KEY" --keyring="$CS_KEYRING" --location="$CS_REGION"; then
  # The provider below trusts this key by its id. Make sure Cloud KMS still holds the key env.sh names.
  public_key="$(cs_gc kms keys versions get-public-key "$CS_SIGNING_KEY_VERSION" --key="$CS_SIGNING_KEY" \
    --keyring="$CS_KEYRING" --location="$CS_REGION" 2>/dev/null || true)"
  if [[ -n "$public_key" ]]; then
    key_id="$(printf '%s\n' "$public_key" | openssl pkey -pubin -outform DER | openssl sha256 -r | cut -d' ' -f1)"
    [[ "$key_id" == "$CS_SIGNING_KEY_ID" ]] ||
      cs_die "$CS_SIGNING_KEY version $CS_SIGNING_KEY_VERSION has key_id $key_id, but env.sh trusts $CS_SIGNING_KEY_ID"
  else
    cs_warn "couldn't read $CS_SIGNING_KEY's public key; trusting the key_id in env.sh, $CS_SIGNING_KEY_ID"
  fi
else
  cs_gcm kms keys create "$CS_SIGNING_KEY" --keyring="$CS_KEYRING" --location="$CS_REGION" \
    --purpose=asymmetric-signing --default-algorithm=ec-sign-p256-sha256
  cs_warn "a new signing key isn't the one env.sh trusts: set CS_SIGNING_KEY_ID to its key_id, pin its public key in the app, and run this again"
fi

cs_say "$CS_ENV's VMs' service account, $CS_RUNTIME_SA: pulls the image and its signatures, writes logs, gets attestation tokens, reaches Cloud SQL"
exists cs_gc iam service-accounts describe "$CS_RUNTIME_SA" ||
  cs_gcm iam service-accounts create "$CS_RUNTIME_SA_NAME" --display-name="Alcove in Confidential Space ($CS_ENV)" \
    --description="Attached to Alcove's $CS_ENV Confidential Space VMs. Opens no secrets: those need its attested VMs' identity."
# Not attested, so it gets nothing that opens data: the database only holds ciphertext, and its password is a secret.
cs_iam artifacts repositories add-iam-policy-binding "$CS_REPOSITORY" --location="$CS_REGION" \
  --member="serviceAccount:$CS_RUNTIME_SA" --role=roles/artifactregistry.reader
for role in roles/logging.logWriter roles/confidentialcomputing.workloadUser roles/cloudsql.client; do
  cs_iam projects add-iam-policy-binding "$CS_PROJECT" --member="serviceAccount:$CS_RUNTIME_SA" --role="$role"
done

cs_say "Workload Identity: pool $CS_POOL, provider $CS_PROVIDER, for Confidential Space's attestation tokens"
pool_state="$(cs_gc iam workload-identity-pools describe "$CS_POOL" --location=global --format='value(state)' 2>/dev/null || true)"
case "$pool_state" in
  ACTIVE) ;;
  DELETED) cs_gcm iam workload-identity-pools undelete "$CS_POOL" --location=global ;;
  *) cs_gcm iam workload-identity-pools create "$CS_POOL" --location=global --display-name="Alcove in Confidential Space" \
    --description="Only the signed Alcove image, attested on a production Confidential Space TDX VM in this project." ;;
esac
# The subject names the image, project and VM (at most 127 bytes; this is about 113), and image_digest is kept so the
# logs say which image used a key. service_account is the account the VM runs as, the only one in the token (the
# condition requires that): it's what tells production's VMs from staging's, whose principal sets are granted apart.
mapping='google.subject="gcpcs::"+assertion.submods.container.image_digest+"::"+assertion.submods.gce.project_number+"::"+assertion.submods.gce.instance_id'
mapping+=',attribute.image_digest=assertion.submods.container.image_digest'
mapping+=',attribute.service_account=assertion.google_service_accounts[0]'
# Who gets a token: Confidential Space's production image (STABLE support, no debugging since boot, recent enough to have
# dropped the compromised CAs), on Intel TDX, in this project, running as exactly one account, one of the environments'
# own, an image from our repository by digest that the launcher found signed with our key. Any image CI signs passes, so
# releases need no change here; the key's id is the lowercase hex SHA-256 of its DER SubjectPublicKeyInfo, as the
# launcher reports it.
accounts="$(printf '"%s", ' "${CS_RUNTIME_SAS[@]}")"
condition="assertion.swname == \"CONFIDENTIAL_SPACE\""
condition+=" && \"STABLE\" in assertion.submods.confidential_space.support_attributes"
condition+=" && assertion.hwmodel == \"GCP_INTEL_TDX\""
condition+=" && assertion.dbgstat == \"disabled-since-boot\""
condition+=" && int(assertion.swversion[0]) >= 261001"
condition+=" && assertion.submods.gce.project_number == \"$CS_PROJECT_NUMBER\""
condition+=" && size(assertion.google_service_accounts) == 1"
condition+=" && assertion.google_service_accounts[0] in [${accounts%, }]"
condition+=" && assertion.submods.container.image_reference.startsWith(\"$CS_IMAGE_REPO@sha256:\")"
condition+=" && has(assertion.submods.container.image_signatures)"
condition+=" && [\"$CS_SIGNING_ALGORITHM:$CS_SIGNING_KEY_ID\"].exists(f, f in assertion.submods.container.image_signatures.map(s, s.signature_algorithm + \":\" + s.key_id))"
provider_state="$(cs_gc iam workload-identity-pools providers describe "$CS_PROVIDER" --location=global \
  --workload-identity-pool="$CS_POOL" --format='value(state)' 2>/dev/null || true)"
provider_action=create-oidc
case "$provider_state" in
  ACTIVE) provider_action=update-oidc ;;
  DELETED)
    cs_gcm iam workload-identity-pools providers undelete "$CS_PROVIDER" --location=global --workload-identity-pool="$CS_POOL"
    provider_action=update-oidc
    ;;
esac
cs_gcm iam workload-identity-pools providers "$provider_action" "$CS_PROVIDER" --location=global \
  --workload-identity-pool="$CS_POOL" --display-name="Confidential Space" \
  --issuer-uri=https://confidentialcomputing.googleapis.com --allowed-audiences=https://sts.googleapis.com \
  --attribute-mapping="$mapping" --attribute-condition="$condition"

# The secrets this run gives a version to, which a dry run only says it would.
declare -A filled=()
# A secret whose value this script makes, once, and never prints: $1 the secret, $2 the command that makes the value.
fill() {
  [[ -z "$(latest_version "$1")" ]] || return 0
  filled[$1]=1
  if [[ "$CS_DRY_RUN" == true ]]; then
    cs_gcm secrets versions add "$1" --data-file=-
    return 0
  fi
  "$2" | cs_gcm secrets versions add "$1" --data-file=- >/dev/null
}
fresh_key() { openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'; }
placeholder_livekit_key() { printf 'staging-no-livekit-%s' "$(openssl rand -hex 6)"; }
placeholder_livekit_secret() { openssl rand -base64 48 | tr -d '\n'; }
# Whether two secrets holding database URLs have the same password. Neither is printed.
same_password() {
  node -e '
    const fs = require("node:fs");
    const password = (file) => { try { return decodeURIComponent(new URL(fs.readFileSync(file, "utf8").trim()).password); } catch { return ""; } };
    const [a, b] = process.argv.slice(1).map(password);
    process.exit(a !== "" && a === b ? 0 : 1);
  ' <(cs_gc secrets versions access latest --secret="$1" 2>/dev/null || true) \
    <(cs_gc secrets versions access latest --secret="$2" 2>/dev/null || true)
}

if [[ "$CS_ENV" == staging ]]; then
  cs_say "Staging's own bucket, gs://$CS_OBJECTS_BUCKET, and the key the API reaches it with"
  # Physical deletes, as everywhere: no soft-deleted copies kept.
  exists cs_gc storage buckets describe "gs://$CS_OBJECTS_BUCKET" ||
    cs_gcm storage buckets create "gs://$CS_OBJECTS_BUCKET" --location="$CS_REGION" --uniform-bucket-level-access \
      --public-access-prevention --soft-delete-duration=0
  objects_sa="alcove-objects-staging@$CS_PROJECT.iam.gserviceaccount.com"
  exists cs_gc iam service-accounts describe "$objects_sa" ||
    cs_gcm iam service-accounts create alcove-objects-staging --display-name="Alcove staging objects" \
      --description="Holds the HMAC key the staging API reaches gs://$CS_OBJECTS_BUCKET with."
  # Objects, and the bucket's own metadata, which the API reads once at start (HeadBucket).
  for role in roles/storage.objectAdmin roles/storage.legacyBucketReader; do
    cs_iam storage buckets add-iam-policy-binding "gs://$CS_OBJECTS_BUCKET" --member="serviceAccount:$objects_sa" --role="$role"
  done
  for secret in "$CS_OBJECTS_ACCESS_KEY_SECRET" "$CS_OBJECTS_SECRET_KEY_SECRET"; do
    exists cs_gc secrets describe "$secret" || cs_gcm secrets create "$secret" --replication-policy=automatic
  done
  if [[ -z "$(latest_version "$CS_OBJECTS_ACCESS_KEY_SECRET")" ]]; then
    filled[$CS_OBJECTS_ACCESS_KEY_SECRET]=1
    filled[$CS_OBJECTS_SECRET_KEY_SECRET]=1
    # Cloud Storage shows an HMAC key's secret once, when it's made: it goes straight into Secret Manager, unprinted.
    if [[ "$CS_DRY_RUN" == true ]]; then
      cs_gcm storage hmac create "$objects_sa" --format=json
      cs_gcm secrets versions add "$CS_OBJECTS_ACCESS_KEY_SECRET" --data-file=-
      cs_gcm secrets versions add "$CS_OBJECTS_SECRET_KEY_SECRET" --data-file=-
    else
      hmac="$(cs_gcm storage hmac create "$objects_sa" --format=json)"
      printf '%s' "$hmac" | jq -j '.metadata.accessId' | cs_gcm secrets versions add "$CS_OBJECTS_ACCESS_KEY_SECRET" --data-file=- >/dev/null
      printf '%s' "$hmac" | jq -j '.secret' | cs_gcm secrets versions add "$CS_OBJECTS_SECRET_KEY_SECRET" --data-file=- >/dev/null
      unset hmac
    fi
  fi

  db="${CS_CLOUDSQL_INSTANCE##*:}"
  cs_say "Staging's own database, $db: empty to start with, with a password of its own"
  exists cs_gc sql instances describe "$db" ||
    cs_gcm sql instances create "$db" --database-version=POSTGRES_17 --edition=enterprise --region="$CS_REGION" \
      --cpu=1 --memory=3840MB --storage-auto-increase --require-ssl --no-backup --no-deletion-protection
  exists cs_gc sql databases describe alcove --instance="$db" || cs_gcm sql databases create alcove --instance="$db"
  exists cs_gc secrets describe "$CS_DATABASE_URL_SECRET" ||
    cs_gcm secrets create "$CS_DATABASE_URL_SECRET" --replication-policy=automatic
  db_users="$(cs_gc sql users list --instance="$db" --format='value(name)' 2>/dev/null || true)"
  if [[ -n "$(latest_version "$CS_DATABASE_URL_SECRET")" ]]; then
    # A copy of production's database keeps production's password: staging never runs on one.
    if same_password alcove-database-url "$CS_DATABASE_URL_SECRET"; then
      cs_die "$CS_DATABASE_URL_SECRET has production's database password, so $db is a copy of production's database. Delete it and the secret (README.md › Staging), then run this again."
    fi
  else
    # This script makes the URL and the user together: a user and no URL means it didn't make this database.
    if grep -qx alcove <<<"$db_users"; then
      cs_die "$db has a user alcove, but $CS_DATABASE_URL_SECRET has no version: this script didn't make it (a copy of production's database?). Delete it (README.md › Staging), then run this again."
    fi
    # The password goes into Secret Manager before the user is made with it, so a run that stops between the two
    # picks up where it was.
    filled[$CS_DATABASE_URL_SECRET]=1
    if [[ "$CS_DRY_RUN" == true ]]; then
      cs_gcm secrets versions add "$CS_DATABASE_URL_SECRET" --data-file=-
    else
      openssl rand -base64 30 | tr -d '/+=\n' | node -e '
        const fs = require("node:fs");
        const url = new URL("postgres://alcove@localhost/alcove");
        url.password = fs.readFileSync(0, "utf8");
        url.searchParams.set("host", "/cloudsql/" + process.argv[1]);
        process.stdout.write(url.href);
      ' "$CS_CLOUDSQL_INSTANCE" | cs_gcm secrets versions add "$CS_DATABASE_URL_SECRET" --data-file=- >/dev/null
    fi
  fi
  if ! grep -qx alcove <<<"$db_users"; then
    # The password is the one in the URL, and is never printed.
    if [[ "$CS_DRY_RUN" == true ]]; then
      printf '[dry-run] %s --password=<the one in %s>\n' "$(cs_quote gcloud --project="$CS_PROJECT" sql users create alcove --instance="$db")" "$CS_DATABASE_URL_SECRET" >&2
    else
      printf '+ %s --password=<the one in %s>\n' "$(cs_quote gcloud --project="$CS_PROJECT" sql users create alcove --instance="$db")" "$CS_DATABASE_URL_SECRET" >&2
      password="$(cs_gc secrets versions access latest --secret="$CS_DATABASE_URL_SECRET" |
        node -e 'process.stdout.write(decodeURIComponent(new URL(require("node:fs").readFileSync(0, "utf8")).password))')"
      [[ -n "$password" ]] || cs_die "couldn't read the password in $CS_DATABASE_URL_SECRET"
      gcloud --project="$CS_PROJECT" sql users create alcove --instance="$db" --password="$password" >/dev/null
      unset password
    fi
  fi

  cs_say "Staging's LiveKit placeholders (they open nothing), its own old keys, made fresh, and its Cloudflare token's secret"
  for secret in "$CS_LIVEKIT_KEY_SECRET" "$CS_LIVEKIT_SECRET_SECRET" "${CS_LEGACY_KEY_SECRETS[@]}" "$CS_ACME_TOKEN_SECRET"; do
    exists cs_gc secrets describe "$secret" || cs_gcm secrets create "$secret" --replication-policy=automatic
  done
  fill "$CS_LIVEKIT_KEY_SECRET" placeholder_livekit_key
  fill "$CS_LIVEKIT_SECRET_SECRET" placeholder_livekit_secret
  # Made once: once its database has accounts, they're under these.
  for secret in "${CS_LEGACY_KEY_SECRETS[@]}"; do fill "$secret" fresh_key; done
  # The Cloudflare token is made in Cloudflare and added by hand (README.md › Staging).
fi

# Every grant to the pool, other than to $2, on a resource's IAM policy (JSON, $1), as "<member> <role>" lines. With no $2,
# only grants to the whole pool.
pool_grants() {
  jq -r --arg pool "$CS_POOL_PRINCIPALS/" --arg whole "principalSet://$CS_POOL_PRINCIPALS/*" --arg keep "${2:-}" '
    .bindings[]? | .role as $role | .members[]?
    | select(if $keep == "" then . == $whole
             else (startswith("principalSet://" + $pool) or startswith("principal://" + $pool)) and . != $keep end)
    | "\(.) \($role)"' <<<"$1" 2>/dev/null || true
}
# Takes those grants off a secret or key (secret|key <name> [<principal set to keep>]).
revoke_pool() {
  local kind="$1" name="$2" keep="${3:-}" policy grant
  local -a grants=()
  case "$kind" in
    secret) policy="$(cs_gc secrets get-iam-policy "$name" --format=json 2>/dev/null || true)" ;;
    key) policy="$(cs_gc kms keys get-iam-policy "$name" --keyring="$CS_KEYRING" --location="$CS_REGION" --format=json 2>/dev/null || true)" ;;
  esac
  [[ -n "$policy" ]] || return 0
  mapfile -t grants < <(pool_grants "$policy" "$keep")
  for grant in ${grants[@]+"${grants[@]}"}; do
    [[ -n "$grant" ]] || continue
    case "$kind" in
      secret) cs_gcm secrets remove-iam-policy-binding "$name" --member="${grant% *}" --role="${grant##* }" --all >/dev/null ;;
      key) cs_gcm kms keys remove-iam-policy-binding "$name" --keyring="$CS_KEYRING" --location="$CS_REGION" \
        --member="${grant% *}" --role="${grant##* }" --all >/dev/null ;;
    esac
  done
}

cs_say "What $CS_ENV's attested VMs may use, granted to $CS_PRINCIPAL_SET alone: $CS_MASTER_KEY, and the secrets $CS_ENV's API reads"
# Encrypt too: whoever could encrypt with this key could plant a master of their choosing in the database.
cs_iam kms keys add-iam-policy-binding "$CS_MASTER_KEY" --keyring="$CS_KEYRING" --location="$CS_REGION" \
  --member="$CS_PRINCIPAL_SET" --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
revoke_pool key "$CS_MASTER_KEY" "$CS_PRINCIPAL_SET"
# Exactly the secrets in SECRETS, and the old KMASTER and KSERVICE only while CS_LEGACY is carry (env.sh). Once they're
# retired this grants them no more, and README.md › The old keys deletes them, which takes their bindings with them.
# The top-up secrets (CS_TOPUP_SECRETS) only a person makes, with their values, so this runs before they exist: one that
# doesn't exist yet, or has no version, is reported at the end with the command that adds it, and granted once it exists.
# deploy.sh won't roll out until both can be read.
declare -A handled=()
unversioned=() topups_missing=() topups_unversioned=()
for entry in "${CS_SECRETS[@]}" ${CS_LEGACY_SECRETS[@]+"${CS_LEGACY_SECRETS[@]/#/legacy=}"}; do
  secret="${entry#*=}"
  if ! exists cs_gc secrets describe "$secret"; then
    if cs_topup_secret "$entry"; then
      cs_warn "$secret doesn't exist yet, or couldn't be read: $CS_ENV's VMs aren't granted it (a person adds it, below)"
      topups_missing+=("$entry")
      continue
    fi
    [[ "$CS_DRY_RUN" == true ]] ||
      cs_die "secret $secret doesn't exist: infra/bootstrap-gcp.sh makes production's, and this script staging's"
  fi
  cs_iam secrets add-iam-policy-binding "$secret" --member="$CS_PRINCIPAL_SET" --role=roles/secretmanager.secretAccessor
  revoke_pool secret "$secret" "$CS_PRINCIPAL_SET"
  if [[ -z "${filled[$secret]:-}" && -z "$(latest_version "$secret")" ]]; then
    if cs_topup_secret "$entry"; then topups_unversioned+=("$entry"); else unversioned+=("$secret"); fi
  fi
  handled[$secret]=1
done
cs_say "Nothing granted to the whole pool: every key in $CS_KEYRING and every secret"
mapfile -t keys < <(cs_gc kms keys list --keyring="$CS_KEYRING" --location="$CS_REGION" --format='value(name.basename())' 2>/dev/null || true)
for key in ${keys[@]+"${keys[@]}"}; do
  [[ -z "$key" || "$key" == "$CS_MASTER_KEY" ]] || revoke_pool key "$key"
done
mapfile -t secrets < <(cs_gc secrets list --format='value(name.basename())' 2>/dev/null || true)
for secret in ${secrets[@]+"${secrets[@]}"}; do
  [[ -z "$secret" || -n "${handled[$secret]:-}" ]] || revoke_pool secret "$secret"
done

# The project's Owners can use any key in it (README.md › Known limits), so every use of one has to be on record.
audit="$(cs_gc projects get-iam-policy "$CS_PROJECT" --format=json 2>/dev/null || true)"
if [[ -z "$audit" ]]; then
  cs_warn "couldn't read $CS_PROJECT's IAM policy to check Cloud KMS's Data Access audit logs are on"
else
  logged="$(jq -r '[.auditConfigs[]? | select(.service == "cloudkms.googleapis.com" or .service == "allServices")
    | .auditLogConfigs[]? | .logType] | unique | join(" ")' <<<"$audit")"
  exempted="$(jq -r '[.auditConfigs[]? | select(.service == "cloudkms.googleapis.com" or .service == "allServices")
    | .auditLogConfigs[]? | .exemptedMembers[]?] | unique | join(", ")' <<<"$audit")"
  [[ " $logged " == *" DATA_READ "* && " $logged " == *" DATA_WRITE "* ]] ||
    cs_warn "Cloud KMS's Data Access audit logs (Data Read and Data Write) aren't on for $CS_PROJECT: they record every use of the master key (README.md › Known limits)"
  [[ -z "$exempted" ]] || cs_warn "Cloud KMS's Data Access audit logs leave out $exempted: nothing should be exempt"
fi

cs_say "The deploy account, $CS_DEPLOY_SA: templates and the groups, the signing key, the registry, the migration job, and seeing the API's secrets are there"
exists cs_gc iam service-accounts describe "$CS_DEPLOY_SA" || [[ "$CS_DRY_RUN" == true ]] ||
  cs_die "$CS_DEPLOY_SA doesn't exist: run infra/bootstrap-gcp.sh first"
deployer_permissions=(
  compute.addresses.get
  compute.globalOperations.get compute.regionOperations.get compute.zoneOperations.get
  compute.instanceTemplates.create compute.instanceTemplates.delete compute.instanceTemplates.get
  compute.instanceTemplates.list compute.instanceTemplates.useReadOnly
  compute.instanceGroupManagers.create compute.instanceGroupManagers.get compute.instanceGroupManagers.list
  compute.instanceGroupManagers.update compute.instanceGroupManagers.use
  compute.instanceGroups.get compute.instanceGroups.update compute.instanceGroups.use
  compute.instances.get compute.instances.list
  compute.regions.get
  compute.regionBackendServices.get compute.regionBackendServices.update
  # A rolling update re-reads the group's autohealing check, which takes use, not useReadOnly (13 Nov 2026).
  compute.regionHealthChecks.get compute.regionHealthChecks.use compute.regionHealthChecks.useReadOnly
  compute.networks.get compute.subnetworks.get compute.subnetworks.use
)
role_state="$(cs_gc iam roles describe "$CS_DEPLOYER_ROLE" --format='value(deleted)' 2>/dev/null || echo missing)"
role_action=update
if [[ "$role_state" == missing ]]; then
  role_action=create
elif [[ "$role_state" == True ]]; then
  cs_gcm iam roles undelete "$CS_DEPLOYER_ROLE" --project="$CS_PROJECT"
fi
cs_gcm iam roles "$role_action" "$CS_DEPLOYER_ROLE" --project="$CS_PROJECT" --title="Alcove deployer" \
  --description="Makes instance templates and rolls the Alcove Confidential Space groups onto them." --stage=GA \
  --permissions="$(IFS=,; printf '%s' "${deployer_permissions[*]}")"
cs_iam projects add-iam-policy-binding "$CS_PROJECT" --member="serviceAccount:$CS_DEPLOY_SA" \
  --role="projects/$CS_PROJECT/roles/$CS_DEPLOYER_ROLE"
# Templates attach the VMs' service account.
cs_iam iam service-accounts add-iam-policy-binding "$CS_RUNTIME_SA" --member="serviceAccount:$CS_DEPLOY_SA" \
  --role=roles/iam.serviceAccountUser
# Signs with the key (and reads its public key); can't use a master key, or decrypt anything.
cs_iam kms keys add-iam-policy-binding "$CS_SIGNING_KEY" --keyring="$CS_KEYRING" --location="$CS_REGION" \
  --member="serviceAccount:$CS_DEPLOY_SA" --role=roles/cloudkms.signerVerifier
# cosign looks the key up (cloudkms.cryptoKeys.get) before it signs, which signerVerifier doesn't include.
cs_iam kms keys add-iam-policy-binding "$CS_SIGNING_KEY" --keyring="$CS_KEYRING" --location="$CS_REGION" \
  --member="serviceAccount:$CS_DEPLOY_SA" --role=roles/cloudkms.viewer
# Pushes images and their signatures.
cs_iam artifacts repositories add-iam-policy-binding "$CS_REPOSITORY" --location="$CS_REGION" \
  --member="serviceAccount:$CS_DEPLOY_SA" --role=roles/artifactregistry.writer
# Deploys and runs the migration job (Cloud Run), which needs no IAM changes.
cs_iam projects add-iam-policy-binding "$CS_PROJECT" --member="serviceAccount:$CS_DEPLOY_SA" --role=roles/run.developer
# Making or rolling a group makes its VMs as the caller, which needs compute.instances.create and the permissions around
# it (disks, the subnet, metadata, the attached account): the first production deploy (13 Nov 2026) failed without them.
cs_iam projects add-iam-policy-binding "$CS_PROJECT" --member="serviceAccount:$CS_DEPLOY_SA" --role=roles/compute.instanceAdmin.v1
# deploy.sh checks, before it rolls anything out, that each secret the API reads exists, has a version and is granted to
# the environment's VMs (cs_check_secrets). Secret Manager's viewer reads secrets' names, versions and policies, and no
# value: it has no secretmanager.versions.access.
cs_iam projects add-iam-policy-binding "$CS_PROJECT" --member="serviceAccount:$CS_DEPLOY_SA" --role=roles/secretmanager.viewer

cs_say "$CS_ENV's load balancer: a regional external proxy Network Load Balancer on $CS_ADDRESS"
exists cs_gc compute addresses describe "$CS_ADDRESS" --region="$CS_REGION" ||
  cs_gcm compute addresses create "$CS_ADDRESS" --region="$CS_REGION" --network-tier=PREMIUM
health_check() {
  local name="$1" action=create
  shift
  if exists cs_gc compute health-checks describe "$name" --region="$CS_REGION"; then action=update; fi
  # Probes say they're for the API's own name (not the VM's address, the default), since the API routes by host.
  cs_gcm compute health-checks "$action" http "$name" --region="$CS_REGION" --port="$CS_HTTP_PORT" --request-path=/health \
    --host="${CS_API_URL#https://}" "$@"
}
# /health on the plain port is the edge's own answer, never redirected: 200 once it serves TLS, 503 before. It doesn't
# reach the database, so an outage there doesn't take the VM out of the load balancer or have it replaced.
health_check "$CS_HC_LB" --check-interval=5s --timeout=5s --healthy-threshold=2 --unhealthy-threshold=2
# Autohealing is slower to judge, since it replaces a VM: four failures thirty seconds apart.
health_check "$CS_HC_HEAL" --check-interval=30s --timeout=10s --healthy-threshold=1 --unhealthy-threshold=4
backend_service() {
  local name="$1" port_name="$2" affinity="$3"
  local settings=(--region="$CS_REGION" --health-checks="$CS_HC_LB" --health-checks-region="$CS_REGION"
    --timeout="$CS_LB_TIMEOUT" --connection-draining-timeout="$CS_DRAINING_TIMEOUT" --session-affinity="$affinity"
    --port-name="$port_name")
  if exists cs_gc compute backend-services describe "$name" --region="$CS_REGION"; then
    cs_gcm compute backend-services update "$name" "${settings[@]}"
  else
    cs_gcm compute backend-services create "$name" --load-balancing-scheme=EXTERNAL_MANAGED --protocol=TCP "${settings[@]}"
  fi
}
backend_service "$CS_HTTPS" https CLIENT_IP
backend_service "$CS_HTTP" http NONE
target_proxy() {
  local name="$1" header="$2" current
  current="$(cs_gc compute target-tcp-proxies describe "$name" --region="$CS_REGION" --format='value(proxyHeader)' 2>/dev/null || true)"
  if [[ -z "$current" ]]; then
    cs_gcm compute target-tcp-proxies create "$name" --region="$CS_REGION" --backend-service="$name" \
      --backend-service-region="$CS_REGION" --proxy-header="$header"
  elif [[ "$current" != "$header" ]]; then
    # gcloud can't change a regional proxy's header; deleting and making it again drops connections for a moment.
    cs_warn "$name sends proxy header $current, not $header: delete its forwarding rule and it, then run this again"
  fi
}
target_proxy "$CS_HTTPS" PROXY_V1
target_proxy "$CS_HTTP" NONE
forwarding_rule() {
  local name="$1" port="$2"
  exists cs_gc compute forwarding-rules describe "$name" --region="$CS_REGION" ||
    cs_gcm compute forwarding-rules create "$name" --region="$CS_REGION" --load-balancing-scheme=EXTERNAL_MANAGED \
      --network-tier=PREMIUM --network="$CS_NETWORK" --address="$CS_ADDRESS" --ip-protocol=TCP --ports="$port" \
      --target-tcp-proxy="$name" --target-tcp-proxy-region="$CS_REGION"
}
forwarding_rule "$CS_HTTPS" 443
forwarding_rule "$CS_HTTP" 80

cs_say "$CS_ENV's managed instance group, $CS_MIG in $CS_ZONE"
if cs_mig_exists; then
  cs_converge_mig
  [[ -z "$image" ]] || cs_say "$CS_MIG exists; deploy.sh rolls it onto an image"
elif [[ -n "$image" ]]; then
  # A group's first VM reads every secret the API reads, as a deploy's does: refused while one can't be read.
  cs_check_secrets
  cs_check_quota
  cs_image="$(cs_confidential_space_image)"
  template="$(cs_template_name "$image")"
  cs_create_template "$template" "$image" "$cs_image" "$(cs_metadata "$image")" "$CS_RUNTIME_SA"
  cs_create_mig "$template"
else
  cs_say "$CS_MIG doesn't exist yet: the first deploy.sh makes it (or run this again with --image)"
fi

address="$(cs_gc compute addresses describe "$CS_ADDRESS" --region="$CS_REGION" --format='value(address)' 2>/dev/null || true)"
cat >&2 <<DONE

Done: $CS_ENV in Confidential Space.
  Address           ${address:-<$CS_ADDRESS, once made>} (dns.sh $CS_ENV points ${CS_HOSTS[*]} at it)
  WIF provider      $CS_WIF_PROVIDER
  Principal set     $CS_PRINCIPAL_SET
  Master key        $CS_KMS_MASTER_KEY
  Signing key id    $CS_SIGNING_KEY_ID ($CS_SIGNING_ALGORITHM)
  Group             $CS_MIG in $CS_ZONE
DONE
# The top-up secrets this run couldn't make ready, which only a person can: setup doesn't fail for them, deploy.sh does.
if ((${#topups_missing[@]} + ${#topups_unversioned[@]})); then
  cs_warn "top-ups need ${CS_TOPUP_SECRETS[*]#*=}, which only a person adds; $CS_ENV's API reads them, and deploy.sh won't roll out until each exists with a version and is granted to $CS_ENV's VMs"
  {
    printf 'Add what they are missing, never printing a value (README.md › The top-up secrets), then run this script again to grant them:\n'
    for entry in ${topups_missing[@]+"${topups_missing[@]}"}; do printf '  %s\n' "$(cs_add_secret_command "$entry" create)"; done
    for entry in ${topups_unversioned[@]+"${topups_unversioned[@]}"}; do printf '  %s\n' "$(cs_add_secret_command "$entry" version)"; done
    printf 'TREASURY_INTENTS_KEY is a full access key of %s (ed25519: and 64 bytes, base58), registered for it in intents.near;\n' "$CS_TREASURY_ACCOUNT"
    printf 'ONECLICK_API_KEY is the partner key from partners.near-intents.org.\n'
  } >&2
fi
if ((${#unversioned[@]})); then
  if [[ "$CS_DRY_RUN" == true ]]; then
    cs_warn "these secrets have no version yet, or couldn't be read; the API can't start until each has one: ${unversioned[*]}"
  else
    cs_die "the API can't start until each of these secrets has a version: ${unversioned[*]}. Add them (README.md › First setup, and › Staging for staging's Cloudflare token), then run this again."
  fi
fi
cs_say "Next: README.md › $([[ "$CS_ENV" == staging ]] && printf 'Staging' || printf 'First setup')."
