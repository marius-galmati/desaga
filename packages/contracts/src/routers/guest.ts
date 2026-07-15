import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { apiErrorSchema } from "../schemas/common";
import {
  guestMenuSchema,
  guestOrderListSchema,
  guestOrderSchema,
  guestPlateListSchema,
  guestSessionSchema,
  guestTablesSchema,
  okResultSchema,
  placeOrderRequestSchema,
  serviceRequestBodySchema,
  startSessionRequestSchema,
} from "../schemas/guest";

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
  getTables: {
    method: "GET",
    path: "/guest/:tenantSlug/tables",
    pathParams: z.object({ tenantSlug: z.string().min(1) }),
    summary: "Tables + active QR slug (table picker when no physical QR yet)",
    responses: { 200: guestTablesSchema, 404: apiErrorSchema },
  },

  // Open (or join) a table's shared session from a scanned QR slug. Returns the
  // raw device token ONCE — subsequent calls send it as the X-Guest-Token header.
  startSession: {
    method: "POST",
    path: "/guest/session",
    body: startSessionRequestSchema,
    summary: "Open/join a table session from a QR slug (returns a device token)",
    responses: { 200: guestSessionSchema, 404: apiErrorSchema },
  },

  // The token-carrying routes read X-Guest-Token; no body param carries it.
  placeOrder: {
    method: "POST",
    path: "/guest/orders",
    body: placeOrderRequestSchema,
    summary: "Place an order for the current session (X-Guest-Token header)",
    responses: {
      201: guestOrderSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
    },
  },
  listOrders: {
    method: "GET",
    path: "/guest/orders",
    summary: "Orders placed in the current session (X-Guest-Token header)",
    responses: { 200: guestOrderListSchema, 401: apiErrorSchema },
  },
  serviceRequest: {
    method: "POST",
    path: "/guest/service",
    body: serviceRequestBodySchema,
    summary: "Call a waiter or request the bill (X-Guest-Token header)",
    responses: { 200: okResultSchema, 401: apiErrorSchema },
  },

  // "Farfuria mea" — the table's plates that were photographed at the pass and
  // scored, in the warm guest framing (X-Guest-Token header).
  listPlates: {
    method: "GET",
    path: "/guest/plates",
    summary: "The session's evaluated plates, as a guest-facing keepsake",
    responses: { 200: guestPlateListSchema, 401: apiErrorSchema },
  },
});
