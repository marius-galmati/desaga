import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { apiErrorSchema } from "../schemas/common";
import {
  addPlatformDomainRequestSchema,
  aiCostPeriodSchema,
  aiCostReportSchema,
  aiSettingsSchema,
  createPlatformTenantRequestSchema,
  createPlatformTenantResponseSchema,
  platformLoginRequestSchema,
  platformLoginResponseSchema,
  platformTenantListSchema,
  updateAiPricesRequestSchema,
  updateAiSettingsRequestSchema,
  updatePlatformBrandingRequestSchema,
} from "../schemas/platform";

const c = initContract();

const idParams = z.object({ id: z.string().uuid() });

// Every protected platform route can produce this full error set (the service
// result type is one union) — declared uniformly so handlers type-check.
const platformErrors = {
  400: apiErrorSchema,
  401: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  503: apiErrorSchema,
} as const;

// Super-admin (Bitup) backend. Guarded by the dedicated platform JWT (NOT the
// tenant JWT) on the Nest controller; runs on the boca_platform DB role — the
// only role that can create tenants (RLS chicken-and-egg by design).
export const platformContract = c.router({
  login: {
    method: "POST",
    path: "/platform/auth/login",
    body: platformLoginRequestSchema,
    responses: { 200: platformLoginResponseSchema, 401: apiErrorSchema, 503: apiErrorSchema },
  },
  listTenants: {
    method: "GET",
    path: "/platform/tenants",
    summary: "All tenants + their domains and branding summary",
    responses: { 200: platformTenantListSchema, 401: apiErrorSchema, 503: apiErrorSchema },
  },
  createTenant: {
    method: "POST",
    path: "/platform/tenants",
    summary: "Onboard a brand: tenant + first location + tenant_admin + domains",
    body: createPlatformTenantRequestSchema,
    responses: {
      201: createPlatformTenantResponseSchema,
      ...platformErrors, // 409 = slug or domain already taken
    },
  },
  addDomain: {
    method: "POST",
    path: "/platform/tenants/:id/domains",
    pathParams: idParams,
    body: addPlatformDomainRequestSchema,
    responses: {
      200: z.object({ ok: z.literal(true) }),
      ...platformErrors, // 409 = domain registered to another tenant
    },
  },
  deleteDomain: {
    method: "DELETE",
    path: "/platform/domains/:id",
    pathParams: idParams,
    body: z.object({}),
    responses: {
      200: z.object({ ok: z.literal(true) }),
      ...platformErrors,
    },
  },
  updateBranding: {
    method: "PUT",
    path: "/platform/tenants/:id/branding",
    summary: "Texts + palette on behalf of the tenant (logo stays tenant-owned)",
    body: updatePlatformBrandingRequestSchema,
    responses: {
      200: z.object({ ok: z.literal(true) }),
      ...platformErrors,
    },
  },

  // --- AI runtime config + costs ------------------------------------------
  getAiSettings: {
    method: "GET",
    path: "/platform/ai/settings",
    summary: "Active provider/model + price sheet (API key never returned)",
    responses: { 200: aiSettingsSchema, ...platformErrors },
  },
  updateAiSettings: {
    method: "PUT",
    path: "/platform/ai/settings",
    body: updateAiSettingsRequestSchema,
    responses: { 200: aiSettingsSchema, ...platformErrors },
  },
  updateAiPrices: {
    method: "PUT",
    path: "/platform/ai/prices",
    body: updateAiPricesRequestSchema,
    responses: { 200: aiSettingsSchema, ...platformErrors },
  },
  getAiCosts: {
    method: "GET",
    path: "/platform/ai/costs",
    summary: "Cost + usage rollup per model and per tenant for the window",
    query: z.object({ period: aiCostPeriodSchema.optional() }),
    responses: { 200: aiCostReportSchema, ...platformErrors },
  },
});
