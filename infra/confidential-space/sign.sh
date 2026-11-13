#!/usr/bin/env bash
# Signs an image with Cloud KMS's alcove-image-signing key, which records the signature in Sigstore's public log (Rekor),
# then checks it the three ways it's used:
#   - the launcher finds it as sha256-<digest>.sig beside the image (cosign v2's layout; v3's referrers it can't find),
#     with the public key and algorithm in the payload's dev.cosignproject.cosign/pub and /sigalg, which Confidential
#     Space reads; the Workload Identity provider then sees our key's id in the token's image_signatures;
#   - cosign verifies it against our public key and Rekor;
#   - Rekor finds it by the SHA-256 of the payload the web app rebuilds (README.md › What's signed), signed by our key.
#
#   infra/confidential-space/sign.sh <image>@sha256:<digest> <commit> [--dry-run]
#
# Needs cosign v2 (the deploy workflow pins v2.6.5), jq, openssl, curl, Application Default Credentials that may sign with
# the key (cosign reaches Cloud KMS through them), and Docker credentials for Artifact Registry.
set -euo pipefail
# shellcheck source=infra/confidential-space/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  printf 'usage: %s <image>@sha256:<digest> <commit> [--dry-run]\n' "$0" >&2
  exit 2
}
image='' commit=''
while (($#)); do
  case "$1" in
    --dry-run) CS_DRY_RUN=true ;;
    -*) usage ;;
    *)
      if [[ -z "$image" ]]; then image="$1"; elif [[ -z "$commit" ]]; then commit="$1"; else usage; fi
      ;;
  esac
  shift
done
[[ -n "$image" && "$commit" =~ ^[0-9a-f]{40}$ ]] || usage
cs_check_image "$image"
cs_require cosign jq openssl curl
version="$(cosign version 2>/dev/null | sed -n 's/^GitVersion:[[:space:]]*//p')"
[[ "$version" == v2.* ]] || cs_die "cosign v2 is needed (found ${version:-none}): v3 stores signatures where the launcher doesn't look"
cs_banner "sign" "$image, commit $commit"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Our public key, in OpenSSL's PEM form, which is exactly what the payload's pub annotation encodes; and only if it's the
# key env.sh trusts.
if cosign public-key --key "$CS_SIGNING_KEY_URI" >"$work/kms.pem" 2>"$work/err"; then
  openssl pkey -pubin -in "$work/kms.pem" -outform PEM >"$work/public.pem"
  key_id="$(openssl pkey -pubin -in "$work/public.pem" -outform DER | openssl sha256 -r | cut -d' ' -f1)"
  [[ "$key_id" == "$CS_SIGNING_KEY_ID" ]] || cs_die "$CS_SIGNING_KEY has key_id $key_id, but env.sh trusts $CS_SIGNING_KEY_ID"
  pub="$(openssl base64 -A <"$work/public.pem" | sed 's/=*$//')"
elif [[ "$CS_DRY_RUN" == true ]]; then
  cs_warn "couldn't read the signing key's public key ($(head -c 200 "$work/err")); showing the commands anyway"
  pub='<base64 of the public key PEM, unpadded>'
else
  cs_die "couldn't read the signing key's public key: $(cat "$work/err")"
fi

# Annotations are signed. commit= is what Rekor maps this image to; pub and sigalg are how Confidential Space checks it.
cs_run cosign sign --yes --key "$CS_SIGNING_KEY_URI" --tlog-upload=true --new-bundle-format=false --use-signing-config=false \
  -a "commit=$commit" -a "dev.cosignproject.cosign/sigalg=$CS_SIGNING_ALGORITHM" -a "dev.cosignproject.cosign/pub=$pub" \
  "$image"

if [[ "$CS_DRY_RUN" == true ]]; then
  cs_say "would check: cosign verify --key <public key> -a commit=$commit $image; the sha256-<digest>.sig payload; Rekor's entry"
  exit 0
fi

cs_say "checking it with cosign, against our key and Rekor"
cosign verify --key "$work/public.pem" -a "commit=$commit" "$image" >/dev/null

# The payload, as cosign v2 writes it (Go's encoding/json, keys in order, no spaces). The web app rebuilds exactly this.
digest="${image#*@}"
payload="$(printf '{"critical":{"identity":{"docker-reference":"%s"},"image":{"docker-manifest-digest":"%s"},"type":"cosign container image signature"},"optional":{"commit":"%s","dev.cosignproject.cosign/pub":"%s","dev.cosignproject.cosign/sigalg":"%s"}}' \
  "$CS_IMAGE_REPO" "$digest" "$commit" "$pub" "$CS_SIGNING_ALGORITHM")"
cs_say "checking the signature beside the image is that payload"
found=false
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  candidate="$(jq -r '.Payload' <<<"$line" | openssl base64 -d -A)"
  if [[ "$candidate" == "$payload" ]]; then
    found=true
    signature="$(jq -r '.Base64Signature' <<<"$line")"
    break
  fi
done < <(cosign download signature "$image")
[[ "$found" == true ]] || cs_die "no signature beside $image has the payload the web app expects (README.md › What's signed)"

cs_say "checking Rekor finds it by the payload's hash, signed by our key"
hash="$(printf '%s' "$payload" | openssl sha256 -r | cut -d' ' -f1)"
uuids='[]'
for _ in 1 2 3 4 5 6 7 8 9 10; do
  uuids="$(curl -fsS -X POST -H 'Content-Type: application/json' --data "{\"hash\":\"sha256:$hash\"}" \
    https://rekor.sigstore.dev/api/v1/index/retrieve)"
  [[ "$(jq 'length' <<<"$uuids")" -gt 0 ]] && break
  sleep 3
done
match=false
for uuid in $(jq -r '.[]' <<<"$uuids"); do
  body="$(curl -fsS "https://rekor.sigstore.dev/api/v1/log/entries/$uuid" | jq -r 'to_entries[0].value.body' | openssl base64 -d -A)"
  [[ "$(jq -r '.spec.data.hash.value' <<<"$body")" == "$hash" ]] || continue
  [[ "$(jq -r '.spec.signature.content' <<<"$body")" == "$signature" ]] || continue
  jq -r '.spec.signature.publicKey.content' <<<"$body" | openssl base64 -d -A >"$work/rekor.pem"
  [[ "$(openssl pkey -pubin -in "$work/rekor.pem" -outform DER | openssl sha256 -r | cut -d' ' -f1)" == "$CS_SIGNING_KEY_ID" ]] || continue
  match=true
  cs_say "Rekor entry $uuid"
  break
done
[[ "$match" == true ]] || cs_die "Rekor has no entry for this payload signed by our key"
cs_say "signed: $image is commit $commit"
