import { z } from "zod";
import { bilingualTextSchema, uuidSchema } from "./common";
import { evalStatusSchema, notScoreableReasonSchema, referenceSetStatusSchema } from "./enums";

// AI plating-QC evaluation contract (demo increment, but the REAL production
// shapes). The 6 criterion keys are LOCKED (2026-07-13) and intentionally
// duplicated from @boca/config SCORING_CRITERIA — the anti-drift test in
// test/evaluation.test.ts diffs the two, same pattern as dbEnums vs pg_enum.

const isoDateTimeSchema = z.string().datetime({ offset: true });

// --- Criterion scores -----------------------------------------------------------

export const criterionScoreSchema = z.object({
  score: z.number().int().min(1).max(5),
  // Exactly one sentence, in Romanian.
  justification: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type CriterionScore = z.infer<typeof criterionScoreSchema>;

// EXACT shape of ai_evaluation.criterion_scores AND (later) of
// sous_chef_rating.criterion_scores — one entry per locked criterion, no
// extras (.strict()), for direct kappa/MAE comparison during calibration.
export const criterionScoresSchema = z
  .object({
    components: criterionScoreSchema,
    arrangement: criterionScoreSchema,
    sauce: criterionScoreSchema,
    cleanliness: criterionScoreSchema,
    color: criterionScoreSchema,
    portion: criterionScoreSchema,
  })
  .strict();
export type CriterionScores = z.infer<typeof criterionScoresSchema>;

// --- Model output vs persisted report --------------------------------------------

// What ONE model call must return — the zod twin of
// EVALUATION_REPORT_JSON_SCHEMA below. ALWAYS zod-parse the model's JSON with
// this before persisting, even though output_config.format enforces the JSON
// schema server-side: belt and braces, and zod enforces the numeric ranges
// (confidence 0-1) that the structured-output JSON schema cannot express.
export const modelEvaluationOutputSchema = z
  .object({
    criteria: criterionScoresSchema,
    dishMismatch: z.boolean(),
  })
  .strict();
export type ModelEvaluationOutput = z.infer<typeof modelEvaluationOutputSchema>;

// Server-derived aggregate — computed from the ensemble, never asked of the
// model, never a bare percent.
export const evaluationOverallSchema = z.object({
  // Median of the six per-criterion medians.
  median: z.number().min(1).max(5),
  // true when any criterion's score range across the ensemble runs is > 1.
  lowAgreement: z.boolean(),
});
export type EvaluationOverall = z.infer<typeof evaluationOverallSchema>;

// The report persisted on ai_evaluation: criteria hold the per-criterion
// MEDIANs of the ensemble runs (raw runs live in ai_evaluation.raw_ensemble).
// dishMismatch is optional here (server aggregates the per-run flags).
export const evaluationReportSchema = z.object({
  criteria: criterionScoresSchema,
  overall: evaluationOverallSchema,
  dishMismatch: z.boolean().optional(),
});
export type EvaluationReport = z.infer<typeof evaluationReportSchema>;

// --- Pinned eval config -----------------------------------------------------------

export const evalConfigSchema = z.object({
  // Exact pinned model id (env EVAL_MODEL, default @boca/config EVAL_MODEL_DEFAULT).
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  // reference_set.version_no / tolerance_profile.version_no — null until the
  // enqueuer pins them (always non-null on status 'completed').
  referenceSetVersion: z.number().int().positive().nullable(),
  toleranceVersion: z.number().int().positive().nullable(),
  preprocessingVersion: z.string().min(1),
  ensembleSize: z.number().int().positive(),
});
export type EvalConfig = z.infer<typeof evalConfigSchema>;

// --- ai_evaluation API projection --------------------------------------------------

export const aiEvaluationSchema = z.object({
  id: uuidSchema,
  status: evalStatusSchema, // queued | running | completed | not_scoreable | eval_failed
  notScoreableReason: notScoreableReasonSchema.nullable(), // set iff status = 'not_scoreable'
  report: evaluationReportSchema.nullable(), // set iff status = 'completed'
  evalConfig: evalConfigSchema,
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});
export type AiEvaluation = z.infer<typeof aiEvaluationSchema>;

// --- Structured-output JSON Schema --------------------------------------------------
//
// Hand-written JSON Schema sent to the model as
//   output_config: { format: { type: "json_schema", schema: EVALUATION_REPORT_JSON_SCHEMA } }
// It matches modelEvaluationOutputSchema (= evaluationReportSchema minus the
// server-added `overall`, with dishMismatch REQUIRED — the model must always
// answer it). Constraints the structured-output API does not support are
// deliberately absent: NO minimum/maximum anywhere — score uses an integer
// enum instead, and confidence's 0-1 range is enforced by zod on parse.
// Keep this object byte-stable: it feeds the 24h schema-compilation cache and
// is covered by PROMPT_VERSION.

const CRITERION_SCORE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "justification", "confidence"],
  properties: {
    score: {
      type: "integer",
      enum: [1, 2, 3, 4, 5],
      description: "1 = neconform grav, 3 = abateri minore, 5 = conform cu referința.",
    },
    justification: {
      type: "string",
      description: "Exact o propoziție, în limba română.",
    },
    confidence: {
      type: "number",
      description: "Încredere între 0 și 1.",
    },
  },
};

