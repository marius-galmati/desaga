-- Up Migration
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
  -- non-voided items are served (app-enforced) — this is what makes the
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

-- t1. set_updated_at
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON guest_order
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON order_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration
DROP TABLE IF EXISTS outbox_event;
DROP TABLE IF EXISTS order_item;
DROP TABLE IF EXISTS guest_order;
