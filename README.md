# Boca

Multi-tenant restaurant operations platform: guest PWA ordering, staff apps, and AI-assisted
plating quality coaching. Source of truth for design decisions: [docs/arhitectura.md](docs/arhitectura.md)
and [db/schema.sql](db/schema.sql).

## Prerequisites

- Node.js >= 24
- pnpm 10.30 (`corepack enable`)
- Docker (Postgres 16, Redis 7, MinIO for local dev)

## Quickstart

```sh
pnpm install
docker compose -f infra/compose/docker-compose.dev.yml up -d
cp infra/env/.env.example .env
pnpm db:migrate                        # applies SQL migrations (node-pg-migrate)
pnpm --filter @boca/api run seed:dev   # tenant "demo" + admin@demo.local / demo-Parola1!
pnpm dev                               # starts apps/api on :3000 (global prefix /api)
curl http://localhost:3000/api/health
```

If port 5432 (or 6379/9000) is already taken on your machine, override the host port:
`BOCA_PG_PORT=55432 docker compose -f infra/compose/docker-compose.dev.yml up -d` and
adjust `DATABASE_URL` in `.env` accordingly.

Other commands: `pnpm typecheck` · `pnpm test` · `pnpm lint` · `pnpm build` ·
`pnpm db:codegen` (regenerates `packages/db/src/generated` from the migrated DB).

## Workspace layout

- `packages/contracts` — single API source of truth (ts-rest + Zod). Depends only on zod.
- `packages/db` — Kysely layer, SQL migrations, `withTenant()` / `asSystem()` transaction
  wrappers (`SET LOCAL app.tenant_id` per transaction, RLS-enforced).
- `packages/config` — tsconfig presets and shared constants.
- `packages/i18n` — RO/EN catalogs (placeholder).
- `apps/api` — NestJS modular monolith. Currently: health, auth (argon2 + JWT access/refresh),
  tenancy, tenant-context plumbing, role guard, audit interceptor skeleton.
- `infra/` — dev docker-compose and env templates.

## Package boundaries

Direction is strictly `apps -> packages`. `packages/db` is importable **only** by `apps/api`
(enforced via Turborepo boundaries tags; run `pnpm boundaries` — experimental feature).
Frontends will consume the system exclusively through `packages/contracts`.

## Dev-only note on RLS

The dev compose connects as the `boca` superuser, which bypasses RLS. Migrations create the
`boca_app` / `boca_worker` / `boca_platform` roles as NOLOGIN; production (and the upcoming
Testcontainers integration tests) connect with LOGIN users granted those roles so RLS is
actually enforced.

## Roadmap

- [x] Monorepo skeleton: contracts, db (migrations + Kysely), api (health/auth/tenancy)
- [ ] `apps/guest-pwa` — Next.js App Router PWA (RO/EN, QR sessions, menu, orders, shared tab)
- [ ] `apps/admin` — Next.js dashboard (menu CMS, photos, staffing, quality, coaching)
- [ ] `apps/staff` — web PWA on Android devices (waiter + pass modes; decision 2026-07-13, spike pending on the real pass device)
- [ ] Orders + transactional outbox, Socket.IO gateway, BullMQ workers (preprocess, ai-score, ...)
- [ ] Testcontainers integration suite (RLS cross-tenant denial, migrations, codegen drift)
- [ ] Prod compose (caddy, images, backup) + deploy workflow
