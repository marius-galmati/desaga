-- ============================================================================
-- BOCA MVP SCHEMA  PostgreSQL 16
-- Conventions: snake_case; PK uuid v7; timestamptz everywhere; RON in integer
-- minor units (bani); every tenant-scoped table: tenant_id uuid NOT NULL,
-- UNIQUE (tenant_id, id) as composite-FK anchor, RLS policy (canonical example
-- at bottom), and ALL indexes lead with tenant_id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- REVIEW FIXES APPLIED (v0.2)
-- ----------------------------------------------------------------------------
-- F1  Multi-device tokens: token_hash moved off table_session into new
--     session_device_token (one token per device, per-device sliding expiry).
-- F2  boca_app revoked from platform_admin (ALL) and allergen (writes);
--     boca_platform role defined with the tenant-onboarding path documented.
-- F3  pass_photo purge path: purged_at column, storage_key NULL-out semantics,
--     legal_hold purge-guard CHECK, trigger whitelist extended.
-- F4  boca_worker role defined with narrow cross-tenant RLS policies and
--     column-scoped grants; audit_log INSERT policies split per role.
-- F5  guest_order.pos_entered_total_minor added; order-level status CHECK and
--     'served' promotion rule documented.
-- F6  Escalation tiers: service_request.escalation_level + shift_id, new
--     service_request_escalation table.
-- F7  First-order race closed: partial unique index WHERE is_first_of_session.
-- F8  ai_evaluation CHECKs: completed rows fully pinned/scored, eval_failed
--     rows must carry failure_detail.
-- F9  refs_stale trigger redesign (BEFORE on dish + statement-level on
--     reference_set); per-item enqueue rule documented on ai_evaluation.
-- F10 dish_go_live_gate: one 'passed' gate per dish_version; per-version gate
--     semantics documented.
-- F11 pass_photo plate-slot uniqueness, skip/storage CHECK, same-item refire
--     FK; chef_attribution self-claim semantics documented.
-- F12 location_id carried through composite FKs (floor_section, dining_table,
--     table_session, guest_order, shift assignments, capture_device/pass_photo).
-- F13 Doc comments: alert.subject_id polymorphism, bill-request source of
--     truth, 86-toggle audit trail.

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS & HELPERS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;

-- UUIDv7: PG16 has no native generator (lands in PG18). This function is the
-- column DEFAULT; the app MAY pre-generate v7 ids (npm `uuidv7`)  both emit
-- RFC 9562 v7, keeping b-tree inserts append-mostly.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        placing substring(int8send((extract(epoch FROM clock_timestamp())*1000)::bigint) FROM 3)
        FROM 1 FOR 6),
      52, 1), 53, 1), 'hex')::uuid;
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
-- Attach BEFORE UPDATE to every table that has updated_at (see trigger notes).

-- ----------------------------------------------------------------------------
-- 1. ENUMS (closed sets; tenant-extensible catalogs are tables instead)
-- ----------------------------------------------------------------------------
CREATE TYPE user_role                AS ENUM ('tenant_admin','manager','waiter','kitchen_pass','management_viewer');
CREATE TYPE table_session_status     AS ENUM ('open','bill_requested','closed','expired');
-- Shared by guest_order and order_item. Order-level uses submitted|accepted|served|voided;
-- fired/ready are item-level (course firing). One enum keeps the machine in one place.
CREATE TYPE order_status             AS ENUM ('submitted','accepted','fired','ready','served','voided');
CREATE TYPE payment_status           AS ENUM ('unpaid','paid','refunded','comped');  -- dormant in MVP
CREATE TYPE service_request_kind     AS ENUM ('call_waiter','request_bill');
CREATE TYPE service_request_status   AS ENUM ('open','acknowledged','escalated','resolved','cancelled');
CREATE TYPE reference_set_status     AS ENUM ('draft','active','retired');
CREATE TYPE tolerance_profile_status AS ENUM ('draft','active','retired');
CREATE TYPE reference_photo_role     AS ENUM ('primary','holdout');   -- N primary (tenant_settings, 1..5) + holdout, checked at approval
CREATE TYPE capture_mode             AS ENUM ('auto','manual');
CREATE TYPE photo_upload_status      AS ENUM ('pending','uploaded','failed');
CREATE TYPE skip_reason              AS ENUM ('rush','tableside','tech','other');
CREATE TYPE quality_gate_status      AS ENUM ('pending','passed','failed');
CREATE TYPE eval_mode                AS ENUM ('shadow','active');
CREATE TYPE eval_status              AS ENUM ('queued','running','completed','not_scoreable','eval_failed');
CREATE TYPE not_scoreable_reason     AS ENUM ('refs_stale','non_scoreable_dish','quality_gate_failed','photo_skipped','no_active_tolerance','other');
CREATE TYPE attribution_role         AS ENUM ('station_chef','plating_chef');
CREATE TYPE attribution_method       AS ENUM ('dish_station_roster','kds_bump_roster','self_claim','manual');
CREATE TYPE go_live_status           AS ENUM ('pending','passed','failed');
CREATE TYPE coaching_report_status   AS ENUM ('draft','issued','acknowledged','disputed');
CREATE TYPE alert_rule               AS ENUM ('dish_wow_drop','dish_three_week_decline','skip_rate_high');
CREATE TYPE alert_status             AS ENUM ('open','acknowledged','resolved');
CREATE TYPE outbox_status            AS ENUM ('pending','processing','completed','failed');
CREATE TYPE shift_status             AS ENUM ('planned','open','closed');
CREATE TYPE audit_actor_type        AS ENUM ('staff','guest','system','platform_admin');

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
-- RLS: USING (id = current_setting('app.tenant_id')::uuid)

