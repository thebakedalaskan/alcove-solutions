#!/usr/bin/env bash
# Points alcove.solutions' names at an environment's load balancer through Cloudflare's API, as DNS-only records (never
# proxied: TLS ends inside the VM, so Cloudflare must pass connections through untouched).
#
#   infra/confidential-space/dns.sh staging [--dry-run]
#       staging.alcove.solutions and api.staging.alcove.solutions: A records for staging's address
#   infra/confidential-space/dns.sh staging --delete [--dry-run]
#       deletes them again, with any CAA record on staging.alcove.solutions, when staging goes
#   infra/confidential-space/dns.sh production [--dry-run]
#       shows what --switch would change, and changes nothing
#   infra/confidential-space/dns.sh production --switch [--dry-run]
#       the apex, www and api: A records for production's address. What they were is saved to a file first
#   infra/confidential-space/dns.sh production --rollback-file <file> [--dry-run]
#       puts back the records that file saved
#   infra/confidential-space/dns.sh <production|staging> caa <ACME account URI> [--dry-run]
#       a CAA record letting only Let's Encrypt, for only that account, issue certificates: on the apex for production
#       (every name under it inherits it), on staging.alcove.solutions for staging
#
# It changes only the address records (A, AAAA, CNAME) of exactly those names, and CAA records: never MX, TXT or any
# other record. Each change is one Cloudflare batch, so a name's old record and its new one swap in one transaction. The
# Cloudflare token, production's alcove-cloudflare-dns-token for either environment (Zone › DNS › Edit and Zone › Zone ›
# Read on the zone), is read from Secret Manager when it runs, and never printed or passed in argv.
set -euo pipefail
# shellcheck source=infra/confidential-space/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  printf 'usage: %s staging [--delete] [--dry-run]\n' "$0" >&2
  printf '       %s production [--switch | --rollback-file <file>] [--dry-run]\n' "$0" >&2
  printf '       %s <production|staging> caa <ACME account URI> [--dry-run]\n' "$0" >&2
  exit 2
}
environment='' mode=show rollback='' account=''
while (($#)); do
  case "$1" in
    --dry-run) CS_DRY_RUN=true ;;
    --switch) mode=switch ;;
    --delete) mode=delete ;;
    --rollback-file) mode=rollback; rollback="${2:-}"; [[ -n "$rollback" ]] || usage; shift ;;
    caa) mode=caa; account="${2:-}"; [[ -n "$account" ]] || usage; shift ;;
    production | staging) environment="$1" ;;
    *) usage ;;
  esac
  shift
done
[[ -n "$environment" ]] || usage
[[ "$mode" != switch && "$mode" != rollback ]] || [[ "$environment" == production ]] || usage
# Production's names only ever move, by --switch and --rollback-file; nothing here deletes them.
[[ "$mode" != delete ]] || [[ "$environment" == staging ]] || usage
cs_require gcloud curl jq
cs_env "$environment"
cs_banner "dns" "$CS_ENV, $mode"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
umask 077
token="$(cs_gc secrets versions access latest --secret="$CS_DNS_TOKEN_SECRET" 2>/dev/null || true)"
[[ -n "$token" ]] || cs_die "couldn't read the Cloudflare token from Secret Manager ($CS_DNS_TOKEN_SECRET)"
printf 'Authorization: Bearer %s\n' "$token" >"$work/auth"
unset token

