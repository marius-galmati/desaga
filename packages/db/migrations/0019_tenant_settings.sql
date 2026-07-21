-- Up Migration

-- Per-tenant operational settings (quality/AI knobs the tenant admin owns).
-- One optional row per tenant; absent row = app-side defaults.
-- reference_photo_count = how many PRIMARY reference photos the AI compares
-- the pass photo against (REF1..REFn). Default 3, range 1..5. The value is
-- consulted when a reference set is CREATED/activated — already-pinned sets
-- keep the primaries they were approved with (pinning stays reproducible).
CREATE TABLE tenant_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES tenant(id),
  reference_photo_count smallint NOT NULL DEFAULT 3
    CHECK (reference_photo_count BETWEEN 1 AND 5),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- RLS mirrors 0016 tenant_branding: tenant-fenced for boca_app, open for
-- platform onboarding.
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
  FOR ALL TO boca_app
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY platform_all_tenant_settings ON tenant_settings
  FOR ALL TO boca_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings TO boca_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_settings TO boca_platform;

-- Down Migration

DROP TABLE IF EXISTS tenant_settings;