-- Public hostnames a tenant serves (guest/admin/staff). Host -> tenant is a
-- pre-tenant moment, resolved via SECURITY DEFINER resolve_tenant_domain(text)
-- (0015) — same sanctioned-bypass pattern as resolve_tenant_slug.
CREATE TABLE tenant_domain (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id),
  domain     citext NOT NULL UNIQUE,          -- bare hostname, no scheme/port
  surface    text NOT NULL CHECK (surface IN ('guest','admin','staff')),
  is_primary boolean NOT NULL DEFAULT true,   -- canonical origin per (tenant, surface)
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX uq_tenant_domain_primary
  ON tenant_domain (tenant_id, surface) WHERE is_primary;

-- Per-tenant brand identity (0016). Absent row = app-side neutral defaults.
-- palette is a whitelisted token->hex map validated in the contract layer.
CREATE TABLE tenant_branding (
  tenant_id     uuid PRIMARY KEY REFERENCES tenant(id),
  display_name  text,
  tagline       text,
  greeting      text,
  promise       text,
  locations     text[] NOT NULL DEFAULT '{}',
  logo_media_id uuid,
  palette       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, logo_media_id) REFERENCES media_asset (tenant_id, id)
);

-- Per-tenant operational settings (0019). Absent row = app-side defaults.
-- reference_photo_count = how many PRIMARY reference photos the AI compares
-- the pass photo against (REF1..REFn); consulted at reference-set creation —
-- already-pinned sets keep the primaries they were approved with.
CREATE TABLE tenant_settings (
  tenant_id             uuid PRIMARY KEY REFERENCES tenant(id),
  reference_photo_count smallint NOT NULL DEFAULT 3
    CHECK (reference_photo_count BETWEEN 1 AND 5),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Platform operators (Bitup)  deliberately OUTSIDE the tenant model so
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
-- RLS: standard tenant policy (see section 12)

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
-- known  see resolve_qr_slug() note in section 12.
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
-- note in Section 12).
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

-- Global EU-14 lookup (seeded), NOT tenant-scoped; dish_version stores codes.
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
  allergen_codes text[] NOT NULL DEFAULT '{}', -- values from allergen.code (trigger-validated)
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
-- Every 86 toggle ALSO emits an audit_log row (who/when/old/new) - see t4.
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
-- 6. ORDERS & TRANSACTIONAL OUTBOX
-- ----------------------------------------------------------------------------
-- Named guest_order because ORDER is a reserved word.
CREATE TABLE guest_order (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id),
  location_id          uuid NOT NULL,
  table_session_id     uuid NOT NULL,
  -- Order-level machine: submitted -> accepted -> served | voided (fired/ready
  -- are item-level). The API promotes an order to 'served' when ALL its
  -- non-voided items are served (app-enforced) - this is what makes the
  -- ix_guest_order_pos_pending settlement checklist below actually fill up.
  status               order_status NOT NULL DEFAULT 'submitted',
  is_first_of_session  boolean NOT NULL DEFAULT false,  -- requires waiter acceptance
  accepted_by          uuid,
  accepted_at          timestamptz,
  submitted_by_guest_id uuid,                  -- device that hit submit
  -- Payment-ready but dormant:
  subtotal_minor       integer NOT NULL DEFAULT 0,
  vat_total_minor      integer NOT NULL DEFAULT 0,
  tip_minor            integer NOT NULL DEFAULT 0,      -- placeholder line
  total_minor          integer NOT NULL DEFAULT 0,
  payment_status       payment_status NOT NULL DEFAULT 'unpaid',
  idempotency_key      text,
  -- Manual POS re-entry (MVP POSConnector driver) + reconciliation:
  pos_reference        text,
  pos_entered_total_minor integer,              -- amount actually keyed into the POS (nightly variance vs total_minor)
  pos_reentered_by     uuid,
  pos_reentered_at     timestamptz,
  voided_at            timestamptz,
  void_reason          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (status IN ('submitted','accepted','served','voided')),  -- fired/ready are item-level only
  FOREIGN KEY (tenant_id, location_id)           REFERENCES location      (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, table_session_id)
    REFERENCES table_session (tenant_id, location_id, id),       -- order venue = session venue
  FOREIGN KEY (tenant_id, accepted_by)           REFERENCES app_user      (tenant_id, id),
  FOREIGN KEY (tenant_id, pos_reentered_by)      REFERENCES app_user      (tenant_id, id),
  FOREIGN KEY (tenant_id, submitted_by_guest_id) REFERENCES session_guest (tenant_id, id)
);
CREATE INDEX ix_guest_order_tenant_session ON guest_order (tenant_id, table_session_id);
CREATE INDEX ix_guest_order_tenant_loc_created ON guest_order (tenant_id, location_id, created_at DESC);
-- Settlement checklist / nightly variance: closed orders not yet re-entered.
CREATE INDEX ix_guest_order_pos_pending ON guest_order (tenant_id, location_id)
  WHERE pos_reentered_at IS NULL AND status = 'served';
-- First-order race guard: is_first_of_session is derived INSIDE the insert
-- transaction (NOT EXISTS prior order for the session); this index makes two
-- concurrent "first" orders impossible.
CREATE UNIQUE INDEX uq_guest_order_first_of_session
  ON guest_order (tenant_id, table_session_id) WHERE is_first_of_session;

