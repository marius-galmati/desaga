-- Up Migration

-- Multi-tenant domain routing: one row per public hostname a tenant serves
-- (guest / admin / staff surface). Domain -> tenant resolution is a PRE-TENANT
-- moment (the request's Host header is all we have, no app.tenant_id yet), so
-- reads go through the SECURITY DEFINER resolve_tenant_domain below — the same
-- sanctioned-bypass pattern as resolve_tenant_slug (0013).
CREATE TABLE tenant_domain (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  domain     citext NOT NULL UNIQUE,          -- bare hostname, no scheme/port
  surface    text NOT NULL CHECK (surface IN ('guest','admin','staff')),
  is_primary boolean NOT NULL DEFAULT true,   -- canonical origin per (tenant, surface)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

-- One canonical origin per surface (e.g. the guest origin QR links print).
CREATE UNIQUE INDEX uq_tenant_domain_primary
  ON tenant_domain (tenant_id, surface) WHERE is_primary;

-- RLS mirrors 0013: tenant-fenced for boca_app, unrestricted for the
-- platform-onboarding role. 0013's blanket GRANT ran before this table
-- existed, so grants are explicit here.
ALTER TABLE tenant_domain ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_domain FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_domain
  FOR ALL TO boca_app
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY platform_all_tenant_domains ON tenant_domain
  FOR ALL TO boca_platform USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_domain TO boca_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_domain TO boca_platform;

-- Host header -> tenant. STABLE SECURITY DEFINER, narrow projection, matches
-- only live tenants; ::citext keeps the lookup case-insensitive.
CREATE OR REPLACE FUNCTION resolve_tenant_domain(p_domain text)
RETURNS TABLE (tenant_id uuid, tenant_slug citext, surface text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.tenant_id, t.slug, d.surface
  FROM tenant_domain d
  JOIN tenant t ON t.id = d.tenant_id
  WHERE d.domain = p_domain::citext
    AND t.archived_at IS NULL;
$$;
REVOKE ALL ON FUNCTION resolve_tenant_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_domain(text) TO boca_app;

-- Down Migration

DROP FUNCTION IF EXISTS resolve_tenant_domain(text);
DROP TABLE IF EXISTS tenant_domain;
