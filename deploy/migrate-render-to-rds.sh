#!/usr/bin/env bash
# Migrate Postgres data: Render -> AWS RDS.
# Requires: pg_dump / pg_restore (PostgreSQL 16 client, match RDS major version).
# Usage:
#   SRC_URL="postgresql://...render..." DST_URL="postgresql://...rds..." bash deploy/migrate-render-to-rds.sh
set -euo pipefail

: "${SRC_URL:?set SRC_URL (Render DATABASE_URL, External connection string)}"
: "${DST_URL:?set DST_URL (RDS DATABASE_URL)}"

DUMP="wd-$(date +%Y%m%d-%H%M%S).dump"

echo ">> dumping from Render..."
pg_dump "$SRC_URL" -Fc --no-owner --no-acl -f "$DUMP"
echo ">> dump size: $(du -h "$DUMP" | cut -f1)"

echo ">> restoring into RDS..."
pg_restore --no-owner --no-acl --clean --if-exists -d "$DST_URL" "$DUMP"

echo ">> row-count sanity check (top tables):"
psql "$DST_URL" -c "\
SELECT relname AS table, n_live_tup AS rows \
FROM pg_stat_user_tables \
ORDER BY n_live_tup DESC LIMIT 20;"

echo "done. dump kept at $DUMP (delete after verifying)."
