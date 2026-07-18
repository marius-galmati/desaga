import Anthropic from "@anthropic-ai/sdk";
import { EVAL_DEFAULTS, PROMPT_VERSION } from "@boca/config";
import { type ModelEvaluationOutput, modelEvaluationOutputSchema } from "@boca/contracts";
import { getAiRuntimeConfig } from "@boca/db";
import { Inject, Injectable, Logger } from "@nestjs/common";
import OpenAI from "openai";
import { decryptSecret } from "../../common/secrets";
import { ENV, type Env } from "../../config/env";
import { aggregateEnsemble, type EnsembleAggregate } from "./ensemble";
import { mockEvaluationRun, mockSeedFor } from "./mock-evaluator";
import {
  buildEvaluationRequest,
  buildOpenAiRequest,
  buildToleranceText,
  PROMPT_HASH,
  REPAIR_ASK,
} from "./prompt";

export { buildToleranceText };

/** Terminal per-evaluation failure — the worker records it as eval_failed. */
export class EvaluationRunError extends Error {}

export interface EnsembleEvaluationInput {
  /** 1-5 primary reference images as model-input JPEGs (REF1..REFn). */
  referenceJpegs: readonly Buffer[];
  /** Candidate plate as model-input JPEG. */
  candidateJpeg: Buffer;
  /** Rendered tolerance block (buildToleranceText); "" allowed in v1. */
  toleranceText: string;
}

interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  /** Provider real billed cost when returned, else null (computed from prices). */
  costUsd: number | null;
}

interface RunResult {
  output: ModelEvaluationOutput;
  usage: RunUsage | null;
}

export interface EnsembleEvaluationResult {
  runs: ModelEvaluationOutput[];
  aggregate: EnsembleAggregate;
  /** What the calls actually used (mock-prefixed in mock mode). */
  modelId: string;
  promptVersion: string;
  promptHash: string;
  ensembleSize: number;
  /** Token usage summed over the ensemble runs (null in mock mode). */
  usage: RunUsage | null;
}

type ActiveConfig =
  | { mode: "mock"; model: string }
  | { mode: "anthropic"; model: string; apiKey: string }
  | { mode: "openai"; model: string; baseUrl: string; apiKey: string };

const CONFIG_TTL_MS = 60_000;

/**
 * Ensemble-of-N evaluator. The active provider/model/key comes from the DB
 * (ai_settings, set in the platform dashboard) with an env fallback, refreshed
 * on a short TTL — the model can change at runtime without a redeploy. Real
 * modes: Anthropic (messages.create) or any OpenAI-compatible endpoint
 * (OpenRouter → Gemini/DeepSeek/Qwen). Every run is zod-parsed with one repair
 * retry; mock mode is deterministic. Usage tokens are captured per run.
 */
@Injectable()
export class EvaluatorService {
  private readonly logger = new Logger(EvaluatorService.name);
  private cached: { config: ActiveConfig; at: number } | undefined;
  /** Best-effort current model id for enqueue-time pinning (re-asserted on completion). */
  private currentModelId: string;
  readonly promptVersion = PROMPT_VERSION;
  readonly promptHash = PROMPT_HASH;

  constructor(@Inject(ENV) private readonly env: Env) {
    const envMock = env.EVAL_MOCK || env.ANTHROPIC_API_KEY === undefined;
    this.currentModelId = envMock ? `mock:${env.EVAL_MODEL}` : env.EVAL_MODEL;
    // Warm the config from the DB in the background (best-effort — DB may not be
    // ready at boot; it re-resolves on the first evaluation anyway).
    void this.resolveConfig().catch(() => undefined);
  }

  /** Pinned at enqueue time into ai_evaluation.model_id (dynamic, cached). */
  get pinnedModelId(): string {
    return this.currentModelId;
  }

  private async resolveConfig(): Promise<ActiveConfig> {
    if (this.cached && Date.now() - this.cached.at < CONFIG_TTL_MS) {
      return this.cached.config;
    }
    const config = await this.computeConfig();
    this.cached = { config, at: Date.now() };
    this.currentModelId = config.mode === "mock" ? `mock:${config.model}` : config.model;
    return config;
  }

