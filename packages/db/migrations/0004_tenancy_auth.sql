-- Up Migration
-- ----------------------------------------------------------------------------
-- 2. TENANCY & AUTH
-- ----------------------------------------------------------------------------
CREATE TABLE tenant (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug         citext NOT NULL UNIQUE,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz
);
-- RLS: USING (id = current_setting('app.tenant_id')::uuid) — see 0013.

-- Platform operators (Bitup) — deliberately OUTSIDE the tenant model so
-- tenant_id can stay NOT NULL on all tenant-scoped tables. Only reachable via
-- the boca_platform DB role / dedicated admin endpoints.
CREATE TABLE platform_admin (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email         citext NOT NULL UNIQUE,
  password_hash text NOT NULL,               -- argon2id
  full_name     text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE location (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  name        text NOT NULL,
  timezone    text NOT NULL DEFAULT 'Europe/Bucharest',
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, id)                      -- << composite-FK anchor pattern
);
CREATE INDEX ix_location_tenant ON location (tenant_id);
-- RLS: standard tenant policy (see 0013)

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  location_id   uuid,                          -- home venue (nullable: tenant-wide staff)
  role          user_role NOT NULL,
  email         citext NOT NULL,
  password_hash text NOT NULL,                 -- argon2id
  full_name     text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email),
  FOREIGN KEY (tenant_id, location_id) REFERENCES location (tenant_id, id)
);
CREATE INDEX ix_app_user_tenant_role ON app_user (tenant_id, role) WHERE is_active;

CREATE TABLE auth_refresh_token (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  user_id    uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,             -- sha256 of opaque token
  issued_ip  inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id)
);
CREATE INDEX ix_refresh_token_tenant_user ON auth_refresh_token (tenant_id, user_id) WHERE revoked_at IS NULL;

-- t1. set_updated_at
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON tenant
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON location
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS auth_refresh_token;
DROP TABLE IF EXISTS app_user;
DROP TABLE IF EXISTS location;
DROP TABLE IF EXISTS platform_admin;
DROP TABLE IF EXISTS tenant;
