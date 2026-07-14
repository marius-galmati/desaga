#!/usr/bin/env bash
# One-shot migrate + role provisioning for the Boca prod stack.
#
# Env (set by docker-compose.prod.yml, superuser connection):
#   DATABASE_URL         postgres://boca:<POSTGRES_PASSWORD>@postgres:5432/boca
#   APP_DB_PASSWORD      password for boca_app_login   (RLS-enforced app role)
#   WORKER_DB_PASSWORD   password for boca_worker_login (background jobs)
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL (superuser) is required}"
: "${APP_DB_PASSWORD:?APP_DB_PASSWORD is required}"
: "${WORKER_DB_PASSWORD:?WORKER_DB_PASSWORD is required}"

echo "==> [1/2] applying SQL migrations"
# migrate.ts reads DATABASE_URL from the environment directly.
pnpm --filter @boca/db exec tsx scripts/migrate.ts up

echo "==> [2/2] provisioning RLS login roles"
# prod-roles.sql quotes both passwords with format(%L), so special characters
# are safe. ON_ERROR_STOP makes any SQL error fail the job (compose sees non-0).
psql "${DATABASE_URL}" \
  --set=ON_ERROR_STOP=1 \
  --set=app_pwd="${APP_DB_PASSWORD}" \
  --set=worker_pwd="${WORKER_DB_PASSWORD}" \
  -f infra/db/prod-roles.sql

echo "==> migrate job complete"
