-- Up Migration
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
CREATE TYPE reference_photo_role     AS ENUM ('primary','holdout');   -- 3 primary + 2 holdout, checked at approval
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
CREATE TYPE audit_actor_type         AS ENUM ('staff','guest','system','platform_admin');

-- Down Migration
DROP TYPE IF EXISTS
  user_role, table_session_status, order_status, payment_status,
  service_request_kind, service_request_status, reference_set_status,
  tolerance_profile_status, reference_photo_role, capture_mode,
  photo_upload_status, skip_reason, quality_gate_status, eval_mode, eval_status,
  not_scoreable_reason, attribution_role, attribution_method, go_live_status,
  coaching_report_status, alert_rule, alert_status, outbox_status, shift_status,
  audit_actor_type
CASCADE;
