#!/usr/bin/env bash
# Builds Alcove's image for an environment, from a clean checkout of a commit, and pushes it to Artifact Registry. The
# image holds the API and the web app built for that environment's origins (apps/api/Dockerfile), for linux/amd64, one
# manifest (no attestation index), so its digest is what the launcher pulls, measures and finds signatures for.
#
#   infra/confidential-space/build.sh [production|staging] <commit> [--dry-run]
#
# Prints image=<repository>@sha256:<digest> on stdout (for $GITHUB_OUTPUT), and nothing else there: docker's and
# gcloud's output go to stderr. Docker must be able to push to us-central1-docker.pkg.dev (gcloud auth configure-docker
# us-central1-docker.pkg.dev). Next: sign.sh.
set -euo pipefail
# shellcheck source=infra/confidential-space/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
# The image= line goes to the caller's stdout, kept as fd 3; everything else goes to stderr.
exec 3>&1 1>&2

usage() {
  printf 'usage: %s [production|staging] <commit> [--dry-run]\n' "$0" >&2
  exit 2
}
environment=production commit=''
while (($#)); do
  case "$1" in
    --dry-run) CS_DRY_RUN=true ;;
    production | staging) environment="$1" ;;
    -*) usage ;;
    *) [[ -z "$commit" ]] || usage; commit="$1" ;;
  esac
  shift
done
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || usage
cs_require docker git gcloud
cs_env "$environment"
cs_settings || cs_die "set the values above (README.md › Settings)"
cs_banner "build" "$CS_ENV, commit $commit"

# The image says which commit it is (ALCOVE_COMMIT), and Rekor will say so too: build only that commit, unchanged.
head="$(git -C "$CS_ROOT" rev-parse HEAD)"
[[ "$head" == "$commit" ]] || cs_die "the checkout is at $head, not $commit"
[[ -z "$(git -C "$CS_ROOT" status --porcelain)" ]] || cs_die "the checkout has changes: build from a clean one"

tag="$CS_IMAGE_REPO:$commit"
[[ "$CS_ENV" == production ]] || tag+="-$CS_ENV"
args=(--build-arg "ALCOVE_COMMIT=$commit")
for arg in "${CS_BUILD_ARGS[@]}"; do args+=(--build-arg "$arg"); done
cs_run docker buildx build --platform=linux/amd64 --provenance=false --sbom=false \
  --file="$CS_ROOT/apps/api/Dockerfile" "${args[@]}" --tag="$tag" --push "$CS_ROOT"

if [[ "$CS_DRY_RUN" == true ]]; then
  printf 'image=%s@sha256:<digest of %s>\n' "$CS_IMAGE_REPO" "$tag" >&3
  exit 0
fi
# The registry's own record of what the tag points at.
digest="$(cs_gc artifacts docker images describe "$tag" --format='value(image_summary.digest)')"
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || cs_die "couldn't read $tag's digest from Artifact Registry"
cs_say "pushed $tag"
printf 'image=%s@%s\n' "$CS_IMAGE_REPO" "$digest" >&3
