-- Up Migration
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

-- IMMUTABLE rows. Cardinality (3 primary + 2 holdout) enforced at the moment
-- of set activation (app + deferred trigger), not per-row.
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

-- Every row pins the FULL eval config — reproducible forever.
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

-- t1. set_updated_at
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON capture_device
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS ai_evaluation;
DROP TABLE IF EXISTS pass_photo;
DROP TABLE IF EXISTS tolerance_profile;
DROP TABLE IF EXISTS reference_photo;
DROP TABLE IF EXISTS reference_set;
DROP TABLE IF EXISTS capture_device;
