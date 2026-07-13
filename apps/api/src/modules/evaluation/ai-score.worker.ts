import { EVAL_QUEUE_NAME, PREPROCESSING_VERSION } from "@boca/config";
import {
  getEvaluationById,
  updateEvaluationCompleted,
  updateEvaluationFailed,
  updateEvaluationNotScoreable,
  updateEvaluationRunning,
  updatePassPhotoQuality,
  withTenant,
} from "@boca/db";
import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import IORedis from "ioredis";
import { ENV, type Env } from "../../config/env";
import { aiInputKeyFor } from "../storage/keys";
import { StorageService } from "../storage/storage.service";
import type { AiScoreJobData } from "./eval-queue.service";
import { buildToleranceText, EvaluatorService } from "./evaluator.service";
import { runQualityGates, toAiInputJpeg } from "./preprocess";

type EvaluationSnapshot = {
  row: NonNullable<Awaited<ReturnType<typeof getEvaluationById>>>;
  referencePhotos: { storage_key: string; role: string }[];
  toleranceCriteria: unknown;
};

/**
 * Consumer side of the ai-score queue. Registered ONLY by main.worker.ts —
 * the HTTP entrypoint instantiates this provider but never calls start().
 *
 * Job flow per evaluation:
 *  1. claim tx: queued -> running + snapshot (photo key, pinned reference
 *     photos, pinned tolerance criteria);
 *  2. fetch candidate original from MinIO, run sharp quality gates; failure
 *     -> pass_photo.quality (machine detail) + not_scoreable/quality_gate_failed;
 *  3. build model inputs (pre-built ai.jpg derivatives, re-encode fallback),
 *     ensemble-of-3 evaluate (real Anthropic or deterministic mock);
 *  4. terminal tx: completed (medians + raw ensemble + re-asserted pinned
 *     config) — any thrown error instead lands as eval_failed with detail.
 */