API="https://api.cloudflare.com/client/v4/zones/$CS_CLOUDFLARE_ZONE"
# A Cloudflare call that only reads.
cf() {
  local out
  out="$(curl -sS -H @"$work/auth" "$API$1")" || cs_die "Cloudflare didn't answer GET $1"
  [[ "$(jq -r '.success' <<<"$out")" == true ]] || cs_die "Cloudflare refused GET $1: $(jq -c '.errors' <<<"$out")"
  printf '%s' "$out"
}
# The one call that changes records: a batch (deletes first, then new records, in one transaction).
cf_batch() {
  local body="$1" out
  if [[ "$CS_DRY_RUN" == true ]]; then
    printf '[dry-run] POST %s/dns_records/batch\n' "$API" >&2
    jq . <<<"$body" >&2
    return 0
  fi
  out="$(curl -sS -X POST -H @"$work/auth" -H 'Content-Type: application/json' --data "$body" "$API/dns_records/batch")" ||
    cs_die "Cloudflare didn't answer the batch"
  [[ "$(jq -r '.success' <<<"$out")" == true ]] || cs_die "Cloudflare refused the batch: $(jq -c '.errors' <<<"$out")"
}
# A, AAAA and CNAME records at exactly these names, as a JSON array.
address_records() {
  local name all='[]'
  for name in "$@"; do
    all="$(jq -c --argjson more "$(cf "/dns_records?name=$name&per_page=100" | jq -c '.result')" '. + $more' <<<"$all")"
  done
  jq -c '[.[] | select(.type == "A" or .type == "AAAA" or .type == "CNAME")
    | {id, type, name, content, ttl, proxied, comment}]' <<<"$all"
}
show_records() { jq -r '.[] | "  \(.name)  \(.type)  \(.content)  ttl \(.ttl)  \(if .proxied then "proxied" else "DNS only" end)"' <<<"$1" >&2; }

address="$(cs_gc compute addresses describe "$CS_ADDRESS" --region="$CS_REGION" --format='value(address)' 2>/dev/null || true)"
if [[ -z "$address" && "$mode" =~ ^(show|switch)$ ]]; then
  [[ "$CS_DRY_RUN" == true ]] || cs_die "$CS_ADDRESS has no address: run setup.sh $CS_ENV first"
  address=203.0.113.10
  cs_warn "couldn't read $CS_ADDRESS; showing the change with $address in its place"
fi

# One batch that leaves each name with a single DNS-only A record for the address, unless it already has exactly that.
point() {
  local current wanted
  current="$(address_records "$@")"
  cs_say "now:"
  show_records "$current"
  wanted="$(jq -cn --arg ip "$address" '$ARGS.positional | map({type: "A", name: ., content: $ip, ttl: 60, proxied: false,
    comment: "Alcove in Confidential Space (infra/confidential-space/dns.sh)"})' --args "$@")"
  if jq -e --argjson wanted "$wanted" '([.[] | {type, name, content, ttl, proxied}] | sort_by(.name))
      == ($wanted | map({type, name, content, ttl, proxied}) | sort_by(.name))' <<<"$current" >/dev/null; then
    cs_say "already pointing at $address: nothing to change"
    return 0
  fi
  cs_say "becomes: $* → $address (A, DNS only, ttl 60)"
  cf_batch "$(jq -cn --argjson current "$current" --argjson wanted "$wanted" '{deletes: ($current | map({id})), posts: $wanted}')"
}

