-- Up Migration
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
-- NOTE: golden membership should set pass_photo.legal_hold = true (trigger t5,
-- lands with the calibration module).

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
-- Trigger t5 (coaching module): AFTER INSERT -> UPDATE pass_photo SET
-- legal_hold = true (evidence pinned).

-- Down Migration
DROP TABLE IF EXISTS coaching_report_evidence;
DROP TABLE IF EXISTS coaching_report;
DROP TABLE IF EXISTS golden_set_member;
DROP TABLE IF EXISTS dish_go_live_gate;
DROP TABLE IF EXISTS sous_chef_rating;
