import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { PROMPT_VERSION, SCORING_CRITERIA, SCORING_CRITERION_KEYS } from "@boca/config";
import { EVALUATION_REPORT_JSON_SCHEMA } from "@boca/contracts";

// The evaluation request builder. Everything here must be BYTE-STABLE for a
// given PROMPT_VERSION: the rubric string, the JSON schema and the block
// layout together define PROMPT_HASH, which is pinned on every ai_evaluation
// row. Change ANY of it => bump PROMPT_VERSION in @boca/config.

export const EVAL_MAX_TOKENS = 2000;

const CRITERIA_LINES = SCORING_CRITERIA.map(
  (criterion, index) =>
    `${index + 1}. ${criterion.key} — ${criterion.labelRo} (${criterion.labelEn}) — ${criterion.description}`,
).join("\n");

/**
 * Fixed system rubric (model-facing, Romanian; criterion descriptions come
 * verbatim from @boca/config so config and prompt cannot drift). Sent as a
 * single system text block with cache_control ephemeral — identical across
 * all ensemble calls and all evaluations of a PROMPT_VERSION. The rubric is
 * reference-count-neutral: the number of REF images actually attached is the
 * tenant's configured reference_photo_count, pinned per reference set.
 */
export const FIXED_RUBRIC = `Ești evaluatorul AI de plating al unui restaurant fine-dining. Compari fotografia CANDIDAT cu fotografia sau fotografiile de referință (REF1…REFn, câte sunt furnizate; același preparat, plating aprobat de head chef, același dispozitiv de captură).

Evaluezi EXCLUSIV următoarele 6 criterii vizuale. Excluse intenționat: gust, temperatură, viteză, creativitate.

${CRITERIA_LINES}

Ancorele scalei de scor (identice pentru toate criteriile):
5 = conform cu referința, fără abateri vizibile;
4 = abateri cosmetice minime, nesemnificative;
3 = abateri minore vizibile (element minor lipsă/substituit, poziționare ușor diferită);
2 = abateri majore vizibile, dar preparatul rămâne recognoscibil;
1 = neconform grav: element major lipsă, obiect străin sau execuție compromisă.

Reguli:
- "score": întreg 1–5 pentru fiecare criteriu.
- "justification": EXACT o propoziție, în limba română, concretă (ce anume diferă față de referință).
- "confidence": număr între 0 și 1 — cât de sigură este evaluarea criteriului din această fotografie.
- "dishMismatch": true dacă farfuria candidat nu pare a fi același preparat cu referințele; în acest caz scorurile descriu tot ce se vede, dar semnalezi nepotrivirea.
- Blocul TOLERANȚE de mai jos ajustează severitatea per criteriu: "strict" = penalizezi orice abatere; "normal" = penalizezi abaterile clar vizibile; "wide" = penalizezi doar abaterile majore. Elementele "obligatoriu vizibile" lipsă coboară scorul criteriului components la cel mult 2.
- Răspunzi DOAR cu JSON valid conform schemei impuse, fără alt text.

[PROMPT_VERSION ${PROMPT_VERSION}]`;

/** Final user-content instruction block (after all images). */
export const EVAL_ASK =
  "Compară CANDIDAT cu referințele furnizate (REF1…REFn) aplicând rubrica din system și blocul TOLERANȚE. Returnează raportul JSON.";

/** Follow-up used for the single repair retry after an unparseable output. */
export const REPAIR_ASK =
  "Răspunsul anterior nu a respectat schema JSON impusă. Returnează DOAR obiectul JSON valid conform schemei, fără niciun alt text.";

/**
 * Pinned prompt identity: rubric + structured-output schema + layout marker.
 * Persisted in ai_evaluation.prompt_hash on every row.
 */
export const PROMPT_HASH = createHash("sha256")
  .update(FIXED_RUBRIC)
  .update("\n")
  .update(JSON.stringify(EVALUATION_REPORT_JSON_SCHEMA))
  .update("\n")
  .update(EVAL_ASK)
  .digest("hex");

/**
 * Renders tolerance_profile.criteria (jsonb) into the prompt tolerance block.
 * Unknown/missing entries are skipped; an empty result is allowed in v1.
 */
