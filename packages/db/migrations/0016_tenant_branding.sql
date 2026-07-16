-- Up Migration

-- Per-tenant brand identity (multi-brand platform). One optional row per
-- tenant; absent row = the app-side neutral defaults. Presentation-only data:
-- the palette is a whitelisted token->hex map validated in the contract layer,
-- and the logo references the tenant's own media library (composite FK).
CREATE TABLE tenant_branding (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id),
  display_name  text,             -- "Restaurantele Desaga by Euphoria"
  tagline       text,             -- "Gust Autentic"
  greeting      text,             -- "No, zîua bună!"
  promise       text,
  locations     text[] NOT NULL DEFAULT '{}',
  logo_media_id uuid,
  palette       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"vin":"#7a2231",...}
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, logo_media_id) REFERENCES media_asset (tenant_id, id)
);

-- RLS mirrors 0013/0015: tenant-fenced for boca_app, open for onboarding.
ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_branding
  FOR ALL TO boca_app
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY platform_all_tenant_branding ON tenant_branding
  FOR ALL TO boca_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_branding TO boca_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_branding TO boca_platform;

-- Down Migration

DROP TABLE IF EXISTS tenant_branding;
