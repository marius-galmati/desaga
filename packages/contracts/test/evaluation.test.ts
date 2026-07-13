import {
  PROMPT_VERSION,
  SCORING_CRITERIA,
  SCORING_CRITERIA_COUNT,
  SCORING_CRITERION_KEYS,
} from "@boca/config";
import { describe, expect, it } from "vitest";
import {
  aiEvaluationSchema,
  apiContract,
  criterionScoreSchema,
  criterionScoresSchema,
  EVALUATION_REPORT_JSON_SCHEMA,
  evaluationReportSchema,
  modelEvaluationOutputSchema,
} from "../src";

// ---------------------------------------------------------------------------
// Minimal structural JSON Schema validator covering exactly the subset the
// hand-written EVALUATION_REPORT_JSON_SCHEMA uses (object/required/
// additionalProperties:false, string, boolean, number, integer + enum). Kept
// local to avoid an ajv dependency; if the schema grows a construct this does
// not know, validation fails loudly.
// ---------------------------------------------------------------------------

type JsonSchemaNode = {
  type: string;
  enum?: unknown[];
  required?: string[];
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchemaNode>;
};

function validateAgainstJsonSchema(node: JsonSchemaNode, value: unknown, path = "$"): string[] {
  const errors: string[] = [];
  switch (node.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return [`${path}: expected object`];
      }
      const obj = value as Record<string, unknown>;
      const props = node.properties ?? {};
      for (const key of node.required ?? []) {
        if (!(key in obj)) errors.push(`${path}.${key}: missing required key`);
      }
      for (const [key, val] of Object.entries(obj)) {
        const propSchema = props[key];
        if (!propSchema) {
          if (node.additionalProperties === false) {
            errors.push(`${path}.${key}: additional property not allowed`);
          }
          continue;
        }
        errors.push(...validateAgainstJsonSchema(propSchema, val, `${path}.${key}`));
      }
      return errors;
    }
    case "string":
      if (typeof value !== "string") errors.push(`${path}: expected string`);
      break;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
      break;
    case "number":
      if (typeof value !== "number") errors.push(`${path}: expected number`);
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        errors.push(`${path}: expected integer`);
      }
      break;
    default:
      errors.push(`${path}: unknown schema type '${node.type}'`);
  }
  if (node.enum && !node.enum.includes(value)) {
    errors.push(`${path}: value not in enum`);
  }
  return errors;
}