export const EVALUATION_REPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["criteria", "dishMismatch"],
  properties: {
    criteria: {
      type: "object",
      additionalProperties: false,
      required: ["components", "arrangement", "sauce", "cleanliness", "color", "portion"],
      properties: {
        components: CRITERION_SCORE_JSON_SCHEMA,
        arrangement: CRITERION_SCORE_JSON_SCHEMA,
        sauce: CRITERION_SCORE_JSON_SCHEMA,
        cleanliness: CRITERION_SCORE_JSON_SCHEMA,
        color: CRITERION_SCORE_JSON_SCHEMA,
        portion: CRITERION_SCORE_JSON_SCHEMA,
      },
    },
    dishMismatch: {
      type: "boolean",
      description: "true dacă farfuria candidat nu pare a fi același preparat cu referințele.",
    },
  },
};

// --- Admin demo flow payloads --------------------------------------------------------

// Opaque storage key minted by POST /admin/uploads (see routers/evaluation.ts
// for the two-step upload flow).
export const photoKeySchema = z.string().min(1);
export type PhotoKey = z.infer<typeof photoKeySchema>;

// Response of the non-ts-rest multipart upload route.
export const uploadResponseSchema = z.object({
  photoKey: photoKeySchema,
});
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const createDemoDishRequestSchema = z.object({
  name: bilingualTextSchema, // { ro, en }
});
export type CreateDemoDishRequest = z.infer<typeof createDemoDishRequestSchema>;

export const createDemoDishResponseSchema = z.object({
  dishId: uuidSchema,
  dishVersionId: uuidSchema,
});
export type CreateDemoDishResponse = z.infer<typeof createDemoDishResponseSchema>;

export const attachReferencesRequestSchema = z.object({
  // 3-5 previously uploaded photo keys; attach order = sort_order.
  imageKeys: z.array(photoKeySchema).min(3).max(5),
});
export type AttachReferencesRequest = z.infer<typeof attachReferencesRequestSchema>;

export const referenceSetSummarySchema = z.object({
  referenceSetId: uuidSchema,
  versionNo: z.number().int().positive(),
  status: referenceSetStatusSchema,
  photoCount: z.number().int().nonnegative(),
});
export type ReferenceSetSummary = z.infer<typeof referenceSetSummarySchema>;

export const demoDishSchema = z.object({
  id: uuidSchema,
  dishVersionId: uuidSchema,
  name: bilingualTextSchema,
  // null until references are attached — this IS the "reference status".
  referenceSet: referenceSetSummarySchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type DemoDish = z.infer<typeof demoDishSchema>;

export const demoDishListSchema = z.array(demoDishSchema);

export const createEvaluationRequestSchema = z.object({
  dishId: uuidSchema,
  candidatePhotoKey: photoKeySchema,
});
export type CreateEvaluationRequest = z.infer<typeof createEvaluationRequestSchema>;

export const createEvaluationResponseSchema = z.object({
  evaluationId: uuidSchema,
});
export type CreateEvaluationResponse = z.infer<typeof createEvaluationResponseSchema>;
