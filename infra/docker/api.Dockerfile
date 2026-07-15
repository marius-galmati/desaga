# syntax=docker/dockerfile:1

# =============================================================================
# Boca API (NestJS) production image.
#
# Build context = REPO ROOT:  docker build -f infra/docker/api.Dockerfile .
#
# One image, two entrypoints (compose sets `command`):
#   node dist/main.js         -> HTTP API (port 3000, /api/health)
#   node dist/main.worker.js  -> BullMQ "ai-score" worker
#
# apps/api is bundled by tsup to CJS; the @boca/* workspace packages are inlined
# (noExternal /^@boca\//), so the runtime only needs api's EXTERNAL npm deps
# (argon2 + sharp are native). We use a Debian (glibc) base on purpose: sharp's
# and argon2's prebuilt binaries are glibc; Alpine/musl would need the separate
# musl sharp build and an argon2 source compile.
#
# `pnpm deploy --prod` produces a self-contained folder (real node_modules, dev
# deps pruned, native binaries included) that we copy verbatim into the runtime.
# =============================================================================

# ---- base: pnpm via corepack ------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---- deps: install the whole workspace (cached on manifests) ----------------
FROM base AS deps
# node-gyp toolchain: insurance so argon2 compiles from source if no prebuilt
# binary matches this Node/platform (sharp ships its own prebuilt binaries).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Manifests first for a cacheable install layer.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/showcase/package.json apps/showcase/
COPY apps/guest/package.json apps/guest/
COPY apps/staff/package.json apps/staff/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/i18n/package.json packages/i18n/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

# ---- build: tsup bundle + prune to a deployable prod folder ------------------
FROM deps AS build
COPY . .
RUN pnpm --filter @boca/api build
# Self-contained prod tree at /prod/api (dist + pruned node_modules incl. native
# argon2/sharp binaries). --legacy uses the reliable copy-from-store deploy path.
#
# node-linker=hoisted flattens node_modules: tsup inlines @boca/db into main.js,
# which hoists its `require("pg")` / `require("kysely")` to the api package
# root — but pg/kysely are only TRANSITIVE deps (of @boca/db), so pnpm's default
# isolated store leaves them unresolvable from the bundle. Hoisting puts every
# runtime dep at the top level where the bundle can find it.
RUN NPM_CONFIG_NODE_LINKER=hoisted \
  pnpm --filter @boca/api --prod --legacy deploy /prod/api

# ---- runtime: slim, non-root ------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
# curl for the compose/Docker healthcheck.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --create-home --uid 10001 boca
COPY --from=build --chown=boca:boca /prod/api ./
USER boca
EXPOSE 3000
# HTTP-image healthcheck; the worker image overrides/ignores it in compose.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
# Default command = HTTP API; compose overrides for the worker.
CMD ["node", "dist/main.js"]
