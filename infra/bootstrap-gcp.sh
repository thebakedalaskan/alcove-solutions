#!/usr/bin/env bash
# One-time GCP setup for Alcove. Safe to re-run; requires gcloud, Node and openssl.
# Uses the caller's gcloud configuration without changing its default project.
#   CLOUDSDK_ACTIVE_CONFIG_NAME=alcove PROJECT_ID=alcove-solutions REGION=us-central1 \
#     GITHUB_REPO=thebakedalaskan/the-privacy-suite ./infra/bootstrap-gcp.sh
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}" "${REGION:?set REGION}" "${GITHUB_REPO:?set GITHUB_REPO (owner/name)}"
SQL_INSTANCE="${SQL_INSTANCE:-alcove-db}"
if [[ "$GITHUB_REPO" == thebakedalaskan/the-privacy-suite ]]; then
  GITHUB_REPOSITORY_ID="${GITHUB_REPOSITORY_ID:-1442472668}"
  GITHUB_REPOSITORY_OWNER_ID="${GITHUB_REPOSITORY_OWNER_ID:-280182442}"
fi
: "${GITHUB_REPOSITORY_ID:?set the immutable GitHub repository ID}" "${GITHUB_REPOSITORY_OWNER_ID:?set the immutable GitHub owner ID}"
gcp() { gcloud --project="$PROJECT_ID" "$@"; }
gcp_iam() {
  local attempt delay=2
  for attempt in 1 2 3 4 5 6; do
    if gcp "$@"; then return 0; fi
    if [[ "$attempt" == 6 ]]; then
      echo 'IAM policy binding failed after six attempts.' >&2
      return 1
    fi
    echo "Waiting ${delay}s for IAM propagation before retrying policy binding." >&2
    sleep "$delay"
    delay=$((delay * 2))
  done
}
ensure_secret() {
  gcp secrets describe "$1" >/dev/null 2>&1 || gcp secrets create "$1" --replication-policy automatic
}
latest_secret_version() {
  gcp secrets versions list "$1" --sort-by='~createTime' --limit=1 --format='value(name)'
}
backups_configured() {
  node -e '
    const fs = require("node:fs");
    const config = JSON.parse(fs.readFileSync(0, "utf8")).settings?.backupConfiguration;
    process.exit(config?.enabled === true && config.startTime === "03:00" && config.pointInTimeRecoveryEnabled === true && Number(config.backupRetentionSettings?.retainedBackups) === 7 ? 0 : 1);
  '
}

echo "› APIs"
gcp services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "› Artifact Registry"
gcp artifacts repositories describe alcove --location "$REGION" >/dev/null 2>&1 || \
  gcp artifacts repositories create alcove --repository-format docker --location "$REGION"

echo "› Cloud SQL (Postgres 17, D01)"
gcp sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcp sql instances create "$SQL_INSTANCE" --database-version POSTGRES_17 --edition enterprise --region "$REGION" --cpu 1 --memory 3840MB \
    --storage-auto-increase --backup-start-time 03:00 --enable-point-in-time-recovery --retained-backups-count 7 --require-ssl
# --backup alone does not send an enabled backup configuration in some gcloud versions.
BACKUP_SETTINGS="$(gcp sql instances describe "$SQL_INSTANCE" --format='json(settings.backupConfiguration)')"
if ! printf '%s' "$BACKUP_SETTINGS" | backups_configured; then
  gcp sql instances patch "$SQL_INSTANCE" --backup-start-time 03:00 --enable-point-in-time-recovery --retained-backups-count 7 --quiet
  BACKUP_SETTINGS="$(gcp sql instances describe "$SQL_INSTANCE" --format='json(settings.backupConfiguration)')"
fi
if ! printf '%s' "$BACKUP_SETTINGS" | backups_configured; then
  echo 'Cloud SQL must have daily backups at 03:00 UTC, point-in-time recovery, and seven retained backups before setup can continue.' >&2
  exit 1
