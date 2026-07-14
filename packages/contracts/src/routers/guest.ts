import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { apiErrorSchema } from "../schemas/common";
import { guestMenuSchema } from "../schemas/guest";

const c = initContract();

// Guest (diner-facing) surface. Phase 1 = read-only menu, tenant resolved from
// the URL slug — no auth. Ordering/session routes (QR device token) nest here
// next, keeping these route KEYS stable per the namespace note in ./index.ts.
export const guestContract = c.router({
  getMenu: {
    method: "GET",
    path: "/guest/:tenantSlug/menu",
    pathParams: z.object({ tenantSlug: z.string().min(1) }),
    summary: "Public menu for a tenant (no auth): categories + available dishes",
    responses: { 200: guestMenuSchema, 404: apiErrorSchema },
  },
});
