import type { Selectable } from "kysely";
import type { AiEvaluation, EvalMode, NotScoreableReason } from "../generated/db";
import type { TenantTransaction } from "../tenant";
import { getDishVersionById } from "./menu";
import { type InsertPassPhotoParams, insertPassPhoto } from "./passPhotos";
import {
  getActiveReferenceSetForDishVersion,
  getActiveToleranceProfileForDish,
} from "./references";

/** Everything a completed row must be able to reproduce forever (0009). */
export interface PinnedEvalConfig {
  modelId: string;
  promptVersion: string;
  promptHash: string;
  preprocessingVersion: string;
}

export interface CreateDemoOrderItemParams {
  tenantId: string;
  locationId: string;
  tableSessionId: string;
  dishVersionId: string;
}

export interface CreatedDemoOrderItem {
  orderId: string;
  orderItemId: string;
  dishId: string;
  dishVersionId: string;
  nonScoreable: boolean;
}

/**
 * Synthetic guest_order + order_item anchoring a demo pass_photo. Price/VAT
 * are snapshotted from the pinned dish_version exactly like a real order; the
 * item is 'fired' (the state a plate is in when it reaches the pass). Order
 * totals stay 0 — the row exists only to satisfy the FK chain.
 */
export async function createDemoOrderItem(
  trx: TenantTransaction,
  params: CreateDemoOrderItemParams,
): Promise<CreatedDemoOrderItem> {
  const version = await getDishVersionById(trx, params.dishVersionId);
  if (!version) {
    throw new Error(`createDemoOrderItem: dish_version ${params.dishVersionId} not found`);
  }

  const order = await trx
    .insertInto("guest_order")
    .values({
      tenant_id: params.tenantId,
      location_id: params.locationId,
      table_session_id: params.tableSessionId,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const item = await trx
    .insertInto("order_item")
    .values({
      tenant_id: params.tenantId,
      order_id: order.id,
      dish_id: version.dish_id,
      dish_version_id: version.id,
      quantity: 1,
      unit_price_minor: version.price_minor,
      vat_rate_bp: version.vat_rate_bp,
      line_total_minor: version.price_minor,
      status: "fired",
      fired_at: new Date(),
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  return {
    orderId: order.id,
    orderItemId: item.id,
    dishId: version.dish_id,
    dishVersionId: version.id,
    nonScoreable: version.non_scoreable,
  };
}

export interface CreateQueuedEvaluationParams {
  tenantId: string;
  locationId: string;
  tableSessionId: string;
  dishVersionId: string;
  photo: Omit<InsertPassPhotoParams, "tenantId" | "locationId" | "orderItemId">;
  mode: EvalMode;
  config: PinnedEvalConfig;
  /** Ensemble-of-3 during calibration. */
  ensembleSize?: number;
}

export interface QueuedEvaluationResult {
  evaluation: Selectable<AiEvaluation>;
  orderId: string;
  orderItemId: string;
  passPhotoId: string;
}

/**
 * The full demo persistence chain in the caller's tx: synthetic
 * guest_order/order_item -> pass_photo -> ai_evaluation. The active
 * reference_set (per the dish_version PINNED on the item) and the active
 * tolerance_profile are resolved and pinned at enqueue time; when either is
 * missing (or the dish is non-scoreable) the row is inserted directly as
 * not_scoreable with the machine-readable reason instead of queued.
 */
export async function createQueuedEvaluation(
  trx: TenantTransaction,
  params: CreateQueuedEvaluationParams,
): Promise<QueuedEvaluationResult> {
  const orderItem = await createDemoOrderItem(trx, {
    tenantId: params.tenantId,
    locationId: params.locationId,
    tableSessionId: params.tableSessionId,
    dishVersionId: params.dishVersionId,
  });

  const passPhotoId = await insertPassPhoto(trx, {
    ...params.photo,
    tenantId: params.tenantId,
    locationId: params.locationId,
    orderItemId: orderItem.orderItemId,
  });

  const referenceSet = await getActiveReferenceSetForDishVersion(trx, params.dishVersionId);
  const toleranceProfileId = await getActiveToleranceProfileForDish(trx, orderItem.dishId);

  let notScoreableReason: NotScoreableReason | null = null;
  if (orderItem.nonScoreable) {
    notScoreableReason = "non_scoreable_dish";
  } else if (!referenceSet) {
    notScoreableReason = "refs_stale";
  } else if (!toleranceProfileId) {
    notScoreableReason = "no_active_tolerance";
  }

  const evaluation = await trx
    .insertInto("ai_evaluation")
    .values({
      tenant_id: params.tenantId,
      pass_photo_id: passPhotoId,
      mode: params.mode,
      status: notScoreableReason === null ? "queued" : "not_scoreable",
      not_scoreable_reason: notScoreableReason,
      model_id: params.config.modelId,
      prompt_version: params.config.promptVersion,
      prompt_hash: params.config.promptHash,
      preprocessing_version: params.config.preprocessingVersion,
      reference_set_id: referenceSet?.set.id ?? null,
      tolerance_profile_id: toleranceProfileId ?? null,
      ensemble_size: params.ensembleSize ?? 3,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    evaluation,
    orderId: orderItem.orderId,
    orderItemId: orderItem.orderItemId,
    passPhotoId,
  };
}

export interface CreateEvaluationForItemParams {
  tenantId: string;
  locationId: string;
  orderItemId: string;
  dishId: string;
  dishVersionId: string;
  nonScoreable: boolean;
  photo: Omit<InsertPassPhotoParams, "tenantId" | "locationId" | "orderItemId">;
  mode: EvalMode;
  config: PinnedEvalConfig;
  ensembleSize?: number;
}

/**
 * Queue an evaluation against a REAL order_item (a plate actually ordered): the
 * pass_photo binds to it instead of a synthetic demo chain, so the evaluation is
 * part of the real audit trail. Same reference-set/tolerance pinning and
 * not_scoreable short-circuit as {@link createQueuedEvaluation}.
 */
export async function createQueuedEvaluationForOrderItem(
  trx: TenantTransaction,
  params: CreateEvaluationForItemParams,
): Promise<{ evaluation: Selectable<AiEvaluation>; passPhotoId: string }> {
  const passPhotoId = await insertPassPhoto(trx, {
    ...params.photo,
    tenantId: params.tenantId,
    locationId: params.locationId,
    orderItemId: params.orderItemId,
  });

  const referenceSet = await getActiveReferenceSetForDishVersion(trx, params.dishVersionId);
  const toleranceProfileId = await getActiveToleranceProfileForDish(trx, params.dishId);

  let notScoreableReason: NotScoreableReason | null = null;
  if (params.nonScoreable) {
    notScoreableReason = "non_scoreable_dish";
  } else if (!referenceSet) {
    notScoreableReason = "refs_stale";
  } else if (!toleranceProfileId) {
    notScoreableReason = "no_active_tolerance";
  }

  const evaluation = await trx
    .insertInto("ai_evaluation")
    .values({
      tenant_id: params.tenantId,
      pass_photo_id: passPhotoId,
      mode: params.mode,
      status: notScoreableReason === null ? "queued" : "not_scoreable",
      not_scoreable_reason: notScoreableReason,
      model_id: params.config.modelId,
      prompt_version: params.config.promptVersion,
      prompt_hash: params.config.promptHash,
      preprocessing_version: params.config.preprocessingVersion,
      reference_set_id: referenceSet?.set.id ?? null,
      tolerance_profile_id: toleranceProfileId ?? null,
      ensemble_size: params.ensembleSize ?? 3,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { evaluation, passPhotoId };
}

/** queued -> running; false when the row was not in 'queued'. */
export async function updateEvaluationRunning(
  trx: TenantTransaction,
  evaluationId: string,
): Promise<boolean> {
  const result = await trx
    .updateTable("ai_evaluation")
    .set({ status: "running" })
    .where("id", "=", evaluationId)
    .where("status", "=", "queued")
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export interface CompleteEvaluationParams {
  evaluationId: string;
  /** Re-asserted by the worker: exactly what the calls actually used. */
  config: PinnedEvalConfig;
  referenceSetId: string;
  toleranceProfileId: string;
  /** {criterion_code: {score, justification_ro, confidence}} x 6 (+ flags). */
  criterionScores: unknown;
  /** Median-derived overall, numeric(3,2). */
  overallScore: number;
  /** ALL raw ensemble runs, persisted verbatim. */
  rawEnsemble: unknown;
  ensembleSize: number;
  latencyMs: number;
}

/**
 * Terminal success. Satisfies the completed-CHECK (pinned reference set +
 * tolerance profile + scores + completed_at all present in one statement).
 */
export async function updateEvaluationCompleted(
  trx: TenantTransaction,
  params: CompleteEvaluationParams,
): Promise<boolean> {
  const result = await trx
    .updateTable("ai_evaluation")
    .set({
      status: "completed",
      model_id: params.config.modelId,
      prompt_version: params.config.promptVersion,
      prompt_hash: params.config.promptHash,
      preprocessing_version: params.config.preprocessingVersion,
      reference_set_id: params.referenceSetId,
      tolerance_profile_id: params.toleranceProfileId,
      criterion_scores: JSON.stringify(params.criterionScores),
      overall_score: params.overallScore,
      raw_ensemble: JSON.stringify(params.rawEnsemble),
      ensemble_size: params.ensembleSize,
      latency_ms: params.latencyMs,
      completed_at: new Date(),
    })
    .where("id", "=", params.evaluationId)
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

/**
 * Terminal not-scoreable (e.g. quality_gate_failed). Machine-readable detail
 * belongs in pass_photo.quality (updatePassPhotoQuality) — failure_detail is
 * reserved for eval_failed rows by the schema.
 */
export async function updateEvaluationNotScoreable(
  trx: TenantTransaction,
  params: { evaluationId: string; reason: NotScoreableReason; latencyMs?: number },
): Promise<boolean> {
  const result = await trx
    .updateTable("ai_evaluation")
    .set({
      status: "not_scoreable",
      not_scoreable_reason: params.reason,
      latency_ms: params.latencyMs ?? null,
    })
    .where("id", "=", params.evaluationId)
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

/** Terminal failure; the CHECK requires failure_detail. */
export async function updateEvaluationFailed(
  trx: TenantTransaction,
  params: { evaluationId: string; failureDetail: string; latencyMs?: number },
): Promise<boolean> {
  const result = await trx
    .updateTable("ai_evaluation")
    .set({
      status: "eval_failed",
      failure_detail: params.failureDetail,
      latency_ms: params.latencyMs ?? null,
    })
    .where("id", "=", params.evaluationId)
    .where("status", "in", ["queued", "running"])
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

/** Polling read: evaluation + photo + pinned dish context in one row. */
export async function getEvaluationById(trx: TenantTransaction, evaluationId: string) {
  return trx
    .selectFrom("ai_evaluation as e")
    .innerJoin("pass_photo as p", (join) =>
      join.onRef("p.id", "=", "e.pass_photo_id").onRef("p.tenant_id", "=", "e.tenant_id"),
    )
    .innerJoin("order_item as oi", (join) =>
      join.onRef("oi.id", "=", "p.order_item_id").onRef("oi.tenant_id", "=", "p.tenant_id"),
    )
    .innerJoin("dish_version as dv", (join) =>
      join.onRef("dv.id", "=", "oi.dish_version_id").onRef("dv.tenant_id", "=", "oi.tenant_id"),
    )
    .selectAll("e")
    .select([
      "p.storage_key as pass_photo_storage_key",
      "p.quality_status as pass_photo_quality_status",
      "p.quality as pass_photo_quality",
      "oi.dish_id",
      "oi.dish_version_id",
      "dv.name as dish_name",
    ])
    .where("e.id", "=", evaluationId)
    .executeTakeFirst();
}
