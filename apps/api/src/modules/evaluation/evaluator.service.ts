import Anthropic from "@anthropic-ai/sdk";
import { EVAL_DEFAULTS, PROMPT_VERSION } from "@boca/config";
import { type ModelEvaluationOutput, modelEvaluationOutputSchema } from "@boca/contracts";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ENV, type Env } from "../../config/env";
import { aggregateEnsemble, type EnsembleAggregate } from "./ensemble";
import { mockEvaluationRun, mockSeedFor } from "./mock-evaluator";
import { buildEvaluationRequest, buildToleranceText, PROMPT_HASH, REPAIR_ASK } from "./prompt";

export { buildToleranceText };

/** Terminal per-evaluation failure — the worker records it as eval_failed. */
export class EvaluationRunError extends Error {}

export interface EnsembleEvaluationInput {
  /** Exactly 3 primary reference images as model-input JPEGs (REF1..REF3). */
  referenceJpegs: readonly Buffer[];
  /** Candidate plate as model-input JPEG. */
  candidateJpeg: Buffer;
  /** Rendered tolerance block (buildToleranceText); "" allowed in v1. */
  toleranceText: string;
}

export interface EnsembleEvaluationResult {
  runs: ModelEvaluationOutput[];
  aggregate: EnsembleAggregate;
  /** What the calls actually used (mock-prefixed in mock mode). */
  modelId: string;
  promptVersion: string;
  promptHash: string;
  ensembleSize: number;
}

/**
 * Ensemble-of-N evaluator. Real mode: N identical sequential messages.create
 * calls (SDK default retries cover 429/5xx), structured output enforced via
 * output_config json_schema, every run zod-parsed before use (belt and
 * braces) with ONE repair retry on parse failure. Mock mode (no
 * ANTHROPIC_API_KEY or EVAL_MOCK=true): deterministic runs seeded by
 * sha256(candidate image) through the exact same ensemble/median path.
 */
@Injectable()
export class EvaluatorService {
  private readonly logger = new Logger(EvaluatorService.name);
  private readonly client: Anthropic | undefined;
  readonly mockMode: boolean;
  /** Pinned at enqueue time into ai_evaluation.model_id. */
  readonly pinnedModelId: string;
  readonly promptVersion = PROMPT_VERSION;
  readonly promptHash = PROMPT_HASH;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.mockMode = env.EVAL_MOCK || env.ANTHROPIC_API_KEY === undefined;
    this.pinnedModelId = this.mockMode ? `mock:${env.EVAL_MODEL}` : env.EVAL_MODEL;
    this.client = this.mockMode ? undefined : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    if (this.mockMode) {
      this.logger.warn(
        "EVAL MOCK MODE active (no ANTHROPIC_API_KEY or EVAL_MOCK=true) — deterministic evaluator",
      );
    }
  }

  async evaluateEnsemble(input: EnsembleEvaluationInput): Promise<EnsembleEvaluationResult> {
    const ensembleSize = EVAL_DEFAULTS.ensembleSize;
    const runs: ModelEvaluationOutput[] = [];
    const mockSeed = this.mockMode ? mockSeedFor(input.candidateJpeg) : undefined;
    for (let runIndex = 0; runIndex < ensembleSize; runIndex += 1) {
      runs.push(
        mockSeed !== undefined
          ? mockEvaluationRun(mockSeed, runIndex)
          : await this.runAnthropicOnce(input, runIndex),
      );
    }
    return {
      runs,
      aggregate: aggregateEnsemble(runs),
      modelId: this.pinnedModelId,
      promptVersion: this.promptVersion,
      promptHash: this.promptHash,
      ensembleSize,
    };
  }

  private async runAnthropicOnce(
    input: EnsembleEvaluationInput,
    runIndex: number,
  ): Promise<ModelEvaluationOutput> {
    const client = this.client;
    if (!client) {
      throw new EvaluationRunError("anthropic client unavailable in mock mode");
    }
    const request = buildEvaluationRequest({
      model: this.env.EVAL_MODEL,
      referenceImagesB64: input.referenceJpegs.map((buffer) => buffer.toString("base64")),
      toleranceText: input.toleranceText,
      candidateImageB64: input.candidateJpeg.toString("base64"),
    });

    const response = await client.messages.create(request);
    const rawText = this.extractText(response, runIndex);
    const parsed = this.tryParse(rawText);
    if (parsed) {
      return parsed;
    }

    // One repair retry: show the model its invalid output, ask for JSON only.
    this.logger.warn(`run ${runIndex}: unparseable output, attempting repair retry`);
    const repairResponse = await client.messages.create({
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: rawText },
        { role: "user", content: REPAIR_ASK },
      ],
    });
    const repairedText = this.extractText(repairResponse, runIndex);
    const repaired = this.tryParse(repairedText);
    if (!repaired) {
      throw new EvaluationRunError(
        `run ${runIndex}: model output failed schema validation after repair retry`,
      );
    }
    return repaired;
  }

  /** stop_reason FIRST (refusal/max_tokens are terminal), then the text block. */
  private extractText(response: Anthropic.Messages.Message, runIndex: number): string {
    if (response.stop_reason === "refusal") {
      throw new EvaluationRunError(`run ${runIndex}: model refused the request`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new EvaluationRunError(`run ${runIndex}: output truncated at max_tokens`);
    }
    const block = response.content[0];
    if (!block || block.type !== "text") {
      throw new EvaluationRunError(
        `run ${runIndex}: expected a text content block, got '${block?.type ?? "none"}'`,
      );
    }
    return block.text;
  }

  private tryParse(rawText: string): ModelEvaluationOutput | undefined {
    try {
      return modelEvaluationOutputSchema.parse(JSON.parse(rawText));
    } catch {
      return undefined;
    }
  }
}
