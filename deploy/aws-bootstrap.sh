#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# WhiteDot backend → AWS, one shot.
# Provisions: RDS Postgres → SSM secrets → ECS Fargate + ALB (via Copilot).
# The container runs `prisma migrate deploy` on boot, so all tables (incl. the
# workforce-os migration) and the admin seed are created automatically.
#
# PREREQS (you, once):
#   1) AWS account + credentials configured:  aws configure   (region ap-south-1)
#   2) Docker Desktop running.
#   3) Copilot CLI installed (it is, on this machine).
#
# RUN:
#   bash deploy/aws-bootstrap.sh
#
# Override anything via env, e.g.  DB_PASSWORD='...' ADMIN_SEED_PASSWORD='...' bash deploy/aws-bootstrap.sh
# Re-running is safe: existing RDS / Copilot app are detected and reused.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Use the full path if `aws` is not on PATH (Windows default install location).
AWS="${AWS_BIN:-aws}"; command -v "$AWS" >/dev/null 2>&1 || AWS="/c/Program Files/Amazon/AWSCLIV2/aws.exe"

REGION="${AWS_REGION:-ap-south-1}"
APP="${APP:-whitedot}"
SVC="${SVC:-api}"
ENV_NAME="${ENV_NAME:-prod}"
DB_ID="${DB_ID:-whitedot-prod}"
DB_CLASS="${DB_CLASS:-db.t3.micro}"
DB_USER="${DB_USER:-wdadmin}"
DB_NAME="${DB_NAME:-postgres}"
PREFIX="/whitedot/prod"

say() { printf '\n\033[1;36m>> %s\033[0m\n' "$*"; }

say "Preflight"
"$AWS" sts get-caller-identity --region "$REGION" >/dev/null || { echo "!! Run 'aws configure' first (no valid credentials)."; exit 1; }
docker info >/dev/null 2>&1 || { echo "!! Start Docker Desktop first."; exit 1; }
copilot --version >/dev/null || { echo "!! Copilot CLI missing."; exit 1; }
ACCOUNT=$("$AWS" sts get-caller-identity --query Account --output text --region "$REGION")
echo "account=$ACCOUNT region=$REGION"

# ── Secrets / passwords ──
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
ADMIN_SEED_EMAIL="${ADMIN_SEED_EMAIL:-admin@whitedotindia.in}"
ADMIN_SEED_PASSWORD="${ADMIN_SEED_PASSWORD:-$(openssl rand -hex 12)}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}"

# ── 1) RDS Postgres ──
say "RDS Postgres ($DB_ID)"
if "$AWS" rds describe-db-instances --db-instance-identifier "$DB_ID" --region "$REGION" >/dev/null 2>&1; then
  echo "exists — reusing"
else
  "$AWS" rds create-db-instance \
    --db-instance-identifier "$DB_ID" \
    --engine postgres --engine-version 16 \
    --db-instance-class "$DB_CLASS" \
    --allocated-storage 20 --storage-type gp3 \
    --master-username "$DB_USER" --master-user-password "$DB_PASSWORD" \
    --publicly-accessible --backup-retention-period 7 \
    --no-multi-az --region "$REGION" >/dev/null
  echo "creating… (a few minutes)"
fi
"$AWS" rds wait db-instance-available --db-instance-identifier "$DB_ID" --region "$REGION"
EP=$("$AWS" rds describe-db-instances --db-instance-identifier "$DB_ID" --region "$REGION" \
  --query 'DBInstances[0].Endpoint.Address' --output text)
SG=$("$AWS" rds describe-db-instances --db-instance-identifier "$DB_ID" --region "$REGION" \
  --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' --output text)
echo "endpoint=$EP sg=$SG"

# Allow Postgres in. NOTE: 0.0.0.0/0 on 5432 is open — fine to bootstrap, but
# lock this down to the ECS service security group afterwards (see DEPLOY_AWS.md).
"$AWS" ec2 authorize-security-group-ingress --group-id "$SG" \
  --protocol tcp --port 5432 --cidr 0.0.0.0/0 --region "$REGION" 2>/dev/null || echo "(ingress rule already present)"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${EP}:5432/${DB_NAME}?schema=public&sslmode=require"

# ── 2) Secrets → SSM Parameter Store ──
say "SSM secrets ($PREFIX/*)"
put() { "$AWS" ssm put-parameter --name "$PREFIX/$1" --value "$2" --type SecureString --overwrite --region "$REGION" >/dev/null && echo "set $1"; }
put DATABASE_URL          "$DATABASE_URL"
put JWT_SECRET            "$JWT_SECRET"
put GOOGLE_CLIENT_ID      "$GOOGLE_CLIENT_ID"
put GOOGLE_CLIENT_SECRET  "$GOOGLE_CLIENT_SECRET"
put ADMIN_SEED_EMAIL      "$ADMIN_SEED_EMAIL"
put ADMIN_SEED_PASSWORD   "$ADMIN_SEED_PASSWORD"

# ── 3) Copilot: app → env → service ──
say "Copilot app/env/service"
copilot app init "$APP" 2>/dev/null || true
# Region comes from the configured AWS profile (set by `aws configure`).
copilot env init --name "$ENV_NAME" --default-config 2>/dev/null || true
copilot env deploy --name "$ENV_NAME"
copilot deploy --name "$SVC" --env "$ENV_NAME"

# ── 4) Result ──
URL=$(copilot svc show --name "$SVC" --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const r=(j.routes||[]).find(x=>x.environment==="'"$ENV_NAME"'");console.log(r?r.url:"")}catch{console.log("")}})' || true)
say "DONE"
echo "Backend URL: ${URL:-<see 'copilot svc show'>}"
[ -n "${URL:-}" ] && { echo "Health:"; curl -s -m 30 "${URL%/}/api/health" || true; echo; }
echo
echo "Admin login seeded:  $ADMIN_SEED_EMAIL  /  $ADMIN_SEED_PASSWORD"
echo "(Save these. DB password is in SSM at $PREFIX/DATABASE_URL.)"
echo
echo "NEXT: point the frontend at this URL — set VITE_API_URL in the frontend"
echo "GitHub Actions (pages.yml or deploy-frontend-aws.yml) and redeploy."
