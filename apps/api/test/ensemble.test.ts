import type { CriterionScore, ModelEvaluationOutput } from "@boca/contracts";
import { describe, expect, it } from "vitest";
import { aggregateEnsemble, lowerMedianInt, medianOf } from "../src/modules/evaluation/ensemble";

function entry(score: number, confidence = 0.8): CriterionScore {
  return { score, justification: `Scor ${score}.`, confidence };
}

function run(scores: Partial<Record<string, number>>, dishMismatch = false): ModelEvaluationOutput {
  const s = (key: string, fallback: number) => entry(scores[key] ?? fallback);
  return {
    criteria: {
      components: s("components", 4),
      arrangement: s("arrangement", 4),
      sauce: s("sauce", 4),
      cleanliness: s("cleanliness", 4),
      color: s("color", 4),
      portion: s("portion", 4),
    },
    dishMismatch,
  };
}

describe("median math", () => {
  it("medianOf: odd, even, single", () => {
    expect(medianOf([3, 1, 5])).toBe(3);
    expect(medianOf([4, 2])).toBe(3);
    expect(medianOf([2])).toBe(2);
  });

  it("lowerMedianInt keeps scores integral for even ensembles", () => {
    expect(lowerMedianInt([4, 5])).toBe(4);
    expect(lowerMedianInt([5, 4, 4, 5])).toBe(4);
    expect(lowerMedianInt([1, 5, 3])).toBe(3);
  });
});

describe("aggregateEnsemble", () => {
  it("takes the per-criterion median across runs", () => {
    const aggregate = aggregateEnsemble([run({ sauce: 2 }), run({ sauce: 3 }), run({ sauce: 5 })]);
    expect(aggregate.criteria.sauce.score).toBe(3);
    expect(aggregate.criteria.components.score).toBe(4);
    // Justification comes from a run that actually voted the median score.
    expect(aggregate.criteria.sauce.justification).toBe("Scor 3.");
  });

  it("flags lowAgreement when any criterion range exceeds 1", () => {
    // range exactly 1 (4,5,5) => still fine
    const tight = aggregateEnsemble([run({}), run({ color: 5 }), run({ color: 5 })]);
    expect(tight.scoreRanges.color).toBe(1);
    expect(tight.overall.lowAgreement).toBe(false);

    // range 2 on a single criterion => flagged
    const spread = aggregateEnsemble([run({ sauce: 2 }), run({ sauce: 4 }), run({ sauce: 4 })]);
    expect(spread.scoreRanges.sauce).toBe(2);
    expect(spread.overall.lowAgreement).toBe(true);
  });

  it("derives overall as the median of the six criterion medians", () => {
    const aggregate = aggregateEnsemble([
      run({ components: 2, arrangement: 3, sauce: 3, cleanliness: 5, color: 5, portion: 5 }),
      run({ components: 2, arrangement: 3, sauce: 3, cleanliness: 5, color: 5, portion: 5 }),
      run({ components: 2, arrangement: 3, sauce: 3, cleanliness: 5, color: 5, portion: 5 }),
    ]);
    // sorted medians [2,3,3,5,5,5] -> (3+5)/2 = 4
    expect(aggregate.overall.median).toBe(4);
  });

  it("dishMismatch is a majority vote", () => {
    expect(aggregateEnsemble([run({}, true), run({}, true), run({})]).dishMismatch).toBe(true);
    expect(aggregateEnsemble([run({}, true), run({}), run({})]).dishMismatch).toBe(false);
  });

  it("confidence is the (rounded) median of run confidences", () => {
    const runs = [0.61, 0.75, 0.9].map((confidence) => {
      const base = run({});
      base.criteria.components.confidence = confidence;
      return base;
    });
    expect(aggregateEnsemble(runs).criteria.components.confidence).toBe(0.75);
  });
});
