// Typed fetch wrappers over the admin surface.
//
// DECISION: plain typed fetch instead of the ts-rest client. Two reasons:
// (a) the token-refresh-and-retry interceptor below sits awkwardly in
// initClient's api option, and (b) the media upload route is a documented
// NON-ts-rest multipart route anyway — one thin wrapper keeps both worlds
// identical. Type safety is preserved end-to-end because every response is
// zod-parsed with the SAME schemas the Nest handlers implement (@boca/contracts),
// which also gives us runtime validation the ts-rest client would not do.

import {
  ADMIN_MEDIA_UPLOAD_PATH,
  ADMIN_UPLOAD_PATH,
  type AdminAllergen,
  type AdminCategory,
  type AdminDishDetail,
  type AdminDishListItem,
  type AdminMediaAsset,
  type AdminOrder,
  type AdminSettings,
  type AdminStation,
  type AdminTable,
  type AdminUser,
  type AiEvaluation,
  type AttachReferencesRequest,
  adminAllergenListSchema,
  adminCategoryListSchema,
  adminCategorySchema,
  adminDishDetailSchema,
  adminDishListSchema,
  adminMediaListSchema,
  adminOrderListSchema,
  adminSettingsSchema,
  adminStationListSchema,
  adminStationSchema,
  adminTableListSchema,
  adminTableSchema,
  adminUserListSchema,
  adminUserSchema,
  aiEvaluationSchema,
  type CreateCategoryRequest,
  type CreateDemoDishRequest,
  type CreateDemoDishResponse,
  type CreateDishRequest,
  type CreateEvaluationRequest,
  type CreateEvaluationResponse,
  type CreateReferenceSetRequest,
  type CreateStationRequest,
  type CreateTableRequest,
  type CreateUserRequest,
  createDemoDishResponseSchema,
  createEvaluationResponseSchema,
  type DemoDish,
  type DishAvailabilityEntry,
  type DishEvaluationSummary,
  demoDishListSchema,
  dishAvailabilityEntrySchema,
  dishEvaluationListSchema,
  type EvaluationDetail,
  evaluationDetailSchema,
  type ManagementMetrics,
  MEDIA_UPLOAD_FILE_FIELD,
  type MetricsPeriod,
  managementMetricsSchema,
  type PutToleranceRequest,
  type ReferenceSetDetail,
  type ReferenceSetSummary,
  referenceSetDetailSchema,
  referenceSetSummarySchema,
  type SetAvailabilityRequest,
  type ToleranceCriteria,
  toleranceCriteriaSchema,
  UPLOAD_FILE_FIELD,
  type UpdateCategoryRequest,
  type UpdateDishRequest,
  type UpdateLocationRequest,
  type UpdateStationRequest,
  type UpdateTenantRequest,
  type UploadMediaResponse,
  type UploadResponse,
  uploadMediaResponseSchema,
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
  // Nullable GETs (tolerance, reference-set) return a `null` body, which ts-rest
  // serializes as an EMPTY response — res.json() would throw on empty input, so
  // read text and treat empty as null.
  const text = await res.text();
  return parse(text.length > 0 ? JSON.parse(text) : null);
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ===========================================================================
// Real tenant-admin endpoints (apiContract.admin.*)
// ===========================================================================

// --- Allergens -------------------------------------------------------------

export function listAllergens(): Promise<AdminAllergen[]> {
  return requestJson("/admin/allergens", { method: "GET" }, (p) =>
    adminAllergenListSchema.parse(p),
  );
}

// --- Categories ------------------------------------------------------------

export function listCategories(): Promise<AdminCategory[]> {
  return requestJson("/admin/categories", { method: "GET" }, (p) =>
    adminCategoryListSchema.parse(p),
  );
}

export function createCategory(body: CreateCategoryRequest): Promise<AdminCategory> {
  return requestJson("/admin/categories", jsonInit("POST", body), (p) =>
    adminCategorySchema.parse(p),
  );
}

export function updateCategory(id: string, body: UpdateCategoryRequest): Promise<AdminCategory> {
  return requestJson(`/admin/categories/${id}`, jsonInit("PATCH", body), (p) =>
    adminCategorySchema.parse(p),
  );
}

export function archiveCategory(id: string): Promise<void> {
  return requestJson(`/admin/categories/${id}/archive`, jsonInit("POST", {}), () => undefined);
}

// --- Stations --------------------------------------------------------------

export function listStations(): Promise<AdminStation[]> {
  return requestJson("/admin/stations", { method: "GET" }, (p) => adminStationListSchema.parse(p));
}

export function createStation(body: CreateStationRequest): Promise<AdminStation> {
  return requestJson("/admin/stations", jsonInit("POST", body), (p) => adminStationSchema.parse(p));
}

export function updateStation(id: string, body: UpdateStationRequest): Promise<AdminStation> {
  return requestJson(`/admin/stations/${id}`, jsonInit("PATCH", body), (p) =>
    adminStationSchema.parse(p),
  );
}

// --- Dishes ----------------------------------------------------------------

export function listDishes(categoryId?: string): Promise<AdminDishListItem[]> {
  const qs = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : "";
  return requestJson(`/admin/dishes${qs}`, { method: "GET" }, (p) => adminDishListSchema.parse(p));
}

export function getDish(id: string): Promise<AdminDishDetail> {
  return requestJson(`/admin/dishes/${id}`, { method: "GET" }, (p) =>
    adminDishDetailSchema.parse(p),
  );
}

export function createDish(body: CreateDishRequest): Promise<AdminDishDetail> {
  return requestJson("/admin/dishes", jsonInit("POST", body), (p) =>
    adminDishDetailSchema.parse(p),
  );
}

export function updateDish(id: string, body: UpdateDishRequest): Promise<AdminDishDetail> {
  return requestJson(`/admin/dishes/${id}`, jsonInit("PATCH", body), (p) =>
    adminDishDetailSchema.parse(p),
  );
}

export function setDishAvailability(
  id: string,
  body: SetAvailabilityRequest,
): Promise<DishAvailabilityEntry> {
  return requestJson(`/admin/dishes/${id}/availability`, jsonInit("POST", body), (p) =>
    dishAvailabilityEntrySchema.parse(p),
  );
}

export function archiveDish(id: string): Promise<void> {
  return requestJson(`/admin/dishes/${id}/archive`, jsonInit("POST", {}), () => undefined);
}

// --- Reference sets --------------------------------------------------------

export function getReferenceSet(dishId: string): Promise<ReferenceSetDetail | null> {
  return requestJson(`/admin/dishes/${dishId}/reference-set`, { method: "GET" }, (p) =>
    referenceSetDetailSchema.nullable().parse(p),
  );
}

export function createReferenceSet(
  dishId: string,
  body: CreateReferenceSetRequest,
): Promise<ReferenceSetDetail> {
  return requestJson(`/admin/dishes/${dishId}/reference-set`, jsonInit("POST", body), (p) =>
    referenceSetDetailSchema.parse(p),
  );
}

// --- Tolerances ------------------------------------------------------------

export function getTolerance(dishId: string): Promise<ToleranceCriteria | null> {
  return requestJson(`/admin/dishes/${dishId}/tolerance`, { method: "GET" }, (p) =>
    toleranceCriteriaSchema.nullable().parse(p),
  );
}

export function putTolerance(
  dishId: string,
  body: PutToleranceRequest,
): Promise<ToleranceCriteria> {
  return requestJson(`/admin/dishes/${dishId}/tolerance`, jsonInit("PUT", body), (p) =>
    toleranceCriteriaSchema.parse(p),
  );
}

// --- Media -----------------------------------------------------------------

export function listMedia(): Promise<AdminMediaAsset[]> {
  return requestJson("/admin/media", { method: "GET" }, (p) => adminMediaListSchema.parse(p));
}

/** Multipart upload to the documented non-ts-rest media route. */
export async function uploadMedia(file: File): Promise<UploadMediaResponse> {
  const form = new FormData();
  form.append(MEDIA_UPLOAD_FILE_FIELD, file);
  const res = await authFetch(ADMIN_MEDIA_UPLOAD_PATH, { method: "POST", body: form });
  if (!res.ok) throw new ApiRequestError(res.status, await extractMessage(res));
  return uploadMediaResponseSchema.parse(await res.json());
}

export function deleteMedia(id: string): Promise<void> {
  return requestJson(`/admin/media/${id}`, jsonInit("DELETE", {}), () => undefined);
}

// --- Orders (staff floor view) ---------------------------------------------

export function listOrders(): Promise<AdminOrder[]> {
  return requestJson("/admin/orders", { method: "GET" }, (p) => adminOrderListSchema.parse(p));
}

export function acceptOrder(id: string): Promise<void> {
  return requestJson(`/admin/orders/${id}/accept`, jsonInit("POST", {}), () => undefined);
}

export function serveOrder(id: string): Promise<void> {
  return requestJson(`/admin/orders/${id}/serve`, jsonInit("POST", {}), () => undefined);
}

// --- Users -----------------------------------------------------------------

export function listUsers(): Promise<AdminUser[]> {
  return requestJson("/admin/users", { method: "GET" }, (p) => adminUserListSchema.parse(p));
}

export function createUser(body: CreateUserRequest): Promise<AdminUser> {
  return requestJson("/admin/users", jsonInit("POST", body), (p) => adminUserSchema.parse(p));
}

export function deactivateUser(id: string): Promise<void> {
  return requestJson(`/admin/users/${id}/deactivate`, jsonInit("POST", {}), () => undefined);
}

export function deleteUser(id: string): Promise<void> {
  return requestJson(`/admin/users/${id}`, jsonInit("DELETE", {}), () => undefined);
}

// --- Tables + QR -----------------------------------------------------------

export function listTables(): Promise<AdminTable[]> {
  return requestJson("/admin/tables", { method: "GET" }, (p) => adminTableListSchema.parse(p));
}

export function createTable(body: CreateTableRequest): Promise<AdminTable> {
  return requestJson("/admin/tables", jsonInit("POST", body), (p) => adminTableSchema.parse(p));
}

export function deleteTable(id: string): Promise<void> {
  return requestJson(`/admin/tables/${id}`, jsonInit("DELETE", {}), () => undefined);
}

export function closeTable(id: string): Promise<void> {
  return requestJson(`/admin/tables/${id}/close`, jsonInit("POST", {}), () => undefined);
}

// --- Management dashboard ---------------------------------------------------

export function getMetrics(period: MetricsPeriod = "month"): Promise<ManagementMetrics> {
  return requestJson(`/admin/metrics?period=${period}`, { method: "GET" }, (p) =>
    managementMetricsSchema.parse(p),
  );
}

export function listDishEvaluations(dishId: string): Promise<DishEvaluationSummary[]> {
  return requestJson(`/admin/dishes/${dishId}/evaluations`, { method: "GET" }, (p) =>
    dishEvaluationListSchema.parse(p),
  );
}

export function getEvaluationDetail(id: string): Promise<EvaluationDetail> {
  return requestJson(`/admin/evaluations/${id}`, { method: "GET" }, (p) =>
    evaluationDetailSchema.parse(p),
  );
}

export function deleteEvaluation(id: string): Promise<void> {
  return requestJson(`/admin/evaluations/${id}`, jsonInit("DELETE", {}), () => undefined);
}

// --- Settings --------------------------------------------------------------

export function getSettings(): Promise<AdminSettings> {
  return requestJson("/admin/settings", { method: "GET" }, (p) => adminSettingsSchema.parse(p));
}

export function updateTenant(body: UpdateTenantRequest): Promise<AdminSettings> {
  return requestJson("/admin/tenant", jsonInit("PATCH", body), (p) => adminSettingsSchema.parse(p));
}

export function updateLocation(id: string, body: UpdateLocationRequest): Promise<AdminSettings> {
  return requestJson(`/admin/locations/${id}`, jsonInit("PATCH", body), (p) =>
    adminSettingsSchema.parse(p),
  );
}

// ===========================================================================
// Legacy demo endpoints (apiContract.evaluation) — kept for the /demo sandbox.
// ===========================================================================

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

/** Legacy demo upload route (single file, field UPLOAD_FILE_FIELD). */
export async function uploadPhoto(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append(UPLOAD_FILE_FIELD, file);
  const res = await authFetch(ADMIN_UPLOAD_PATH, { method: "POST", body: form });
  if (!res.ok) throw new ApiRequestError(res.status, await extractMessage(res));
  return uploadResponseSchema.parse(await res.json());
}
