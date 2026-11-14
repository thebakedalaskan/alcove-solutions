#!/usr/bin/env bash
# Runs the checks job (apps/api/src/operator-job.ts) on a VM of its own, for an API that won't start: every start step on its
# own, carrying on past one that fails, then the live checks from inside, as the report they make.
#
#   infra/confidential-space/job.sh <production|staging> checks [--dry-run]
#
# It reads the group's current instance template and makes one VM from it, alcove-job-<UTC time>-<4 hex> (staging's
# alcove-job-staging-<UTC time>-<4 hex>): the same image, account and environment, plus ALCOVE_JOB=checks, which the image
# runs in the server's place (apps/api/entrypoint.sh), and tee-restart-policy=Never, so the VM stops once the job has. It
# isn't in the group, so the load balancer sends it nothing. It waits up to fifteen minutes for the job to say it's done or
# the VM to stop, prints the job's lines from Cloud Logging, found by the VM's instance ID, and deletes the VM, whatever
# happened. It refuses up front when the region's C3 quota can't hold one VM more, as while a rollout holds two.
#
# The report goes to stdout and everything else to stderr. Exits 0 when the job said everything passed, 1 otherwise, and 2 for
# words it doesn't take. --dry-run prints each command that would change something and runs only those that read.
#
# What it risks: a second VM with the environment's attested identity, which can read its secrets and unwrap its master,
# running code that's already in the signed image. The job only reads: it never listens, migrates, writes or orders.
set -euo pipefail
# shellcheck source=infra/confidential-space/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# The report goes to the caller's stdout, kept as fd 3; everything else goes to stderr.
exec 3>&1 1>&2

usage() {
  printf 'usage: %s <production|staging> checks [--dry-run]\n' "$0" >&2
  exit 2
}
environment='' job=''
while (($#)); do
  case "$1" in
    --dry-run) CS_DRY_RUN=true ;;
    production | staging) [[ -z "$environment" ]] || usage; environment="$1" ;;
    checks) [[ -z "$job" ]] || usage; job="$1" ;;
    *) usage ;;
  esac
  shift
done
[[ -n "$environment" && -n "$job" ]] || usage
cs_require gcloud jq
cs_env "$environment"
cs_banner "$job job" "$CS_ENV"

# What a dry run without credentials can't read, it says as a placeholder, and goes on.
read_or() {
  local placeholder="$1" out
  shift
  if out="$("$@" 2>/dev/null)" && [[ -n "$out" ]]; then printf '%s' "$out"; return 0; fi
  [[ "$CS_DRY_RUN" == true ]] || return 1
  printf '%s' "$placeholder"
}

# The group's current template: what a new VM of the group runs now, a rollout's included.
group="$(read_or '{}' cs_gc compute instance-groups managed describe "$CS_MIG" --zone="$CS_ZONE" --format=json)" ||
  cs_die "couldn't read $CS_MIG in $CS_ZONE: it doesn't exist yet, or this account can't read it"
template="$(jq -r '(.versions[0].instanceTemplate // .instanceTemplate // empty) | split("/") | last' <<<"$group")"
[[ -n "$template" || "$CS_DRY_RUN" == true ]] || cs_die "$CS_MIG names no instance template"
template="${template:-<the template of $CS_MIG>}"
source_template="$(read_or '{}' cs_gc compute instance-templates describe "$template" --format=json)" ||
  cs_die "couldn't read the template $template"
image="$(jq -r '.properties.metadata.items[]? | select(.key == "tee-image-reference") | .value' <<<"$source_template")"
account="$(jq -r '.properties.serviceAccounts[0].email // empty' <<<"$source_template")"
machine="$(jq -r '.properties.machineType // empty' <<<"$source_template")"
machine="${machine:-$CS_MACHINE_TYPE}"
if [[ "$source_template" != '{}' ]]; then
  # Never one environment's VM as another's account, which opens that environment's keys and secrets.
  [[ "$account" == "$CS_RUNTIME_SA" ]] ||
    cs_die "$template runs as ${account:-no service account}, not $CS_ENV's own $CS_RUNTIME_SA"
  [[ "$(jq -r 'any(.properties.metadata.items[]?; (.key + .value) | contains("~"))' <<<"$source_template")" == false ]] ||
    cs_die "$template has metadata with a ~ in it, which can't be passed on"