fi
unset BACKUP_SETTINGS
gcp sql databases describe alcove --instance "$SQL_INSTANCE" >/dev/null 2>&1 || gcp sql databases create alcove --instance "$SQL_INSTANCE"
CONN="$(gcp sql instances describe "$SQL_INSTANCE" --format 'value(connectionName)')"
SQL_USERS="$(gcp sql users list --instance "$SQL_INSTANCE" --format='value(name)')"
USER_EXISTS=false
if grep -qx alcove <<< "$SQL_USERS"; then USER_EXISTS=true; fi
ensure_secret alcove-database-url
DB_VERSION="$(latest_secret_version alcove-database-url)"
if [[ -n "$DB_VERSION" ]]; then
  DB_URL="$(gcp secrets versions access "$DB_VERSION" --secret=alcove-database-url)"
  # Repair the original empty-host URL while retaining its existing password.
  NORMALIZED_DB_URL="${DB_URL/@\/alcove/@localhost\/alcove}"
  DB_PASSWORD="$(printf '%s' "$NORMALIZED_DB_URL" | node -e '
    const fs = require("node:fs");
    try {
      const url = new URL(fs.readFileSync(0, "utf8"));
      if (url.protocol !== "postgres:" || url.username !== "alcove" || url.pathname !== "/alcove" || url.searchParams.get("host") !== "/cloudsql/" + process.argv[1] || !url.password) throw new Error();
      process.stdout.write(decodeURIComponent(url.password));
    } catch {
      process.stderr.write("The database secret does not match this Cloud SQL instance. No password was changed.\n");
      process.exit(1);
    }
  ' "$CONN")"
  if [[ "$DB_URL" != "$NORMALIZED_DB_URL" ]]; then
    printf '%s' "$NORMALIZED_DB_URL" | gcp secrets versions add alcove-database-url --data-file=-
  fi
else
  if [[ "$USER_EXISTS" == true && -z "${ALCOVE_DB_PASSWORD:-}" ]]; then
    echo 'Database user alcove exists without a usable secret. Set ALCOVE_DB_PASSWORD to its current password to restore the secret. No password was changed.' >&2
    exit 1
  fi
  DB_PASSWORD="${ALCOVE_DB_PASSWORD:-$(openssl rand -base64 30 | tr -d '/+=')}"
  DB_URL="$(printf '%s' "$DB_PASSWORD" | node -e '
    const fs = require("node:fs");
    const url = new URL("postgres://alcove@localhost/alcove");
    url.password = fs.readFileSync(0, "utf8");
    url.searchParams.set("host", "/cloudsql/" + process.argv[1]);
    process.stdout.write(url.href);
  ' "$CONN")"
  # Persist the password before creating the user so a failed run can safely resume.
  printf '%s' "$DB_URL" | gcp secrets versions add alcove-database-url --data-file=-
fi
if [[ "$USER_EXISTS" == false ]]; then
  gcp sql users create alcove --instance "$SQL_INSTANCE" --password "$DB_PASSWORD"
fi
unset DB_PASSWORD DB_URL NORMALIZED_DB_URL ALCOVE_DB_PASSWORD

echo "› Secrets (values you add once)"
for s in alcove-kmaster alcove-kservice alcove-near-ai-api-key alcove-objects-access-key alcove-objects-secret-key alcove-google-client-id alcove-google-client-secret alcove-google-signup-testers alcove-livekit-api-key alcove-livekit-api-secret; do
  ensure_secret "$s"
done
# The Cloudflare token the API in Confidential Space orders its certificates with, and dns.sh changes records with.
# Only the attested production VMs read it (infra/confidential-space/setup.sh), never the Cloud Run runtime account.
ensure_secret alcove-cloudflare-dns-token
# The two server keys are generated here once and never rotated by this script: KMASTER wraps every
# account's root key, KSERVICE seals billing state. Losing KMASTER makes every account unreadable.
for key in alcove-kmaster alcove-kservice; do
  KEY_VERSION="$(latest_secret_version "$key")"
  if [[ -z "$KEY_VERSION" ]]; then
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' | gcp secrets versions add "$key" --data-file=-
  elif [[ "$(gcp secrets versions describe "$KEY_VERSION" --secret="$key" --format='value(state)')" != ENABLED ]]; then
    echo "The latest $key version is not enabled. Restore that version explicitly; no key was changed." >&2
    exit 1
  fi
done

echo "› Service accounts"
gcp iam service-accounts describe "alcove-api@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || gcp iam service-accounts create alcove-api --display-name "Alcove API runtime"
gcp iam service-accounts describe "alcove-deploy@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || gcp iam service-accounts create alcove-deploy --display-name "Alcove GitHub deploys"
RUNTIME="alcove-api@$PROJECT_ID.iam.gserviceaccount.com"; DEPLOY="alcove-deploy@$PROJECT_ID.iam.gserviceaccount.com"
gcp_iam projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME" --role roles/cloudsql.client --condition None >/dev/null
for s in alcove-database-url alcove-kmaster alcove-kservice alcove-near-ai-api-key alcove-objects-access-key alcove-objects-secret-key alcove-google-client-id alcove-google-client-secret alcove-google-signup-testers alcove-livekit-api-key alcove-livekit-api-secret; do
  gcp_iam secrets add-iam-policy-binding "$s" --member "serviceAccount:$RUNTIME" --role roles/secretmanager.secretAccessor --condition None >/dev/null
