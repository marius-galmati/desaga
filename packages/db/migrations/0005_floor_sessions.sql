-- Up Migration
-- ----------------------------------------------------------------------------
-- 3. FLOOR PLAN, TABLES, QR SLUGS, GUEST SESSIONS
-- ----------------------------------------------------------------------------
CREATE TABLE floor_section (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id),
  location_id uuid NOT NULL,
  name        text NOT NULL,
  layout      jsonb,                           -- floor-plan editor geometry
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),         -- anchor: children carry location_id
  FOREIGN KEY (tenant_id, location_id) REFERENCES location (tenant_id, id)
);
CREATE INDEX ix_floor_section_tenant_loc ON floor_section (tenant_id, location_id);

CREATE TABLE dining_table (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  location_id      uuid NOT NULL,
  floor_section_id uuid NOT NULL,
  label            text NOT NULL,              -- "T12"
  seats            smallint,
  position         jsonb,                      -- x/y on floor plan
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),         -- anchor: children carry location_id
  UNIQUE (tenant_id, location_id, label),
  FOREIGN KEY (tenant_id, location_id)      REFERENCES location      (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, floor_section_id)
    REFERENCES floor_section (tenant_id, location_id, id)  -- section must be at the same venue
);
CREATE INDEX ix_dining_table_tenant_section ON dining_table (tenant_id, floor_section_id);

-- QR slug lifecycle: slugs are replaceable (reprint stickers) without touching
-- the table row. Globally unique because resolution happens BEFORE tenant is
-- known — see resolve_qr_slug() in 0013.
CREATE TABLE table_qr_slug (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  dining_table_id uuid NOT NULL,
  slug            text NOT NULL UNIQUE,        -- unguessable, e.g. 22+ char base58
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      uuid,
  FOREIGN KEY (tenant_id, dining_table_id) REFERENCES dining_table (tenant_id, id),
  FOREIGN KEY (tenant_id, revoked_by)      REFERENCES app_user     (tenant_id, id)
);
CREATE UNIQUE INDEX uq_qr_slug_active_per_table
  ON table_qr_slug (tenant_id, dining_table_id) WHERE revoked_at IS NULL;

-- The shared tab. Guests are NOT users. Session tokens live in
-- session_device_token (ONE PER DEVICE) so a second phone scanning the same QR
-- joins the shared tab instead of being locked out.
CREATE TABLE table_session (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id),
  location_id       uuid NOT NULL,
  dining_table_id   uuid NOT NULL,
  status            table_session_status NOT NULL DEFAULT 'open',
  opened_at         timestamptz NOT NULL DEFAULT now(),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,      -- slid on activity
  bill_requested_at timestamptz,
  closed_at         timestamptz,
  pseudonymized_at  timestamptz,               -- retention hook: guest identities scrubbed in place
  purge_after       timestamptz,               -- retention hook: duration set by specialist
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),        -- anchor: children carry location_id
  FOREIGN KEY (tenant_id, location_id)     REFERENCES location     (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, dining_table_id)
    REFERENCES dining_table (tenant_id, location_id, id)  -- table must be at the session's venue
);
CREATE UNIQUE INDEX uq_open_session_per_table
  ON table_session (tenant_id, dining_table_id) WHERE status IN ('open','bill_requested');
CREATE INDEX ix_table_session_tenant_loc_status ON table_session (tenant_id, location_id, status);

-- Per-device guest identity (name/emoji) within a shared tab.
CREATE TABLE session_guest (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  table_session_id uuid NOT NULL,
  display_name     text NOT NULL,              -- pseudonymization target
  emoji            text NOT NULL,
  device_key_hash  text NOT NULL,              -- hash of per-device random key
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, table_session_id, device_key_hash),
  FOREIGN KEY (tenant_id, table_session_id) REFERENCES table_session (tenant_id, id)
);

-- One session token PER DEVICE; 3h sliding expiry is per device (expires_at
-- refreshed on that device's activity). Kept separate from session_guest so
-- tokens can be re-issued/revoked without touching guest identity rows.
-- token_hash is also GLOBALLY unique: token resolution happens BEFORE tenant
-- is known (same rationale as table_qr_slug.slug; see resolve_session_token
-- in 0013).
CREATE TABLE session_device_token (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  table_session_id uuid NOT NULL,
  session_guest_id uuid NOT NULL,
  token_hash       text NOT NULL UNIQUE,       -- sha256; raw token only on guest device
  issued_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,       -- slid on activity, PER DEVICE
  revoked_at       timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, token_hash),              -- tenant-scoped lookup path
  FOREIGN KEY (tenant_id, table_session_id) REFERENCES table_session (tenant_id, id),
  FOREIGN KEY (tenant_id, session_guest_id) REFERENCES session_guest (tenant_id, id)
);
CREATE INDEX ix_session_device_token_session
  ON session_device_token (tenant_id, table_session_id) WHERE revoked_at IS NULL;

-- t1. set_updated_at
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON floor_section
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON dining_table
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS session_device_token;
DROP TABLE IF EXISTS session_guest;
DROP TABLE IF EXISTS table_session;
DROP TABLE IF EXISTS table_qr_slug;
DROP TABLE IF EXISTS dining_table;
DROP TABLE IF EXISTS floor_section;
