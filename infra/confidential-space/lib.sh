#!/usr/bin/env bash
# What setup.sh, build.sh, sign.sh, deploy.sh and dns.sh share. Sourced, never run.
#
# Every command that changes something goes through cs_run, which in a dry run (CS_DRY_RUN=true, set by --dry-run) prints
# it instead, quoted so it can be pasted. Commands that only read still run in a dry run, so it shows what would change
# against what exists; without credentials they fail, and the dry run prints everything as if nothing existed yet.
# Every gcloud call names the project; the active configuration (CLOUDSDK_ACTIVE_CONFIG_NAME) supplies the account.
# What the scripts say goes to stderr, dry-run lines included; build.sh and deploy.sh keep stdout for their key=value
# results ($GITHUB_OUTPUT).

if ((BASH_VERSINFO[0] < 4)); then
  echo 'These scripts need bash 4 or later (on macOS: brew install bash).' >&2
  exit 1
fi

CS_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CS_ROOT="$(cd "$CS_HERE/../.." && pwd)"
# shellcheck source=infra/confidential-space/env.sh
source "$CS_HERE/env.sh"

CS_DRY_RUN="${CS_DRY_RUN:-false}"
# gcloud never stops to ask: a question it would ask is answered with its default, which for anything risky is no.
export CLOUDSDK_CORE_DISABLE_PROMPTS=1

cs_say() { printf '› %s\n' "$*" >&2; }
cs_warn() { printf 'warning: %s\n' "$*" >&2; }
cs_die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# A command as it would be typed: words that need it in single quotes.
cs_quote() {
  local out='' word
  for word in "$@"; do
    if [[ "$word" =~ ^[A-Za-z0-9_./:=,@%+-]+$ ]]; then
      out+="$word "
    else
      out+="'${word//\'/\'\\\'\'}' "
    fi
  done
  printf '%s\n' "${out% }"
}

# A command that changes something.
cs_run() {
  if [[ "$CS_DRY_RUN" == true ]]; then
    printf '[dry-run] %s\n' "$(cs_quote "$@")" >&2
    return 0
  fi
  printf '+ %s\n' "$(cs_quote "$@")" >&2
  "$@"
}

# gcloud that reads, and gcloud that changes something.
cs_gc() { gcloud --project="$CS_PROJECT" "$@"; }
cs_gcm() { cs_run gcloud --project="$CS_PROJECT" "$@"; }

# An IAM binding. Adding one that exists changes nothing, so these always run (and a dry run always lists them). A
# service account made a moment ago can take a while to be seen, so it tries again for about a minute.
cs_iam() {
  local attempt delay=2
  if [[ "$CS_DRY_RUN" == true ]]; then cs_gcm "$@" --condition=None; return 0; fi
  for attempt in 1 2 3 4 5 6; do
    if cs_gcm "$@" --condition=None >/dev/null; then return 0; fi
    ((attempt == 6)) && cs_die "IAM binding failed six times: $(cs_quote "$@")"
    cs_warn "waiting ${delay}s for IAM to see a new principal, then trying again"
    sleep "$delay"
    delay=$((delay * 2))
  done
}

cs_require() {
  local tool
  for tool in "$@"; do command -v "$tool" >/dev/null 2>&1 || cs_die "$tool is needed and isn't installed"; done
}

cs_banner() {
  local config
  config="$(gcloud config configurations list --filter=is_active=true --format='value(name)' 2>/dev/null || true)"
  cs_say "$1: project $CS_PROJECT, gcloud configuration ${config:-unknown}${2:+, $2}$([[ "$CS_DRY_RUN" == true ]] && printf ', dry run')"
}