CREATE TABLE order_item (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  order_id         uuid NOT NULL,
  dish_id          uuid NOT NULL,
  dish_version_id  uuid NOT NULL,              -- PINNED at order time (price/allergens/station)
  session_guest_id uuid,                       -- per-device line attribution (NULL after pseudonymization)
  course_no        smallint NOT NULL DEFAULT 1,
  quantity         smallint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor integer NOT NULL,           -- snapshot from dish_version
  vat_rate_bp      smallint NOT NULL,          -- snapshot (per-line VAT metadata)
  line_total_minor integer NOT NULL,
  modifiers        jsonb,                      -- structured modifiers
  special_request  text,
  status           order_status NOT NULL DEFAULT 'submitted',
  fired_at         timestamptz,
  ready_at         timestamptz,
  served_at        timestamptz,
  voided_at        timestamptz,
  void_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id)         REFERENCES guest_order   (tenant_id, id),
  FOREIGN KEY (tenant_id, dish_id)          REFERENCES dish          (tenant_id, id),
  FOREIGN KEY (tenant_id, dish_version_id)  REFERENCES dish_version  (tenant_id, id),
  FOREIGN KEY (tenant_id, session_guest_id) REFERENCES session_guest (tenant_id, id)
);
CREATE INDEX ix_order_item_tenant_order ON order_item (tenant_id, order_id);
-- Pass ticket queue: fired-but-not-served items.
CREATE INDEX ix_order_item_pass_queue ON order_item (tenant_id, status, fired_at)
  WHERE status IN ('fired','ready');

-- Transactional outbox: written in the SAME tx as the domain write; relayed by
-- a BullMQ worker into the POSConnector interface (MVP driver = manual
-- checklist + nightly variance report keyed on guest_order.pos_reference).
CREATE TABLE outbox_event (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  aggregate_type  text NOT NULL,               -- 'guest_order', 'order_item'
  aggregate_id    uuid NOT NULL,
  event_type      text NOT NULL,               -- 'order.submitted', 'item.voided', ...
  payload         jsonb NOT NULL,
  status          outbox_status NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX ix_outbox_pending ON outbox_event (status, next_attempt_at) WHERE status IN ('pending','failed');
CREATE INDEX ix_outbox_tenant_aggregate ON outbox_event (tenant_id, aggregate_type, aggregate_id);
-- NOTE: relay worker runs with a job-scoped SET LOCAL app.tenant_id per row batch.

-- ----------------------------------------------------------------------------
-- 7. SERVICE EVENTS (call-waiter / request-bill) & MANAGER ALERTS
-- ----------------------------------------------------------------------------
-- Bill requests: service_request is the SINGLE SOURCE OF TRUTH.
-- table_session.status = 'bill_requested' (and bill_requested_at) is a
-- denormalized mirror updated in the SAME transaction as the request row.
CREATE TABLE service_request (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  location_id        uuid NOT NULL,
  table_session_id   uuid NOT NULL,
  dining_table_id    uuid NOT NULL,            -- denormalized for the floor view
  kind               service_request_kind NOT NULL,
  status             service_request_status NOT NULL DEFAULT 'open',
  escalation_level   smallint NOT NULL DEFAULT 0,  -- highest tier reached; history in service_request_escalation
  shift_id           uuid,                     -- shift in progress when raised (nullable: off-shift)
  created_by_guest_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  acknowledged_by    uuid,
  acknowledged_at    timestamptz,
  escalated_at       timestamptz,              -- set by worker when unacked > 60s
  resolved_at        timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id)         REFERENCES location      (tenant_id, id),
  FOREIGN KEY (tenant_id, table_session_id)    REFERENCES table_session (tenant_id, id),
  FOREIGN KEY (tenant_id, dining_table_id)     REFERENCES dining_table  (tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id)            REFERENCES shift         (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by_guest_id) REFERENCES session_guest (tenant_id, id),
  FOREIGN KEY (tenant_id, acknowledged_by)     REFERENCES app_user      (tenant_id, id)
);
CREATE INDEX ix_service_request_open ON service_request (tenant_id, location_id, created_at)
  WHERE status IN ('open','escalated');

-- Escalation tiers: one row per notification hop (waiter -> manager -> ...),
-- written by the escalation scanner (boca_worker). Parent's escalated_at stays
-- as "first escalation" convenience; escalation_level mirrors the max level.
CREATE TABLE service_request_escalation (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  service_request_id uuid NOT NULL,
  level              smallint NOT NULL,        -- 1 = first escalation
  notified_role      user_role NOT NULL,
  notified_user_id   uuid,                     -- NULL = role-wide broadcast
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, service_request_id, level),
  FOREIGN KEY (tenant_id, service_request_id) REFERENCES service_request (tenant_id, id),
  FOREIGN KEY (tenant_id, notified_user_id)   REFERENCES app_user        (tenant_id, id)
);
CREATE INDEX ix_sr_escalation_request ON service_request_escalation (tenant_id, service_request_id);

-- Manager notification inbox (rule alerts: WoW drop, 3-week decline, skip>10%).
CREATE TABLE alert (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  location_id     uuid,                        -- NULL = tenant-wide
  rule            alert_rule NOT NULL,
  subject_type    text NOT NULL,               -- 'dish' | 'app_user'
  -- Polymorphic BY DESIGN: only the rules worker (boca_worker) writes
  -- subject_id, and it is deliberately EXCLUDED from the composite-FK
  -- guarantee (no FK possible across subject_type targets).
  subject_id      uuid NOT NULL,
  payload         jsonb NOT NULL,              -- metric values that fired the rule
  status          alert_status NOT NULL DEFAULT 'open',
  created_at      timestamptz NOT NULL DEFAULT now(),
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  FOREIGN KEY (tenant_id, location_id)     REFERENCES location (tenant_id, id),
  FOREIGN KEY (tenant_id, acknowledged_by) REFERENCES app_user (tenant_id, id)
);
CREATE INDEX ix_alert_inbox ON alert (tenant_id, status, created_at DESC);