@Injectable()
export class AiScoreWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(AiScoreWorker.name);
  private worker: Worker<AiScoreJobData> | undefined;
  private connection: IORedis | undefined;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageService,
    private readonly evaluator: EvaluatorService,
  ) {}

  start(): void {
    if (this.worker) {
      return;
    }
    // maxRetriesPerRequest: null is required by BullMQ blocking connections.
    this.connection = new IORedis(this.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.connection.on("error", (error) => {
      this.logger.error(`redis (worker) error: ${error.message}`);
    });
    this.worker = new Worker<AiScoreJobData>(EVAL_QUEUE_NAME, (job) => this.process(job), {
      connection: this.connection,
      concurrency: 2,
    });
    this.worker.on("failed", (job, error) => {
      this.logger.error(`job ${job?.id ?? "?"} failed: ${error.message}`);
    });
    this.worker.on("error", (error) => {
      this.logger.error(`worker error: ${error.message}`);
    });
    this.logger.log(
      `ai-score worker started (queue '${EVAL_QUEUE_NAME}', model '${this.evaluator.pinnedModelId}')`,
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    // BullMQ does not close externally-provided connections — quit explicitly.
    await this.connection?.quit().catch(() => undefined);
    this.worker = undefined;
    this.connection = undefined;
  }

  async process(job: Job<AiScoreJobData>): Promise<void> {
    const { evaluationId, tenantId } = job.data;
    const startedAt = Date.now();

    const snapshot = await withTenant(tenantId, async (trx): Promise<EvaluationSnapshot | null> => {
      const claimed = await updateEvaluationRunning(trx, evaluationId);
      if (!claimed) {
        return null; // not queued anymore (duplicate delivery / terminal row)
      }
      const row = await getEvaluationById(trx, evaluationId);
      if (!row) {
        return null;
      }
      const referencePhotos = row.reference_set_id
        ? await trx
            .selectFrom("reference_photo")
            .select(["storage_key", "role"])
            .where("reference_set_id", "=", row.reference_set_id)
            .orderBy("sort_order")
            .orderBy("id")
            .execute()
        : [];
      const tolerance = row.tolerance_profile_id
        ? await trx
            .selectFrom("tolerance_profile")
            .select(["criteria"])
            .where("id", "=", row.tolerance_profile_id)
            .executeTakeFirst()
        : undefined;
      return { row, referencePhotos, toleranceCriteria: tolerance?.criteria ?? null };
    });

    if (!snapshot) {
      this.logger.warn(`evaluation ${evaluationId}: not claimable, skipping`);
      return;
    }

    try {
      await this.evaluate(tenantId, snapshot, startedAt);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`evaluation ${evaluationId}: ${detail}`);
      await withTenant(tenantId, (trx) =>
        updateEvaluationFailed(trx, {
          evaluationId,
          failureDetail: detail.slice(0, 2000),
          latencyMs: Date.now() - startedAt,
        }),
      );
    }
  }

  private async evaluate(
    tenantId: string,
    snapshot: EvaluationSnapshot,
    startedAt: number,
  ): Promise<void> {
    const { row, referencePhotos, toleranceCriteria } = snapshot;
    if (!row.pass_photo_storage_key) {
      throw new Error("pass photo has no storage key");
    }
    const original = await this.storage.getObject(row.pass_photo_storage_key);

    const gates = await runQualityGates(original);
    await withTenant(tenantId, async (trx) => {
      await updatePassPhotoQuality(trx, {
        passPhotoId: row.pass_photo_id,
        quality: gates,
        qualityStatus: gates.passed ? "passed" : "failed",
      });
      if (!gates.passed) {
        await updateEvaluationNotScoreable(trx, {
          evaluationId: row.id,
          reason: "quality_gate_failed",
          latencyMs: Date.now() - startedAt,
        });
      }
    });
    if (!gates.passed) {
      this.logger.log(
        `evaluation ${row.id}: quality gate failed (${gates.failures.map((f) => f.code).join(", ")})`,
      );
      return;
    }

    if (!row.reference_set_id || !row.tolerance_profile_id) {
      // createQueuedEvaluation only enqueues fully pinned rows; belt and braces.
      throw new Error("pinned reference set / tolerance profile missing on a queued row");
    }
    const primaries = referencePhotos.filter((photo) => photo.role === "primary").slice(0, 3);
    if (primaries.length !== 3) {
      throw new Error(`pinned reference set has ${primaries.length} primary photos, expected 3`);
    }

    const referenceJpegs = await Promise.all(
      primaries.map((photo) => this.loadAiInput(photo.storage_key)),
    );
    const candidateJpeg = await this.loadAiInput(row.pass_photo_storage_key, original);

    const result = await this.evaluator.evaluateEnsemble({
      referenceJpegs,
      candidateJpeg,
      toleranceText: buildToleranceText(toleranceCriteria),
    });

    await withTenant(tenantId, (trx) =>
      updateEvaluationCompleted(trx, {
        evaluationId: row.id,
        config: {
          modelId: result.modelId,
          promptVersion: result.promptVersion,
          promptHash: result.promptHash,
          preprocessingVersion: PREPROCESSING_VERSION,
        },
        referenceSetId: row.reference_set_id as string,
        toleranceProfileId: row.tolerance_profile_id as string,
        criterionScores: result.aggregate.criteria,
        overallScore: result.aggregate.overall.median,
        rawEnsemble: {
          runs: result.runs,
          lowAgreement: result.aggregate.overall.lowAgreement,
          dishMismatch: result.aggregate.dishMismatch,
          scoreRanges: result.aggregate.scoreRanges,
        },
        ensembleSize: result.ensembleSize,
        latencyMs: Date.now() - startedAt,
      }),
    );
    this.logger.log(
      `evaluation ${row.id}: completed (overall ${result.aggregate.overall.median}, lowAgreement=${result.aggregate.overall.lowAgreement})`,
    );
  }

  /** Pre-built ai.jpg derivative, or re-encode the original on the fly. */
  private async loadAiInput(originalKey: string, originalBytes?: Buffer): Promise<Buffer> {
    try {
      return await this.storage.getObject(aiInputKeyFor(originalKey));
    } catch {
      const source = originalBytes ?? (await this.storage.getObject(originalKey));
      return toAiInputJpeg(source);
    }
  }
}
