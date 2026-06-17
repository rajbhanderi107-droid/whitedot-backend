#!/usr/bin/env bash
# One-time: push backend secrets into SSM Parameter Store (SecureString).
# Copilot manifest references these by path. Run once per environment.
# Usage: AWS_PROFILE=whitedot bash deploy/secrets.sh
set -euo pipefail

REGION="${AWS_REGION:-ap-south-1}"
PREFIX="/whitedot/prod"

put() {
  local name="$1" value="$2"
  aws ssm put-parameter \
    --name "$PREFIX/$name" \
    --value "$value" \
    --type SecureString \
    --overwrite \
    --region "$REGION" >/dev/null
  echo "set $PREFIX/$name"
}

# Fill these in before running. DATABASE_URL = the RDS connection string.
put DATABASE_URL          "${DATABASE_URL:?set DATABASE_URL}"
put JWT_SECRET            "${JWT_SECRET:?set JWT_SECRET}"
put GOOGLE_CLIENT_ID      "${GOOGLE_CLIENT_ID:-}"
put GOOGLE_CLIENT_SECRET  "${GOOGLE_CLIENT_SECRET:-}"
put ADMIN_SEED_EMAIL      "${ADMIN_SEED_EMAIL:-admin@whitedot.in}"
put ADMIN_SEED_PASSWORD   "${ADMIN_SEED_PASSWORD:?set ADMIN_SEED_PASSWORD}"

echo "done."
