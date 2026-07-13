-- Up Migration
-- ----------------------------------------------------------------------------
-- 12. ROLES & GRANTS + RLS (last migration: references every table above).
-- schema.sql sketches the role bootstrap commented-out; the real, working SQL
-- lives here (roles themselves are created in 0001, NOLOGIN — login users are
-- provisioned per environment and GRANTed these roles).
-- boca_migrator (= the migration connection's login user) owns the schema.
-- boca_app: NestJS runtime, NO BYPASSRLS, NOT the table owner (so FORCE RLS
-- applies).
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO boca_app, boca_worker, boca_platform;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO boca_app;
REVOKE UPDATE, DELETE ON audit_log FROM boca_app;      -- append-only, enforced by grants
-- Partitions are separate tables for grants AND RLS: the blanket grant above
-- reached them, and neither the parent's REVOKE nor the parent's policies
-- apply to direct partition access. Close the append-only bypass by revoking
-- direct partition DML entirely (all access goes through the parent). The
-- partition pre-creation job must repeat this for every new partition.
REVOKE ALL ON audit_log_2026_07, audit_log_2026_08 FROM boca_app;
REVOKE UPDATE ON dish_version, reference_photo, sous_chef_rating FROM boca_app;  -- immutable rows
REVOKE DELETE ON pass_photo, ai_evaluation, coaching_report, guest_feedback FROM boca_app;
-- (hard deletes happen only via the retention worker role, which honors legal_hold)
REVOKE ALL ON platform_admin FROM boca_app;              -- platform table: app must never touch it
REVOKE INSERT, UPDATE, DELETE ON allergen FROM boca_app; -- global seed catalog: app reads only
-- MIGRATION NOTE: keep the runner's bookkeeping table away from the runtime
-- roles (it exists when applied via scripts/migrate.ts; guarded for raw psql).
DO $$
BEGIN
  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON public.schema_migrations FROM boca_app, boca_worker, boca_platform';
  END IF;
END
$$;

-- boca_platform: platform operators (Bitup admin endpoints). NOLOGIN, assumed
-- via SET ROLE from a dedicated admin connection pool. TENANT ONBOARDING runs
-- as boca_platform (row inserts) + the migrator (any DDL): boca_app can NEVER
-- create tenants because the tenant policy's WITH CHECK (id = app.tenant_id)
-- cannot match a not-yet-existing tenant id (chicken-and-egg by design).
GRANT SELECT, INSERT, UPDATE ON tenant TO boca_platform;   -- onboarding + archiving
GRANT ALL ON platform_admin TO boca_platform;

-- boca_worker: BullMQ background jobs (outbox relay, escalation scanner,
-- nightly variance, alert rules, retention purge, weekly drift). These need
-- CROSS-TENANT access, so boca_worker gets its own narrow RLS policies below
-- instead of the app.tenant_id policy. NO BYPASSRLS. Writes are additionally
-- narrowed to exactly the columns each job touches (column-level grants).
-- Partition pre-creation is DDL and runs as the migrator (see 0012 note).
GRANT SELECT ON outbox_event, service_request, service_request_escalation,
                guest_order, pass_photo, ai_evaluation TO boca_worker;
GRANT UPDATE (status, attempts, next_attempt_at, last_error, completed_at)
  ON outbox_event TO boca_worker;                          -- outbox relay
GRANT UPDATE (storage_key, purged_at) ON pass_photo TO boca_worker;  -- purge path ONLY
GRANT UPDATE (status, escalated_at, escalation_level)
  ON service_request TO boca_worker;                       -- escalation scanner
GRANT INSERT ON service_request_escalation, alert, audit_log TO boca_worker;

-- ----------------------------------------------------------------------------
-- RLS: canonical policy
-- Every request/transaction: BEGIN; SET LOCAL app.tenant_id = '<uuid>'; ...; COMMIT;
-- (guest requests too — tenant resolved server-side from the session token).
-- The exact ENABLE + FORCE + policy trio below is applied to EVERY table that
-- carries tenant_id (tenant uses `id =` instead; audit_log is the EXCEPTION:
-- INSERT-only, explicit per-role policies below, no UPDATE/DELETE policies at
-- all). schema.sql writes the trio once for dish with an "applied VERBATIM"
-- comment — expanded here into real statements.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'location','app_user','auth_refresh_token','floor_section','dining_table',
    'table_qr_slug','table_session','session_guest','session_device_token',
    'menu_category','station','dish','dish_version','dish_location_availability',
    'media_asset','shift','shift_roster','station_assignment','section_assignment',
    'guest_order','order_item','outbox_event','service_request',
    'service_request_escalation','alert','capture_device','reference_set',
    'reference_photo','tolerance_profile','pass_photo','ai_evaluation',
    'chef_attribution','sous_chef_rating','dish_go_live_gate','golden_set_member',
    'coaching_report','coaching_report_evidence','guest_feedback'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL TO boca_app '
      || 'USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) '
      || 'WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  END LOOP;
END
$$;

-- tenant: same trio, but keyed on id.
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant
  FOR ALL TO boca_app
  USING      (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- audit_log: INSERT-only for everyone. boca_app writes tenant-scoped rows;
-- NULL-tenant rows (system / platform actors) may come ONLY from boca_worker /
-- boca_platform. No UPDATE/DELETE policies exist at all.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_app ON audit_log
  FOR INSERT TO boca_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY audit_insert_system ON audit_log
  FOR INSERT TO boca_worker, boca_platform
  WITH CHECK (tenant_id IS NOT NULL OR actor_type IN ('system','platform_admin'));

-- --- RLS: worker & platform policies ----------------------------------------
-- boca_worker sees ALL tenants, but only on the tables its jobs touch; writes
-- are further narrowed by the column-level grants above.
CREATE POLICY worker_read   ON outbox_event    FOR SELECT TO boca_worker USING (true);
CREATE POLICY worker_update ON outbox_event    FOR UPDATE TO boca_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_read   ON service_request FOR SELECT TO boca_worker USING (true);
CREATE POLICY worker_update ON service_request FOR UPDATE TO boca_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_read   ON service_request_escalation FOR SELECT TO boca_worker USING (true);
CREATE POLICY worker_insert ON service_request_escalation FOR INSERT TO boca_worker WITH CHECK (true);
CREATE POLICY worker_read   ON guest_order     FOR SELECT TO boca_worker USING (true);  -- nightly variance
CREATE POLICY worker_read   ON pass_photo      FOR SELECT TO boca_worker USING (true);  -- retention scan
CREATE POLICY worker_update ON pass_photo      FOR UPDATE TO boca_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_read   ON ai_evaluation   FOR SELECT TO boca_worker USING (true);  -- drift + alert rules
CREATE POLICY worker_insert ON alert           FOR INSERT TO boca_worker WITH CHECK (true);

-- boca_platform: cross-tenant on the tenant table only (onboarding/archiving).
CREATE POLICY platform_all_tenants ON tenant
  FOR ALL TO boca_platform USING (true) WITH CHECK (true);

-- ----------------------------------------------------------------------------
-- SANCTIONED PRE-TENANT PATHS (SECURITY DEFINER, owned by the migrator role —
-- the only sanctioned RLS bypasses). schema.sql specifies the two guest
-- resolvers in prose; implemented here as real functions.
-- ----------------------------------------------------------------------------
-- QR-scan endpoint maps slug -> tenant before SET LOCAL is possible;
-- reads table_qr_slug WHERE revoked_at IS NULL only.
CREATE OR REPLACE FUNCTION resolve_qr_slug(p_slug text)
RETURNS TABLE (tenant_id uuid, location_id uuid, dining_table_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.tenant_id, t.location_id, s.dining_table_id
  FROM table_qr_slug s
  JOIN dining_table t
    ON t.tenant_id = s.tenant_id AND t.id = s.dining_table_id
  WHERE s.slug = p_slug
    AND s.revoked_at IS NULL
    AND t.archived_at IS NULL;
$$;

-- Guest requests carry only the device token; tenant comes from here;
-- reads session_device_token WHERE revoked_at IS NULL AND expires_at > now().
CREATE OR REPLACE FUNCTION resolve_session_token(p_token_hash text)
RETURNS TABLE (tenant_id uuid, table_session_id uuid, session_guest_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.tenant_id, d.table_session_id, d.session_guest_id
  FROM session_device_token d
  WHERE d.token_hash = p_token_hash
    AND d.revoked_at IS NULL
    AND d.expires_at > now();
$$;

-- MIGRATION NOTE (addition vs schema.sql): staff login is also a pre-tenant
-- moment — the tenant slug on the login form must resolve to a tenant id
-- before SET LOCAL app.tenant_id is possible. Same narrow SECURITY DEFINER
-- pattern as the two guest paths above.
CREATE OR REPLACE FUNCTION resolve_tenant_slug(p_slug text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id
  FROM tenant t
  WHERE t.slug = p_slug::citext   -- ::citext cast: without it the comparison degrades to case-sensitive text
    AND t.archived_at IS NULL;
$$;

REVOKE ALL ON FUNCTION resolve_qr_slug(text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_session_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_tenant_slug(text)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_qr_slug(text)       TO boca_app;
GRANT EXECUTE ON FUNCTION resolve_session_token(text) TO boca_app;
GRANT EXECUTE ON FUNCTION resolve_tenant_slug(text)   TO boca_app;

-- Down Migration
DROP FUNCTION IF EXISTS resolve_tenant_slug(text);
DROP FUNCTION IF EXISTS resolve_session_token(text);
DROP FUNCTION IF EXISTS resolve_qr_slug(text);

DROP POLICY IF EXISTS platform_all_tenants ON tenant;
DROP POLICY IF EXISTS worker_insert ON alert;
DROP POLICY IF EXISTS worker_read   ON ai_evaluation;
DROP POLICY IF EXISTS worker_update ON pass_photo;
DROP POLICY IF EXISTS worker_read   ON pass_photo;
DROP POLICY IF EXISTS worker_read   ON guest_order;
DROP POLICY IF EXISTS worker_insert ON service_request_escalation;
DROP POLICY IF EXISTS worker_read   ON service_request_escalation;
DROP POLICY IF EXISTS worker_update ON service_request;
DROP POLICY IF EXISTS worker_read   ON service_request;
DROP POLICY IF EXISTS worker_update ON outbox_event;
DROP POLICY IF EXISTS worker_read   ON outbox_event;

DROP POLICY IF EXISTS audit_insert_system ON audit_log;
DROP POLICY IF EXISTS audit_insert_app ON audit_log;
ALTER TABLE audit_log NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant;
ALTER TABLE tenant NO FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant DISABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'location','app_user','auth_refresh_token','floor_section','dining_table',
    'table_qr_slug','table_session','session_guest','session_device_token',
    'menu_category','station','dish','dish_version','dish_location_availability',
    'media_asset','shift','shift_roster','station_assignment','section_assignment',
    'guest_order','order_item','outbox_event','service_request',
    'service_request_escalation','alert','capture_device','reference_set',
    'reference_photo','tolerance_profile','pass_photo','ai_evaluation',
    'chef_attribution','sous_chef_rating','dish_go_live_gate','golden_set_member',
    'coaching_report','coaching_report_evidence','guest_feedback'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM boca_app, boca_worker, boca_platform;
REVOKE USAGE ON SCHEMA public FROM boca_app, boca_worker, boca_platform;