-- ----------------------------------------------------------------------------
-- 8. CAPTURE DEVICES, PASS PHOTOS, REFERENCE SETS, TOLERANCES, AI EVALUATIONS
-- ----------------------------------------------------------------------------
-- Gap-fill: which iPhone at which pass, running which capture profile.
CREATE TABLE capture_device (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  location_id             uuid NOT NULL,
  name                    text NOT NULL,       -- "Pass iPhone 15 - Boca Centru"
  platform                text NOT NULL DEFAULT 'ios',
  device_fingerprint      text,                -- Expo installation id
  capture_profile_version text NOT NULL,       -- current AE/AWB-lock profile
  is_active               boolean NOT NULL DEFAULT true,
  last_seen_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, location_id, id),         -- anchor: pass_photo carries location_id
  FOREIGN KEY (tenant_id, location_id) REFERENCES location (tenant_id, id)
);

-- Versioned reference sets, bound to an exact dish_version, shot on the SAME
-- rig as pass photos. Exactly one ACTIVE set per dish_version (partial unique).
CREATE TABLE reference_set (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id),
  dish_id         uuid NOT NULL,
  dish_version_id uuid NOT NULL,
  version_no      integer NOT NULL,
  status          reference_set_status NOT NULL DEFAULT 'draft',
  approved_by     uuid,
  approved_at     timestamptz,
  retired_at      timestamptz,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dish_version_id, version_no),
  FOREIGN KEY (tenant_id, dish_id)         REFERENCES dish         (tenant_id, id),
  FOREIGN KEY (tenant_id, dish_version_id) REFERENCES dish_version (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by)     REFERENCES app_user     (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by)      REFERENCES app_user     (tenant_id, id)
);
CREATE UNIQUE INDEX uq_reference_set_active
  ON reference_set (tenant_id, dish_version_id) WHERE status = 'active';

-- IMMUTABLE rows. Cardinality (N primary per tenant_settings.reference_photo_count,
-- 1..5, + holdout) enforced at the moment of set activation (app + deferred
-- trigger), not per-row.
CREATE TABLE reference_photo (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  reference_set_id        uuid NOT NULL,
  role                    reference_photo_role NOT NULL,
  storage_key             text NOT NULL,       -- tenant/{t}/location/{l}/reference/...
  capture_device_id       uuid NOT NULL,
  capture_profile_version text NOT NULL,       -- snapshot at shoot time
  shot_at                 timestamptz NOT NULL,
  metadata                jsonb,               -- EXIF-ish, lighting notes
  sort_order              smallint NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, reference_set_id)  REFERENCES reference_set  (tenant_id, id),
  FOREIGN KEY (tenant_id, capture_device_id) REFERENCES capture_device (tenant_id, id)
);
CREATE INDEX ix_reference_photo_set ON reference_photo (tenant_id, reference_set_id);

-- Versioned per-criterion tolerances authored by head chef. One ACTIVE per dish.
CREATE TABLE tolerance_profile (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id),
  dish_id      uuid NOT NULL,
  version_no   integer NOT NULL,
  criteria     jsonb NOT NULL,   -- {criterion_code: {allowed_variance:..., must_have:[...], notes_ro:...}} x6
  status       tolerance_profile_status NOT NULL DEFAULT 'draft',
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at   timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, dish_id, version_no),
  FOREIGN KEY (tenant_id, dish_id)    REFERENCES dish     (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES app_user (tenant_id, id)
);
CREATE UNIQUE INDEX uq_tolerance_profile_active
  ON tolerance_profile (tenant_id, dish_id) WHERE status = 'active';

