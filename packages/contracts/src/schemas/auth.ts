import { z } from "zod";
import { uuidSchema } from "./common";
import { userRoleSchema } from "./enums";
import { locationListSchema, tenantSchema } from "./tenancy";

export const loginRequestSchema = z.object({
  // Email is unique per tenant, so login is tenant-scoped by slug.
  tenantSlug: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const authUserSchema = z.object({
  id: uuidSchema,
  tenantId: uuidSchema,
  locationId: uuidSchema.nullable(),
  role: userRoleSchema,
  email: z.string(),
  fullName: z.string(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  // Opaque, rotated on every refresh; only its sha256 is stored server-side.
  refreshToken: z.string(),
  accessTokenExpiresInSeconds: z.number().int().positive(),
});
export type TokenPair = z.infer<typeof tokenPairSchema>;

export const loginResponseSchema = z.object({
  user: authUserSchema,
  tokens: tokenPairSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

// GET /auth/me bootstrap payload: who am I (role included) + the tenant I am
// scoped to + its active locations, so staff clients boot with a single call.
export const mePayloadSchema = z.object({
  user: authUserSchema,
  tenant: tenantSchema,
  locations: locationListSchema,
});
export type MePayload = z.infer<typeof mePayloadSchema>;
