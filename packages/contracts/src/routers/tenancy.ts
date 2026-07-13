import { initContract } from "@ts-rest/core";
import { apiErrorSchema } from "../schemas/common";
import { locationListSchema, tenantContextSchema, tenantSchema } from "../schemas/tenancy";

const c = initContract();

export const tenancyContract = c.router({
  me: {
    method: "GET",
    path: "/tenancy/me",
    summary: "Current tenant + its active locations in one call",
    responses: {
      200: tenantContextSchema,
      401: apiErrorSchema,
    },
  },
  // Fine-grained variants kept for cheap polling of a single slice.
  getCurrentTenant: {
    method: "GET",
    path: "/tenancy/tenant",
    summary: "Tenant of the authenticated user (RLS-scoped)",
    responses: {
      200: tenantSchema,
      401: apiErrorSchema,
    },
  },
  listLocations: {
    method: "GET",
    path: "/tenancy/locations",
    summary: "Active locations of the current tenant",
    responses: {
      200: locationListSchema,
      401: apiErrorSchema,
    },
  },
});
