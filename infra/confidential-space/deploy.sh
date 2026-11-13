#!/usr/bin/env bash
# Rolls an environment's group onto an image: a new instance template for it, on the newest Confidential Space image, then
# a rolling update that adds the new VM first and removes the old one only once the new one is healthy.
#
#   infra/confidential-space/deploy.sh <image>@sha256:<digest> [production|staging] [--dry-run]
#   infra/confidential-space/deploy.sh --refresh [production|staging] [--dry-run]
#
# --refresh keeps what the group runs, exactly: its image by digest, as the account and with the environment its template
# gives it, and moves it onto the newest Confidential Space image (.github/workflows/refresh.yml runs it monthly). It
# refuses while the group is mid-rollout or stalled, when its template may not be what runs. The image must be signed
# (sign.sh) or its VM can't unwrap the master. The first deploy to an environment makes its group. Both first wait for a VM
# an earlier rollout took out of service to finish going, then refuse, before changing anything, when the region's C3
# quota can't hold the VM a rollout adds. Waits until the group has the new VM in service and the old one out of it, and
# both of the load balancer's backend services call the new VM healthy, then prints image=, instance=, template= and
# address= lines on stdout (for $GITHUB_OUTPUT), and nothing else there: everything else, gcloud's own output included,
# goes to stderr. The old VM drains and is deleted after that, in the background. Old templates beyond the newest five are
# deleted.
set -euo pipefail
# shellcheck source=infra/confidential-space/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# The key=value lines go to the caller's stdout, kept as fd 3; everything else goes to stderr.
exec 3>&1 1>&2

usage() {
  printf 'usage: %s <image>@sha256:<digest> [production|staging] [--dry-run]\n       %s --refresh [production|staging] [--dry-run]\n' "$0" "$0" >&2
  exit 2
}
image='' environment=production refresh=false
while (($#)); do
  case "$1" in
    --dry-run) CS_DRY_RUN=true ;;
    --refresh) refresh=true ;;
    production | staging) environment="$1" ;;
    -h | --help) usage ;;
    -*) usage ;;
    *) [[ -z "$image" ]] || usage; image="$1" ;;
  esac
  shift
done
[[ "$refresh" == true && -z "$image" ]] || [[ "$refresh" == false && -n "$image" ]] || usage
cs_require gcloud jq
cs_env "$environment"

# A rollout's old VM drains and is deleted after deploy.sh has gone, about eight minutes on (below). Wait for any still
# going, up to fifteen minutes, so the quota and the group's state are this run's to judge: until it's gone it holds C3
# vCPUs, and the group isn't settled.
wait_for_removals() {
  local deadline=$((SECONDS + 900)) going said=false
  while :; do
    going="$(cs_gc compute instance-groups managed list-instances "$CS_MIG" --zone="$CS_ZONE" --format=json |
      jq '[.[] | select(.currentAction == "DELETING")] | length')"
    ((going == 0)) && return 0
    if [[ "$CS_DRY_RUN" == true ]]; then cs_say "would wait for the $going VM(s) $CS_MIG is deleting to go"; return 0; fi
    [[ "$said" == true ]] || cs_say "waiting for the VM an earlier rollout took out of service to drain and go"
    said=true
    if ((SECONDS >= deadline)); then cs_warn "$CS_MIG is still deleting $going VM(s) after fifteen minutes; going on"; return 0; fi
    sleep 10
  done
}

# The group as it stands once any VM an earlier rollout took out has gone; none when there's no group yet.
group=''
read_group() {
  cs_mig_exists || return 0
  wait_for_removals
  group="$(cs_gc compute instance-groups managed describe "$CS_MIG" --zone="$CS_ZONE" --format=json)"
}
settled() { [[ "$(jq -r '.status.versionTarget.isReached == true and .status.isStable == true and (.versions | length) == 1' <<<"$group")" == true ]]; }

if [[ "$refresh" == true ]]; then
  cs_banner "refresh" "$CS_ENV"
  read_group
  [[ -n "$group" ]] || cs_die "$CS_MIG doesn't exist yet: deploy an image first"
  # Mid-rollout or stalled, the group's template may be an image that never came up: refresh what runs, once it's settled.
  settled || cs_die "$CS_MIG hasn't settled (a rollout is in progress or stalled), so its template may not be what runs: refresh once it has"
  current="$(jq -r '.versions[0].instanceTemplate | split("/") | last' <<<"$group")"
  source_template="$(cs_gc compute instance-templates describe "$current" --format=json)"
  image="$(jq -r '.properties.metadata.items[]? | select(.key == "tee-image-reference") | .value' <<<"$source_template")"
  account="$(jq -r '.properties.serviceAccounts[0].email // empty' <<<"$source_template")"
  # Never carry one environment's VMs on as another's account, which opens that environment's keys and secrets.
  [[ "$account" == "$CS_RUNTIME_SA" ]] ||
    cs_die "$current runs as ${account:-no service account}, not $CS_ENV's own $CS_RUNTIME_SA: deploy an image to move it"
  # The environment the image was deployed with, as it was: env.sh may have moved on since, to names its label doesn't allow.
  [[ "$(jq -r 'any(.properties.metadata.items[]?; (.key + .value) | contains("~"))' <<<"$source_template")" == false ]] ||
    cs_die "$current has metadata with a ~ in it, which can't be passed on"
  metadata="$(jq -r '"^~^" + ([.properties.metadata.items[]? | "\(.key)=\(.value)"] | join("~"))' <<<"$source_template")"
  cs_say "$CS_MIG runs $image as $account (template $current); keeping both, and the template's environment"
