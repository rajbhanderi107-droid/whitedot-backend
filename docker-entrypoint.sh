#!/bin/sh
set -e

echo "[entrypoint] applying migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting server..."
exec node dist/index.js