-- IMMUTABLE after finalization (trigger whitelists upload/quality/retention cols).
-- Files in MinIO under tenant/{t}/location/{l}/pass/{yyyy-mm-dd}/{photo_id}.jpg
-- RETENTION: photo rows are NEVER row-DELETEd (ai_evaluation, sous_chef_rating,
-- coaching_report_evidence, golden_set_member and refire links depend on them).
-- Purge = delete the MinIO object, then SET storage_key = NULL, purged_at =
-- now() (retention worker only, via boca_worker role).
CREATE TABLE pass_photo (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenant(id),
  location_id             uuid NOT NULL,       -- venue of capture; must match the device's venue
  order_item_id           uuid NOT NULL,
  captured_by             uuid,                -- pass user
  capture_device_id       uuid,
  capture_profile_version text,                -- snapshot at capture time
  capture_mode            capture_mode,
  storage_key             text,                -- NULL when skipped
  upload_status           photo_upload_status NOT NULL DEFAULT 'pending',
  uploaded_at             timestamptz,
  skipped                 boolean NOT NULL DEFAULT false,
  skip_reason             skip_reason,
  refire_sequence         smallint NOT NULL DEFAULT 0,    -- 0 = original plate
  parent_photo_id         uuid,                -- refire link to superseded photo
  plate_index             smallint NOT NULL DEFAULT 1,    -- n-of-m multi-plate
  expected_plate_count    smallint NOT NULL DEFAULT 1,
  quality                 jsonb,               -- blur/exposure/framing heuristic outputs
  quality_status          quality_gate_status NOT NULL DEFAULT 'pending',
  captured_at             timestamptz NOT NULL DEFAULT now(),
  purge_after             timestamptz,         -- retention hook: raw photos short TTL
  purged_at               timestamptz,         -- object deleted from MinIO; row kept for FKs
  legal_hold              boolean NOT NULL DEFAULT false, -- evidence pin overrides purge
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_item_id, id),       -- anchor: refire links stay on the SAME item
  CHECK (skipped = (skip_reason IS NOT NULL)),
  -- Skipped rows never carry an object; upload_status stays 'pending' on them
  -- (app rule: skipped=true is the terminal marker, not the enum).
  CHECK (skip_reason IS NULL OR storage_key IS NULL),
  CHECK (purged_at IS NULL OR legal_hold = false),  -- pinned evidence cannot be purged
  CHECK (plate_index BETWEEN 1 AND expected_plate_count),
  FOREIGN KEY (tenant_id, location_id)       REFERENCES location       (tenant_id, id),
  FOREIGN KEY (tenant_id, order_item_id)     REFERENCES order_item     (tenant_id, id),
  FOREIGN KEY (tenant_id, captured_by)       REFERENCES app_user       (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id, capture_device_id)
    REFERENCES capture_device (tenant_id, location_id, id),  -- device at the same venue
  FOREIGN KEY (tenant_id, order_item_id, parent_photo_id)
    REFERENCES pass_photo (tenant_id, order_item_id, id)     -- refire parent = same order_item
);
CREATE INDEX ix_pass_photo_tenant_item ON pass_photo (tenant_id, order_item_id);
CREATE INDEX ix_pass_photo_purge ON pass_photo (purge_after)
  WHERE purge_after IS NOT NULL AND NOT legal_hold AND purged_at IS NULL;
-- One LIVE photo per plate slot; skipped rows are exempt (a later real capture
-- may fill the same slot after a recorded skip).
CREATE UNIQUE INDEX uq_pass_photo_plate_slot
  ON pass_photo (tenant_id, order_item_id, refire_sequence, plate_index)
  WHERE skip_reason IS NULL;

-- Every row pins the FULL eval config  reproducible forever.
-- ENQUEUE RULE (per-item grain): the enqueuer resolves the ACTIVE reference_set
-- WHERE dish_version_id = order_item.dish_version_id (the version PINNED on the
-- item, NOT dish.current_version_id) and marks the eval not_scoreable /
-- refs_stale PER ITEM when none exists. dish.refs_stale is a dashboard hint,
-- never the eval gate.
CREATE TABLE ai_evaluation (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  pass_photo_id         uuid NOT NULL,
  mode                  eval_mode NOT NULL,           -- shadow | active
  status                eval_status NOT NULL DEFAULT 'queued',
  not_scoreable_reason  not_scoreable_reason,         -- iff status='not_scoreable'
  failure_detail        text,                         -- iff status='eval_failed'
  -- Pinned config:
  model_id              text NOT NULL,                -- pinned Sonnet-class id
  prompt_version        text NOT NULL,
  prompt_hash           text NOT NULL,
  reference_set_id      uuid,                         -- exact version row
  tolerance_profile_id  uuid,                         -- exact version row
  preprocessing_version text NOT NULL,
  -- Results: {criterion_code: {score: 1-5, justification_ro: text, confidence: 0-1}} x 6
  criterion_scores      jsonb,
  overall_score         numeric(3,2),                 -- convenience median
  raw_ensemble          jsonb,                        -- full N-run outputs (ensemble-of-3 during calibration)
  ensemble_size         smallint NOT NULL DEFAULT 1,
  latency_ms            integer,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  purge_after           timestamptz,                  -- retention hook: scores are LONG class
  deleted_at            timestamptz,                  -- soft delete (dashboard); row kept for retention
  input_tokens          integer,                      -- usage/cost tracking (0018)
  output_tokens         integer,
  cost_usd              numeric(12,6),                -- provider real cost, else computed at read
  UNIQUE (tenant_id, id),
  CHECK ((status = 'not_scoreable') = (not_scoreable_reason IS NOT NULL)),
  -- Completed rows must be fully pinned and scored; failures must say why.
  CHECK (status <> 'completed'
         OR (reference_set_id IS NOT NULL AND tolerance_profile_id IS NOT NULL
             AND criterion_scores IS NOT NULL AND completed_at IS NOT NULL)),
  CHECK (status <> 'eval_failed' OR failure_detail IS NOT NULL),
  FOREIGN KEY (tenant_id, pass_photo_id)        REFERENCES pass_photo        (tenant_id, id),
  FOREIGN KEY (tenant_id, reference_set_id)     REFERENCES reference_set     (tenant_id, id),
  FOREIGN KEY (tenant_id, tolerance_profile_id) REFERENCES tolerance_profile (tenant_id, id)
);
CREATE INDEX ix_ai_eval_tenant_photo ON ai_evaluation (tenant_id, pass_photo_id);
CREATE INDEX ix_ai_eval_tenant_created ON ai_evaluation (tenant_id, created_at DESC);
CREATE INDEX ix_ai_eval_queue ON ai_evaluation (status, created_at) WHERE status IN ('queued','running');
CREATE INDEX ix_ai_eval_tenant_live ON ai_evaluation (tenant_id, created_at DESC) WHERE deleted_at IS NULL;

