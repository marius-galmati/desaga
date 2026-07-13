import { createHash } from "node:crypto";
import { SCORING_CRITERION_KEYS, type ScoringCriterionKey } from "@boca/config";
import {
  type CriterionScore,
  type ModelEvaluationOutput,
  modelEvaluationOutputSchema,
} from "@boca/contracts";

// Deterministic mock evaluator: active when ANTHROPIC_API_KEY is missing or
// EVAL_MOCK=true. Seeded by sha256(candidate image) so re-runs of the same
// photo produce byte-identical reports, with slight (deterministic) per-run
// variation so the ensemble/median/low-agreement path is genuinely exercised.
// Same code path as the real evaluator: N runs -> zod parse -> median.

const JUSTIFICATIONS: Record<ScoringCriterionKey, Record<"high" | "mid" | "low", string>> = {
  components: {
    high: "Toate componentele din specificație sunt prezente și corect identificabile.",
    mid: "Un element minor pare lipsă sau substituit față de referință.",
    low: "Lipsește un element major al preparatului față de referință.",
  },
  arrangement: {
    high: "Aranjamentul respectă fidel poziționarea și structura din referință.",
    mid: "Poziționarea componentelor diferă ușor de intenția compozițională a referinței.",
    low: "Structura farfuriei diferă semnificativ de aranjamentul de referință.",
  },
  sauce: {
    high: "Sosul are poziția, forma și cantitatea din referință, cu margini curate.",
    mid: "Forma sosului diferă ușor de referință, cu mici imperfecțiuni de margine.",
    low: "Sosul este aplicat neglijent, cu pete accidentale în afara zonei intenționate.",
  },
  cleanliness: {
    high: "Marginea farfuriei este imaculată, fără amprente sau stropi.",
    mid: "Se observă urme discrete pe marginea farfuriei.",
    low: "Marginea farfuriei prezintă stropi și urme clar vizibile.",
  },
  color: {
    high: "Culorile și indiciile de gătire corespund referinței, cu aspect proaspăt.",
    mid: "Nuanțele de gătire diferă ușor de referință, posibil din cauza luminii.",
    low: "Aspectul de gătire pare vizibil diferit de referință (pal sau ars).",
  },
  portion: {
    high: "Cantitatea aparentă și proporțiile componentelor corespund referinței.",
    mid: "Porția pare ușor diferită de referință ca volum sau proporții.",
    low: "Porția diferă vizibil de referință în cantitate sau raportul componentelor.",
  },
};

export function mockSeedFor(candidateImage: Buffer): Buffer {
  return createHash("sha256").update(candidateImage).digest();
}

function byteAt(seed: Buffer, index: number): number {
  return seed[index % seed.length] as number;
}

function clampScore(value: number): number {
  return Math.min(5, Math.max(1, value));
}

function bucketFor(score: number): "high" | "mid" | "low" {
  if (score >= 4) {
    return "high";
  }
  return score === 3 ? "mid" : "low";
}

/** One simulated model call (runIndex = position in the ensemble, 0-based). */
export function mockEvaluationRun(seed: Buffer, runIndex: number): ModelEvaluationOutput {
  const criteria = {} as Record<ScoringCriterionKey, CriterionScore>;
  SCORING_CRITERION_KEYS.forEach((key, index) => {
    // Stable per-image base score; per-run jitter of -1/0/+1 (≈25%/50%/25%).
    const base = 2 + (byteAt(seed, index * 5) % 4);
    const jitterByte = byteAt(seed, index * 5 + runIndex * 7 + 1);
    const jitter = jitterByte % 4 === 0 ? -1 : jitterByte % 4 === 3 ? 1 : 0;
    const score = clampScore(base + jitter);
    const confidence =
      Math.round((0.6 + (byteAt(seed, index * 3 + runIndex + 2) % 36) / 100) * 100) / 100;
    criteria[key] = { score, justification: JUSTIFICATIONS[key][bucketFor(score)], confidence };
  });
  // Rare (~3% of images), but stable across runs of the same image.
  const dishMismatch = byteAt(seed, 31) < 8;
  return modelEvaluationOutputSchema.parse({ criteria, dishMismatch });
}
