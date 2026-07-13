import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

export const healthContract = c.router({
  check: {
    method: "GET",
    path: "/health",
    summary: "Liveness probe (used by compose healthchecks and deploy smoke-check)",
    responses: {
      200: z.object({
        status: z.literal("ok"),
        uptimeSeconds: z.number(),
      }),
    },
  },
});
