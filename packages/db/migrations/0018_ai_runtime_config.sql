-- Up Migration

-- Runtime AI configuration + cost tracking, managed from the platform dashboard.
-- These two tables are GLOBAL platform config (no tenant_id, no RLS): the
-- evaluator (boca_app / boca_worker) reads them without a tenant context, the
-- platform role writes them.

-- Single-row active provider/model/key. The API key is stored ENCRYPTED
-- (AES-256-GCM, SECRETS_ENCRYPTION_KEY) and never returned to a client.
CREATE TABLE ai_settings (
  singleton          boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  provider           text NOT NULL DEFAULT 'anthropic'
                       CHECK (provider IN ('anthropic', 'openai')),
  base_url           text,                 -- OpenAI-compatible base (e.g. OpenRouter)
  model              text,                 -- active model slug; NULL => fall back to env
  api_key_ciphertext text,                 -- AES-256-GCM ciphertext (base64)
  api_key_iv         text,                 -- base64 IV
  api_key_tag        text,                 -- base64 auth tag
  api_key_last4      text,                 -- for masked display only
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Per-model price sheet the operator maintains; cost = tokens x these rates
-- (used when the provider doesn't return a real billed cost).
CREATE TABLE ai_model_price (
  model              text PRIMARY KEY,     -- matches ai_evaluation.model_id
  label              text,
  input_per_million  numeric(10,4) NOT NULL DEFAULT 0,
  output_per_million numeric(10,4) NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Usage + cost captured per evaluation (summed across the ensemble runs).
-- cost_usd is the provider's real billed cost when available, else NULL and the
-- dashboard computes it from tokens x ai_model_price at read time.
ALTER TABLE ai_evaluation ADD COLUMN input_tokens  integer;
ALTER TABLE ai_evaluation ADD COLUMN output_tokens integer;
ALTER TABLE ai_evaluation ADD COLUMN cost_usd      numeric(12,6);

-- Grants: the runtime app/worker READ config; the platform role manages it.
-- 0013's blanket grant ran before these tables existed, so grant explicitly.
GRANT SELECT ON ai_settings, ai_model_price TO boca_app, boca_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_settings, ai_model_price TO boca_platform;

-- The platform cost dashboard reads usage across ALL tenants.
GRANT SELECT ON ai_evaluation TO boca_platform;
CREATE POLICY platform_read_ai_eval ON ai_evaluation
  FOR SELECT TO boca_platform USING (true);

-- Down Migration

DROP POLICY IF EXISTS platform_read_ai_eval ON ai_evaluation;
REVOKE SELECT ON ai_evaluation FROM boca_platform;
ALTER TABLE ai_evaluation DROP COLUMN IF EXISTS cost_usd;
ALTER TABLE ai_evaluation DROP COLUMN IF EXISTS output_tokens;
ALTER TABLE ai_evaluation DROP COLUMN IF EXISTS input_tokens;
DROP TABLE IF EXISTS ai_model_price;
DROP TABLE IF EXISTS ai_settings;
