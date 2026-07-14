import { EVAL_DEFAULTS, PREPROCESSING_VERSION } from "@boca/config";
import {
  type AiEvaluation,
  type CaptureRequest,
  type CreateEvaluationRequest,
  criterionScoresSchema,
  type PassQueueItem,
} from "@boca/contracts";
import {
  createQueuedEvaluation,
  createQueuedEvaluationForOrderItem,
  DEMO_CAPTURE_PROFILE_VERSION,
  ensureDemoFixtures,
  getActiveReferenceSetForDishVersion,
  getEvaluationById,
  listActiveLocations,
  type TenantTransaction,
  updateEvaluationFailed,
  withTenant,
} from "@boca/db";
import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import type { Principal } from "../../common/principal";
import { parseBilingual } from "../admin/admin.helpers";
import { isOwnDemoPhotoKey } from "../storage/keys";
import { StorageService } from "../storage/storage.service";
import { EvalQueueService } from "./eval-queue.service";
import { EvaluatorService } from "./evaluator.service";

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 404 | 409; message: string };

/** Shape of ai_evaluation.raw_ensemble as written by AiScoreWorker. */
const rawEnsembleSchema = z.object({
  runs: z.array(z.unknown()),
  lowAgreement: z.boolean(),
  dishMismatch: z.boolean(),
});

