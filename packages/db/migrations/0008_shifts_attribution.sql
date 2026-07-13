-- Up Migration
-- ----------------------------------------------------------------------------
-- 5. SHIFTS, ROSTERS, STATION MAP, SECTION ASSIGNMENT
-- ----------------------------------------------------------------------------
CREATE TABLE shift (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  location_id  uuid NOT NULL,
  service_date date NOT NULL,
  label        text NOT NULL DEFAULT 'dinner', -- lunch/dinner/custom
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,
  status       shift_status NOT NULL DEFAULT 'planned',
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),         -- anchor: assignments carry location_id
  UNIQUE (tenant_id, location_id, service_date, label),
  FOREIGN KEY (tenant_id, location_id) REFERENCES location (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by)  REFERENCES app_user (tenant_id, id)
);
CREATE INDEX ix_shift_tenant_loc_date ON shift (tenant_id, location_id, service_date);

CREATE TABLE shift_roster (
  id        uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id uuid NOT NULL REFERENCES tenant(id),
  shift_id  uuid NOT NULL,
  user_id   uuid NOT NULL,
  UNIQUE (tenant_id, shift_id, user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES shift    (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id)  REFERENCES app_user (tenant_id, id)
);

-- Manager sets the station map at shift start; drives dish_station_roster attribution.
CREATE TABLE station_assignment (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  location_id uuid NOT NULL,                   -- denormalized from shift; FK-enforced below
  shift_id    uuid NOT NULL,
  station_id  uuid NOT NULL,
  user_id     uuid NOT NULL,
  assigned_by uuid NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,                     -- mid-shift swaps end the old row
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, shift_id) REFERENCES shift (tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, station_id)  REFERENCES station  (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id)     REFERENCES app_user (tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_by) REFERENCES app_user (tenant_id, id)
);
CREATE INDEX ix_station_assignment_shift ON station_assignment (tenant_id, shift_id) WHERE ended_at IS NULL;

-- Waiter -> floor section, per shift (gap-fill).
CREATE TABLE section_assignment (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  location_id      uuid NOT NULL,              -- denormalized from shift; FK-enforced below
  shift_id         uuid NOT NULL,
  floor_section_id uuid NOT NULL,
  waiter_user_id   uuid NOT NULL,
  UNIQUE (tenant_id, shift_id, floor_section_id, waiter_user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, shift_id)         REFERENCES shift         (tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, location_id, floor_section_id) REFERENCES floor_section (tenant_id, location_id, id),
  FOREIGN KEY (tenant_id, waiter_user_id)   REFERENCES app_user      (tenant_id, id)
);

-- ----------------------------------------------------------------------------
-- 9. CHEF ATTRIBUTION
-- ----------------------------------------------------------------------------
-- Possibly several rows per order_item (station chef + plating chef).
-- Retroactive same-day corrections are plain UPDATEs, captured verbatim by the
-- audit row-trigger (old + new in details JSONB).
-- SELF-CLAIM: a method='self_claim' claim REPLACES the roster-derived row for
-- the same (order_item, role) — the existing row is UPDATEd in place
-- (staff_user_id/method/confidence swapped) and the old values are
-- audit-logged via t4; there are never two live rows for one (item, role).
CREATE TABLE chef_attribution (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  order_item_id uuid NOT NULL,
  staff_user_id uuid NOT NULL,
  role          attribution_role NOT NULL,
  method        attribution_method NOT NULL,
  confidence    numeric(3,2) CHECK (confidence BETWEEN 0 AND 1),
  shift_id      uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, order_item_id, staff_user_id, role),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_item_id) REFERENCES order_item (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_user_id) REFERENCES app_user   (tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id)      REFERENCES shift      (tenant_id, id)
);
CREATE INDEX ix_chef_attribution_tenant_chef ON chef_attribution (tenant_id, staff_user_id, created_at DESC);

-- t1. set_updated_at
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON shift
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON chef_attribution
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS chef_attribution;
DROP TABLE IF EXISTS section_assignment;
DROP TABLE IF EXISTS station_assignment;
DROP TABLE IF EXISTS shift_roster;
DROP TABLE IF EXISTS shift;
