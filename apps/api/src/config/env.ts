import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from "@boca/config";
import { z } from "zod";

// Own zod-validated env (no @nestjs/config): a bad deploy dies at boot.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  WORKER_DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
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
