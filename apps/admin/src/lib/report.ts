// Pure presentation helpers for the conformity report — RO copy, verdict
// derivation, score tones. Framework-free so they unit-test in node.

import type { EvalStatus, NotScoreableReason } from "@boca/contracts";

export type Tone = "good" | "mixed" | "bad";

export interface Verdict {
  label: string;
  tone: Tone;
}

/** Owner-facing verdict derived from the overall median (1-5, halves allowed). */
export function verdictForMedian(median: number): Verdict {
  if (median >= 4.5) return { label: "Conform cu standardul", tone: "good" };
  if (median >= 3.5) return { label: "Conform, cu observații minore", tone: "good" };
  if (median >= 2.5) return { label: "Abateri vizibile față de referință", tone: "mixed" };
  return { label: "Neconform — necesită replatare", tone: "bad" };
}

/** Tone bucket for a single 1-5 criterion score. */
export function scoreTone(score: number): Tone {
  if (score >= 4) return "good";
  if (score >= 3) return "mixed";
  return "bad";
}

/** Romanian decimal comma, always one decimal: 4 -> "4,0", 3.5 -> "3,5". */
export function formatMedian(median: number): string {
  return median.toFixed(1).replace(".", ",");
}

/** 0-1 confidence as a whole percent: 0.825 -> "83%". */
export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export const LOW_AGREEMENT_BADGE = "Scor incert — dezacord între rulări";

export const DISH_MISMATCH_WARNING =
  "Atenție: preparatul din fotografie nu pare a fi același cu cel din referințe.";

// Every not_scoreable_reason has plain-Romanian copy; the anti-drift unit test
// diffs these keys against notScoreableReasonSchema.options.
export const NOT_SCOREABLE_REASON_RO: Record<NotScoreableReason, string> = {
  refs_stale:
    "Setul de referință al preparatului nu mai este valabil — încarcă referințe noi și reia evaluarea.",
  non_scoreable_dish: "Preparatul este marcat ca neevaluabil vizual (de exemplu, servire la masă).",
  quality_gate_failed:
    "Fotografia nu îndeplinește condițiile minime de calitate: rezoluție, claritate sau expunere insuficientă. Refă fotografia și încearcă din nou.",
  photo_skipped: "Fotografia a fost omisă la pass — nu există imagine de evaluat.",
  no_active_tolerance: "Preparatul nu are un profil de toleranță activ.",
  other: "Evaluarea nu a putut fi realizată dintr-un motiv nespecificat.",
};

export const EVAL_FAILED_MESSAGE =
  "Evaluarea a eșuat din motive tehnice. Fotografia nu s-a pierdut — poți relua evaluarea.";

/** In-progress copy while polling. */
export const PENDING_STATUS_RO: Record<Extract<EvalStatus, "queued" | "running">, string> = {
  queued: "În coada de evaluare…",
  running: "Analiza AI rulează…",
};

export function isTerminalStatus(status: EvalStatus): boolean {
  return status === "completed" || status === "not_scoreable" || status === "eval_failed";
}
