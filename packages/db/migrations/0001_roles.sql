-- Up Migration
-- Cluster-level runtime roles (db/schema.sql section 12). schema.sql sketches
-- them commented-out with LOGIN; here they are created NOLOGIN + passwordless
-- and each environment provisions LOGIN users out of band and GRANTs these
-- roles to them (dev compose connects as the `boca` superuser => RLS is
-- bypassed in dev; prod runbook creates LOGIN users that inherit these roles).
-- No BYPASSRLS anywhere, by design.
--   boca_app      NestJS runtime; tenant-scoped via SET LOCAL app.tenant_id.
--                 NOT the table owner, so FORCE RLS applies.
--   boca_worker   BullMQ jobs; narrow cross-tenant policies + column grants.
--   boca_platform platform operators (Bitup); tenant onboarding path. Assumed
--                 via SET ROLE from a dedicated admin connection pool.
-- boca_migrator (schema owner, runs migrations) is NOT created here: it is the
-- connection's login user per environment (dev: `boca`), never a shared role.
-- Cluster-level and idempotent: roles are not database-scoped, so guard with
-- IF NOT EXISTS checks instead of failing on a shared dev cluster.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_app') THEN
    CREATE ROLE boca_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_worker') THEN
    CREATE ROLE boca_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_platform') THEN
    CREATE ROLE boca_platform NOLOGIN;
  END IF;
END
$$;

-- Down Migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_app') THEN
    EXECUTE 'DROP OWNED BY boca_app';
    EXECUTE 'DROP ROLE boca_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_worker') THEN
    EXECUTE 'DROP OWNED BY boca_worker';
    EXECUTE 'DROP ROLE boca_worker';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boca_platform') THEN
    EXECUTE 'DROP OWNED BY boca_platform';
    EXECUTE 'DROP ROLE boca_platform';
  END IF;
END
$$;
