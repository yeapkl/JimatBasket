#!/usr/bin/env bash
# One-time GCP setup for JimatBasket CI/CD (GitHub Actions -> Cloud Run).
# Keyless: GitHub authenticates with Workload Identity Federation, so no JSON
# service-account keys are created or stored anywhere.
#
# Safe to run in a project that already hosts other apps: everything it
# creates is named for JimatBasket, and the deployer can only touch the
# JimatBasket Cloud Run service (not your other services).
#
# Run in Cloud Shell as a user with Owner on the project, or with the admin
# roles listed in README.md ("Deploy to Google Cloud").
set -euo pipefail

# ---- edit these ------------------------------------------------------------
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"  # your existing project
REGION="asia-southeast1"          # Singapore, closest to Malaysia
GITHUB_REPO="yeapkl/JimatBasket"  # owner/repo, exact case
DEPLOY_BRANCH="main"
SERVICE="jimatbasket"
AR_REPO="jimatbasket"
POOL="github"                     # reused if your other project already has it
PROVIDER="jimatbasket-repo"
DEPLOY_SA_NAME="gh-deployer"
RUNTIME_SA_NAME="jimatbasket-run"
# ----------------------------------------------------------------------------

[ -n "$PROJECT_ID" ] || { echo "Set PROJECT_ID (e.g. PROJECT_ID=my-project bash $0)"; exit 1; }
echo "Using project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
exists() { "$@" >/dev/null 2>&1; }

echo "==> Enabling APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com

echo "==> Artifact Registry repo"
exists gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" ||
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker --location "$REGION" \
    --description "JimatBasket container images"

# keep storage costs down: keep the 10 newest images, delete the rest
POLICY=$(mktemp)
cat > "$POLICY" <<'JSON'
[
  {"name": "keep-10-newest", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 10}},
  {"name": "delete-older", "action": {"type": "Delete"}, "condition": {"tagState": "any", "olderThan": "7d"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" \
  --location "$REGION" --policy "$POLICY" --no-dry-run
rm -f "$POLICY"

echo "==> Service accounts"
exists gcloud iam service-accounts describe "$DEPLOY_SA" ||
  gcloud iam service-accounts create "$DEPLOY_SA_NAME" --display-name "GitHub Actions deployer (JimatBasket)"
# runtime identity for the Cloud Run service: gets NO roles (the site
# only serves static files and needs no Google APIs)
exists gcloud iam service-accounts describe "$RUNTIME_SA" ||
  gcloud iam service-accounts create "$RUNTIME_SA_NAME" --display-name "JimatBasket Cloud Run runtime"

echo "==> Cloud Run service (placeholder until the first pipeline run)"
# Created up front so the deployer can be scoped to THIS service only.
exists gcloud run services describe "$SERVICE" --region "$REGION" ||
  gcloud run deploy "$SERVICE" --region "$REGION" \
    --image us-docker.pkg.dev/cloudrun/container/hello \
    --service-account "$RUNTIME_SA" --no-allow-unauthenticated --quiet

echo "==> Deployer permissions (least privilege, JimatBasket resources only)"
# deploy new revisions of this one service (not your other services)
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/run.developer >/dev/null
# push images, only to this one repository
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/artifactregistry.writer >/dev/null
# allow deploying a service that runs as the runtime SA (and only that SA)
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member "serviceAccount:${DEPLOY_SA}" --role roles/iam.serviceAccountUser >/dev/null

echo "==> Public access (anyone can open the website)"
PUBLIC_OK=yes
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member allUsers --role roles/run.invoker >/dev/null || PUBLIC_OK=no

echo "==> Workload Identity Federation (GitHub OIDC)"
exists gcloud iam workload-identity-pools describe "$POOL" --location global ||
  gcloud iam workload-identity-pools create "$POOL" --location global --display-name "GitHub Actions"

exists gcloud iam workload-identity-pools providers describe "$PROVIDER" --location global --workload-identity-pool "$POOL" ||
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location global --workload-identity-pool "$POOL" \
    --display-name "JimatBasket repo" \
    --issuer-uri "https://token.actions.githubusercontent.com" \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository=='${GITHUB_REPO}' && assertion.ref=='refs/heads/${DEPLOY_BRANCH}'"

# only this repo (and, via the condition above, only its deploy branch)
# may impersonate the deployer
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}" >/dev/null

WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

cat <<OUT

Done. Add these as GitHub repository VARIABLES
(Settings -> Secrets and variables -> Actions -> Variables tab). None are secret.

  GCP_PROJECT_ID     = ${PROJECT_ID}
  GCP_REGION         = ${REGION}
  CLOUD_RUN_SERVICE  = ${SERVICE}
  GCP_AR_REPO        = ${AR_REPO}
  GCP_WIF_PROVIDER   = ${WIF_PROVIDER}
  GCP_DEPLOY_SA      = ${DEPLOY_SA}
  GCP_RUNTIME_SA     = ${RUNTIME_SA}

Site URL: $(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
OUT
if [ "$PUBLIC_OK" = no ]; then
  cat <<'WARN'
WARNING: could not make the service public. Your organization probably has the
"Domain restricted sharing" policy (iam.allowedPolicyMemberDomains). Ask an org
admin to allow allUsers for this project, then re-run this script.
WARN
fi