export function buildToleranceText(criteria: unknown): string {
  if (typeof criteria !== "object" || criteria === null) {
    return "";
  }
  const map = criteria as Record<string, unknown>;
  const lines: string[] = [];
  for (const key of SCORING_CRITERION_KEYS) {
    const entry = map[key];
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const { allowed_variance, must_have, notes_ro } = entry as {
      allowed_variance?: unknown;
      must_have?: unknown;
      notes_ro?: unknown;
    };
    const parts: string[] = [];
    if (typeof allowed_variance === "string") {
      parts.push(`varianță permisă: ${allowed_variance}`);
    }
    if (Array.isArray(must_have) && must_have.length > 0) {
      parts.push(`obligatoriu vizibile: ${must_have.join(", ")}`);
    }
    if (typeof notes_ro === "string" && notes_ro.trim() !== "") {
      parts.push(`note: ${notes_ro.trim()}`);
    }
    if (parts.length > 0) {
      lines.push(`- ${key}: ${parts.join("; ")}`);
    }
  }
  return lines.join("\n");
}

export interface EvaluationRequestInput {
  /** Exact pinned model id (env EVAL_MODEL). */
  model: string;
  /** 1-5 primary reference images, JPEG base64, REF1..REFn order. */
  referenceImagesB64: readonly string[];
  /** Output of buildToleranceText; empty string allowed in v1. */
  toleranceText: string;
  /** Candidate plate image, JPEG base64. */
  candidateImageB64: string;
}

const toleranceBlock = (toleranceText: string): string =>
  toleranceText.trim() === ""
    ? "TOLERANȚE: (nedefinite — aplică severitate normală pe toate criteriile)"
    : `TOLERANȚE (per criteriu):\n${toleranceText}`;

/**
 * The exact request shape locked in the architecture:
 * - system: single byte-stable rubric block with cache_control ephemeral;
 * - user content: REF1..REFn images labeled via interleaved text blocks,
 *   tolerance block, CANDIDAT image, then the ask;
 * - structured output ENFORCED via output_config.format json_schema;
 * - thinking disabled (Sonnet 5 accepts disabled; omitting would run adaptive);
 * - NO temperature/top_p (removed on current models — sending them is a 400).
 */
export function buildEvaluationRequest(
  input: EvaluationRequestInput,
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  if (input.referenceImagesB64.length < 1 || input.referenceImagesB64.length > 5) {
    throw new Error(
      `buildEvaluationRequest: expected 1-5 reference images, got ${input.referenceImagesB64.length}`,
    );
  }

  const content: Anthropic.Messages.ContentBlockParam[] = [];
  input.referenceImagesB64.forEach((data, index) => {
    content.push({ type: "text", text: `REF${index + 1} — fotografie de referință aprobată:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } });
  });
  content.push({ type: "text", text: toleranceBlock(input.toleranceText) });
  content.push({ type: "text", text: "CANDIDAT — fotografia farfuriei de evaluat:" });
  content.push({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data: input.candidateImageB64 },
  });
  content.push({ type: "text", text: EVAL_ASK });

  return {
    model: input.model,
    max_tokens: EVAL_MAX_TOKENS,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: FIXED_RUBRIC, cache_control: { type: "ephemeral" } }],
    output_config: { format: { type: "json_schema", schema: EVALUATION_REPORT_JSON_SCHEMA } },
    messages: [{ role: "user", content }],
  };
}

/**
 * The SAME rubric/layout as an OpenAI-compatible chat request (OpenRouter →
 * Gemini/DeepSeek/Qwen). System = the byte-stable rubric; user = interleaved
 * REF images, tolerance, CANDIDAT, ask. Structured output requested via
 * response_format json_schema; the caller still zod-parses + repairs, so a
 * provider that ignores the schema is covered.
 */
export function buildOpenAiRequest(input: EvaluationRequestInput): {
  model: string;
  max_tokens: number;
  messages: unknown[];
  response_format: unknown;
} {
  if (input.referenceImagesB64.length < 1 || input.referenceImagesB64.length > 5) {
    throw new Error(
      `buildOpenAiRequest: expected 1-5 reference images, got ${input.referenceImagesB64.length}`,
    );
  }
  const dataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;
  const userContent: unknown[] = [];
  input.referenceImagesB64.forEach((data, index) => {
    userContent.push({ type: "text", text: `REF${index + 1} — fotografie de referință aprobată:` });
    userContent.push({ type: "image_url", image_url: { url: dataUri(data) } });
  });
  userContent.push({ type: "text", text: toleranceBlock(input.toleranceText) });
  userContent.push({ type: "text", text: "CANDIDAT — fotografia farfuriei de evaluat:" });
  userContent.push({ type: "image_url", image_url: { url: dataUri(input.candidateImageB64) } });
  userContent.push({ type: "text", text: EVAL_ASK });

  return {
    model: input.model,
    max_tokens: EVAL_MAX_TOKENS,
    messages: [
      { role: "system", content: FIXED_RUBRIC },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "plating_report", schema: EVALUATION_REPORT_JSON_SCHEMA, strict: true },
    },
  };
}
