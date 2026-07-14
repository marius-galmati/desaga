-- Dev RLS-enforcing login roles.
--
-- In dev we normally connect the app as the `boca` superuser, which BYPASSES
-- row-level security — so RLS bugs never surface locally. These two LOGIN roles
-- let the runtime app + worker connect as members of boca_app / boca_worker so
-- RLS is actually enforced in dev, exactly like prod. Migrations and seeds keep
-- using the superuser (they must bypass RLS to bootstrap tenants and own DDL).
--
-- Apply once against the dev database (superuser connection), e.g.:
--   Get-Content infra/db/dev-roles.sql -Raw | docker exec -i boca-dev-postgres-1 psql -U boca -d boca
-- Then set APP_DATABASE_URL / WORKER_DATABASE_URL in .env to these roles.
-- Idempotent. Dev-only credentials.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_app_login') THEN
    CREATE ROLE boca_app_login LOGIN PASSWORD 'boca-app-dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_worker_login') THEN
    CREATE ROLE boca_worker_login LOGIN PASSWORD 'boca-worker-dev';
  END IF;
END
$$;

-- Membership -> inherited table grants (INHERIT is the role default) and RLS
-- policies that target boca_app / boca_worker apply to the member login.
GRANT boca_app    TO boca_app_login;
GRANT boca_worker TO boca_worker_login;
-- asSystem() does SET LOCAL ROLE boca_worker, which requires membership:
-- boca_worker_login is a member of boca_worker (granted above).