fi
# The template's metadata as it is (the image, how its logs go, which signatures it's checked against, its environment), but
# for the job and how a stop is taken. Entries are separated by ~ (gcloud's ^~^ prefix), as some values hold commas.
metadata="$(jq -r --arg job "$job" '"^~^" + ([.properties.metadata.items[]? | select(.key != "tee-restart-policy" and .key != "tee-env-ALCOVE_JOB") | "\(.key)=\(.value)"]
  + ["tee-restart-policy=Never", "tee-env-ALCOVE_JOB=\($job)"] | join("~"))' <<<"$source_template")"
cs_say "$CS_MIG's template is $template: ${image:-<its image>} as ${account:-$CS_RUNTIME_SA}"

# One VM more must fit the region's C3 quota beside what's running, which a rollout's two VMs fill.
per_vm="${machine##*-}"
[[ "$per_vm" =~ ^[0-9]+$ ]] || cs_die "can't tell how many vCPUs $machine has"
quota="$(cs_gc compute regions describe "$CS_REGION" --format=json 2>/dev/null |
  jq -c --arg m "$CS_CPU_QUOTA" 'first(.quotas[]? | select(.metric == $m)) // empty' 2>/dev/null || true)"
if [[ -z "$quota" ]]; then
  cs_warn "couldn't read $CS_REGION's $CS_CPU_QUOTA quota; not checking there's room for the job's VM"
else
  limit="$(jq -r '.limit | floor' <<<"$quota")"
  usage="$(jq -r '.usage | ceil' <<<"$quota")"
  if ((usage + per_vm > limit)); then
    holding="$(cs_gc compute instances list --filter="zone ~ /zones/$CS_REGION- AND machineType ~ /machineTypes/c3-" \
      --format='value(name,zone.basename(),status)' 2>/dev/null | awk '{printf "%s%s (%s, %s)", (NR > 1 ? ", " : ""), $1, $2, $3}' || true)"
    cs_die "$CS_REGION's $CS_CPU_QUOTA quota is $limit vCPUs and $usage are in use${holding:+: $holding}. The job's VM needs $per_vm more. A rollout holds two VMs until its old one has gone (about eight minutes after deploy.sh): try again then, or raise the quota."
  fi
  cs_say "room for the job: its VM needs $per_vm of $CS_REGION's $limit $CS_CPU_QUOTA, and $usage are in use"
fi

# Its own name, so a run that fails to make it can never take another run's VM for its own.
vm="alcove-job$CS_SUFFIX-$(date -u +%Y%m%d-%H%M%S)-$(printf '%04x' "$RANDOM")"
made=false
# The VM goes however this ends: done, failed, or stopped by hand.
remove_vm() {
  [[ "$made" == true ]] || return 0
  if [[ "$CS_DRY_RUN" != true ]] && ! cs_gc compute instances describe "$vm" --zone="$CS_ZONE" --format='value(name)' >/dev/null 2>&1; then return 0; fi
  cs_gcm compute instances delete "$vm" --zone="$CS_ZONE" --quiet ||
    cs_warn "couldn't delete $vm: delete it by hand, gcloud --project=$CS_PROJECT compute instances delete $vm --zone=$CS_ZONE"
}
trap remove_vm EXIT
trap 'exit 130' INT TERM

made=true
cs_say "making $vm from $template, to run the $job job"
cs_gcm compute instances create "$vm" --zone="$CS_ZONE" --source-instance-template="$template" \
  --metadata="$metadata" --labels="alcove-env=$CS_ENV,alcove-job=$job"