-- Global runtime AI config (0018) — no tenant_id / no RLS; app+worker read,
-- platform role writes. API key stored AES-256-GCM encrypted, never returned.
CREATE TABLE ai_settings (
  singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  provider           text NOT NULL DEFAULT 'anthropic' CHECK (provider IN ('anthropic','openai')),
  base_url           text,
  model              text,
  api_key_ciphertext text,
  api_key_iv         text,
  api_key_tag        text,
  api_key_last4      text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_model_price (
  model              text PRIMARY KEY,
  label              text,
  input_per_million  numeric(10,4) NOT NULL DEFAULT 0,
  output_per_million numeric(10,4) NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 9. CHEF ATTRIBUTION
-- ----------------------------------------------------------------------------
-- Possibly several rows per order_item (station chef + plating chef).
-- Retroactive same-day corrections are plain UPDATEs, captured verbatim by the
-- audit row-trigger (old + new in details JSONB).
-- SELF-CLAIM: a method='self_claim' claim REPLACES the roster-derived row for
-- the same (order_item, role) - the existing row is UPDATEd in place
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

-- ----------------------------------------------------------------------------
-- 10. CALIBRATION, GO-LIVE GATE, GOLDEN SET, COACHING
-- ----------------------------------------------------------------------------
-- Blind, photo-only ratings during shadow calibration. Same JSONB shape as
-- ai_evaluation.criterion_scores for direct kappa/MAE comparison. IMMUTABLE.
CREATE TABLE sous_chef_rating (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  pass_photo_id    uuid NOT NULL,
  rater_user_id    uuid NOT NULL,
  criterion_scores jsonb NOT NULL,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, pass_photo_id, rater_user_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, pass_photo_id) REFERENCES pass_photo (tenant_id, id),
  FOREIGN KEY (tenant_id, rater_user_id) REFERENCES app_user   (tenant_id, id)
);

-- Per-dish go-live gate: agreement metrics + dual sign-off before mode=active.
CREATE TABLE dish_go_live_gate (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  dish_id               uuid NOT NULL,
  dish_version_id       uuid NOT NULL,
  sample_size           integer NOT NULL,
  kappa                 numeric(4,3),
  mae                   numeric(5,3),
  per_criterion_metrics jsonb,
  status                go_live_status NOT NULL DEFAULT 'pending',
  head_chef_signed_by   uuid,
  head_chef_signed_at   timestamptz,
  owner_signed_by       uuid,
  owner_signed_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, dish_id)             REFERENCES dish         (tenant_id, id),
  FOREIGN KEY (tenant_id, dish_version_id)     REFERENCES dish_version (tenant_id, id),
  FOREIGN KEY (tenant_id, head_chef_signed_by) REFERENCES app_user     (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_signed_by)     REFERENCES app_user     (tenant_id, id)
);
-- The gate is PER dish_version: a version bump reverts the dish to SHADOW mode
-- until the new version passes its own gate. The enqueuer sets eval mode from
-- the gate row for THAT dish_version (order_item.dish_version_id), never from
-- dish-level state.
CREATE UNIQUE INDEX uq_go_live_gate_passed
  ON dish_go_live_gate (tenant_id, dish_version_id) WHERE status = 'passed';

-- Membership for the weekly drift job (re-score, compare to pinned results).
CREATE TABLE golden_set_member (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  dish_id       uuid NOT NULL,
  pass_photo_id uuid NOT NULL,
  added_by      uuid NOT NULL,
  added_at      timestamptz NOT NULL DEFAULT now(),
  retired_at    timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, dish_id)       REFERENCES dish       (tenant_id, id),
  FOREIGN KEY (tenant_id, pass_photo_id) REFERENCES pass_photo (tenant_id, id),
  FOREIGN KEY (tenant_id, added_by)      REFERENCES app_user   (tenant_id, id)
);
CREATE UNIQUE INDEX uq_golden_member_active
  ON golden_set_member (tenant_id, pass_photo_id) WHERE retired_at IS NULL;
-- NOTE: golden membership should set pass_photo.legal_hold = true (trigger).

-- APPEND-ONLY: corrections insert a new version row (supersedes_id); the only
-- UPDATEs allowed (trigger-whitelisted) are sign-off / acknowledgment / dispute.
CREATE TABLE coaching_report (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenant(id),
  chef_user_id          uuid NOT NULL,
  period_start          date NOT NULL,
  period_end            date NOT NULL,
  version_no            integer NOT NULL DEFAULT 1,
  supersedes_id         uuid,
  inputs                jsonb NOT NULL,   -- pinned: eval ids, model/prompt/ref-set/tolerance versions, metric snapshot
  pdf_key               text,             -- MinIO snapshot: tenant/{t}/coaching/{id}.pdf
  status                coaching_report_status NOT NULL DEFAULT 'draft',
  manager_signed_by     uuid,
  manager_signed_at     timestamptz,
  chef_acknowledged_at  timestamptz,
  chef_dispute_comment  text,
  created_by            uuid NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, chef_user_id, period_start, period_end, version_no),
  FOREIGN KEY (tenant_id, chef_user_id)      REFERENCES app_user        (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id)     REFERENCES coaching_report (tenant_id, id),
  FOREIGN KEY (tenant_id, manager_signed_by) REFERENCES app_user        (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by)        REFERENCES app_user        (tenant_id, id)
);
CREATE INDEX ix_coaching_report_chef ON coaching_report (tenant_id, chef_user_id, period_start DESC);

