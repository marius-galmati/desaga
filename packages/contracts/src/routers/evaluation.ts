import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { apiErrorSchema } from "../schemas/common";
import {
  aiEvaluationSchema,
  attachReferencesRequestSchema,
  createDemoDishRequestSchema,
  createDemoDishResponseSchema,
  createEvaluationRequestSchema,
  createEvaluationResponseSchema,
  demoDishListSchema,
  referenceSetSummarySchema,
} from "../schemas/evaluation";

const c = initContract();

// ---------------------------------------------------------------------------
// FILE UPLOAD FLOW (decision, read me):
//
// ts-rest multipart support is limited, so uploads are TWO-step:
//
//   1. POST /admin/uploads — a documented NON-ts-rest Nest route (multipart/
//      form-data, single file in field UPLOAD_FILE_FIELD). The API validates
//      content type against UPLOAD_ALLOWED_CONTENT_TYPES and size against
//      UPLOAD_MAX_BYTES, streams the object to MinIO and responds
//      201 uploadResponseSchema => { photoKey }. Same JWT admin guard as the
//      ts-rest routes. Constants below are the single source of truth shared
//      by the Nest controller and the UI uploader.
//
//   2. The returned photoKey is then referenced from the JSON (ts-rest)
//      endpoints: attachReferences { imageKeys } / createEvaluation
//      { candidatePhotoKey }. The API validates each key exists in MinIO
//      before persisting.
//
// Everything else on this surface is plain JSON and stays in ts-rest.
// ---------------------------------------------------------------------------

export const ADMIN_UPLOAD_PATH = "/admin/uploads";
export const UPLOAD_FILE_FIELD = "file";
export const UPLOAD_ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

// Namespace note: paths carry the /admin prefix literally for now. When the
// router splits into c.router({ staff, guest, admin }) with pathPrefix per
// namespace, this contract nests under `admin` — route KEYS stay stable.
export const evaluationContract = c.router({
  createDemoDish: {
    method: "POST",
    path: "/admin/demo/dishes",
    summary: "Create an ad-hoc demo dish (dish + dish_version, name RO/EN)",
    body: createDemoDishRequestSchema,
    responses: {
      201: createDemoDishResponseSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
    },
  },
  listDemoDishes: {
    method: "GET",
    path: "/admin/demo/dishes",
    summary: "Demo dishes with reference-set status (referenceSet null = no refs yet)",
    responses: {
      200: demoDishListSchema,
      401: apiErrorSchema,
    },
  },
  attachReferences: {
    method: "POST",
    path: "/admin/demo/dishes/:dishId/references",
    summary: "Attach 3-5 uploaded photos as a new ACTIVE reference set for the dish",
    pathParams: z.object({ dishId: z.string().uuid() }),
    body: attachReferencesRequestSchema,
    responses: {
      201: referenceSetSummarySchema,
      400: apiErrorSchema, // bad/unknown imageKeys
      401: apiErrorSchema,
      404: apiErrorSchema, // dish not found
    },
  },
  createEvaluation: {
    method: "POST",
    path: "/admin/demo/evaluations",
    summary: "Enqueue an AI evaluation of a candidate plate photo (async — poll getEvaluation)",
    body: createEvaluationRequestSchema,
    responses: {
      202: createEvaluationResponseSchema,
      400: apiErrorSchema, // unknown candidatePhotoKey / dish has no active reference set
      401: apiErrorSchema,
      404: apiErrorSchema, // dish not found
    },
  },
  getEvaluation: {
    method: "GET",
    path: "/admin/demo/evaluations/:id",
    summary: "Evaluation status + conformity report once completed",
    pathParams: z.object({ id: z.string().uuid() }),
    responses: {
      200: aiEvaluationSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
});
