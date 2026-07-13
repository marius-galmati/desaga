-- Up Migration
-- ============================================================================
-- BOCA MVP SCHEMA v0.2 — split from db/schema.sql (source of truth for design
-- commentary) into ordered migrations 0002..0013.
-- Conventions: snake_case; PK uuid v7; timestamptz everywhere; RON in integer
-- minor units (bani); every tenant-scoped table: tenant_id uuid NOT NULL,
-- UNIQUE (tenant_id, id) as composite-FK anchor, RLS policy (0013), and ALL
-- indexes lead with tenant_id.
-- Trigger bodies t2-t7 (immutability guards, refs_stale, audit row-triggers,
-- evidence pinning, allergen array validation, retention) deliberately land
-- with their module increments; t1 (set_updated_at) is attached in the
-- migration that creates each table.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS & HELPERS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;

-- UUIDv7: PG16 has no native generator (lands in PG18). This function is the
-- column DEFAULT; the app MAY pre-generate v7 ids (npm `uuidv7`) — both emit
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
-- Attached BEFORE UPDATE to every table that has updated_at (t1 list in
-- db/schema.sql section 13), in the migration that creates the table.

-- Down Migration
DROP FUNCTION IF EXISTS set_updated_at();
DROP FUNCTION IF EXISTS uuid_generate_v7();
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pgcrypto;
