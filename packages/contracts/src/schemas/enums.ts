import { z } from "zod";

// Zod mirrors of every CREATE TYPE in db/schema.sql, same names, same value
// order. must match db enums — CI diff test guards this (planned Testcontainers
// test: SELECT enum values from pg_enum and diff against `dbEnums` below).

export const userRoleSchema = z.enum([
  "tenant_admin",
  "manager",
  "waiter",
  "kitchen_pass",
  "management_viewer",
]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const tableSessionStatusSchema = z.enum(["open", "bill_requested", "closed", "expired"]);
export type TableSessionStatus = z.infer<typeof tableSessionStatusSchema>;

// Shared by guest_order and order_item. Order-level uses submitted|accepted|
// served|voided; fired/ready are item-level only (see schemas/transitions.ts).
export const orderStatusSchema = z.enum([
  "submitted",
  "accepted",
  "fired",
  "ready",
  "served",
  "voided",
]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum(["unpaid", "paid", "refunded", "comped"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const serviceRequestKindSchema = z.enum(["call_waiter", "request_bill"]);
export type ServiceRequestKind = z.infer<typeof serviceRequestKindSchema>;

export const serviceRequestStatusSchema = z.enum([
  "open",
  "acknowledged",
  "escalated",
  "resolved",
  "cancelled",
]);
export type ServiceRequestStatus = z.infer<typeof serviceRequestStatusSchema>;

export const referenceSetStatusSchema = z.enum(["draft", "active", "retired"]);
export type ReferenceSetStatus = z.infer<typeof referenceSetStatusSchema>;

export const toleranceProfileStatusSchema = z.enum(["draft", "active", "retired"]);
export type ToleranceProfileStatus = z.infer<typeof toleranceProfileStatusSchema>;

export const referencePhotoRoleSchema = z.enum(["primary", "holdout"]);
export type ReferencePhotoRole = z.infer<typeof referencePhotoRoleSchema>;

export const captureModeSchema = z.enum(["auto", "manual"]);
export type CaptureMode = z.infer<typeof captureModeSchema>;

export const photoUploadStatusSchema = z.enum(["pending", "uploaded", "failed"]);
export type PhotoUploadStatus = z.infer<typeof photoUploadStatusSchema>;

export const skipReasonSchema = z.enum(["rush", "tableside", "tech", "other"]);
export type SkipReason = z.infer<typeof skipReasonSchema>;

export const qualityGateStatusSchema = z.enum(["pending", "passed", "failed"]);
export type QualityGateStatus = z.infer<typeof qualityGateStatusSchema>;

export const evalModeSchema = z.enum(["shadow", "active"]);
export type EvalMode = z.infer<typeof evalModeSchema>;

export const evalStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "not_scoreable",
  "eval_failed",
]);
export type EvalStatus = z.infer<typeof evalStatusSchema>;

export const notScoreableReasonSchema = z.enum([
  "refs_stale",
  "non_scoreable_dish",
  "quality_gate_failed",
  "photo_skipped",
  "no_active_tolerance",
  "other",
]);
export type NotScoreableReason = z.infer<typeof notScoreableReasonSchema>;

export const attributionRoleSchema = z.enum(["station_chef", "plating_chef"]);
export type AttributionRole = z.infer<typeof attributionRoleSchema>;

export const attributionMethodSchema = z.enum([
  "dish_station_roster",
  "kds_bump_roster",
  "self_claim",
  "manual",
]);
export type AttributionMethod = z.infer<typeof attributionMethodSchema>;

export const goLiveStatusSchema = z.enum(["pending", "passed", "failed"]);
export type GoLiveStatus = z.infer<typeof goLiveStatusSchema>;

export const coachingReportStatusSchema = z.enum(["draft", "issued", "acknowledged", "disputed"]);
export type CoachingReportStatus = z.infer<typeof coachingReportStatusSchema>;

export const alertRuleSchema = z.enum([
  "dish_wow_drop",
  "dish_three_week_decline",
  "skip_rate_high",
]);
export type AlertRule = z.infer<typeof alertRuleSchema>;

export const alertStatusSchema = z.enum(["open", "acknowledged", "resolved"]);
export type AlertStatus = z.infer<typeof alertStatusSchema>;

export const outboxStatusSchema = z.enum(["pending", "processing", "completed", "failed"]);
export type OutboxStatus = z.infer<typeof outboxStatusSchema>;

export const shiftStatusSchema = z.enum(["planned", "open", "closed"]);
export type ShiftStatus = z.infer<typeof shiftStatusSchema>;

export const auditActorTypeSchema = z.enum(["staff", "guest", "system", "platform_admin"]);
export type AuditActorType = z.infer<typeof auditActorTypeSchema>;

// Keyed by the Postgres type name so the anti-drift test can diff 1:1 against
// pg_enum. Adding a db enum without touching this map is the failure mode the
// test exists to catch.
export const dbEnums = {
  user_role: userRoleSchema.options,
  table_session_status: tableSessionStatusSchema.options,
  order_status: orderStatusSchema.options,
  payment_status: paymentStatusSchema.options,
  service_request_kind: serviceRequestKindSchema.options,
  service_request_status: serviceRequestStatusSchema.options,
  reference_set_status: referenceSetStatusSchema.options,
  tolerance_profile_status: toleranceProfileStatusSchema.options,
  reference_photo_role: referencePhotoRoleSchema.options,
  capture_mode: captureModeSchema.options,
  photo_upload_status: photoUploadStatusSchema.options,
  skip_reason: skipReasonSchema.options,
  quality_gate_status: qualityGateStatusSchema.options,
  eval_mode: evalModeSchema.options,
  eval_status: evalStatusSchema.options,
  not_scoreable_reason: notScoreableReasonSchema.options,
  attribution_role: attributionRoleSchema.options,
  attribution_method: attributionMethodSchema.options,
  go_live_status: goLiveStatusSchema.options,
  coaching_report_status: coachingReportStatusSchema.options,
  alert_rule: alertRuleSchema.options,
  alert_status: alertStatusSchema.options,
  outbox_status: outboxStatusSchema.options,
  shift_status: shiftStatusSchema.options,
  audit_actor_type: auditActorTypeSchema.options,
} as const satisfies Record<string, readonly [string, ...string[]]>;
