import { z } from "zod";
import { brandColorsSchema } from "./branding";
import { uuidSchema } from "./common";

// Platform (super-admin) surface: Bitup operators onboarding restaurant brands.
// COMPLETELY separate auth from tenant users (platform_admin table, dedicated
// JWT type) — a tenant admin can never reach these shapes and vice versa.

export const platformLoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(256),
});
export type PlatformLoginRequest = z.infer<typeof platformLoginRequestSchema>;

export const platformAdminSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
});
export type PlatformAdmin = z.infer<typeof platformAdminSchema>;

export const platformLoginResponseSchema = z.object({
  token: z.string(),
  expiresInSeconds: z.number().int().positive(),
  admin: platformAdminSchema,
});
export type PlatformLoginResponse = z.infer<typeof platformLoginResponseSchema>;

// Bare hostname (no scheme/port). Same shape tenant_domain stores.
const hostnameSchema = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, "hostname invalid");

export const platformSurfaceSchema = z.enum(["guest", "admin", "staff"]);

export const platformDomainSchema = z.object({
  id: uuidSchema,
  domain: z.string(),
  surface: platformSurfaceSchema,
  isPrimary: z.boolean(),
});
export type PlatformDomain = z.infer<typeof platformDomainSchema>;

// Branding as the platform sees it: texts + palette. The logo is deliberately
// NOT editable here — it lives in the tenant's own media library (the tenant
// admin manages it); platform writes must never touch logo_media_id.
export const platformBrandingSchema = z.object({
  displayName: z.string().nullable(),
  tagline: z.string().nullable(),
  greeting: z.string().nullable(),
  promise: z.string().nullable(),
  locations: z.array(z.string()),
  hasLogo: z.boolean(),
  colors: brandColorsSchema,
});
export type PlatformBranding = z.infer<typeof platformBrandingSchema>;

export const platformTenantSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
  domains: z.array(platformDomainSchema),
  branding: platformBrandingSchema.nullable(),
});
export type PlatformTenant = z.infer<typeof platformTenantSchema>;

export const platformTenantListSchema = z.array(platformTenantSchema);

export const createPlatformTenantRequestSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "slug: litere mici, cifre, cratime"),
  name: z.string().min(1).max(160),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).max(256),
  adminFullName: z.string().max(120).optional(),
  locationName: z.string().max(120).optional(),
  domains: z.object({
    guest: hostnameSchema.optional(),
    admin: hostnameSchema.optional(),
    staff: hostnameSchema.optional(),
  }),
});
export type CreatePlatformTenantRequest = z.infer<typeof createPlatformTenantRequestSchema>;

export const createPlatformTenantResponseSchema = z.object({
  tenantId: uuidSchema,
});

export const addPlatformDomainRequestSchema = z.object({
  domain: hostnameSchema,
  surface: platformSurfaceSchema,
  isPrimary: z.boolean().optional(),
});
export type AddPlatformDomainRequest = z.infer<typeof addPlatformDomainRequestSchema>;

// Whole-object PUT for texts + palette; logo untouched by design.
export const updatePlatformBrandingRequestSchema = z.object({
  displayName: z.string().max(120).nullable(),
  tagline: z.string().max(120).nullable(),
  greeting: z.string().max(120).nullable(),
  promise: z.string().max(240).nullable(),
  locations: z.array(z.string().min(1).max(80)).max(6),
  colors: brandColorsSchema,
});
export type UpdatePlatformBrandingRequest = z.infer<typeof updatePlatformBrandingRequestSchema>;

// --- AI runtime config + costs (platform-managed) --------------------------

export const aiProviderSchema = z.enum(["anthropic", "openai"]);
export type AiProvider = z.infer<typeof aiProviderSchema>;

export const aiModelPriceSchema = z.object({
  model: z.string().min(1),
  label: z.string().nullable(),
  inputPerMillion: z.number().nonnegative(),
  outputPerMillion: z.number().nonnegative(),
});
export type AiModelPrice = z.infer<typeof aiModelPriceSchema>;

// Read shape — the API key is NEVER returned, only whether one is set + last 4.
export const aiSettingsSchema = z.object({
  provider: aiProviderSchema,
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  hasKey: z.boolean(),
  keyLast4: z.string().nullable(),
  secretsConfigured: z.boolean(), // false => can't store a key yet (env missing)
  prices: z.array(aiModelPriceSchema),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

// One selectable model in the provider dropdown. Pricing/context are best-effort
// (present for OpenRouter live results and known Anthropic models, null otherwise).
export const aiModelOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextTokens: z.number().int().positive().nullable(),
  inputPerMillion: z.number().nonnegative().nullable(),
  outputPerMillion: z.number().nonnegative().nullable(),
});
export type AiModelOption = z.infer<typeof aiModelOptionSchema>;

// The dropdown catalog for one provider. `source` = "live" when fetched from the
// provider, "static" when we fell back to the built-in list; `note` explains why.
export const aiModelListSchema = z.object({
  provider: aiProviderSchema,
  source: z.enum(["live", "static"]),
  note: z.string().nullable(),
  models: z.array(aiModelOptionSchema),
});
export type AiModelList = z.infer<typeof aiModelListSchema>;

export const updateAiSettingsRequestSchema = z.object({
  provider: aiProviderSchema,
  baseUrl: z.string().max(300).nullable(),
  model: z.string().max(200).nullable(),
  // Write-only. Omit to keep the stored key; empty string clears it.
  apiKey: z.string().max(400).optional(),
});
export type UpdateAiSettingsRequest = z.infer<typeof updateAiSettingsRequestSchema>;

export const updateAiPricesRequestSchema = z.object({
  prices: z
    .array(
      z.object({
        model: z.string().min(1).max(200),
        label: z.string().max(120).nullable(),
        inputPerMillion: z.number().nonnegative(),
        outputPerMillion: z.number().nonnegative(),
      }),
    )
    .max(50),
});
export type UpdateAiPricesRequest = z.infer<typeof updateAiPricesRequestSchema>;

export const aiCostPeriodSchema = z.enum(["day", "week", "month", "all"]);
export type AiCostPeriod = z.infer<typeof aiCostPeriodSchema>;

export const aiCostReportSchema = z.object({
  period: aiCostPeriodSchema,
  rangeLabel: z.string(),
  totalCostUsd: z.number(),
  totalCalls: z.number().int().nonnegative(),
  byModel: z.array(
    z.object({
      model: z.string(),
      label: z.string().nullable(),
      calls: z.number().int().nonnegative(),
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      costUsd: z.number(),
    }),
  ),
  byTenant: z.array(
    z.object({
      tenantId: uuidSchema,
      name: z.string(),
      calls: z.number().int().nonnegative(),
      costUsd: z.number(),
    }),
  ),
});
export type AiCostReport = z.infer<typeof aiCostReportSchema>;
