-- Production runtime login roles. Run ONCE, as the Postgres superuser, AFTER
-- migrations (which create the boca_app / boca_worker NOLOGIN roles + RLS).
-- The migrate step in the prod compose runs migrations first, then this file.
--
-- Passwords are injected from the environment via psql variables, e.g.:
--   psql -v app_pwd="$APP_DB_PASSWORD" -v worker_pwd="$WORKER_DB_PASSWORD" \
--        -f infra/db/prod-roles.sql
--
-- The runtime app connects as boca_app_login (RLS enforced), background jobs as
-- boca_worker_login (can SET ROLE boca_worker). Idempotent: re-running resets
-- the passwords. Uses format(%L) so special characters in passwords are safe.

SELECT set_config('boca.app_pwd',    :'app_pwd',    false);
SELECT set_config('boca.worker_pwd', :'worker_pwd', false);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_app_login') THEN
    EXECUTE format('CREATE ROLE boca_app_login LOGIN PASSWORD %L', current_setting('boca.app_pwd'));
  ELSE
    EXECUTE format('ALTER ROLE boca_app_login LOGIN PASSWORD %L', current_setting('boca.app_pwd'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_worker_login') THEN
    EXECUTE format('CREATE ROLE boca_worker_login LOGIN PASSWORD %L', current_setting('boca.worker_pwd'));
  ELSE
    EXECUTE format('ALTER ROLE boca_worker_login LOGIN PASSWORD %L', current_setting('boca.worker_pwd'));
  END IF;
END
$$;

-- Membership -> inherited grants + RLS policies that target boca_app / boca_worker.
GRANT boca_app    TO boca_app_login;
GRANT boca_worker TO boca_worker_login;
