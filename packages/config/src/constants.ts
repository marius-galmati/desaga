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
// TODO(head-chef): PLACEHOLDER codes. The final 6 criteria and the canonical
// per-criterion tolerance shape are pending head-chef sign-off
// (docs/arhitectura.md §6, open questions). These codes become the
// `criterion_code` keys inside tolerance_profile.criteria and
// ai_evaluation.criterion_scores JSONB — renaming them after production data
// exists means a data migration, so freeze before go-live.

export const SCORING_CRITERIA = [
  "portion_size",
  "component_placement",
  "sauce_execution",
  "garnish_quality",
  "plate_cleanliness",
  "color_balance",
] as const;

export type ScoringCriterion = (typeof SCORING_CRITERIA)[number];

// db/schema.sql comments pin the JSONB maps at exactly 6 entries.
export const SCORING_CRITERIA_COUNT = 6;
