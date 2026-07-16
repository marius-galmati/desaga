import { z } from "zod";
import { uuidSchema } from "./common";

// Per-tenant brand identity, shared by the guest surface (display) and the
// admin surface (editor). SECURITY: the palette is a WHITELISTED token -> hex
// map — keys are locked to the accent families below and values to strict
// 6-digit hex, so tenant input can never inject arbitrary CSS.

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "culoare hex #rrggbb");

// The three brand accent families of the design system (globals.css). Surfaces
// (paper/ink) stay platform-owned — readability is not tenant-configurable.
export const brandColorsSchema = z
  .object({
    vin: hexColorSchema.optional(),
    "vin-deep": hexColorSchema.optional(),
    "vin-wash": hexColorSchema.optional(),
    ochre: hexColorSchema.optional(),
    "ochre-soft": hexColorSchema.optional(),
    "ochre-wash": hexColorSchema.optional(),
    pine: hexColorSchema.optional(),
    "pine-soft": hexColorSchema.optional(),
    "pine-wash": hexColorSchema.optional(),
  })
  .strict();
export type BrandColors = z.infer<typeof brandColorsSchema>;

export const BRAND_COLOR_KEYS = [
  "vin",
  "vin-deep",
  "vin-wash",
  "ochre",
  "ochre-soft",
  "ochre-wash",
  "pine",
  "pine-soft",
  "pine-wash",
] as const;
export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];

// Read shape. Null fields = "use the app's neutral fallback"; logoUrl is a
// short-lived presigned GET minted at read time (never persisted), while
// logoMediaId is the stable reference the editor sends back on save.
export const tenantBrandingSchema = z.object({
  displayName: z.string().nullable(),
  tagline: z.string().nullable(),
  greeting: z.string().nullable(),
  promise: z.string().nullable(),
  locations: z.array(z.string()),
  logoMediaId: uuidSchema.nullable(),
  logoUrl: z.string().nullable(),
  colors: brandColorsSchema,
});
export type TenantBranding = z.infer<typeof tenantBrandingSchema>;

// Write shape (admin editor). Whole-object PUT — omitted fields clear to null,
// matching the editor's "what you see is what is saved" form.
export const updateBrandingRequestSchema = z.object({
  displayName: z.string().max(120).nullable(),
  tagline: z.string().max(120).nullable(),
  greeting: z.string().max(120).nullable(),
  promise: z.string().max(240).nullable(),
  locations: z.array(z.string().min(1).max(80)).max(6),
  logoMediaId: uuidSchema.nullable(),
  colors: brandColorsSchema,
});
export type UpdateBrandingRequest = z.infer<typeof updateBrandingRequestSchema>;