else
  cs_settings || cs_die "set the values above (README.md › Settings)"
  cs_check_env_allowed
  cs_banner "deploy" "$CS_ENV"
  read_group
  metadata="$(cs_metadata "$image")"
  account="$CS_RUNTIME_SA"
  if [[ -n "$group" ]] && ! settled; then cs_warn "$CS_MIG hasn't settled since its last rollout; this one takes its place"; fi
fi
cs_check_image "$image"
cs_check_quota

cs_image="$(cs_confidential_space_image)"
template="$(cs_template_name "$image")"
cs_say "template $template: $image on $cs_image"
cs_create_template "$template" "$image" "$cs_image" "$metadata" "$account"

if [[ -n "$group" ]]; then
  cs_gcm compute instance-groups managed rolling-action start-update "$CS_MIG" --zone="$CS_ZONE" \
    --version="template=$template" --type=proactive --max-surge=1 --max-unavailable=0 \
    --minimal-action=replace --replacement-method=substitute
else
  cs_say "$CS_MIG doesn't exist yet: making it"
  cs_create_mig "$template"
fi

address="$(cs_gc compute addresses describe "$CS_ADDRESS" --region="$CS_REGION" --format='value(address)' 2>/dev/null || true)"
if [[ "$CS_DRY_RUN" == true ]]; then
  cs_say "would wait for the group to have $template's VM in service and the old one out, and for the load balancer to call it healthy"
  printf 'image=%s\ninstance=<new VM>\ntemplate=%s\naddress=%s\n' "$image" "$template" "${address:-<$CS_ADDRESS>}" >&3
  exit 0
fi

# A TDX VM boots, pulls the image and attests, and the API starts: about a minute and a half. Once the group's health
# check calls it healthy, the group takes the old VM out of service. The load balancer sends that one no new connections
# and lets those it has drain (CS_DRAINING_TIMEOUT, and up to a minute more), then the group deletes it, which takes two
# minutes more: Confidential Space holds a VM that long once its workload has stopped. The new VM serves every new
# connection from the moment the old one is out, so that's what this waits for, not the old one's going, which takes
# eight minutes more and which the next rollout waits for instead (wait_for_removals).
cs_say "waiting for $CS_MIG to have $template's VM in service and the old one out"
deadline=$((SECONDS + 2700))
instance=''
while :; do
  target="$(cs_gc compute instance-groups managed describe "$CS_MIG" --zone="$CS_ZONE" --format=json |
    jq -r '[.targetSize, ([.versions[]?.instanceTemplate | split("/") | last] | join(" "))] | @tsv')"
  [[ "${target#*$'\t'}" == "$template" ]] ||
    cs_die "$CS_MIG now rolls out ${target#*$'\t'}, not $template: another rollout took this one's place"
  # In service: from this template, running, nothing pending and healthy by the group's check, as many as the group
  # holds; and every VM from another template on its way out, which takes it out of the load balancer.
  instance="$(cs_gc compute instance-groups managed list-instances "$CS_MIG" --zone="$CS_ZONE" --format=json |
    jq -r --arg t "$template" --argjson size "${target%%$'\t'*}" '
      def ours: (.version.instanceTemplate // "") | endswith("/" + $t);
      [.[] | select(ours)] as $new | [.[] | select(ours | not)] as $old
      | if $size > 0 and ($new | length) == $size
           and all($new[]; .currentAction == "NONE" and .instanceStatus == "RUNNING" and all(.instanceHealth[]?; .detailedHealthState == "HEALTHY"))
           and all($old[]; .currentAction == "DELETING")
        then $new[0].instance | split("/") | last else empty end')"
  [[ -z "$instance" ]] || break
  ((SECONDS < deadline)) || cs_die "$CS_MIG hasn't had $template's VM in service and the old one out after 45 minutes"
  sleep 5
done

cs_say "waiting for the load balancer to call $instance healthy"
for service in "$CS_HTTPS" "$CS_HTTP"; do
  for attempt in $(seq 1 60); do
    state="$(cs_gc compute backend-services get-health "$service" --region="$CS_REGION" --format=json |
      jq -r --arg i "/instances/$instance" '[.[].status.healthStatus[]? | select(.instance | endswith($i)) | .healthState] | first // "UNKNOWN"')"
    [[ "$state" == HEALTHY ]] && break
    ((attempt == 60)) && cs_die "$service still calls $instance $state after ten minutes"
    sleep 10
  done
done

# Keep the newest five templates of this environment, to roll back to; one still in use can't be deleted, and stays.
mapfile -t old < <(cs_gc compute instance-templates list --sort-by=~creationTimestamp --format='value(name)' \
  --filter="name ~ '^$CS_TEMPLATE_PREFIX-[0-9]{8}-[0-9]{6}-[0-9a-f]{12}\$'" | tail -n +6)
for name in ${old[@]+"${old[@]}"}; do
  cs_say "deleting the old template $name"
  cs_gcm compute instance-templates delete "$name" --quiet || cs_say "kept $name (in use)"
done

cs_say "$CS_ENV runs $image on $instance; the VM it replaced drains and goes in the background"
printf 'image=%s\ninstance=%s\ntemplate=%s\naddress=%s\n' "$image" "$instance" "$template" "$address" >&3
