import { SCORING_CRITERION_KEYS } from "@boca/config";
import { modelEvaluationOutputSchema } from "@boca/contracts";
import { describe, expect, it } from "vitest";
import { mockEvaluationRun, mockSeedFor } from "../src/modules/evaluation/mock-evaluator";

const IMAGE_A = Buffer.from("demo-candidate-plate-photo-A");
const IMAGE_B = Buffer.from("demo-candidate-plate-photo-B");

describe("mock evaluator", () => {
  it("is deterministic: same image + run index => byte-identical report", () => {
    const first = mockEvaluationRun(mockSeedFor(IMAGE_A), 0);
    const second = mockEvaluationRun(mockSeedFor(Buffer.from(IMAGE_A)), 0);
    expect(second).toEqual(first);
  });

  it("varies deterministically across ensemble run indexes", () => {
    const seed = mockSeedFor(IMAGE_A);
    const ensemble = [0, 1, 2].map((runIndex) => mockEvaluationRun(seed, runIndex));
    const rerun = [0, 1, 2].map((runIndex) => mockEvaluationRun(seed, runIndex));
    expect(rerun).toEqual(ensemble); // stable re-run of the whole ensemble
    // At least one criterion score differs somewhere across the 3 runs —
    // otherwise the median/low-agreement path would never be exercised.
    const flat = ensemble.map((run) =>
      SCORING_CRITERION_KEYS.map((key) => run.criteria[key].score).join(","),
    );
    expect(new Set(flat).size).toBeGreaterThan(1);
  });

  it("different images produce different reports", () => {
    const runA = mockEvaluationRun(mockSeedFor(IMAGE_A), 0);
    const runB = mockEvaluationRun(mockSeedFor(IMAGE_B), 0);
    expect(runB).not.toEqual(runA);
  });

  it("every run satisfies the model-output contract (plausible values)", () => {
    for (const image of [IMAGE_A, IMAGE_B]) {
      const seed = mockSeedFor(image);
      for (const runIndex of [0, 1, 2]) {
        const run = mockEvaluationRun(seed, runIndex);
        expect(() => modelEvaluationOutputSchema.parse(run)).not.toThrow();
        for (const key of SCORING_CRITERION_KEYS) {
          const entry = run.criteria[key];
          expect(entry.score).toBeGreaterThanOrEqual(1);
          expect(entry.score).toBeLessThanOrEqual(5);
          expect(entry.confidence).toBeGreaterThanOrEqual(0.6);
          expect(entry.confidence).toBeLessThanOrEqual(0.96);
          expect(entry.justification.length).toBeGreaterThan(10);
        }
      }
    }
  });
});
