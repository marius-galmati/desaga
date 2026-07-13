// Typed fetch wrappers over the admin demo surface.
//
// DECISION (task 4): plain typed fetch instead of the ts-rest client. The two
// reasons: (a) the token-refresh-and-retry interceptor below sits awkwardly in
// initClient's api option, and (b) the upload route is documented as NON-ts-rest
// multipart anyway — one thin wrapper keeps both worlds identical. Type safety
// is preserved end-to-end because every response is zod-parsed with the SAME
// schemas the Nest handlers implement (@boca/contracts), which also gives us
// runtime validation the ts-rest client would not do by default.

import {
  ADMIN_UPLOAD_PATH,
  type AiEvaluation,
  type AttachReferencesRequest,
  aiEvaluationSchema,
  type CreateDemoDishRequest,
  type CreateDemoDishResponse,
  type CreateEvaluationRequest,
  type CreateEvaluationResponse,
  createDemoDishResponseSchema,
  createEvaluationResponseSchema,
  type DemoDish,
  demoDishListSchema,
  type ReferenceSetSummary,
  referenceSetSummarySchema,
  UPLOAD_FILE_FIELD,
  type UploadResponse,
  uploadResponseSchema,
} from "@boca/contracts";
import { clearSession, getAccessToken, refreshSession } from "./auth";

/** Thrown when the session cannot be (re)established — caller redirects to /login. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Sesiune expirată");
    this.name = "UnauthorizedError";
  }
}

/** Thrown for non-2xx API responses, with the server's RO message when present. */
export class ApiRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

async function extractMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) return body.message;
  } catch {
    // fall through
  }
  return `Cererea a eșuat (${res.status}).`;
}

/**
 * Authenticated fetch against the same-origin /api proxy. On a 401 it rotates
 * the refresh token ONCE and retries; a second 401 clears the session.
 */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const doFetch = (): Promise<Response> => {
    const token = getAccessToken();
    if (!token) throw new UnauthorizedError();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(`/api${path}`, { ...init, headers });
  };

  let res = await doFetch();
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      clearSession();
      throw new UnauthorizedError();
    }
    res = await doFetch();
    if (res.status === 401) {
      clearSession();
      throw new UnauthorizedError();
    }
  }
  return res;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  parse: (payload: unknown) => T,
): Promise<T> {
  const res = await authFetch(path, init);
  if (!res.ok) throw new ApiRequestError(res.status, await extractMessage(res));
  return parse(await res.json());
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// --- admin demo endpoints (ts-rest contract: apiContract.evaluation) ---------

export function createDemoDish(body: CreateDemoDishRequest): Promise<CreateDemoDishResponse> {
  return requestJson("/admin/demo/dishes", jsonInit("POST", body), (p) =>
    createDemoDishResponseSchema.parse(p),
  );
}

export function listDemoDishes(): Promise<DemoDish[]> {
  return requestJson("/admin/demo/dishes", { method: "GET" }, (p) => demoDishListSchema.parse(p));
}

export function attachReferences(
  dishId: string,
  body: AttachReferencesRequest,
): Promise<ReferenceSetSummary> {
  return requestJson(`/admin/demo/dishes/${dishId}/references`, jsonInit("POST", body), (p) =>
    referenceSetSummarySchema.parse(p),
  );
}

export function createEvaluation(body: CreateEvaluationRequest): Promise<CreateEvaluationResponse> {
  return requestJson("/admin/demo/evaluations", jsonInit("POST", body), (p) =>
    createEvaluationResponseSchema.parse(p),
  );
}

export function getEvaluation(id: string): Promise<AiEvaluation> {
  return requestJson(`/admin/demo/evaluations/${id}`, { method: "GET" }, (p) =>
    aiEvaluationSchema.parse(p),
  );
}

// --- upload (documented non-ts-rest multipart route) --------------------------

export async function uploadPhoto(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append(UPLOAD_FILE_FIELD, file);
  const res = await authFetch(ADMIN_UPLOAD_PATH, { method: "POST", body: form });
  if (!res.ok) throw new ApiRequestError(res.status, await extractMessage(res));
  return uploadResponseSchema.parse(await res.json());
}
