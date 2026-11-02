#!/usr/bin/env bash
# One-time GCP setup for Alcove. Idempotent: safe to re-run. Requires gcloud logged in as a project owner.
#   PROJECT_ID=alcove-prod REGION=us-central1 GITHUB_REPO=thebakedalaskan/the-privacy-suite ./infra/bootstrap-gcp.sh
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}" "${REGION:?set REGION}" "${GITHUB_REPO:?set GITHUB_REPO (owner/name)}"
SQL_INSTANCE="${SQL_INSTANCE:-alcove-db}"
gcloud config set project "$PROJECT_ID"

echo "› APIs"
gcloud services enable run.googleapis.com sqladmin.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "› Artifact Registry"
gcloud artifacts repositories describe alcove --location "$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create alcove --repository-format docker --location "$REGION"

echo "› Cloud SQL (Postgres 17, D01)"
gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1 || \
  gcloud sql instances create "$SQL_INSTANCE" --database-version POSTGRES_17 --region "$REGION" --tier db-custom-1-3840 \
    --storage-auto-increase --backup --require-ssl
gcloud sql databases describe alcove --instance "$SQL_INSTANCE" >/dev/null 2>&1 || gcloud sql databases create alcove --instance "$SQL_INSTANCE"
if ! gcloud sql users list --instance "$SQL_INSTANCE" --format 'value(name)' | grep -qx alcove; then
  DB_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=')"
  gcloud sql users create alcove --instance "$SQL_INSTANCE" --password "$DB_PASSWORD"
  CONN="$(gcloud sql instances describe "$SQL_INSTANCE" --format 'value(connectionName)')"
  printf 'postgres://alcove:%s@/alcove?host=/cloudsql/%s' "$DB_PASSWORD" "$CONN" | gcloud secrets create alcove-database-url --data-file=- 2>/dev/null || true
fi

echo "› Secrets (values you add once)"
for s in alcove-kservice alcove-near-ai-api-key alcove-objects-access-key alcove-objects-secret-key; do
  gcloud secrets describe "$s" >/dev/null 2>&1 || gcloud secrets create "$s" --replication-policy automatic
done
if ! gcloud secrets versions list alcove-kservice --format 'value(name)' | grep -q .; then
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' | gcloud secrets versions add alcove-kservice --data-file=-
fi

echo "› Service accounts"
gcloud iam service-accounts describe "alcove-api@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || gcloud iam service-accounts create alcove-api --display-name "Alcove API runtime"
gcloud iam service-accounts describe "alcove-deploy@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1 || gcloud iam service-accounts create alcove-deploy --display-name "Alcove GitHub deploys"
RUNTIME="alcove-api@$PROJECT_ID.iam.gserviceaccount.com"; DEPLOY="alcove-deploy@$PROJECT_ID.iam.gserviceaccount.com"
for r in roles/cloudsql.client roles/secretmanager.secretAccessor; do gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$RUNTIME" --role "$r" --condition None >/dev/null; done
for r in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY" --role "$r" --condition None >/dev/null; done

echo "› Workload Identity Federation for GitHub Actions (no keys)"
gcloud iam workload-identity-pools describe github --location global >/dev/null 2>&1 || gcloud iam workload-identity-pools create github --location global --display-name GitHub
gcloud iam workload-identity-pools providers describe github --location global --workload-identity-pool github >/dev/null 2>&1 || \
  gcloud iam workload-identity-pools providers create-oidc github --location global --workload-identity-pool github \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping 'google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref' \
    --attribute-condition "assertion.repository=='$GITHUB_REPO' && assertion.ref=='refs/heads/main'"
NUM="$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO" >/dev/null

cat <<OUT

Done. Add these to GitHub (Settings › Secrets and variables › Actions, environment "production"):
  secret   GCP_WORKLOAD_IDENTITY_PROVIDER = projects/$NUM/locations/global/workloadIdentityPools/github/providers/github
  secret   GCP_DEPLOY_SERVICE_ACCOUNT     = $DEPLOY
  variable GCP_PROJECT_ID                 = $PROJECT_ID
  variable GCP_REGION                     = $REGION
  variable GCP_RUNTIME_SERVICE_ACCOUNT    = $RUNTIME
  variable GCP_CLOUDSQL_INSTANCE          = $(gcloud sql instances describe "$SQL_INSTANCE" --format 'value(connectionName)')
Then add the NEAR AI key and R2 keys:
  printf %s "\$NEAR_AI_API_KEY" | gcloud secrets versions add alcove-near-ai-api-key --data-file=-
  printf %s "\$R2_ACCESS_KEY"   | gcloud secrets versions add alcove-objects-access-key --data-file=-
  printf %s "\$R2_SECRET_KEY"   | gcloud secrets versions add alcove-objects-secret-key --data-file=-
OUT
