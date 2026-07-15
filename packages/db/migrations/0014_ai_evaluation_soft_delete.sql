-- Up Migration

-- Soft delete for evaluations. boca_app is REVOKED hard DELETE on ai_evaluation
-- (retention: scored rows are kept), so "deleting" from the management dashboard
-- is a tenant-scoped UPDATE that stamps deleted_at. All reporting reads filter
-- deleted_at IS NULL; the row survives for audit/retention.
ALTER TABLE ai_evaluation ADD COLUMN deleted_at timestamptz;

-- Live (non-deleted) rows are the common read path for the dashboard aggregates.
CREATE INDEX ix_ai_eval_tenant_live
  ON ai_evaluation (tenant_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Down Migration

DROP INDEX IF EXISTS ix_ai_eval_tenant_live;
ALTER TABLE ai_evaluation DROP COLUMN IF EXISTS deleted_at;
