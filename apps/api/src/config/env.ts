import {
  ACCESS_TOKEN_TTL_SECONDS,
  EVAL_MODEL_DEFAULT,
  MEDIA_BUCKET,
  REFRESH_TOKEN_TTL_DAYS,
} from "@boca/config";
import { z } from "zod";

// "" in an env file means "unset" for optional secrets (e.g. ANTHROPIC_API_KEY=).
const optionalNonEmpty = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== "" ? value : undefined));

// Own zod-validated env (no @nestjs/config): a bad deploy dies at boot.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  // Platform (super-admin) connection — boca_platform_login, the only role that
  // can create tenants. Absent/empty = the platform dashboard endpoints are
  // disabled (compose passes "" when the operator hasn't opted in).
  PLATFORM_DATABASE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().min(1).optional(),
  ),
  // BullMQ queue "ai-score" (producer in the HTTP app, consumer in main.worker).
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  // MinIO (S3-compatible). Defaults match infra/compose/docker-compose.dev.yml;
  // prod compose must set all four explicitly.
  S3_ENDPOINT: z.string().min(1).default("http://127.0.0.1:9000"),
  // Browser-facing MinIO host used ONLY to sign GET URLs (the signature binds
  // the host, so presigned URLs must be signed against a host the browser can
  // reach). Defaults to S3_ENDPOINT when the internal and public hosts match;
  // set it in dev/prod when the API talks to MinIO over an internal hostname
  // (e.g. S3_ENDPOINT=http://minio:9000, S3_PUBLIC_ENDPOINT=http://localhost:9000).
  S3_PUBLIC_ENDPOINT: optionalNonEmpty,
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1).default("boca"),
  S3_SECRET_KEY: z.string().min(1).default("boca-dev-password"),
  S3_BUCKET: z.string().min(1).default(MEDIA_BUCKET),
  // AI evaluation. Missing/empty ANTHROPIC_API_KEY or EVAL_MOCK=true selects the
  // deterministic mock evaluator — the pipeline stays fully exercisable without
  // the client's real key. EVAL_MODEL is the PINNED model id (never a floating
  // alias); the cost-tier decision is deliberate (docs/arhitectura.md).
  ANTHROPIC_API_KEY: optionalNonEmpty,
  EVAL_MODEL: z.string().min(1).default(EVAL_MODEL_DEFAULT),
  EVAL_MOCK: z
    .string()
    .optional()
    .transform((value) => value === "true" || value === "1"),
  JWT_ACCESS_SECRET: z.string().min(16),
  // Reserved: refresh tokens are OPAQUE rotating tokens (sha256 at rest in
  // auth_refresh_token), NOT JWTs — see modules/auth/auth.service.ts. Validated
  // when present so a future switch to signed refresh JWTs cannot ship with a
  // weak secret, but not required today (.env.example does not carry it).
  JWT_REFRESH_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(ACCESS_TOKEN_TTL_SECONDS),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(REFRESH_TOKEN_TTL_DAYS),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${detail}`);
  }
  return parsed.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

/** Nest injection token for the parsed env. */
export const ENV = Symbol("BOCA_ENV");
