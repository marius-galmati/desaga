import { PROMPT_VERSION, SCORING_CRITERIA } from "@boca/config";
import { EVALUATION_REPORT_JSON_SCHEMA } from "@boca/contracts";
import { describe, expect, it } from "vitest";
import {
  buildEvaluationRequest,
  buildToleranceText,
  EVAL_MAX_TOKENS,
  FIXED_RUBRIC,
  PROMPT_HASH,
} from "../src/modules/evaluation/prompt";

const REFS = ["cmVmMQ==", "cmVmMg==", "cmVmMw=="];

function request(toleranceText = "") {
  return buildEvaluationRequest({
    model: "claude-sonnet-5",
    referenceImagesB64: REFS,
    toleranceText,
    candidateImageB64: "Y2FuZGlkYXQ=",
  });
}

describe("FIXED_RUBRIC / PROMPT_HASH", () => {
  it("is byte-stable and stamped with PROMPT_VERSION", () => {
    expect(FIXED_RUBRIC).toContain(`[PROMPT_VERSION ${PROMPT_VERSION}]`);
    for (const criterion of SCORING_CRITERIA) {
      expect(FIXED_RUBRIC).toContain(criterion.key);
      expect(FIXED_RUBRIC).toContain(criterion.labelRo);
    }
    // Two requests carry the exact same bytes — prompt-cache friendly.
    const [a, b] = [request(), request()];
    expect(a.system).toEqual(b.system);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("PROMPT_HASH is a stable sha256 over rubric + JSON schema", () => {
    expect(PROMPT_HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(PROMPT_HASH).toBe(PROMPT_HASH.toLowerCase());
  });
});

describe("buildEvaluationRequest", () => {
  it("pins the locked request shape (system cache_control, schema, thinking off)", () => {
    const params = request();
    expect(params.model).toBe("claude-sonnet-5");
    expect(params.max_tokens).toBe(EVAL_MAX_TOKENS);
    expect(params.thinking).toEqual({ type: "disabled" });
    // NO sampling params — removed on current models (400 if sent).
    expect("temperature" in params).toBe(false);
    expect("top_p" in params).toBe(false);
    expect(params.system).toEqual([
      { type: "text", text: FIXED_RUBRIC, cache_control: { type: "ephemeral" } },
    ]);
    expect(params.output_config).toEqual({
      format: { type: "json_schema", schema: EVALUATION_REPORT_JSON_SCHEMA },
    });
  });

  it("labels REF1..REF3 via interleaved text blocks, then tolerances, then CANDIDAT, then the ask", () => {
    const params = request("- color: varianță permisă: wide");
    const message = params.messages[0];
    expect(message?.role).toBe("user");
    const content = message?.content as Array<{ type: string; text?: string; source?: unknown }>;
    const layout = content.map((block) => block.type);
    expect(layout).toEqual([
      "text",
      "image",
      "text",
      "image",
      "text",
      "image", // REF1..REF3
      "text", // tolerance block
      "text",
      "image", // CANDIDAT
      "text", // the ask
    ]);
    expect(content[0]?.text).toContain("REF1");
    expect(content[2]?.text).toContain("REF2");
    expect(content[4]?.text).toContain("REF3");
    expect(content[6]?.text).toContain("TOLERANȚE");
    expect(content[6]?.text).toContain("wide");
    expect(content[7]?.text).toContain("CANDIDAT");
    expect(content[1]?.source).toEqual({
      type: "base64",
      media_type: "image/jpeg",
      data: REFS[0],
    });
  });

  it("allows an empty tolerance block in v1", () => {
    const params = request("");
    const content = params.messages[0]?.content as Array<{ type: string; text?: string }>;
    expect(content[6]?.text).toContain("nedefinite");
  });

  it("accepts 1-5 references (per-tenant count) and labels a single REF1", () => {
    const params = buildEvaluationRequest({
      model: "claude-sonnet-5",
      referenceImagesB64: REFS.slice(0, 1),
      toleranceText: "",
      candidateImageB64: "x",
    });
    const content = params.messages[0]?.content as Array<{ type: string; text?: string }>;
    expect(content.map((block) => block.type)).toEqual([
      "text",
      "image", // REF1 only
      "text", // tolerance block
      "text",
      "image", // CANDIDAT
      "text", // the ask
    ]);
    expect(content[0]?.text).toContain("REF1");
  });

  it("rejects a reference count outside 1-5", () => {
    for (const referenceImagesB64 of [[], Array.from({ length: 6 }, () => "eA==")]) {
      expect(() =>
        buildEvaluationRequest({
          model: "claude-sonnet-5",
          referenceImagesB64,
          toleranceText: "",
          candidateImageB64: "x",
        }),
      ).toThrow(/expected 1-5 reference images/);
    }
  });
});

describe("buildToleranceText", () => {
  it("renders per-criterion lines from the tolerance_profile jsonb", () => {
    const text = buildToleranceText({
      cleanliness: { allowed_variance: "strict", must_have: [], notes_ro: "" },
      color: {
        allowed_variance: "wide",
        must_have: ["glazură"],
        notes_ro: "Criteriu sensibil la lumină.",
      },
    });
    expect(text).toBe(
      "- cleanliness: varianță permisă: strict\n" +
        "- color: varianță permisă: wide; obligatoriu vizibile: glazură; note: Criteriu sensibil la lumină.",
    );
  });

  it("returns an empty string for null/garbage criteria", () => {
    expect(buildToleranceText(null)).toBe("");
    expect(buildToleranceText("nope")).toBe("");
    expect(buildToleranceText({})).toBe("");
  });
});