case "$mode" in
  delete)
    current="$(address_records "${CS_HOSTS[@]}")"
    caa="$(cf "/dns_records?name=staging.$CS_DOMAIN&type=CAA&per_page=100" | jq -c '[.result[] | {id}]')"
    cs_say "deletes:"
    show_records "$current"
    cs_say "and $(jq length <<<"$caa") CAA record(s) on staging.$CS_DOMAIN"
    body="$(jq -cn --argjson current "$current" --argjson caa "$caa" '{deletes: (($current | map({id})) + $caa)}')"
    if [[ "$(jq '.deletes | length' <<<"$body")" == 0 ]]; then
      cs_say "nothing to delete"
    else
      cf_batch "$body"
    fi
    ;;
  show)
    if [[ "$CS_ENV" == staging ]]; then
      point "${CS_HOSTS[@]}"
    else
      cs_say "now:"
      show_records "$(address_records "${CS_HOSTS[@]}")"
      cs_say "--switch would make ${CS_HOSTS[*]} DNS-only A records for $address (ttl 60), saving these first"
    fi
    ;;
  switch)
    saved="$PWD/dns-rollback-$CS_ENV-$(date -u +%Y%m%dT%H%M%SZ).json"
    current="$(address_records "${CS_HOSTS[@]}")"
    if [[ "$CS_DRY_RUN" == true ]]; then
      cs_say "would save what's there now to $saved"
    else
      jq . <<<"$current" >"$saved"
      cs_say "saved what's there now to $saved: keep it until the switch is confirmed (--rollback-file puts it back)"
    fi
    point "${CS_HOSTS[@]}"
    ;;
  rollback)
    [[ -f "$rollback" ]] || cs_die "no file $rollback"
    saved="$(jq -c '[.[] | {type, name, content, ttl, proxied, comment}]' "$rollback")"
    mapfile -t names < <(jq -r '[.[].name] | unique | .[]' <<<"$saved")
    ((${#names[@]})) || cs_die "$rollback saves no records"
    for name in "${names[@]}"; do
      [[ " ${CS_HOSTS[*]} " == *" $name "* ]] || cs_die "$rollback names $name, which isn't one of ${CS_HOSTS[*]}"
    done
    current="$(address_records "${names[@]}")"
    cs_say "now:"
    show_records "$current"
    cs_say "puts back:"
    show_records "$saved"
    cf_batch "$(jq -cn --argjson current "$current" --argjson saved "$saved" \
      '{deletes: ($current | map({id})), posts: ($saved | map(if .comment == null then del(.comment) else . end))}')"
    ;;
  caa)
    [[ "$account" =~ ^https://acme-v02\.api\.letsencrypt\.org/acme/acct/[0-9]+$ ]] ||
      cs_die "expected a Let's Encrypt account URI, https://acme-v02.api.letsencrypt.org/acme/acct/<number>"
    if [[ "$CS_ENV" == production ]]; then name="$CS_DOMAIN"; else name="staging.$CS_DOMAIN"; fi
    value="letsencrypt.org; accounturi=$account"
    existing="$(cf "/dns_records?name=$name&type=CAA&per_page=100" | jq -c '[.result[] | {id, tag: .data.tag, value: .data.value}]')"
    if jq -e --arg v "$value" 'any(.[]; .tag == "issue" and .value == $v)' <<<"$existing" >/dev/null; then
      cs_say "$name already has CAA 0 issue \"$value\""
    else
      cs_say "adds CAA 0 issue \"$value\" on $name"
      cf_batch "$(jq -cn --arg name "$name" --arg v "$value" \
        '{posts: [{type: "CAA", name: $name, ttl: 3600, data: {flags: 0, tag: "issue", value: $v},
          comment: "Only our ACME account, only Let'"'"'s Encrypt (infra/confidential-space/dns.sh)"}]}')"
    fi
    others="$(jq -r --arg v "$value" '.[] | select((.tag == "issue" or .tag == "issuewild") and .value != $v) | "  \(.tag) \(.value)"' <<<"$existing")"
    [[ -z "$others" ]] || cs_warn "$name has other CAA records that also allow issuing; delete them for the pin to hold:"$'\n'"$others"
    # What resolvers see. Cloudflare adds CAA records of its own for its certificate authorities, hidden from the
    # dashboard, while Universal SSL is on: then the pin doesn't hold until Universal SSL is turned off for the zone.
    if [[ "$CS_DRY_RUN" != true ]]; then
      sleep 5
      public="$(curl -sS -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?name=$name&type=CAA" |
        jq -r '.Answer[]? | select(.type == 257) | .data')"
      cs_say "resolvers now see for $name:"$'\n'"${public:-  (nothing yet)}"
      stray="$(grep -E '^[0-9]+ issue(wild)? ' <<<"$public" | grep -vF "\"$value\"" || true)"
      [[ -z "$stray" ]] || cs_warn "other CAs may still issue for $name (Cloudflare's own, while Universal SSL is on?):"$'\n'"$stray"
    fi
    ;;
esac
