import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { apiErrorSchema, uuidSchema } from "../schemas/common";
import { aiEvaluationSchema } from "../schemas/evaluation";
import { captureRequestSchema, captureResponseSchema, passQueueSchema } from "../schemas/staff";

const c = initContract();

// Staff pass surface. kitchen_pass photographs a real plated order item and gets
// the AI conformity report bound to that item (not a demo fixture).
export const staffContract = c.router({
  passQueue: {
    method: "GET",
    path: "/staff/pass-queue",
    summary: "Plates on active orders waiting to be shot at the pass",
    responses: { 200: passQueueSchema, 401: apiErrorSchema },
  },
  capture: {
    method: "POST",
    path: "/staff/captures",
    body: captureRequestSchema,
    summary: "Capture + evaluate a real plated order item",
    responses: {
      202: captureResponseSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
  getCapture: {
    method: "GET",
    path: "/staff/captures/:id",
    pathParams: z.object({ id: uuidSchema }),
    summary: "Poll a capture's evaluation status/report",
    responses: { 200: aiEvaluationSchema, 401: apiErrorSchema, 404: apiErrorSchema },
  },
});
