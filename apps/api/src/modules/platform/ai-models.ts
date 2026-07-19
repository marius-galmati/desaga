import {
  type AiModelList,
  type AiModelOption,
  type AiProvider,
  aiModelOptionSchema,
} from "@boca/contracts";

// Builds the model dropdown for the platform dashboard. The plating evaluator
// sends images, so only VISION-capable models are usable — we filter the live
// catalog to those. Live fetch first (always current), static fallback if the
// provider can't be reached.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=1000";
const FETCH_TIMEOUT_MS = 6000;

// Standard sticker price per 1M tokens for current Anthropic models (the Models
// API doesn't return pricing). Keyed by bare model id. Unknown id => null price.
const ANTHROPIC_PRICE: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Current vision-capable Claude models (bare ids — the Anthropic SDK path).
const ANTHROPIC_FALLBACK: AiModelOption[] = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-haiku-4-5",
  "claude-fable-5",
].map((id) => ({
  id,
  label: anthropicLabel(id),
  contextTokens: id === "claude-haiku-4-5" ? 200_000 : 1_000_000,
  inputPerMillion: ANTHROPIC_PRICE[id]?.input ?? null,
  outputPerMillion: ANTHROPIC_PRICE[id]?.output ?? null,
}));

// A small vision-capable set for OpenRouter (slugs drift, so this only shows
// when the live list can't be fetched — the operator can still type manually).
const OPENROUTER_FALLBACK: AiModelOption[] = [
  {
    id: "google/gemini-2.5-flash",
    label: "Google: Gemini 2.5 Flash",
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
  },
  {
    id: "google/gemini-2.5-flash-lite",
    label: "Google: Gemini 2.5 Flash Lite",
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
  },
  {
    id: "qwen/qwen2.5-vl-72b-instruct",
    label: "Qwen: Qwen2.5 VL 72B",
    inputPerMillion: 0.25,
    outputPerMillion: 0.75,
  },
  { id: "z-ai/glm-4.5v", label: "Z.ai: GLM 4.5V", inputPerMillion: 0.5, outputPerMillion: 1.75 },
  {
    id: "anthropic/claude-sonnet-5",
    label: "Anthropic: Claude Sonnet 5",
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
].map((m) => ({ contextTokens: null, ...m }));

function anthropicLabel(id: string): string {
  // "claude-opus-4-8" -> "Claude Opus 4.8"
  const words = id.replace(/^claude-/, "").split("-");
  const version = words.filter((w) => /^\d+$/.test(w)).join(".");
  const name = words
    .filter((w) => !/^\d+$/.test(w))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return `Claude ${name}${version ? ` ${version}` : ""}`.trim();
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

// OpenRouter prices are per-token strings and use "-1" for variable/unknown
// pricing (auto-routers). Anything not a real, non-negative number => unknown.
function perMillion(raw?: string): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return round4(n * 1e6);
}

// The contract requires a positive int; some entries report 0 or omit it.
function contextOf(raw?: number): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
}

export async function fetchAiModels(opts: {
  provider: AiProvider;
  baseUrl?: string | null;
  apiKey?: string | null;
}): Promise<AiModelList> {
  return opts.provider === "anthropic"
    ? fetchAnthropic(opts.apiKey)
    : fetchOpenAi(opts.baseUrl, opts.apiKey);
}

// --- Anthropic (bare ids via api.anthropic.com/v1/models) -------------------

interface AnthropicModel {
  id: string;
  display_name?: string;
  capabilities?: { image_input?: { supported?: boolean } };
}

async function fetchAnthropic(apiKey?: string | null): Promise<AiModelList> {
  if (!apiKey) {
    return {
      provider: "anthropic",
      source: "static",
      note: "Fără cheie Anthropic stocată — arăt lista implicită. Salvează o cheie ca să văd lista ta live.",
      models: ANTHROPIC_FALLBACK,
    };
  }
  try {
    const res = await fetch(ANTHROPIC_MODELS_URL, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: AnthropicModel[] };
    const models = (body.data ?? [])
      // Keep vision models; drop pre-3.x (no vision) defensively by id.
      .filter((m) => m.capabilities?.image_input?.supported !== false)
      .filter((m) => !/^claude-(2|instant|1)/.test(m.id))
      .map<AiModelOption>((m) => ({
        id: m.id,
        label: m.display_name ?? anthropicLabel(m.id),
        contextTokens: null,
        inputPerMillion: ANTHROPIC_PRICE[m.id]?.input ?? null,
        outputPerMillion: ANTHROPIC_PRICE[m.id]?.output ?? null,
      }))
      .filter((m) => aiModelOptionSchema.safeParse(m).success);
    if (models.length === 0) throw new Error("listă goală");
    return { provider: "anthropic", source: "live", note: null, models };
  } catch (err) {
    return {
      provider: "anthropic",
      source: "static",
      note: `Nu am putut încărca lista live (${short(err)}) — arăt lista implicită.`,
      models: ANTHROPIC_FALLBACK,
    };
  }
}

// --- OpenAI-compatible / OpenRouter -----------------------------------------

interface OpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
}

async function fetchOpenAi(baseUrl?: string | null, apiKey?: string | null): Promise<AiModelList> {
  const base = (baseUrl?.trim() || OPENROUTER_BASE).replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  try {
    const res = await fetch(`${base}/models`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: OpenRouterModel[] };
    const rows = body.data ?? [];
    // OpenRouter entries carry `architecture`; a plain OpenAI /models does not.
    const isOpenRouter = rows.some((m) => m.architecture !== undefined);
    const kept = isOpenRouter
      ? rows.filter((m) => m.architecture?.input_modalities?.includes("image"))
      : rows;
    const models = kept
      .map<AiModelOption>((m) => ({
        id: m.id,
        label: m.name ?? m.id,
        contextTokens: contextOf(m.context_length),
        inputPerMillion: perMillion(m.pricing?.prompt),
        outputPerMillion: perMillion(m.pricing?.completion),
      }))
      // Safety net: never ship a row the client's schema would reject — one odd
      // entry must not blank the whole dropdown.
      .filter((m) => aiModelOptionSchema.safeParse(m).success)
      .sort((a, b) => a.label.localeCompare(b.label, "ro"));
    if (models.length === 0) throw new Error("listă goală");
    return {
      provider: "openai",
      source: "live",
      note: isOpenRouter
        ? null
        : "Lista provine dintr-un endpoint OpenAI generic (fără filtru de vedere).",
      models,
    };
  } catch (err) {
    return {
      provider: "openai",
      source: "static",
      note: `Nu am putut încărca lista live de la ${base} (${short(err)}) — arăt lista implicită.`,
      models: OPENROUTER_FALLBACK,
    };
  }
}

function short(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 80);
}
