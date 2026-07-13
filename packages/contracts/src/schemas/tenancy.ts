import { z } from "zod";
import { uuidSchema } from "./common";

export const tenantSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  name: z.string(),
});
export type Tenant = z.infer<typeof tenantSchema>;

export const locationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  timezone: z.string(),
  address: z.string().nullable(),
});
export type Location = z.infer<typeof locationSchema>;

export const locationListSchema = z.array(locationSchema);

// GET /tenancy/me payload: current tenant + its active locations.
export const tenantContextSchema = z.object({
  tenant: tenantSchema,
  locations: locationListSchema,
});
export type TenantContext = z.infer<typeof tenantContextSchema>;