done
# The migration job (Cloud Run). The API itself runs in Confidential Space, whose grants infra/confidential-space/setup.sh makes.
gcp_iam projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY" --role roles/run.developer --condition None >/dev/null
gcp_iam artifacts repositories add-iam-policy-binding alcove --location "$REGION" --member "serviceAccount:$DEPLOY" --role roles/artifactregistry.writer --condition None >/dev/null
gcp_iam iam service-accounts add-iam-policy-binding "$RUNTIME" --member "serviceAccount:$DEPLOY" --role roles/iam.serviceAccountUser --condition None >/dev/null

echo "› Workload Identity Federation for GitHub Actions (no keys)"
gcp iam workload-identity-pools describe github --location global >/dev/null 2>&1 || gcp iam workload-identity-pools create github --location global --display-name GitHub
PROVIDER_ACTION=create-oidc
if gcp iam workload-identity-pools providers describe github --location global --workload-identity-pool github >/dev/null 2>&1; then PROVIDER_ACTION=update-oidc; fi
gcp iam workload-identity-pools providers "$PROVIDER_ACTION" github --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping 'google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref' \
  --attribute-condition "assertion.repository_id=='$GITHUB_REPOSITORY_ID' && assertion.repository_owner_id=='$GITHUB_REPOSITORY_OWNER_ID' && assertion.repository=='$GITHUB_REPO' && assertion.ref=='refs/heads/main' && ((assertion.workflow_ref=='$GITHUB_REPO/.github/workflows/deploy.yml@refs/heads/main' && assertion.event_name in ['workflow_run','workflow_dispatch']) || (assertion.workflow_ref=='$GITHUB_REPO/.github/workflows/refresh.yml@refs/heads/main' && assertion.event_name in ['schedule','workflow_dispatch']))"
NUM="$(gcp projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
gcp_iam iam service-accounts add-iam-policy-binding "$DEPLOY" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository_id/$GITHUB_REPOSITORY_ID" --condition None >/dev/null

cat <<OUT

Done. Add these as GitHub repository variables (Settings › Secrets and variables › Actions):
  variable GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$NUM/locations/global/workloadIdentityPools/github/providers/github
  variable GCP_DEPLOY_SERVICE_ACCOUNT     = $DEPLOY
  variable GCP_PROJECT_ID                 = $PROJECT_ID
  variable GCP_REGION                     = $REGION
  variable GCP_RUNTIME_SERVICE_ACCOUNT    = $RUNTIME
  variable GCP_CLOUDSQL_INSTANCE          = $CONN
  variable NEAR_AI_ENABLED                = false (optional; enable only with a real key)
  variable GOOGLE_AUTH_ENABLED            = false (optional; enable only after Google credential versions exist)
Then add the R2 keys (never print their values):
  printf %s "\$R2_ACCESS_KEY" | gcloud --project="$PROJECT_ID" secrets versions add alcove-objects-access-key --data-file=-
  printf %s "\$R2_SECRET_KEY" | gcloud --project="$PROJECT_ID" secrets versions add alcove-objects-secret-key --data-file=-
Then the LiveKit Cloud project's API key and secret (calls need them), and the GitHub variable
LIVEKIT_URL = wss://<project>.livekit.cloud:
  printf %s "\$LIVEKIT_API_KEY" | gcloud --project="$PROJECT_ID" secrets versions add alcove-livekit-api-key --data-file=-
  printf %s "\$LIVEKIT_API_SECRET" | gcloud --project="$PROJECT_ID" secrets versions add alcove-livekit-api-secret --data-file=-
Optional, once inference is implemented:
  printf %s "\$NEAR_AI_API_KEY" | gcloud --project="$PROJECT_ID" secrets versions add alcove-near-ai-api-key --data-file=-
Optional Google provider credentials and the newline-separated tester roster for invite-only deployments:
  printf %s "\$GOOGLE_CLIENT_ID" | gcloud --project="$PROJECT_ID" secrets versions add alcove-google-client-id --data-file=-
  printf %s "\$GOOGLE_CLIENT_SECRET" | gcloud --project="$PROJECT_ID" secrets versions add alcove-google-client-secret --data-file=-
  gcloud --project="$PROJECT_ID" secrets versions add alcove-google-signup-testers --data-file="\$GOOGLE_SIGNUP_TESTER_FILE"
A Cloudflare API token for the zone, a custom token with Zone › DNS › Edit and Zone › Zone › Read on alcove.solutions
alone (Cloudflare › My Profile › API Tokens), which Confidential Space's setup needs:
  printf %s "\$CLOUDFLARE_DNS_TOKEN" | gcloud --project="$PROJECT_ID" secrets versions add alcove-cloudflare-dns-token --data-file=-
Then set up Confidential Space, where the API and web app run: infra/confidential-space/README.md › First setup.
Set DEPLOY_ENABLED=true as a repository variable only after the remaining infrastructure is configured.
OUT
