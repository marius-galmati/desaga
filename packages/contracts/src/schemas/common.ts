import { z } from "zod";

export const uuidSchema = z.string().uuid();

// All money is RON in integer minor units (bani) — never floats, matching the
// *_minor integer columns and their >= 0 CHECKs in db/schema.sql.
export const moneyMinorSchema = z.number().int().nonnegative();
export type MoneyMinor = z.infer<typeof moneyMinorSchema>;

// VAT expressed in basis points (vat_rate_bp smallint).
export const vatRateBpSchema = z.number().int().nonnegative().max(10_000);

// Mirrors the jsonb CHECK (col ?& ARRAY['ro','en']) on menu_category.name,
// dish_version.name/description/story, station.name, allergen.name.
export const bilingualTextSchema = z.object({
  ro: z.string(),
  en: z.string(),
});
export type BilingualText = z.infer<typeof bilingualTextSchema>;

export const apiErrorSchema = z.object({
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
