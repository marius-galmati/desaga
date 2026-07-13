import { SCORING_CRITERION_KEYS, type ScoringCriterionKey } from "@boca/config";
import type {
  CriterionScore,
  CriterionScores,
  EvaluationOverall,
  ModelEvaluationOutput,
} from "@boca/contracts";

// Pure ensemble math — median aggregation of N identical model calls.
// Persisted shapes: criteria medians -> ai_evaluation.criterion_scores,
// overall -> ai_evaluation.overall_score, all raw runs -> raw_ensemble.

/** Statistical median: mean of the two middle values for even counts. */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("medianOf: empty input");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Integer (lower) median — criterion scores must stay 1..5 integers even for
 * even ensemble sizes; the LOWER order statistic is the conservative pick.
 * Identical to medianOf for the default odd ensemble-of-3.
 */
export function lowerMedianInt(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("lowerMedianInt: empty input");
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] as number;
}

export interface EnsembleAggregate {
  /** Per-criterion ensemble medians (the persisted criterion_scores shape). */
  criteria: CriterionScores;
  /** Server-derived overall — median of the 6 criterion medians, 2 decimals. */
  overall: EvaluationOverall;
  /** Majority vote across runs. */
  dishMismatch: boolean;
  /** score max-min per criterion (basis of the lowAgreement flag). */
  scoreRanges: Record<ScoringCriterionKey, number>;
}

const LOW_AGREEMENT_RANGE = 1;

export function aggregateEnsemble(runs: readonly ModelEvaluationOutput[]): EnsembleAggregate {
  if (runs.length === 0) {
    throw new Error("aggregateEnsemble: empty ensemble");
  }

  const criteria = {} as Record<ScoringCriterionKey, CriterionScore>;
  const scoreRanges = {} as Record<ScoringCriterionKey, number>;
  for (const key of SCORING_CRITERION_KEYS) {
    const scores = runs.map((run) => run.criteria[key].score);
    const medianScore = lowerMedianInt(scores);
    scoreRanges[key] = Math.max(...scores) - Math.min(...scores);
    // Justification of the first run that voted the median score; median confidence.
    const medianRun = runs.find((run) => run.criteria[key].score === medianScore) ?? runs[0];
    criteria[key] = {
      score: medianScore,
      justification: (medianRun as ModelEvaluationOutput).criteria[key].justification,
      confidence: round2(medianOf(runs.map((run) => run.criteria[key].confidence))),
    };
  }

  const lowAgreement = SCORING_CRITERION_KEYS.some((key) => scoreRanges[key] > LOW_AGREEMENT_RANGE);
  const overallMedian = round2(medianOf(SCORING_CRITERION_KEYS.map((key) => criteria[key].score)));
  const mismatchVotes = runs.filter((run) => run.dishMismatch).length;

  return {
    criteria,
    overall: { median: overallMedian, lowAgreement },
    dishMismatch: mismatchVotes * 2 > runs.length,
    scoreRanges,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
