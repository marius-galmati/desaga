// Shared cross-package constants. Keep this file dependency-free —
// it is consumed by Nest, Next and Expo alike.

// --- Locales -----------------------------------------------------------------

export const SUPPORTED_LOCALES = ["ro", "en"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "ro";

// --- Auth / session TTLs -----------------------------------------------------

export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const REFRESH_TOKEN_TTL_DAYS = 30;

// Guest table-session sliding expiry (per device), see db/schema.sql section 3.
export const GUEST_SESSION_TTL_SECONDS = 3 * 60 * 60;

// --- Storage -------------------------------------------------------------------

export const MEDIA_BUCKET = "boca-media";

// --- AI plating QC scoring criteria -------------------------------------------
//
// LOCKED with the client on 2026-07-13 (docs/arhitectura.md §6). These keys are
// the `criterion_code` keys inside tolerance_profile.criteria and the entry
// keys of ai_evaluation.criterion_scores / sous_chef_rating.criterion_scores
// JSONB — renaming any of them once production data exists means a data
// migration. Do NOT rename. Deliberately excluded: taste, temperature, speed,
// creativity.

export const SCORING_CRITERION_KEYS = [
  "components",
  "arrangement",
  "sauce",
  "cleanliness",
  "color",
  "portion",
] as const;
export type ScoringCriterionKey = (typeof SCORING_CRITERION_KEYS)[number];

export interface ScoringCriterionDef {
  /** Stable JSONB key — never rename (see block comment above). */
  key: ScoringCriterionKey;
  labelRo: string;
  labelEn: string;
  /** What the model judges; source material for the versioned rubric prompt. */
  description: string;
}

// Same order as SCORING_CRITERION_KEYS (asserted by the contracts anti-drift
// test, same pattern as dbEnums vs pg_enum).
export const SCORING_CRITERIA: readonly ScoringCriterionDef[] = [
  {
    key: "components",
    labelRo: "Completitudinea componentelor",
    labelEn: "Component completeness",
    description:
      "All spec elements present, nothing foreign. 5 = everything exactly as specified; " +
      "3 = minor element missing or substituted; 1 = major element missing or foreign object.",
  },
  {
    key: "arrangement",
    labelRo: "Fidelitatea aranjamentului",
    labelEn: "Arrangement fidelity",
    description:
      "Positioning and structure vs the reference: placement, stacking, orientation, " +
      "compositional intent.",
  },
  {
    key: "sauce",
    labelRo: "Execuția sosului",
    labelEn: "Sauce execution",
    description:
      "Position, shape (dots/swoosh/mirror), quantity, clean edges, no accidental smears.",
  },
  {
    key: "cleanliness",
    labelRo: "Curățenia farfuriei",
    labelEn: "Plate cleanliness",
    description:
      "Rim immaculate, no fingerprints, splatter or drips outside intended zones. " +
      "Most objective criterion, near-binary.",
  },
  {
    key: "color",
    labelRo: "Culoare și aspect de gătire",
    labelEn: "Color and doneness cues",
    description:
      "Visible doneness cues — sear/browning, vibrant greens, glaze sheen, nothing burnt " +
      "or pale. Light-sensitive: tolerance starts wide.",
  },
  {
    key: "portion",
    labelRo: "Porție și proporții vizuale",
    labelEn: "Portion and visual proportions",
    description:
      "Apparent quantity and component ratios vs the reference (visual estimate, not grams).",
  },
];

// db/schema.sql comments pin the JSONB maps at exactly 6 entries.
export const SCORING_CRITERIA_COUNT = 6;

// --- AI evaluation pipeline pins -----------------------------------------------
//
// Every ai_evaluation row persists the FULL config below — reproducible forever.
// Bump the version tags whenever the corresponding artifact changes byte-wise.

/** Version tag of the byte-stable FIXED_RUBRIC system prompt. */
export const PROMPT_VERSION = "v1";

/** Version tag of the image preprocessing chain (downscale + quality gates). */
export const PREPROCESSING_VERSION = "v1";

// Pinned model id — the cost-tier decision is deliberate; never use a floating
// alias in code. Runtime override via env EVAL_MODEL.
export const EVAL_MODEL_DEFAULT = "claude-sonnet-5";

// BullMQ queue shared by the HTTP enqueuer (apps/api) and main.worker.ts.
export const EVAL_QUEUE_NAME = "ai-score";

export const EVAL_DEFAULTS = {
  /** Identical calls per evaluation; per-criterion median is persisted. */
  ensembleSize: 3,
  /** Long-edge downscale target before sending images to the model. */
  maxImageEdgePx: 1024,
  /** JPEG re-encode quality for model-bound images. */
  jpegQuality: 80,
} as const;

// Preprocess quality gate — failure => ai_evaluation status 'not_scoreable'
// with reason 'quality_gate_failed'.
export const QUALITY_GATE_DEFAULTS = {
  /** Reject candidate photos below this short-edge resolution. */
  minShortEdgePx: 800,
} as const;
