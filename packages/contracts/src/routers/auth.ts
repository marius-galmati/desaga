import { initContract } from "@ts-rest/core";
import { z } from "zod";
import {
  loginRequestSchema,
  loginResponseSchema,
  mePayloadSchema,
  refreshRequestSchema,
} from "../schemas/auth";
import { apiErrorSchema } from "../schemas/common";

const c = initContract();

export const authContract = c.router({
  login: {
    method: "POST",
    path: "/auth/login",
    summary: "Staff login (argon2 verify -> JWT access + opaque rotating refresh token)",
    body: loginRequestSchema,
    responses: {
      200: loginResponseSchema,
      401: apiErrorSchema,
    },
  },
  refresh: {
    method: "POST",
    path: "/auth/refresh",
    summary: "Rotate the refresh token and issue a new access token",
    body: refreshRequestSchema,
    responses: {
      200: loginResponseSchema,
      401: apiErrorSchema,
    },
  },
  logout: {
    method: "POST",
    path: "/auth/logout",
    summary: "Revoke a refresh token",
    body: refreshRequestSchema,
    responses: {
      200: z.object({ ok: z.literal(true) }),
    },
  },
  me: {
    method: "GET",
    path: "/auth/me",
    summary: "Current staff user + tenant + locations (single bootstrap call)",
    responses: {
      200: mePayloadSchema,
      401: apiErrorSchema,
    },
  },
});
