// The 6 scoring criteria locked with the client (2026-07-13). Keys are the
// canonical criterion_code values used in tolerance_profile.criteria and
// ai_evaluation.criterion_scores JSONB. Excluded on purpose: taste,
// temperature, speed, creativity.

export const EVALUATION_CRITERIA = [
  {
    code: "components",
    labelRo: "Completitudinea componentelor",
    labelEn: "Component completeness",
  },
  { code: "arrangement", labelRo: "Fidelitatea aranjamentului", labelEn: "Arrangement fidelity" },
  { code: "sauce", labelRo: "Execuția sosului", labelEn: "Sauce execution" },
  { code: "cleanliness", labelRo: "Curățenia farfuriei", labelEn: "Plate cleanliness" },
  {
    code: "color",
    labelRo: "Culoare și aspect de gătire",
    labelEn: "Color and cooking appearance",
  },
  {
    code: "portion",
    labelRo: "Porție și proporții vizuale",
    labelEn: "Portion and visual proportions",
  },
] as const;

export type EvaluationCriterionCode = (typeof EVALUATION_CRITERIA)[number]["code"];

export const EVALUATION_CRITERION_CODES = EVALUATION_CRITERIA.map(
  (c) => c.code,
) as readonly EvaluationCriterionCode[];

export interface ToleranceCriterion {
  /** Head-chef authored width; the eval prompt maps this to scoring slack. */
  allowed_variance: "strict" | "normal" | "wide";
  /** Elements that must be visible on the plate (empty allowed in v1). */
  must_have: string[];
  /** Free-form guidance appended to the prompt tolerance block (RO). */
  notes_ro: string;
}

export type ToleranceCriteria = Record<EvaluationCriterionCode, ToleranceCriterion>;

/**
 * Minimal 'default' tolerance profile content: satisfies the NOT NULL /
 * completed-CHECK chain on ai_evaluation before the head chef authors real
 * tolerances. `color` starts wide by design (light-sensitive criterion).
 */
export const DEFAULT_TOLERANCE_CRITERIA: ToleranceCriteria = {
  components: { allowed_variance: "normal", must_have: [], notes_ro: "" },
  arrangement: { allowed_variance: "normal", must_have: [], notes_ro: "" },
  sauce: { allowed_variance: "normal", must_have: [], notes_ro: "" },
  cleanliness: { allowed_variance: "strict", must_have: [], notes_ro: "" },
  color: {
    allowed_variance: "wide",
    must_have: [],
    notes_ro: "Criteriu sensibil la lumină; toleranța pornește larg.",
  },
  portion: { allowed_variance: "normal", must_have: [], notes_ro: "" },
};