if [[ "$CS_DRY_RUN" == true ]]; then
  cs_say "would wait up to fifteen minutes for the job to say it's done or $vm to stop, print its operator job lines from Cloud Logging, and delete $vm"
  exit 0
fi

id='' created=''
read -r id created < <(cs_gc compute instances describe "$vm" --zone="$CS_ZONE" --format='value(id,creationTimestamp)') || true
[[ "$id" =~ ^[0-9]+$ && -n "$created" ]] || cs_die "couldn't read $vm's instance ID"
# Its lines, from when it was made: an ascending read has no freshness of its own, so the time bounds the search.
launcher="resource.type=\"gce_instance\" AND resource.labels.instance_id=\"$id\" AND logName=\"projects/$CS_PROJECT/logs/confidential-space-launcher\" AND timestamp>=\"$created\""
# The job's own lines, oldest first: each is the API's JSON line, unparsed, in jsonPayload.message (README.md › Logs).
job_lines() {
  cs_gc logging read "$launcher AND jsonPayload.message:\"operator job\"" --order=asc --limit=200 --format=json 2>/dev/null |
    jq -c '.[] | .jsonPayload.message // empty | fromjson? // empty | select((.msg // "") | startswith("operator job"))' 2>/dev/null || true
}

# A TDX VM boots, the launcher pulls the image and attests, about a minute and a half, then the job runs. Confidential Space
# holds the VM two minutes more before it stops, so the job's last line is what's waited for, and the VM's stopping only in
# case that line never comes.
cs_say "waiting for $vm (instance $id): it boots, pulls the image and attests, then the job runs"
deadline=$((SECONDS + 900))
lines=''
while :; do
  sleep 15
  lines="$(job_lines)"
  grep -q '"msg":"operator job done"' <<<"$lines" && break
  status="$(cs_gc compute instances describe "$vm" --zone="$CS_ZONE" --format='value(status)' 2>/dev/null || true)"
  if [[ "$status" == TERMINATED || "$status" == STOPPED ]]; then
    # Its last lines can reach Cloud Logging after it has stopped.
    sleep 30
    lines="$(job_lines)"
    break
  fi
  if ((SECONDS >= deadline)); then
    cs_warn "$vm hasn't finished the job after fifteen minutes"
    break
  fi
done

# The report: one line a step and a check, then how it ended.
jq -r '
  def took: if . == null then "" elif . < 1000 then "\(.) ms" else "\(. / 100 | round / 10) s" end;
  def pad($n): . + (" " * ([$n - length, 0] | max));
  def more: if (. // {}) == {} then "" else "  " + tojson end;
  if .msg == "operator job step" then
    "step   " + (.step | pad(14)) + (if .ok then "ok" else "FAILED (" + ([.errorClass, .code] | map(select(. != null)) | join(" ")) + ")" end) + " in " + (.ms | took) + (.detail | more)
  elif .msg == "operator job check" then
    "check  " + (.check | pad(14)) + (if .ok then "ok" else "FAILED (" + (.code // "unknown") + ")" end) + " in " + (.ms | took) + (.detail | more)
  elif .msg == "operator job done" then
    if .ok then "done: every step and check passed" else "done: \(.failed) failed" + (if .stopped then ", and nothing after \(.stopped) could be taken" else "" end) end
  else empty end' <<<"$lines" >&3

cs_say "the VM's whole log: gcloud --project=$CS_PROJECT logging read '$launcher' --order=asc"
ended="$(jq -r 'select(.msg == "operator job done") | .ok' <<<"$lines" | tail -n 1)"
if [[ -z "$ended" ]]; then
  # The launcher's own lines say why a job never ran: an image that doesn't allow ALCOVE_JOB, say, or a refused attestation.
  cs_warn "the job never said it was done; the launcher's last lines for $vm, oldest first:"
  cs_gc logging read "$launcher AND jsonPayload.MESSAGE:*" --order=desc --limit=20 --format='value(jsonPayload.MESSAGE)' 2>/dev/null |
    awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }' || true
  exit 1
fi
[[ "$ended" == true ]] || exit 1
