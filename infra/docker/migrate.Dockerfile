# syntax=docker/dockerfile:1

# =============================================================================
# Boca DB migrate + role-provisioning image (one-shot job).
#
# Build context = REPO ROOT:  docker build -f infra/docker/migrate.Dockerfile .
#
# Runs, in order, as the Postgres SUPERUSER (DATABASE_URL):
#   1. tsx packages/db/scripts/migrate.ts up   -> apply pending SQL migrations
#      (migration 0001 creates the boca_app / boca_worker NOLOGIN roles + RLS)
#   2. psql -f infra/db/prod-roles.sql          -> create/refresh the LOGIN roles
#      boca_app_login / boca_worker_login from APP_DB_PASSWORD / WORKER_DB_PASSWORD
#
# Kept intentionally simple: it carries the full pnpm workspace install (so tsx +
# pg + the migration runner resolve) plus the Debian postgresql-client for psql.
# =============================================================================

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/showcase/package.json apps/showcase/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

# Runtime = the installed workspace + psql. No separate slimming stage: this is a
# short-lived job, and it needs tsx (dev dep) to run the TS migration runner.
FROM deps AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
# Only the bits the job touches (migrations, runner, prod-roles.sql). apps/api is
# copied too so the optional one-off `seed` service (docker-compose.prod.yml,
# profile: seed) can run scripts/seed-desaga.ts to bootstrap the first tenant +
# admin. Its argon2/tsx deps are already installed in the `deps` stage.
COPY packages/db ./packages/db
COPY packages/config ./packages/config
COPY apps/api ./apps/api
COPY infra/db/prod-roles.sql ./infra/db/prod-roles.sql
COPY infra/docker/migrate-entrypoint.sh /usr/local/bin/migrate-entrypoint.sh
RUN chmod +x /usr/local/bin/migrate-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/migrate-entrypoint.sh"]
