import type {
  DishEvaluationSummary,
  EvaluationDetail,
  ManagementMetrics,
  MetricsPeriod,
} from "@boca/contracts";
import {
  countNotScoreableEvaluations,
  getCompletedEvaluationsForMetrics,
  getEvaluationById,
  getReferencePhotosForSet,
  listEvaluationsForDish,
  softDeleteEvaluation,
  withTenant,
} from "@boca/db";
import { Injectable } from "@nestjs/common";
import type { Principal } from "../../common/principal";
import { projectEvaluation, type ServiceResult } from "../evaluation/evaluation.service";
import { StorageService } from "../storage/storage.service";
import { parseBilingual } from "./admin.helpers";

// A dish scoring below this median is flagged "sub prag" — mirrors the report
// verdict boundary (>= 3.5 is "conform"), rounded to the dashboard threshold.
const UNDER_THRESHOLD = 4.0;
// Cap on how many chronological scores feed a dish trendline.
const SPARK_POINTS = 12;

const PERIOD_MS: Record<Exclude<MetricsPeriod, "all">, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

const RANGE_LABEL: Record<MetricsPeriod, string> = {
  day: "Ultimele 24 de ore",
  week: "Ultimele 7 zile",
  month: "Ultimele 30 de zile",
  all: "De la început",
};

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/** Population standard deviation — the ± spread shown as "dispersie". */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

@Injectable()
export class MetricsService {
  constructor(private readonly storage: StorageService) {}

  async getMetrics(principal: Principal, period: MetricsPeriod): Promise<ManagementMetrics> {
    const since = period === "all" ? undefined : new Date(Date.now() - PERIOD_MS[period]);

    return withTenant(principal.tenantId, async (trx) => {
      const [rows, notScoreable] = await Promise.all([
        getCompletedEvaluationsForMetrics(trx, principal.tenantId, since),
        countNotScoreableEvaluations(trx, principal.tenantId, since),
      ]);

      // Fold the raw rows (chronological) into per-dish and per-operator groups.
      const byDish = new Map<string, { name: unknown; scores: number[] }>();
      const byStaff = new Map<string, { userId: string | null; name: string; scores: number[] }>();
      const allScores: number[] = [];

      for (const row of rows) {
        const score = Number(row.overallScore);
        if (!Number.isFinite(score)) continue;
        allScores.push(score);

        const dish = byDish.get(row.dishId);
        if (dish) {
          dish.scores.push(score);
        } else {
          byDish.set(row.dishId, { name: row.dishName, scores: [score] });
        }

        const staffKey = row.capturedBy ?? "unknown";
        const staff = byStaff.get(staffKey);
        if (staff) {
          staff.scores.push(score);
        } else {
          byStaff.set(staffKey, {
            userId: row.capturedBy ?? null,
            name: row.capturedByName ?? "Operator necunoscut",
            scores: [score],
          });
        }
      }

      const dishes = [...byDish.entries()]
        .map(([dishId, d]) => {
          const spark = d.scores.slice(-SPARK_POINTS);
          return {
            dishId,
            name: parseBilingual(d.name),
            median: median(d.scores),
            dispersion: stdDev(d.scores),
            sample: d.scores.length,
            spark,
            trend: spark.length >= 2 ? (spark[spark.length - 1] ?? 0) - (spark[0] ?? 0) : 0,
          };
        })
        // Worst conformity first, so it surfaces to the top like the demo.
        .sort((a, b) => a.median - b.median);

      const staff = [...byStaff.values()]
        .map((s) => ({
          userId: s.userId,
          name: s.name,
          conformity: mean(s.scores),
          plates: s.scores.length,
        }))
        .sort((a, b) => b.conformity - a.conformity);

      return {
        period,
        rangeLabel: RANGE_LABEL[period],
        generatedAt: new Date().toISOString(),
        kpis: {
          avgConformity: allScores.length ? mean(allScores) : null,
          platesEvaluated: allScores.length,
          notScoreable,
          dishesUnderThreshold: dishes.filter((d) => d.median < UNDER_THRESHOLD).length,
          dishesTracked: dishes.length,
        },
        dishes,
        staff,
      };
    });
  }

  /** Drill-down: the individual evaluations of one dish, newest first. */
  async listDishEvaluations(
    principal: Principal,
    dishId: string,
  ): Promise<DishEvaluationSummary[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await listEvaluationsForDish(trx, principal.tenantId, dishId);
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        notScoreableReason: r.notScoreableReason,
        overallMedian:
          r.status === "completed" && r.overallScore !== null ? Number(r.overallScore) : null,
        capturedByName: r.capturedByName,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  /** Full 6-criteria report for one evaluation, exactly as scored, with photos. */
  async getEvaluationDetail(
    principal: Principal,
    evaluationId: string,
  ): Promise<ServiceResult<EvaluationDetail>> {
    return withTenant(principal.tenantId, async (trx) => {
      const row = await getEvaluationById(trx, evaluationId);
      if (!row || row.deleted_at) {
        return { ok: false as const, status: 404 as const, message: "evaluation not found" };
      }
      const evaluation = await projectEvaluation(trx, row);
      const candidateUrl = row.pass_photo_storage_key
        ? await this.storage.getSignedUrl(row.pass_photo_storage_key)
        : null;
      const refPhotos = row.reference_set_id
        ? await getReferencePhotosForSet(trx, principal.tenantId, row.reference_set_id)
        : [];
      const referenceUrls = await Promise.all(
        refPhotos.map((p) => this.storage.getSignedUrl(p.storage_key)),
      );
      return {
        ok: true as const,
        value: {
          evaluation,
          dishName: parseBilingual(row.dish_name),
          capturedByName: row.captured_by_name,
          candidateUrl,
          referenceUrls,
        },
      };
    });
  }

  /** Soft-delete an evaluation (kept for retention, dropped from reports). */
  async deleteEvaluation(
    principal: Principal,
    evaluationId: string,
  ): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const deleted = await softDeleteEvaluation(trx, principal.tenantId, evaluationId);
      if (!deleted) {
        return { ok: false as const, status: 404 as const, message: "evaluation not found" };
      }
      return { ok: true as const, value: { ok: true as const } };
    });
  }
}
