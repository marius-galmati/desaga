import { z } from "zod";
import { bilingualTextSchema, moneyMinorSchema, uuidSchema } from "./common";

// Public, guest-facing menu shapes. NO internal fields (reference-set status,
// refs_stale, station, cost) ever cross into the guest surface — only what a
// diner sees. Read path is unauthenticated (tenant resolved from the URL slug).

export const guestMenuDishSchema = z.object({
  id: uuidSchema,
  name: bilingualTextSchema,
  description: bilingualTextSchema.nullable(),
  priceMinor: moneyMinorSchema,
  heroPhotoUrl: z.string().nullable(),
  allergenCodes: z.array(z.string()),
});
export type GuestMenuDish = z.infer<typeof guestMenuDishSchema>;

export const guestMenuCategorySchema = z.object({
  id: uuidSchema,
  name: bilingualTextSchema,
  dishes: z.array(guestMenuDishSchema),
});
export type GuestMenuCategory = z.infer<typeof guestMenuCategorySchema>;

export const guestMenuSchema = z.object({
  tenant: z.object({ name: z.string() }),
  categories: z.array(guestMenuCategorySchema),
});
export type GuestMenu = z.infer<typeof guestMenuSchema>;
