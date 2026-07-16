import { z } from "zod";
import { tenantBrandingSchema } from "./branding";
import { bilingualTextSchema, moneyMinorSchema, uuidSchema } from "./common";
import { serviceRequestKindSchema } from "./enums";

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

// Tables + their active QR slug — lets the guest app offer a table picker when
// there is no physical QR yet (demo/soft-launch). The order flow lives at
// /t/{qrSlug}.
export const guestTableSchema = z.object({ label: z.string(), qrSlug: z.string() });
export type GuestTable = z.infer<typeof guestTableSchema>;
export const guestTablesSchema = z.array(guestTableSchema);

// --- Ordering (Phase 2) ----------------------------------------------------

// A table session opened (or joined) from a QR scan. `token` is the raw device
// token — returned ONCE; the client stores it and sends it as X-Guest-Token.
export const guestSessionSchema = z.object({
  token: z.string(),
  sessionId: uuidSchema,
  tableLabel: z.string(),
  guest: z.object({ displayName: z.string(), emoji: z.string() }),
});
export type GuestSession = z.infer<typeof guestSessionSchema>;

export const startSessionRequestSchema = z.object({
  qrSlug: z.string().min(1),
});
export type StartSessionRequest = z.infer<typeof startSessionRequestSchema>;

export const placeOrderItemSchema = z.object({
  dishId: uuidSchema,
  quantity: z.number().int().min(1).max(99),
  note: z.string().max(280).optional(),
});
export const placeOrderRequestSchema = z.object({
  items: z.array(placeOrderItemSchema).min(1).max(50),
});
export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;

// order/item statuses mirror the order_status enum (guest-visible subset).
export const guestOrderStatusSchema = z.enum([
  "submitted",
  "accepted",
  "fired",
  "ready",
  "served",
  "voided",
]);

export const guestOrderLineSchema = z.object({
  id: uuidSchema,
  dishId: uuidSchema,
  name: bilingualTextSchema,
  quantity: z.number().int(),
  unitPriceMinor: moneyMinorSchema,
  lineTotalMinor: moneyMinorSchema,
  status: guestOrderStatusSchema,
  note: z.string().nullable(),
});

// The guest persona who placed the order (for the shared-table bill attribution).
export const guestOrderGuestSchema = z.object({
  displayName: z.string(),
  emoji: z.string(),
});

export const guestOrderSchema = z.object({
  id: uuidSchema,
  status: guestOrderStatusSchema,
  subtotalMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  createdAt: z.string(),
  guest: guestOrderGuestSchema.nullable(),
  items: z.array(guestOrderLineSchema),
});
export type GuestOrder = z.infer<typeof guestOrderSchema>;

export const guestOrderListSchema = z.array(guestOrderSchema);

// serviceRequestKindSchema / ServiceRequestKind come from ./enums (single source).
export const serviceRequestBodySchema = z.object({ kind: serviceRequestKindSchema });

export const okResultSchema = z.object({ ok: z.literal(true) });

// --- Tenant context (multi-domain routing) ----------------------------------

// Which tenant serves the calling hostname. Resolved from the request's Host
// header (never a query param) — the pre-login entry point for all three apps
// on a multi-brand deployment.
export const hostTenantSchema = z.object({
  tenantSlug: z.string(),
  tenantName: z.string(),
  surface: z.enum(["guest", "admin", "staff"]),
  branding: tenantBrandingSchema,
});
export type HostTenant = z.infer<typeof hostTenantSchema>;

// --- Farfuria mea (guest-facing AI comparison) -----------------------------

// A plate the table ordered that was photographed at the pass and scored by the
// AI. The guest sees ONLY the warm, keepsake framing — never the chef's QC
// verdict or the 6-criterion breakdown. `fidelity` is 0-10 (median/5 * 10).
export const guestPlateSchema = z.object({
  evaluationId: uuidSchema,
  dishName: bilingualTextSchema,
  fidelity: z.number().min(0).max(10),
  candidateUrl: z.string().nullable(), // the real served-plate photo (from the pass)
  referenceUrl: z.string().nullable(), // one reference photo (the house recipe)
  chips: z.array(z.string()), // warm delight chips derived from the top criteria
  createdAt: z.string(),
});
export type GuestPlate = z.infer<typeof guestPlateSchema>;

export const guestPlateListSchema = z.array(guestPlateSchema);