export async function resolveLocationId(
  trx: TenantTransaction,
  principal: Principal,
): Promise<string | undefined> {
  if (principal.locationId) {
    return principal.locationId;
  }
  const locations = await listActiveLocations(trx);
  return locations[0]?.id;
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly storage: StorageService,
    private readonly queue: EvalQueueService,
    private readonly evaluator: EvaluatorService,
  ) {}

  /**
   * Enqueue flow (202): validates the candidate photoKey, persists the full
   * synthetic chain (guest_order -> order_item -> pass_photo -> ai_evaluation
   * with pinned config) in ONE tenant tx, then enqueues the BullMQ job after
   * commit so the worker can never observe an uncommitted row.
   */
  async createEvaluation(
    principal: Principal,
    request: CreateEvaluationRequest,
  ): Promise<ServiceResult<{ evaluationId: string }>> {
    if (!isOwnDemoPhotoKey(principal.tenantId, request.candidatePhotoKey)) {
      return { ok: false, status: 400, message: "candidatePhotoKey is not a demo upload key" };
    }
    if (!(await this.storage.exists(request.candidatePhotoKey))) {
      return { ok: false, status: 400, message: "candidatePhotoKey does not exist in storage" };
    }

    const outcome = await withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id", "current_version_id"])
        .where("id", "=", request.dishId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish) {
        return { ok: false, status: 404, message: "dish not found" } as const;
      }
      if (!dish.current_version_id) {
        return { ok: false, status: 400, message: "dish has no current version" } as const;
      }
      // Contract: 400 (not a queued-then-not_scoreable row) when refs missing.
      const activeSet = await getActiveReferenceSetForDishVersion(trx, dish.current_version_id);
      if (!activeSet) {
        return { ok: false, status: 400, message: "dish has no active reference set" } as const;
      }
      const locationId = await resolveLocationId(trx, principal);
      if (!locationId) {
        return { ok: false, status: 400, message: "tenant has no active location" } as const;
      }
      const fixtures = await ensureDemoFixtures(trx, { tenantId: principal.tenantId, locationId });
      const queued = await createQueuedEvaluation(trx, {
        tenantId: principal.tenantId,
        locationId,
        tableSessionId: fixtures.tableSessionId,
        dishVersionId: dish.current_version_id,
        photo: {
          storageKey: request.candidatePhotoKey,
          capturedBy: principal.userId,
          captureDeviceId: fixtures.captureDeviceId,
          captureProfileVersion: DEMO_CAPTURE_PROFILE_VERSION,
          captureMode: "manual",
        },
        mode: "shadow",
        config: {
          modelId: this.evaluator.pinnedModelId,
          promptVersion: this.evaluator.promptVersion,
          promptHash: this.evaluator.promptHash,
          preprocessingVersion: PREPROCESSING_VERSION,
        },
        ensembleSize: EVAL_DEFAULTS.ensembleSize,
      });
      return { ok: true, evaluation: queued.evaluation } as const;
    });

    if (!outcome.ok) {
      return outcome;
    }

    const evaluation = outcome.evaluation;
    if (evaluation.status === "queued") {
      try {
        await this.queue.enqueue({ evaluationId: evaluation.id, tenantId: principal.tenantId });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.logger.error(`enqueue failed for evaluation ${evaluation.id}: ${detail}`);
        await withTenant(principal.tenantId, (trx) =>
          updateEvaluationFailed(trx, {
            evaluationId: evaluation.id,
            failureDetail: `enqueue failed: ${detail.slice(0, 500)}`,
          }),
        );
      }
    }
    return { ok: true, value: { evaluationId: evaluation.id } };
  }

  /** Polling read: DB row -> aiEvaluationSchema projection. */
  async getEvaluation(
    principal: Principal,
    evaluationId: string,
  ): Promise<ServiceResult<AiEvaluation>> {
    return withTenant(principal.tenantId, async (trx) => {
      const row = await getEvaluationById(trx, evaluationId);
      if (!row) {
        return { ok: false as const, status: 404 as const, message: "evaluation not found" };
      }

      const referenceSetVersion = row.reference_set_id
        ? ((
            await trx
              .selectFrom("reference_set")
              .select(["version_no"])
              .where("id", "=", row.reference_set_id)
              .executeTakeFirst()
          )?.version_no ?? null)
        : null;
      const toleranceVersion = row.tolerance_profile_id
        ? ((
            await trx
              .selectFrom("tolerance_profile")
              .select(["version_no"])
              .where("id", "=", row.tolerance_profile_id)
              .executeTakeFirst()
          )?.version_no ?? null)
        : null;

      let report: AiEvaluation["report"] = null;
      if (row.status === "completed") {
        const criteria = criterionScoresSchema.parse(row.criterion_scores);
        const rawEnsemble = rawEnsembleSchema.parse(row.raw_ensemble);
        report = {
          criteria,
          overall: {
            median: Number(row.overall_score),
            lowAgreement: rawEnsemble.lowAgreement,
          },
          dishMismatch: rawEnsemble.dishMismatch,
        };
      }

      return {
        ok: true as const,
        value: {
          id: row.id,
          status: row.status,
          notScoreableReason: row.not_scoreable_reason,
          report,
          evalConfig: {
            model: row.model_id,
            promptVersion: row.prompt_version,
            referenceSetVersion,
            toleranceVersion,
            preprocessingVersion: row.preprocessing_version,
            ensembleSize: row.ensemble_size,
          },
          createdAt: row.created_at.toISOString(),
          completedAt: row.completed_at ? row.completed_at.toISOString() : null,
        },
      };
    });
  }

  // --- Staff pass queue (real order items) ---------------------------------

  /** Plates on active orders waiting to be shot at the pass, oldest first. */
  async listPassQueue(principal: Principal): Promise<PassQueueItem[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await trx
        .selectFrom("order_item as oi")
        .innerJoin("guest_order as go", (join) =>
          join.onRef("go.id", "=", "oi.order_id").onRef("go.tenant_id", "=", "oi.tenant_id"),
        )
        .innerJoin("table_session as ts", (join) =>
          join
            .onRef("ts.id", "=", "go.table_session_id")
            .onRef("ts.tenant_id", "=", "go.tenant_id"),
        )
        .innerJoin("dining_table as dt", (join) =>
          join.onRef("dt.id", "=", "ts.dining_table_id").onRef("dt.tenant_id", "=", "ts.tenant_id"),
        )
        .innerJoin("dish_version as dv", (join) =>
          join.onRef("dv.id", "=", "oi.dish_version_id").onRef("dv.tenant_id", "=", "oi.tenant_id"),
        )
        .select([
          "oi.id as order_item_id",
          "oi.dish_id",
          "oi.quantity",
          "dv.name",
          "dv.hero_photo_key",
          "dt.label as table_label",
          "oi.created_at",
        ])
        .where("oi.tenant_id", "=", principal.tenantId)
        .where("go.status", "in", ["submitted", "accepted"])
        .where("oi.status", "in", ["submitted", "accepted", "fired"])
        .orderBy("oi.created_at")
        .execute();
      return Promise.all(
        rows.map(async (r) => ({
          orderItemId: r.order_item_id,
          dishId: r.dish_id,
          name: parseBilingual(r.name),
          quantity: r.quantity,
          tableLabel: r.table_label,
          heroPhotoUrl: r.hero_photo_key ? await this.storage.getSignedUrl(r.hero_photo_key) : null,
        })),
      );
    });
  }

  /** Capture + evaluate a REAL plated order item (binds the pass_photo to it). */
  async createEvaluationForOrderItem(
    principal: Principal,
    request: CaptureRequest,
  ): Promise<ServiceResult<{ evaluationId: string }>> {
    if (!isOwnDemoPhotoKey(principal.tenantId, request.candidatePhotoKey)) {
      return { ok: false, status: 400, message: "candidatePhotoKey is not an upload key" };
    }
    if (!(await this.storage.exists(request.candidatePhotoKey))) {
      return { ok: false, status: 400, message: "candidatePhotoKey does not exist in storage" };
    }
    const outcome = await withTenant(principal.tenantId, async (trx) => {
      const item = await trx
        .selectFrom("order_item as oi")
        .innerJoin("guest_order as go", (join) =>
          join.onRef("go.id", "=", "oi.order_id").onRef("go.tenant_id", "=", "oi.tenant_id"),
        )
        .innerJoin("dish_version as dv", (join) =>
          join.onRef("dv.id", "=", "oi.dish_version_id").onRef("dv.tenant_id", "=", "oi.tenant_id"),
        )
        .select(["oi.id", "oi.dish_id", "oi.dish_version_id", "go.location_id", "dv.non_scoreable"])
        .where("oi.tenant_id", "=", principal.tenantId)
        .where("oi.id", "=", request.orderItemId)
        .where("go.status", "in", ["submitted", "accepted", "served"])
        .executeTakeFirst();
      if (!item) {
        return { ok: false, status: 404, message: "order item not found or not active" } as const;
      }
      const queued = await createQueuedEvaluationForOrderItem(trx, {
        tenantId: principal.tenantId,
        locationId: item.location_id,
        orderItemId: item.id,
        dishId: item.dish_id,
        dishVersionId: item.dish_version_id,
        nonScoreable: item.non_scoreable,
        photo: {
          storageKey: request.candidatePhotoKey,
          capturedBy: principal.userId,
          captureProfileVersion: DEMO_CAPTURE_PROFILE_VERSION,
          captureMode: "manual",
        },
        mode: "shadow",
        config: {
          modelId: this.evaluator.pinnedModelId,
          promptVersion: this.evaluator.promptVersion,
          promptHash: this.evaluator.promptHash,
          preprocessingVersion: PREPROCESSING_VERSION,
        },
        ensembleSize: EVAL_DEFAULTS.ensembleSize,
      });
      return { ok: true, evaluation: queued.evaluation } as const;
    });
    if (!outcome.ok) {
      return outcome;
    }
    await this.enqueueEvaluation(principal, outcome.evaluation);
    return { ok: true, value: { evaluationId: outcome.evaluation.id } };
  }

  /** Shared post-commit enqueue (mirrors createEvaluation's tail). */
  private async enqueueEvaluation(
    principal: Principal,
    evaluation: { id: string; status: string },
  ): Promise<void> {
    if (evaluation.status !== "queued") {
      return;
    }
    try {
      await this.queue.enqueue({ evaluationId: evaluation.id, tenantId: principal.tenantId });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`enqueue failed for evaluation ${evaluation.id}: ${detail}`);
      await withTenant(principal.tenantId, (trx) =>
        updateEvaluationFailed(trx, {
          evaluationId: evaluation.id,
          failureDetail: `enqueue failed: ${detail.slice(0, 500)}`,
        }),
      );
    }
  }
}