# The image a deployment runs, always by digest, from our repository.
cs_check_image() {
  [[ "$1" =~ ^${CS_IMAGE_REPO//./\\.}@sha256:[0-9a-f]{64}$ ]] || cs_die "expected $CS_IMAGE_REPO@sha256:<64 hex>, got '$1'"
}

# Every tee-env name must be one the image allows (its tee.launch_policy.allow_env_override label), or the launcher
# refuses to start it and the VM powers off. Checked against the Dockerfile of this checkout, before anything changes.
cs_check_env_allowed() {
  local label name missing=()
  label="$(sed -n 's/^LABEL "tee\.launch_policy\.allow_env_override"="\([^"]*\)".*/\1/p' "$CS_ROOT/apps/api/Dockerfile")"
  [[ -n "$label" ]] || cs_die "apps/api/Dockerfile has no tee.launch_policy.allow_env_override label"
  for name in "${CS_TEE_ENV[@]%%=*}"; do
    [[ ",$label," == *",$name,"* ]] || missing+=("$name")
  done
  ((${#missing[@]} == 0)) || cs_die "the image doesn't allow ${missing[*]}: add them to the allow_env_override label in apps/api/Dockerfile"
}

# Whether ENV=secret ($1) is one of the top-up secrets (CS_TOPUP_SECRETS, after cs_secrets), which only a person makes.
cs_topup_secret() { [[ " ${CS_TOPUP_SECRETS[*]-} " == *" $1 "* ]]; }

# The command that adds a secret's value without printing it, for ENV=secret ($1): `create` makes the secret with it, and
# `version` adds it to one that exists. The value comes from the person's own shell, in a variable named after the setting.
cs_add_secret_command() {
  local setting="${1%%=*}" secret="${1#*=}"
  # shellcheck disable=SC2016 # The $ is the person's variable, written out for them to run, not expanded here.
  case "$2" in
    create) printf 'printf %%s "$%s" | gcloud --project=%s secrets create %s --replication-policy=automatic --data-file=-' "$setting" "$CS_PROJECT" "$secret" ;;
    version) printf 'printf %%s "$%s" | gcloud --project=%s secrets versions add %s --data-file=-' "$setting" "$CS_PROJECT" "$secret" ;;
  esac
}

# Refuses, before anything changes, while a secret the environment's API reads (CS_SECRETS, after cs_secrets) doesn't exist,
# has no enabled version, or isn't granted to the environment's VMs (CS_PRINCIPAL_SET): a VM that can't read one never
# starts, so a rollout would only stall until its timeout. It reads names, versions' states and policies, never a value:
# the deploy account may (roles/secretmanager.viewer, which setup.sh grants), and can't read one. A top-up secret
# (CS_TOPUP_SECRETS), which only a person makes, is named with the command that adds it. In a dry run, only a warning.
cs_check_secrets() {
  local entry secret policy line unseen=0
  local -a problems=() commands=()
  for entry in "${CS_SECRETS[@]}"; do
    secret="${entry#*=}"
    if ! cs_gc secrets describe "$secret" --format='value(name)' >/dev/null 2>&1; then
      problems+=("$secret (${entry%%=*}) doesn't exist, or these credentials can't see it")
      if cs_topup_secret "$entry"; then commands+=("$(cs_add_secret_command "$entry" create)"); fi
      unseen=$((unseen + 1))
      continue
    fi
    if [[ -z "$(cs_gc secrets versions list "$secret" --filter=state=ENABLED --limit=1 --format='value(name)' 2>/dev/null || true)" ]]; then
      problems+=("$secret (${entry%%=*}) has no enabled version")
      if cs_topup_secret "$entry"; then commands+=("$(cs_add_secret_command "$entry" version)"); fi
    fi
    policy="$(cs_gc secrets get-iam-policy "$secret" --format=json 2>/dev/null || true)"
    jq -e --arg m "$CS_PRINCIPAL_SET" 'any(.bindings[]?; .role == "roles/secretmanager.secretAccessor" and .condition == null and any(.members[]?; . == $m))' \
      <<<"${policy:-null}" >/dev/null 2>&1 || problems+=("$secret (${entry%%=*}) isn't granted to $CS_ENV's VMs")
  done
  if ((${#problems[@]} == 0)); then
    cs_say "every secret $CS_ENV's API reads exists, has a version and is granted to its VMs"
    return 0
  fi
  for line in "${problems[@]}"; do cs_warn "$line"; done
  if ((unseen == ${#CS_SECRETS[@]})); then
    cs_warn "none of them could be seen: if they exist, these credentials can't see secrets, which setup.sh lets the deploy account do (roles/secretmanager.viewer)"
  fi
  if ((${#commands[@]})); then
    printf 'Add what the top-up secrets are missing (README.md › The top-up secrets), never printing their values:\n' >&2
    printf '  %s\n' "${commands[@]}" >&2
  fi
  [[ "$CS_DRY_RUN" == true ]] && return 0
  cs_die "$CS_ENV's API can't start without every secret it reads, so nothing was rolled out. Once each exists with a version, run infra/confidential-space/setup.sh $CS_ENV, which grants them to $CS_ENV's VMs (and lets the deploy account see them), then deploy again."
}

# The VM metadata for an image: what the launcher runs, how, and with which environment. Several values hold commas, so
# entries are separated by ~ (gcloud's ^~^ prefix).
cs_metadata() {
  local image="$1" entry out
  out="^~^tee-image-reference=$image"
  # A crash restarts the VM (a full reboot, a fresh pull and a fresh attestation); a clean exit stops it.
  out+="~tee-restart-policy=OnFailure"
  # The container's stdout and stderr go to Cloud Logging (the image allows it: tee.launch_policy.log_redirect=always).
  out+="~tee-container-log-redirect=cloud_logging"
  # cosign's signatures sit beside the image, as sha256-<digest>.sig. The launcher has them verified, and the token's
  # image_signatures then holds our key's id, which the Workload Identity provider requires.
  out+="~tee-signed-image-repos=$CS_IMAGE_REPO"
  for entry in "${CS_TEE_ENV[@]}"; do
    [[ "$entry" != *'~'* ]] || cs_die "a value can't contain ~: $entry"
    out+="~tee-env-$entry"
  done
  printf '%s' "$out"
}

# The newest image in the Confidential Space production family, named, so a template says exactly what it boots.
cs_confidential_space_image() {
  local image
  image="$(gcloud compute images describe-from-family "$CS_IMAGE_FAMILY" --project="$CS_IMAGE_PROJECT" --format='value(name)' 2>/dev/null || true)"
  if [[ -z "$image" ]]; then
    [[ "$CS_DRY_RUN" == true ]] || cs_die "couldn't read the newest image in $CS_IMAGE_PROJECT/$CS_IMAGE_FAMILY"
    image="<newest $CS_IMAGE_FAMILY image>"
  fi
  printf '%s' "$image"
}

cs_template_name() {
  local digest="${1#*@sha256:}"
  printf '%s-%s-%s' "$CS_TEMPLATE_PREFIX" "$(date -u +%Y%m%d-%H%M%S)" "${digest:0:12}"
}

# A new instance template (after cs_env): <name> <image> <Confidential Space image> <metadata> <service account>. The
# metadata is cs_metadata's for a new image, or an existing template's for a refresh, with the account it ran as.
cs_create_template() {
  local name="$1" image="$2" cs_image="$3" metadata="$4" account="$5"
  cs_gcm compute instance-templates create "$name" \
    --description="Alcove $CS_ENV: $image on $cs_image" \
    --machine-type="$CS_MACHINE_TYPE" \
    --confidential-compute-type=TDX \
    --maintenance-policy=TERMINATE \
    --shielded-secure-boot \
    --image-project="$CS_IMAGE_PROJECT" --image="$cs_image" \
    --boot-disk-type=pd-balanced --boot-disk-size="$CS_BOOT_DISK_SIZE" \
    --network="$CS_NETWORK" --subnet="$CS_SUBNET" --region="$CS_REGION" --no-address --tags="$CS_TAG" \
    --service-account="$account" --scopes=cloud-platform \
    --labels="alcove-env=$CS_ENV" \
    --metadata="$metadata"
}

# Refuses, before anything changes, when the region's C3 quota can't hold what the group is about to run at once: one
# VM for a new group, and for a rollout its VMs and the one it adds before removing any. Whatever else holds C3 vCPUs
# (staging's group, during a production deploy) is named. A quota it can't read is only a warning: the rollout would
# then wait out its timeout instead.
cs_check_quota() {
  local per_vm="${CS_MACHINE_TYPE##*-}" quota limit usage ours=0 size=0 needed others
  [[ "$per_vm" =~ ^[0-9]+$ ]] || cs_die "can't tell how many vCPUs $CS_MACHINE_TYPE has"
  quota="$(cs_gc compute regions describe "$CS_REGION" --format=json 2>/dev/null |
    jq -c --arg m "$CS_CPU_QUOTA" 'first(.quotas[]? | select(.metric == $m)) // empty' 2>/dev/null || true)"
  if [[ -z "$quota" ]]; then
    cs_warn "couldn't read $CS_REGION's $CS_CPU_QUOTA quota; not checking there's room to roll out"
    return 0
  fi
  limit="$(jq -r '.limit | floor' <<<"$quota")"
  usage="$(jq -r '.usage | ceil' <<<"$quota")"
  if cs_mig_exists; then
    ours="$(cs_gc compute instance-groups managed list-instances "$CS_MIG" --zone="$CS_ZONE" --format=json 2>/dev/null |
      jq 'length' 2>/dev/null || echo 0)"
    size="$(cs_gc compute instance-groups managed describe "$CS_MIG" --zone="$CS_ZONE" --format='value(targetSize)' 2>/dev/null || echo 1)"
    [[ "$size" =~ ^[0-9]+$ ]] || size=1
    needed=$(((size + 1) * per_vm))
  else
    needed=$per_vm
  fi
  others=$((usage - ours * per_vm))
  if ((others < 0)); then others=0; fi
  if ((others + needed > limit)); then
    local elsewhere
    elsewhere="$(cs_gc compute instances list --filter="zone ~ /zones/$CS_REGION- AND machineType ~ /machineTypes/c3-" \
      --format='value(name,zone.basename(),status)' 2>/dev/null | grep -v "^$CS_MIG-[a-z0-9]\{4\}[[:space:]]" |
      awk '{printf "%s%s (%s, %s)", (NR > 1 ? ", " : ""), $1, $2, $3}' || true)"
    cs_die "$CS_REGION's $CS_CPU_QUOTA quota is $limit vCPUs and $usage are in use, $others of them outside $CS_MIG${elsewhere:+: $elsewhere}. $CS_MIG needs $needed at once (a $CS_MACHINE_TYPE has $per_vm, and a rollout adds one before it removes one). Delete what else holds them (staging's group: README.md › Staging) or raise the quota, then try again."
  fi
  cs_say "room to roll out: $CS_MIG needs $needed of $CS_REGION's $limit $CS_CPU_QUOTA, and $others are in use elsewhere"
}

cs_regional_health_check() { printf 'projects/%s/regions/%s/healthChecks/%s' "$CS_PROJECT" "$CS_REGION" "$1"; }

cs_mig_exists() { cs_gc compute instance-groups managed describe "$CS_MIG" --zone="$CS_ZONE" --format='value(name)' >/dev/null 2>&1; }

# The group's settings besides its template: autohealing, the named ports its backend services send to, and membership of
# both. Safe to repeat.
cs_converge_mig() {
  local service backends
  cs_gcm compute instance-groups managed update "$CS_MIG" --zone="$CS_ZONE" \
    --health-check="$(cs_regional_health_check "$CS_HC_HEAL")" --initial-delay="$CS_INITIAL_DELAY"
  cs_gcm compute instance-groups managed set-named-ports "$CS_MIG" --zone="$CS_ZONE" \
    --named-ports="http:$CS_HTTP_PORT,https:$CS_HTTPS_PORT"
  for service in "$CS_HTTPS" "$CS_HTTP"; do
    backends="$(cs_gc compute backend-services describe "$service" --region="$CS_REGION" --format='value(backends[].group)' 2>/dev/null || true)"
    if [[ "$backends" == *"/zones/$CS_ZONE/instanceGroups/$CS_MIG"* ]]; then continue; fi
    cs_gcm compute backend-services add-backend "$service" --region="$CS_REGION" \
      --instance-group="$CS_MIG" --instance-group-zone="$CS_ZONE" \
      --balancing-mode=UTILIZATION --max-utilization=0.8
  done
}

# The group, made from its first template: one VM, replaced one at a time (a new VM first, the old one removed only once
# the new one is healthy).
cs_create_mig() {
  local template="$1"
  cs_gcm compute instance-groups managed create "$CS_MIG" --zone="$CS_ZONE" \
    --template="$template" --size=1 --base-instance-name="$CS_MIG" \
    --health-check="$(cs_regional_health_check "$CS_HC_HEAL")" --initial-delay="$CS_INITIAL_DELAY" \
    --update-policy-type=proactive --update-policy-max-surge=1 --update-policy-max-unavailable=0 \
    --update-policy-minimal-action=replace --update-policy-replacement-method=substitute
  cs_converge_mig
}
