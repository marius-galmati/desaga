-- Up Migration
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

-- Down Migration
DROP TABLE IF EXISTS guest_feedback;
DROP TABLE IF EXISTS alert;
DROP TABLE IF EXISTS service_request_escalation;
DROP TABLE IF EXISTS service_request;
