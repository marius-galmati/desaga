-- Up Migration
-- ----------------------------------------------------------------------------
-- 12. AUDIT LOG (append-only, monthly partitions)
-- ----------------------------------------------------------------------------
-- Includes every READ of chef performance data (written by a NestJS
-- interceptor in the same request transaction) and old/new row images for
-- write audits (t4 row-triggers land with their modules).
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

-- First partitions: current month + next month (as of this migration's
-- authoring: 2026-07). Deterministic names on purpose — kysely-codegen output
-- must not depend on when the migration is applied.
CREATE TABLE audit_log_2026_07 PARTITION OF audit_log
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE audit_log_2026_08 PARTITION OF audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- A nightly maintenance job (BullMQ) pre-creates the next month's partition
-- (DDL: that one job connects as the migrator login, not boca_worker). It must
-- also mirror the partition grant hygiene from 0013 (no direct DML grants on
-- partitions — see the append-only note there).

CREATE INDEX ix_audit_tenant_time   ON audit_log (tenant_id, occurred_at DESC);
CREATE INDEX ix_audit_subject_user  ON audit_log (tenant_id, subject_user_id, occurred_at DESC)
  WHERE subject_user_id IS NOT NULL;

-- Down Migration
DROP TABLE IF EXISTS audit_log;   -- drops its partitions with it
