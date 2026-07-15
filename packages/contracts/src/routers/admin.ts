import { initContract } from "@ts-rest/core";
import { z } from "zod";
import {
  adminAllergenListSchema,
  adminCategoryListSchema,
  adminCategorySchema,
  adminDishDetailSchema,
  adminDishListSchema,
  adminMediaListSchema,
  adminOrderListSchema,
  adminSettingsSchema,
  adminTableListSchema,
  adminTableSchema,
  createTableRequestSchema,
  adminStationListSchema,
  adminStationSchema,
  adminUserListSchema,
  adminUserSchema,
  createCategoryRequestSchema,
  createDishRequestSchema,
  createReferenceSetRequestSchema,
  createStationRequestSchema,
  createUserRequestSchema,
  dishAvailabilityEntrySchema,
  okResponseSchema,
  putToleranceRequestSchema,
  referenceSetDetailSchema,
  setAvailabilityRequestSchema,
  toleranceCriteriaSchema,
  updateCategoryRequestSchema,
  updateDishRequestSchema,
  updateLocationRequestSchema,
  updateStationRequestSchema,
  updateTenantRequestSchema,
} from "../schemas/admin";
import { apiErrorSchema } from "../schemas/common";

const c = initContract();

// The MULTIPART media upload route is NOT a ts-rest endpoint (ts-rest multipart
// support is limited) — it is a documented Nest route. These constants are the
// single source of truth shared by the Nest controller and the UI uploader.
export const ADMIN_MEDIA_UPLOAD_PATH = "/admin/media/upload";
export const MEDIA_UPLOAD_FILE_FIELD = "file";
export const MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
export const MEDIA_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

const idParams = z.object({ id: z.string().uuid() });

