# syntax=docker/dockerfile:1

# =============================================================================
# Boca Next.js apps (admin | showcase) production image, parameterized by APP.
#
# Build context = REPO ROOT:
#   docker build -f infra/docker/next.Dockerfile --build-arg APP=admin    -t boca-admin .
#   docker build -f infra/docker/next.Dockerfile --build-arg APP=showcase -t boca-demo  .
#
# Both apps set `output: "standalone"` in next.config. In a pnpm monorepo Next
# emits a self-contained tree at apps/<APP>/.next/standalone that mirrors the
# workspace layout: the server lives at standalone/apps/<APP>/server.js and its
# traced (pruned) node_modules sit alongside. Static assets and public/ are NOT
# included in standalone and must be copied in next to that server.
# =============================================================================

# ---- base -------------------------------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---- deps -------------------------------------------------------------------
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

# ---- build the target app ---------------------------------------------------
FROM deps AS build
ARG APP
RUN test -n "$APP" || (echo "ERROR: --build-arg APP=admin|showcase is required" && exit 1)
COPY . .
# NEXT_TELEMETRY_DISABLED so the build never phones home from CI/Dokploy.
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js bakes rewrite destinations into routes-manifest.json at BUILD time, so
# API_ORIGIN must be present now (a runtime env is ignored for rewrites). The
# internal Nest service is always reachable at http://api:3000 inside the compose
# network, so that is the correct, stable default.
ARG API_ORIGIN=http://api:3000
ENV API_ORIGIN=${API_ORIGIN}
RUN pnpm --filter @boca/${APP} build
# Neither app ships a public/ dir today; create it so the runtime COPY is
# unconditional (and future assets just work).
RUN mkdir -p apps/${APP}/public

# ---- runtime: minimal standalone server, non-root ---------------------------
FROM node:22-bookworm-slim AS runtime
ARG APP
ENV APP=${APP}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Next standalone server honours HOSTNAME/PORT.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --create-home --uid 10002 boca
# standalone/ already contains the pruned node_modules + apps/<APP>/server.js.
COPY --from=build --chown=boca:boca /repo/apps/${APP}/.next/standalone ./
# Static + public must sit next to the server inside the mirrored layout.
COPY --from=build --chown=boca:boca /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=boca:boca /repo/apps/${APP}/public ./apps/${APP}/public
USER boca
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/ || exit 1
# ${APP} is not expanded inside exec-form CMD, so resolve the server path via a
# shell that reads the APP env baked above.
CMD ["sh", "-c", "node apps/${APP}/server.js"]