CREATE TABLE coaching_report_evidence (
  tenant_id          uuid NOT NULL REFERENCES tenant(id),
  coaching_report_id uuid NOT NULL,
  pass_photo_id      uuid NOT NULL,
  caption            text,
  PRIMARY KEY (tenant_id, coaching_report_id, pass_photo_id),
  FOREIGN KEY (tenant_id, coaching_report_id) REFERENCES coaching_report (tenant_id, id),
  FOREIGN KEY (tenant_id, pass_photo_id)      REFERENCES pass_photo      (tenant_id, id)
);
-- Trigger: AFTER INSERT -> UPDATE pass_photo SET legal_hold = true (evidence pinned).

-- ----------------------------------------------------------------------------
-- 11. GUEST FEEDBACK
-- ----------------------------------------------------------------------------
-- NEVER joined to ai_evaluation in guest-facing surfaces (application rule;
-- guest API role has no grant on ai_evaluation at all).
CREATE TABLE guest_feedback (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id),
  order_item_id    uuid NOT NULL,
  session_guest_id uuid,
  rating           smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags             text[] NOT NULL DEFAULT '{}',
  comment          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  purge_after      timestamptz,                -- retention hook
  UNIQUE (tenant_id, order_item_id, session_guest_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, order_item_id)    REFERENCES order_item    (tenant_id, id),
  FOREIGN KEY (tenant_id, session_guest_id) REFERENCES session_guest (tenant_id, id)
);
CREATE INDEX ix_guest_feedback_tenant_created ON guest_feedback (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 12. AUDIT LOG (append-only, monthly partitions) + RLS + ROLES
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id              uuid NOT NULL DEFAULT uuid_generate_v7(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  tenant_id       uuid,                        -- NULL only for platform-level actions
  actor_type      audit_actor_type NOT NULL,
  actor_id        uuid,                        -- app_user / session_guest / platform_admin id
  action          text NOT NULL,               -- 'coaching_report.read', 'chef_perf.export', 'chef_attribution.correct', ...
  subject_type    text,
  subject_id      uuid,
  subject_user_id uuid,                        -- the chef whose performance data was read/exported
  ip              inet,
  user_agent      text,
  details         jsonb,                       -- old/new row images for write audits
  PRIMARY KEY (id, occurred_at)                -- partition key must be in PK
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_log_2026_07 PARTITION OF audit_log
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- A nightly maintenance job (BullMQ) pre-creates the next month's partition
-- (DDL: that one job connects as boca_migrator, not boca_worker).

CREATE INDEX ix_audit_tenant_time   ON audit_log (tenant_id, occurred_at DESC);
CREATE INDEX ix_audit_subject_user  ON audit_log (tenant_id, subject_user_id, occurred_at DESC)
  WHERE subject_user_id IS NOT NULL;

-- --- Roles & grants -----------------------------------------------------------
-- boca_migrator: owns schema, runs SQL migrations. boca_app: NestJS runtime,
-- NO BYPASSRLS, NOT the table owner (so FORCE RLS applies).
-- CREATE ROLE boca_migrator LOGIN;
-- CREATE ROLE boca_app LOGIN;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO boca_app;
REVOKE UPDATE, DELETE ON audit_log FROM boca_app;      -- append-only, enforced by grants
REVOKE UPDATE ON dish_version, reference_photo, sous_chef_rating FROM boca_app;  -- immutable rows
REVOKE DELETE ON pass_photo, ai_evaluation, coaching_report, guest_feedback FROM boca_app;
-- (hard deletes happen only via the retention worker role, which honors legal_hold)
REVOKE ALL ON platform_admin FROM boca_app;              -- platform table: app must never touch it
REVOKE INSERT, UPDATE, DELETE ON allergen FROM boca_app; -- global seed catalog: app reads only

-- boca_platform: platform operators (Bitup admin endpoints). NOLOGIN, assumed
-- via SET ROLE from a dedicated admin connection pool. TENANT ONBOARDING runs
-- as boca_platform (row inserts) + boca_migrator (any DDL): boca_app can NEVER
-- create tenants because the tenant policy's WITH CHECK (id = app.tenant_id)
-- cannot match a not-yet-existing tenant id (chicken-and-egg by design).
-- CREATE ROLE boca_platform NOLOGIN;
GRANT SELECT, INSERT, UPDATE ON tenant TO boca_platform;   -- onboarding + archiving
GRANT ALL ON platform_admin TO boca_platform;

-- boca_worker: BullMQ background jobs (outbox relay, escalation scanner,
-- nightly variance, alert rules, retention purge, weekly drift). These need
-- CROSS-TENANT access, so boca_worker gets its own narrow RLS policies below
-- instead of the app.tenant_id policy. NO BYPASSRLS. Writes are additionally
-- narrowed to exactly the columns each job touches (column-level grants).
-- Partition pre-creation is DDL and runs as boca_migrator (see audit_log note).
-- CREATE ROLE boca_worker LOGIN;
GRANT SELECT ON outbox_event, service_request, service_request_escalation,
                guest_order, pass_photo, ai_evaluation TO boca_worker;
GRANT UPDATE (status, attempts, next_attempt_at, last_error, completed_at)
  ON outbox_event TO boca_worker;                          -- outbox relay
GRANT UPDATE (storage_key, purged_at) ON pass_photo TO boca_worker;  -- purge path ONLY
GRANT UPDATE (status, escalated_at, escalation_level)
  ON service_request TO boca_worker;                       -- escalation scanner
GRANT INSERT ON service_request_escalation, alert, audit_log TO boca_worker;

-- --- RLS: canonical policy ----------------------------------------------------
-- Every request/transaction: BEGIN; SET LOCAL app.tenant_id = '<uuid>'; ...; COMMIT;
-- (guest requests too  tenant resolved server-side from the session token).
ALTER TABLE dish ENABLE ROW LEVEL SECURITY;
ALTER TABLE dish FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dish
  FOR ALL TO boca_app
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
-- >>> This exact ENABLE + FORCE + policy trio is applied VERBATIM to EVERY
-- >>> table above that carries tenant_id (tenant uses `id =` instead), i.e.:
-- >>> location, app_user, auth_refresh_token, floor_section, dining_table,
-- >>> table_qr_slug, table_session, session_guest, session_device_token,
-- >>> menu_category, station,
-- >>> dish_version, dish_location_availability, media_asset, shift,
-- >>> shift_roster, station_assignment, section_assignment, guest_order,
-- >>> order_item, outbox_event, service_request, service_request_escalation,
-- >>> alert, capture_device,
-- >>> reference_set, reference_photo, tolerance_profile, pass_photo,
-- >>> ai_evaluation, chef_attribution, sous_chef_rating, dish_go_live_gate,
-- >>> golden_set_member, coaching_report, coaching_report_evidence,
-- >>> guest_feedback, audit_log (audit_log is the EXCEPTION: INSERT-only,
-- >>> explicit per-role policies below, no UPDATE/DELETE policies at all).
-- The TWO sanctioned pre-tenant paths (SECURITY DEFINER, owned by boca_migrator):
--   resolve_qr_slug(p_slug text) RETURNS (tenant_id, location_id, dining_table_id)
--     - QR-scan endpoint maps slug -> tenant before SET LOCAL is possible;
--       reads table_qr_slug WHERE revoked_at IS NULL only.
--   resolve_session_token(p_token_hash text) RETURNS (tenant_id, table_session_id, session_guest_id)
--     - guest requests carry only the device token; tenant comes from here;
--       reads session_device_token WHERE revoked_at IS NULL AND expires_at > now().

-- --- RLS: worker & platform policies -------------------------------------------
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

-- audit_log: INSERT-only for everyone. boca_app writes tenant-scoped rows;
-- NULL-tenant rows (system / platform actors) may come ONLY from boca_worker /
-- boca_platform. No UPDATE/DELETE policies exist at all.
CREATE POLICY audit_insert_app ON audit_log
  FOR INSERT TO boca_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY audit_insert_system ON audit_log
  FOR INSERT TO boca_worker, boca_platform
  WITH CHECK (tenant_id IS NOT NULL OR actor_type IN ('system','platform_admin'));

-- ----------------------------------------------------------------------------
-- 13. TRIGGER NOTES (bodies written in SQL migrations)
-- ----------------------------------------------------------------------------
-- t1. set_updated_at(): BEFORE UPDATE on tenant, location, app_user,
--     floor_section, dining_table, menu_category, station, dish, shift,
--     capture_device, guest_order, order_item, chef_attribution.
-- t2. Immutability guards (BEFORE UPDATE, RAISE EXCEPTION unless only
--     whitelisted columns change):
--       pass_photo      -> upload_status, uploaded_at, quality, quality_status,
--                          purge_after, legal_hold, plus storage_key + purged_at
--                          (retention worker ONLY, via boca_worker column grants;
--                          the trigger allows the pair only when storage_key
--                          goes to NULL and purged_at is being set)
--       ai_evaluation   -> status/completed_at/scores/raw_ensemble on completion,
--                          purge_after
--       coaching_report -> status, manager_signed_*, chef_acknowledged_at,
--                          chef_dispute_comment
--       dish_version, reference_photo, sous_chef_rating -> no UPDATE at all
--                          (also revoked at grant level above).
-- t3. refs_stale maintenance, TWO triggers (no AFTER-UPDATE-on-self recursion):
--     a) trg_refs_stale_dish: BEFORE UPDATE OF current_version_id ON dish ->
--        NEW.refs_stale := NOT EXISTS (SELECT 1 FROM reference_set r
--          WHERE r.tenant_id = NEW.tenant_id
--            AND r.dish_version_id = NEW.current_version_id
--            AND r.status = 'active');
--     b) trg_refs_stale_refset: AFTER INSERT OR UPDATE OF status ON
--        reference_set, STATEMENT-level with transition tables -> one UPDATE
--        recomputing refs_stale for just the affected dish rows.
--     Reminder: refs_stale is a dish-level dashboard hint only; the eval
--     enqueuer resolves per order_item.dish_version_id (see ai_evaluation
--     ENQUEUE RULE in Section 8).
-- t4. Audit row-triggers (write path): chef_attribution (corrections capture
--     OLD+NEW into audit_log.details), coaching_report, golden_set_member,
--     table_qr_slug (revocations), station_assignment. READ/EXPORT auditing of
--     chef performance data cannot be done in the DB  a NestJS interceptor on
--     the coaching/attribution/eval endpoints writes audit_log rows
--     (action = '*.read' / '*.export') in the same request transaction.
-- t5. Evidence/golden pinning: AFTER INSERT ON coaching_report_evidence and
--     golden_set_member -> UPDATE pass_photo SET legal_hold = true.
-- t6. dish_version.allergen_codes validated against allergen.code by a
--     constraint trigger (arrays cannot carry FKs).
-- t7. Retention worker (BullMQ, runs as boca_worker): deletes/pseudonymizes rows
--     WHERE purge_after < now() AND NOT legal_hold AND purged_at IS NULL.
--     pass_photo is the EXCEPTION: never row-DELETEd, only storage_key NULL-out
--     + purged_at stamp (see pass_photo header). Exact durations TBD by
--     specialist  schema only guarantees the hooks exist.