// Tenant-admin backend. Guard (tenant_admin/manager, user-create tenant_admin
// only) is applied on the Nest controllers — the contract only shapes I/O.
export const adminContract = c.router({
  // --- Allergens -----------------------------------------------------------
  listAllergens: {
    method: "GET",
    path: "/admin/allergens",
    summary: "Global EU-14 allergen lookup (read-only)",
    responses: { 200: adminAllergenListSchema, 401: apiErrorSchema },
  },

  // --- Categories ----------------------------------------------------------
  listCategories: {
    method: "GET",
    path: "/admin/categories",
    summary: "Menu categories with live dish counts",
    responses: { 200: adminCategoryListSchema, 401: apiErrorSchema },
  },
  createCategory: {
    method: "POST",
    path: "/admin/categories",
    body: createCategoryRequestSchema,
    responses: { 201: adminCategorySchema, 400: apiErrorSchema, 401: apiErrorSchema },
  },
  updateCategory: {
    method: "PATCH",
    path: "/admin/categories/:id",
    pathParams: idParams,
    body: updateCategoryRequestSchema,
    responses: {
      200: adminCategorySchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
  archiveCategory: {
    method: "POST",
    path: "/admin/categories/:id/archive",
    pathParams: idParams,
    body: z.object({}),
    responses: {
      200: okResponseSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema, // category still has active dishes
    },
  },

  // --- Stations ------------------------------------------------------------
  listStations: {
    method: "GET",
    path: "/admin/stations",
    summary: "Kitchen stations",
    responses: { 200: adminStationListSchema, 401: apiErrorSchema },
  },
  createStation: {
    method: "POST",
    path: "/admin/stations",
    body: createStationRequestSchema,
    responses: { 201: adminStationSchema, 400: apiErrorSchema, 401: apiErrorSchema },
  },
  updateStation: {
    method: "PATCH",
    path: "/admin/stations/:id",
    pathParams: idParams,
    body: updateStationRequestSchema,
    responses: {
      200: adminStationSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },

  // --- Dishes --------------------------------------------------------------
  listDishes: {
    method: "GET",
    path: "/admin/dishes",
    summary: "Dishes (current version) + reference/tolerance/availability status",
    query: z.object({ categoryId: z.string().uuid().optional() }),
    responses: { 200: adminDishListSchema, 401: apiErrorSchema },
  },
  getDish: {
    method: "GET",
    path: "/admin/dishes/:id",
    pathParams: idParams,
    responses: { 200: adminDishDetailSchema, 401: apiErrorSchema, 404: apiErrorSchema },
  },
  createDish: {
    method: "POST",
    path: "/admin/dishes",
    summary: "Create dish + dish_version v1 (optional hero from a media asset)",
    body: createDishRequestSchema,
    responses: { 201: adminDishDetailSchema, 400: apiErrorSchema, 401: apiErrorSchema },
  },
  updateDish: {
    method: "PATCH",
    path: "/admin/dishes/:id",
    summary: "Insert a NEW immutable dish_version; repoint current; refs go stale",
    pathParams: idParams,
    body: updateDishRequestSchema,
    responses: {
      200: adminDishDetailSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
  setDishAvailability: {
    method: "POST",
    path: "/admin/dishes/:id/availability",
    summary: "Upsert 86 state for a dish at a location",
    pathParams: idParams,
    body: setAvailabilityRequestSchema,
    responses: {
      200: dishAvailabilityEntrySchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
  archiveDish: {
    method: "POST",
    path: "/admin/dishes/:id/archive",
    pathParams: idParams,
    body: z.object({}),
    responses: { 200: okResponseSchema, 401: apiErrorSchema, 404: apiErrorSchema },
  },

  // --- Reference sets ------------------------------------------------------
  getReferenceSet: {
    method: "GET",
    path: "/admin/dishes/:id/reference-set",
    summary: "Active reference set for the dish's current version (null = none)",
    pathParams: idParams,
    responses: {
      200: referenceSetDetailSchema.nullable(),
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
  createReferenceSet: {
    method: "POST",
    path: "/admin/dishes/:id/reference-set",
    summary: "Bind 3-5 media assets as a NEW ACTIVE reference set for the current version",
    pathParams: idParams,
    body: createReferenceSetRequestSchema,
    responses: {
      201: referenceSetDetailSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },

  // --- Tolerances ----------------------------------------------------------
  getTolerance: {
    method: "GET",
    path: "/admin/dishes/:id/tolerance",
    summary: "Active tolerance criteria for the dish (null = none)",
    pathParams: idParams,
    responses: {
      200: toleranceCriteriaSchema.nullable(),
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
  putTolerance: {
    method: "PUT",
    path: "/admin/dishes/:id/tolerance",
    summary: "Insert a new ACTIVE tolerance profile version; retire the previous",
    pathParams: idParams,
    body: putToleranceRequestSchema,
    responses: {
      200: toleranceCriteriaSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },

  // --- Media ---------------------------------------------------------------
  listMedia: {
    method: "GET",
    path: "/admin/media",
    summary: "Photo library (each url is a short-lived presigned GET)",
    responses: { 200: adminMediaListSchema, 401: apiErrorSchema },
  },
  deleteMedia: {
    method: "DELETE",
    path: "/admin/media/:id",
    pathParams: idParams,
    body: z.object({}),
    summary: "Delete a library photo + its stored object (blocked if still in use)",
    responses: {
      200: okResponseSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema, // still referenced by a dish hero or reference photo
    },
  },

  // --- Orders (staff floor view) -------------------------------------------
  listOrders: {
    method: "GET",
    path: "/admin/orders",
    summary: "Open guest orders for the floor (newest first)",
    responses: { 200: adminOrderListSchema, 401: apiErrorSchema },
  },
  acceptOrder: {
    method: "POST",
    path: "/admin/orders/:id/accept",
    pathParams: idParams,
    body: z.object({}),
    responses: {
      200: okResponseSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema, // not in an acceptable state
    },
  },
  serveOrder: {
    method: "POST",
    path: "/admin/orders/:id/serve",
    pathParams: idParams,
    body: z.object({}),
    responses: {
      200: okResponseSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
    },
  },

  // --- Tables + QR ---------------------------------------------------------
  listTables: {
    method: "GET",
    path: "/admin/tables",
    summary: "Dining tables + their active QR slug",
    responses: { 200: adminTableListSchema, 401: apiErrorSchema },
  },
  createTable: {
    method: "POST",
    path: "/admin/tables",
    body: createTableRequestSchema,
    summary: "Create a table + mint its QR slug",
    responses: {
      201: adminTableSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      409: apiErrorSchema, // duplicate label
    },
  },
  deleteTable: {
    method: "DELETE",
    path: "/admin/tables/:id",
    pathParams: idParams,
    body: z.object({}),
    summary: "Archive a table + revoke its QR slug",
    responses: { 200: okResponseSchema, 401: apiErrorSchema, 404: apiErrorSchema },
  },
  closeTable: {
    method: "POST",
    path: "/admin/tables/:id/close",
    pathParams: idParams,
    body: z.object({}),
    summary: "Close the table's open session so the next guest starts fresh",
    responses: { 200: okResponseSchema, 401: apiErrorSchema, 404: apiErrorSchema },
  },

  // --- Users ---------------------------------------------------------------
  listUsers: {
    method: "GET",
    path: "/admin/users",
    responses: { 200: adminUserListSchema, 401: apiErrorSchema },
  },
  createUser: {
    method: "POST",
    path: "/admin/users",
    summary: "Create a staff user (argon2 hash) — tenant_admin only",
    body: createUserRequestSchema,
    responses: {
      201: adminUserSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
    },
  },
  deactivateUser: {
    method: "POST",
    path: "/admin/users/:id/deactivate",
    pathParams: idParams,
    body: z.object({}),
    responses: {
      200: okResponseSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema, // e.g. deactivating your own account
    },
  },
  deleteUser: {
    method: "DELETE",
    path: "/admin/users/:id",
    pathParams: idParams,
    body: z.object({}),
    summary: "Hard-delete a user (409 if they have activity — deactivate instead)",
    responses: {
      200: okResponseSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
      404: apiErrorSchema,
      409: apiErrorSchema,
    },
  },

  // --- Settings ------------------------------------------------------------
  getSettings: {
    method: "GET",
    path: "/admin/settings",
    summary: "Tenant + locations + stations in one call",
    responses: { 200: adminSettingsSchema, 401: apiErrorSchema },
  },
  updateTenant: {
    method: "PATCH",
    path: "/admin/tenant",
    body: updateTenantRequestSchema,
    responses: { 200: adminSettingsSchema, 400: apiErrorSchema, 401: apiErrorSchema },
  },
  updateLocation: {
    method: "PATCH",
    path: "/admin/locations/:id",
    pathParams: idParams,
    body: updateLocationRequestSchema,
    responses: {
      200: adminSettingsSchema,
      400: apiErrorSchema,
      401: apiErrorSchema,
      404: apiErrorSchema,
    },
  },
});
