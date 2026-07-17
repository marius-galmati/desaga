-- Up Migration

-- Complete the documented boca_platform tenant-onboarding path (0013 comment:
-- "TENANT ONBOARDING runs as boca_platform"): creating a tenant also creates
-- its first location + tenant_admin user, so the platform role needs those two
-- tables. tenant / tenant_domain / tenant_branding / platform_admin grants
-- already exist (0013 / 0015 / 0016).
GRANT SELECT, INSERT, UPDATE ON location TO boca_platform;
GRANT SELECT, INSERT, UPDATE ON app_user TO boca_platform;

CREATE POLICY platform_all_locations ON location
  FOR ALL TO boca_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_all_app_users ON app_user
  FOR ALL TO boca_platform USING (true) WITH CHECK (true);

-- Down Migration

DROP POLICY IF EXISTS platform_all_app_users ON app_user;
DROP POLICY IF EXISTS platform_all_locations ON location;
REVOKE SELECT, INSERT, UPDATE ON app_user FROM boca_platform;
REVOKE SELECT, INSERT, UPDATE ON location FROM boca_platform;