// Recursively collect every object node of the JSON schema.
function collectObjectNodes(node: JsonSchemaNode, acc: JsonSchemaNode[] = []): JsonSchemaNode[] {
  if (node.type === "object") acc.push(node);
  for (const child of Object.values(node.properties ?? {})) {
    collectObjectNodes(child, acc);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCriterion = (score: number, justification: string, confidence: number) => ({
  score,
  justification,
  confidence,
});

const validModelOutput = {
  criteria: {
    components: validCriterion(5, "Toate componentele din specificație sunt prezente.", 0.93),
    arrangement: validCriterion(4, "Stivuirea respectă referința, cu o rotire ușoară.", 0.81),
    sauce: validCriterion(3, "Swoosh-ul de sos are marginea pătată în partea dreaptă.", 0.77),
    cleanliness: validCriterion(5, "Marginea farfuriei este imaculată.", 0.97),
    color: validCriterion(4, "Crusta este bine rumenită, dar verdele este ușor pal.", 0.64),
    portion: validCriterion(4, "Cantitatea aparentă corespunde referinței.", 0.72),
  },
  dishMismatch: false,
};

// ---------------------------------------------------------------------------

describe("criterion scores (zod)", () => {
  it("accepts a valid criterion score", () => {
    expect(criterionScoreSchema.safeParse(validCriterion(3, "OK.", 0.5)).success).toBe(true);
  });

  it.each([
    ["score 0", validCriterion(0, "x", 0.5)],
    ["score 6", validCriterion(6, "x", 0.5)],
    ["fractional score", validCriterion(3.5, "x", 0.5)],
    ["confidence > 1", validCriterion(3, "x", 1.2)],
    ["confidence < 0", validCriterion(3, "x", -0.1)],
    ["empty justification", validCriterion(3, "", 0.5)],
  ])("rejects %s", (_label, value) => {
    expect(criterionScoreSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a missing criterion and an extra criterion (strict, exactly 6 keys)", () => {
    const { portion: _dropped, ...missing } = validModelOutput.criteria;
    expect(criterionScoresSchema.safeParse(missing).success).toBe(false);
    expect(
      criterionScoresSchema.safeParse({
        ...validModelOutput.criteria,
        garnish: validCriterion(4, "x", 0.5),
      }).success,
    ).toBe(false);
  });
});

describe("model output — zod AND JSON schema agree on the same fixture", () => {
  it("valid sample parses with modelEvaluationOutputSchema (zod)", () => {
    const parsed = modelEvaluationOutputSchema.safeParse(validModelOutput);
    expect(parsed.success).toBe(true);
  });

  it("the SAME sample validates against EVALUATION_REPORT_JSON_SCHEMA semantics", () => {
    const errors = validateAgainstJsonSchema(
      EVALUATION_REPORT_JSON_SCHEMA as JsonSchemaNode,
      validModelOutput,
    );
    expect(errors).toEqual([]);
  });

  it("JSON schema rejects what zod rejects: extra key, missing key, out-of-enum score", () => {
    expect(
      validateAgainstJsonSchema(EVALUATION_REPORT_JSON_SCHEMA as JsonSchemaNode, {
        ...validModelOutput,
        extra: true,
      }),
    ).not.toEqual([]);
    const { dishMismatch: _dm, ...noMismatch } = validModelOutput;
    expect(
      validateAgainstJsonSchema(EVALUATION_REPORT_JSON_SCHEMA as JsonSchemaNode, noMismatch),
    ).not.toEqual([]);
    expect(
      validateAgainstJsonSchema(EVALUATION_REPORT_JSON_SCHEMA as JsonSchemaNode, {
        ...validModelOutput,
        criteria: {
          ...validModelOutput.criteria,
          sauce: validCriterion(6, "x", 0.5),
        },
      }),
    ).not.toEqual([]);
  });
});

describe("EVALUATION_REPORT_JSON_SCHEMA — structured-output API constraints", () => {
  const root = EVALUATION_REPORT_JSON_SCHEMA as JsonSchemaNode;

  it("every object node has additionalProperties:false and requires ALL its properties", () => {
    for (const node of collectObjectNodes(root)) {
      expect(node.additionalProperties).toBe(false);
      expect([...(node.required ?? [])].sort()).toEqual(Object.keys(node.properties ?? {}).sort());
    }
  });

  it("contains NO numeric min/max constraints (unsupported by the API)", () => {
    const banned = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];
    const json = JSON.stringify(EVALUATION_REPORT_JSON_SCHEMA);
    for (const keyword of banned) {
      expect(json).not.toContain(`"${keyword}"`);
    }
  });

  it("scores are constrained via integer enum [1..5]", () => {
    const score = root.properties?.criteria?.properties?.components?.properties?.score;
    expect(score?.type).toBe("integer");
    expect(score?.enum).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("anti-drift with @boca/config SCORING_CRITERIA", () => {
  it("locks the 6 criterion keys, in order, across config, zod and JSON schema", () => {
    const configKeys = SCORING_CRITERIA.map((criterion) => criterion.key);
    expect(configKeys).toEqual([...SCORING_CRITERION_KEYS]);
    expect(configKeys).toHaveLength(SCORING_CRITERIA_COUNT);
    expect(Object.keys(criterionScoresSchema.shape)).toEqual(configKeys);
    const jsonCriteria = (EVALUATION_REPORT_JSON_SCHEMA as JsonSchemaNode).properties?.criteria;
    expect(Object.keys(jsonCriteria?.properties ?? {})).toEqual(configKeys);
    expect(jsonCriteria?.required).toEqual(configKeys);
  });

  it("every criterion carries RO/EN labels and a description", () => {
    for (const criterion of SCORING_CRITERIA) {
      expect(criterion.labelRo.length).toBeGreaterThan(0);
      expect(criterion.labelEn.length).toBeGreaterThan(0);
      expect(criterion.description.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluationReportSchema / aiEvaluationSchema", () => {
  const report = {
    criteria: validModelOutput.criteria,
    overall: { median: 4, lowAgreement: false },
    dishMismatch: false,
  };

  it("parses a full persisted report (dishMismatch optional)", () => {
    expect(evaluationReportSchema.safeParse(report).success).toBe(true);
    const { dishMismatch: _dm, ...withoutMismatch } = report;
    expect(evaluationReportSchema.safeParse(withoutMismatch).success).toBe(true);
  });

  it("parses a completed ai_evaluation projection", () => {
    const parsed = aiEvaluationSchema.safeParse({
      id: "018f7d1e-6a5b-7c3d-9e2f-1a2b3c4d5e6f",
      status: "completed",
      notScoreableReason: null,
      report,
      evalConfig: {
        model: "claude-sonnet-5",
        promptVersion: PROMPT_VERSION,
        referenceSetVersion: 1,
        toleranceVersion: 1,
        preprocessingVersion: "v1",
        ensembleSize: 3,
      },
      createdAt: "2026-07-13T10:15:00.000Z",
      completedAt: "2026-07-13T10:15:42.123+03:00",
    });
    expect(parsed.success).toBe(true);
  });

  it("parses a queued evaluation with unpinned versions and no report", () => {
    const parsed = aiEvaluationSchema.safeParse({
      id: "018f7d1e-6a5b-7c3d-9e2f-1a2b3c4d5e6f",
      status: "queued",
      notScoreableReason: null,
      report: null,
      evalConfig: {
        model: "claude-sonnet-5",
        promptVersion: "v1",
        referenceSetVersion: null,
        toleranceVersion: null,
        preprocessingVersion: "v1",
        ensembleSize: 3,
      },
      createdAt: "2026-07-13T10:15:00Z",
      completedAt: null,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("evaluation contract routes", () => {
  it("exposes the admin demo surface", () => {
    expect(apiContract.evaluation.createDemoDish.path).toBe("/admin/demo/dishes");
    expect(apiContract.evaluation.createDemoDish.method).toBe("POST");
    expect(apiContract.evaluation.listDemoDishes.path).toBe("/admin/demo/dishes");
    expect(apiContract.evaluation.attachReferences.path).toBe(
      "/admin/demo/dishes/:dishId/references",
    );
    expect(apiContract.evaluation.createEvaluation.path).toBe("/admin/demo/evaluations");
    expect(apiContract.evaluation.getEvaluation.path).toBe("/admin/demo/evaluations/:id");
  });
});