  private async computeConfig(): Promise<ActiveConfig> {
    // Explicit mock always wins (dev / no-key deployments).
    if (this.env.EVAL_MOCK) {
      return { mode: "mock", model: this.env.EVAL_MODEL };
    }
    try {
      const { settings } = await getAiRuntimeConfig();
      if (settings) {
        const key =
          settings.apiKeyCiphertext && settings.apiKeyIv && settings.apiKeyTag
            ? decryptSecret({
                ciphertext: settings.apiKeyCiphertext,
                iv: settings.apiKeyIv,
                tag: settings.apiKeyTag,
              })
            : null;
        if (settings.provider === "openai" && settings.baseUrl && settings.model && key) {
          return { mode: "openai", model: settings.model, baseUrl: settings.baseUrl, apiKey: key };
        }
        if (settings.provider === "anthropic" && settings.model) {
          const anthropicKey = key ?? this.env.ANTHROPIC_API_KEY;
          if (anthropicKey) {
            return { mode: "anthropic", model: settings.model, apiKey: anthropicKey };
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `AI config DB read failed, using env fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // Env fallback keeps existing single-provider deployments working.
    if (this.env.ANTHROPIC_API_KEY) {
      return { mode: "anthropic", model: this.env.EVAL_MODEL, apiKey: this.env.ANTHROPIC_API_KEY };
    }
    return { mode: "mock", model: this.env.EVAL_MODEL };
  }

  async evaluateEnsemble(input: EnsembleEvaluationInput): Promise<EnsembleEvaluationResult> {
    const config = await this.resolveConfig();
    const ensembleSize = EVAL_DEFAULTS.ensembleSize;
    const results: RunResult[] = [];
    const mockSeed = config.mode === "mock" ? mockSeedFor(input.candidateJpeg) : undefined;

    for (let runIndex = 0; runIndex < ensembleSize; runIndex += 1) {
      if (config.mode === "mock" && mockSeed !== undefined) {
        results.push({ output: mockEvaluationRun(mockSeed, runIndex), usage: null });
      } else if (config.mode === "anthropic") {
        results.push(await this.runAnthropicOnce(input, runIndex, config));
      } else if (config.mode === "openai") {
        results.push(await this.runOpenAiOnce(input, runIndex, config));
      } else {
        throw new EvaluationRunError("no evaluation provider available");
      }
    }

    const runs = results.map((r) => r.output);
    return {
      runs,
      aggregate: aggregateEnsemble(runs),
      modelId: config.mode === "mock" ? `mock:${config.model}` : config.model,
      promptVersion: this.promptVersion,
      promptHash: this.promptHash,
      ensembleSize,
      usage: sumUsage(results.map((r) => r.usage)),
    };
  }

  private async runAnthropicOnce(
    input: EnsembleEvaluationInput,
    runIndex: number,
    config: Extract<ActiveConfig, { mode: "anthropic" }>,
  ): Promise<RunResult> {
    const client = new Anthropic({ apiKey: config.apiKey });
    const request = buildEvaluationRequest({
      model: config.model,
      referenceImagesB64: input.referenceJpegs.map((b) => b.toString("base64")),
      toleranceText: input.toleranceText,
      candidateImageB64: input.candidateJpeg.toString("base64"),
    });

    const response = await client.messages.create(request);
    const usage: RunUsage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd: null,
    };
    const parsed = this.tryParse(this.extractAnthropicText(response, runIndex));
    if (parsed) {
      return { output: parsed, usage };
    }
    this.logger.warn(`run ${runIndex}: unparseable Anthropic output, repair retry`);
    const repair = await client.messages.create({
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: this.extractAnthropicText(response, runIndex) },
        { role: "user", content: REPAIR_ASK },
      ],
    });
    const repaired = this.tryParse(this.extractAnthropicText(repair, runIndex));
    if (!repaired) {
      throw new EvaluationRunError(`run ${runIndex}: schema validation failed after repair`);
    }
    return {
      output: repaired,
      usage: {
        inputTokens: usage.inputTokens + repair.usage.input_tokens,
        outputTokens: usage.outputTokens + repair.usage.output_tokens,
        costUsd: null,
      },
    };
  }

  private async runOpenAiOnce(
    input: EnsembleEvaluationInput,
    runIndex: number,
    config: Extract<ActiveConfig, { mode: "openai" }>,
  ): Promise<RunResult> {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
    const request = buildOpenAiRequest({
      model: config.model,
      referenceImagesB64: input.referenceJpegs.map((b) => b.toString("base64")),
      toleranceText: input.toleranceText,
      candidateImageB64: input.candidateJpeg.toString("base64"),
    }) as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

    const response = await client.chat.completions.create(request);
    const usage = openAiUsage(response);
    const parsed = this.tryParse(this.extractOpenAiText(response, runIndex));
    if (parsed) {
      return { output: parsed, usage };
    }
    this.logger.warn(`run ${runIndex}: unparseable OpenAI-compat output, repair retry`);
    const repair = await client.chat.completions.create({
      ...request,
      messages: [
        ...request.messages,
        { role: "assistant", content: this.extractOpenAiText(response, runIndex) },
        { role: "user", content: REPAIR_ASK },
      ],
    });
    const repaired = this.tryParse(this.extractOpenAiText(repair, runIndex));
    if (!repaired) {
      throw new EvaluationRunError(`run ${runIndex}: schema validation failed after repair`);
    }
    return { output: repaired, usage: sumUsage([usage, openAiUsage(repair)]) };
  }

  private extractAnthropicText(response: Anthropic.Messages.Message, runIndex: number): string {
    if (response.stop_reason === "refusal") {
      throw new EvaluationRunError(`run ${runIndex}: model refused the request`);
    }
    if (response.stop_reason === "max_tokens") {
      throw new EvaluationRunError(`run ${runIndex}: output truncated at max_tokens`);
    }
    const block = response.content[0];
    if (!block || block.type !== "text") {
      throw new EvaluationRunError(
        `run ${runIndex}: expected a text block, got '${block?.type ?? "none"}'`,
      );
    }
    return block.text;
  }

  private extractOpenAiText(
    response: OpenAI.Chat.Completions.ChatCompletion,
    runIndex: number,
  ): string {
    const choice = response.choices[0];
    if (choice?.finish_reason === "length") {
      throw new EvaluationRunError(`run ${runIndex}: output truncated (finish_reason length)`);
    }
    const content = choice?.message.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new EvaluationRunError(`run ${runIndex}: empty model output`);
    }
    return content;
  }

  private tryParse(rawText: string): ModelEvaluationOutput | undefined {
    try {
      return modelEvaluationOutputSchema.parse(JSON.parse(stripJsonFence(rawText)));
    } catch {
      return undefined;
    }
  }
}

/** Some OpenAI-compatible providers wrap JSON in ```json fences — strip them. */
function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }
  return trimmed;
}

function openAiUsage(response: OpenAI.Chat.Completions.ChatCompletion): RunUsage {
  const usage = response.usage;
  // OpenRouter may attach a real billed `cost` on the usage object.
  const cost = (usage as unknown as { cost?: number } | undefined)?.cost;
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    costUsd: typeof cost === "number" ? cost : null,
  };
}

function sumUsage(usages: (RunUsage | null)[]): RunUsage | null {
  const present = usages.filter((u): u is RunUsage => u !== null);
  if (present.length === 0) {
    return null;
  }
  const costs = present.map((u) => u.costUsd).filter((c): c is number => c !== null);
  return {
    inputTokens: present.reduce((s, u) => s + u.inputTokens, 0),
    outputTokens: present.reduce((s, u) => s + u.outputTokens, 0),
    costUsd: costs.length > 0 ? costs.reduce((s, c) => s + c, 0) : null,
  };
}
