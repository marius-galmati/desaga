-- Up Migration
-- ----------------------------------------------------------------------------
-- 4. MENU: CATEGORIES, STATIONS, DISHES (IMMUTABLE VERSIONS), AVAILABILITY
-- ----------------------------------------------------------------------------
CREATE TABLE menu_category (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  name        jsonb NOT NULL CHECK (name ?& ARRAY['ro','en']),   -- {"ro":..., "en":...}
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, id)
);

-- Tenant-level kitchen station catalog ("grill", "garde manger"); physical
-- staffing per venue happens via station_assignment at shift start.
CREATE TABLE station (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  code        text NOT NULL,
  name        jsonb NOT NULL CHECK (name ?& ARRAY['ro','en']),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

-- Global EU-14 lookup (seeded below), NOT tenant-scoped; dish_version stores codes.
CREATE TABLE allergen (
  code text PRIMARY KEY,                       -- 'gluten','crustaceans',...
  name jsonb NOT NULL CHECK (name ?& ARRAY['ro','en'])
);

CREATE TABLE dish (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  menu_category_id   uuid NOT NULL,
  current_version_id uuid,                     -- FK added below (circular)
  -- HARD STALENESS RULE: true unless an ACTIVE reference_set is bound to
  -- current_version_id. Maintained by trg_refs_stale; read by the eval enqueuer.
  refs_stale         boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,              -- soft delete
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, menu_category_id) REFERENCES menu_category (tenant_id, id)
);
CREATE INDEX ix_dish_tenant_category ON dish (tenant_id, menu_category_id) WHERE archived_at IS NULL;

-- IMMUTABLE: never UPDATE; every edit inserts a new version and repoints
-- dish.current_version_id. order_item pins dish_version_id => prices navigable forever.
CREATE TABLE dish_version (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  dish_id        uuid NOT NULL,
  version_no     integer NOT NULL,
  name           jsonb NOT NULL CHECK (name ?& ARRAY['ro','en']),
  description    jsonb,                        -- bilingual
  story          jsonb,                        -- bilingual dish story
  allergen_codes text[] NOT NULL DEFAULT '{}', -- values from allergen.code (trigger-validated, t6)
  price_minor    integer NOT NULL CHECK (price_minor >= 0),   -- RON bani
  vat_rate_bp    smallint NOT NULL CHECK (vat_rate_bp >= 0),  -- basis points
  hero_photo_key text,                         -- MinIO key
  station_id     uuid NOT NULL,                -- dish -> station mapping
  non_scoreable  boolean NOT NULL DEFAULT false, -- tableside-finished dishes
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dish_id, version_no),
  FOREIGN KEY (tenant_id, dish_id)    REFERENCES dish     (tenant_id, id),
  FOREIGN KEY (tenant_id, station_id) REFERENCES station  (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app_user (tenant_id, id)
);
ALTER TABLE dish ADD CONSTRAINT fk_dish_current_version
  FOREIGN KEY (tenant_id, current_version_id) REFERENCES dish_version (tenant_id, id);

-- 86ing is per venue (catalog is tenant-level, availability is location-level).
-- Every 86 toggle ALSO emits an audit_log row (who/when/old/new) — see t4.
CREATE TABLE dish_location_availability (
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  dish_id     uuid NOT NULL,
  location_id uuid NOT NULL,
  is_86ed     boolean NOT NULL DEFAULT false,
  changed_by  uuid,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, dish_id, location_id),
  FOREIGN KEY (tenant_id, dish_id)     REFERENCES dish     (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES location (tenant_id, id),
  FOREIGN KEY (tenant_id, changed_by)  REFERENCES app_user (tenant_id, id)
);

-- Admin CMS photo library index (files live in MinIO; DB stores keys only).
CREATE TABLE media_asset (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  storage_key  text NOT NULL UNIQUE,           -- tenant/{t}/library/...
  content_type text NOT NULL,
  byte_size    integer,
  width        integer,
  height       integer,
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app_user (tenant_id, id)
);

-- t1. set_updated_at
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON menu_category
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON station
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON dish
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- SEED: EU-14 allergen catalog (global, read-only for boca_app; grants in 0013).
INSERT INTO allergen (code, name) VALUES
  ('gluten',      '{"ro": "Gluten", "en": "Gluten"}'),
  ('crustaceans', '{"ro": "Crustacee", "en": "Crustaceans"}'),
  ('eggs',        '{"ro": "Ouă", "en": "Eggs"}'),
  ('fish',        '{"ro": "Pește", "en": "Fish"}'),
  ('peanuts',     '{"ro": "Arahide", "en": "Peanuts"}'),
  ('soybeans',    '{"ro": "Soia", "en": "Soybeans"}'),
  ('milk',        '{"ro": "Lapte", "en": "Milk"}'),
  ('nuts',        '{"ro": "Fructe cu coajă lemnoasă", "en": "Tree nuts"}'),
  ('celery',      '{"ro": "Țelină", "en": "Celery"}'),
  ('mustard',     '{"ro": "Muștar", "en": "Mustard"}'),
  ('sesame',      '{"ro": "Susan", "en": "Sesame"}'),
  ('sulphites',   '{"ro": "Dioxid de sulf și sulfiți", "en": "Sulphur dioxide and sulphites"}'),
  ('lupin',       '{"ro": "Lupin", "en": "Lupin"}'),
  ('molluscs',    '{"ro": "Moluște", "en": "Molluscs"}');

-- Down Migration
DROP TABLE IF EXISTS media_asset;
DROP TABLE IF EXISTS dish_location_availability;
ALTER TABLE dish DROP CONSTRAINT IF EXISTS fk_dish_current_version;
DROP TABLE IF EXISTS dish_version;
DROP TABLE IF EXISTS dish;
DROP TABLE IF EXISTS allergen;
DROP TABLE IF EXISTS station;
DROP TABLE IF EXISTS menu_category;
