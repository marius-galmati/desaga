import { z } from "zod";
import { bilingualTextSchema, moneyMinorSchema, uuidSchema, vatRateBpSchema } from "./common";
import {
  evalStatusSchema,
  notScoreableReasonSchema,
  orderStatusSchema,
  referencePhotoRoleSchema,
  referenceSetStatusSchema,
  serviceRequestKindSchema,
  userRoleSchema,
} from "./enums";
import { aiEvaluationSchema } from "./evaluation";

// Tenant-admin backend contract (real, non-demo). Every route lives under
// apiContract.admin and is guarded by tenant_admin/manager (user-create is
// tenant_admin only). Money stays integer minor units (RON bani); bilingual
// text is always { ro, en }. Photo-bearing responses carry a short-lived
// PRESIGNED `url` the frontend drops straight into <img src>.

const isoDateTimeSchema = z.string().datetime({ offset: true });

// A presigned MinIO GET URL (http://host/bucket/key?X-Amz-...). Not validated
// as .url() — dev endpoints are bare host:port and always browser-reachable.
const signedUrlSchema = z.string();

// ---------------------------------------------------------------------------
// Allergens (global EU-14 lookup, read-only)
// ---------------------------------------------------------------------------

export const adminAllergenSchema = z.object({
  code: z.string(),
  name: bilingualTextSchema,
});
export type AdminAllergen = z.infer<typeof adminAllergenSchema>;

export const adminAllergenListSchema = z.array(adminAllergenSchema);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const adminCategorySchema = z.object({
  id: uuidSchema,
  name: bilingualTextSchema,
  sortOrder: z.number().int(),
  dishCount: z.number().int().nonnegative(),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;

export const adminCategoryListSchema = z.array(adminCategorySchema);

export const createCategoryRequestSchema = z.object({
  name: bilingualTextSchema,
  sortOrder: z.number().int().optional(),
});
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z.object({
  name: bilingualTextSchema.optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateCategoryRequest = z.infer<typeof updateCategoryRequestSchema>;

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export const adminStationSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: bilingualTextSchema,
});
export type AdminStation = z.infer<typeof adminStationSchema>;

export const adminStationListSchema = z.array(adminStationSchema);

export const createStationRequestSchema = z.object({
  code: z.string().min(1),
  name: bilingualTextSchema,
});
export type CreateStationRequest = z.infer<typeof createStationRequestSchema>;

export const updateStationRequestSchema = z.object({
  code: z.string().min(1).optional(),
  name: bilingualTextSchema.optional(),
});
export type UpdateStationRequest = z.infer<typeof updateStationRequestSchema>;

// ---------------------------------------------------------------------------
// Dishes
// ---------------------------------------------------------------------------

// Active reference-set snapshot for a dish's CURRENT version (null = none yet).
export const adminReferenceSetSummarySchema = z.object({
  status: referenceSetStatusSchema,
  versionNo: z.number().int().positive(),
  photoCount: z.number().int().nonnegative(),
});
export type AdminReferenceSetSummary = z.infer<typeof adminReferenceSetSummarySchema>;

export const adminToleranceSummarySchema = z.object({
  status: z.literal("active"),
  versionNo: z.number().int().positive(),
});
export type AdminToleranceSummary = z.infer<typeof adminToleranceSummarySchema>;

export const dishAvailabilityEntrySchema = z.object({
  locationId: uuidSchema,
  is86ed: z.boolean(),
});
export type DishAvailabilityEntry = z.infer<typeof dishAvailabilityEntrySchema>;

export const adminDishListItemSchema = z.object({
  id: uuidSchema,
  categoryId: uuidSchema,
  name: bilingualTextSchema,
  priceMinor: moneyMinorSchema,
  currentVersionNo: z.number().int().positive(),
  heroPhotoUrl: signedUrlSchema.nullable(),
  non_scoreable: z.boolean(),
  refsStale: z.boolean(),
  referenceSet: adminReferenceSetSummarySchema.nullable(),
  availability: z.array(dishAvailabilityEntrySchema),
  allergenCodes: z.array(z.string()),
});
export type AdminDishListItem = z.infer<typeof adminDishListItemSchema>;

export const adminDishListSchema = z.array(adminDishListItemSchema);

export const adminDishDetailSchema = z.object({
  id: uuidSchema,
  categoryId: uuidSchema,
  name: bilingualTextSchema,
  description: bilingualTextSchema.nullable(),
  story: bilingualTextSchema.nullable(),
  priceMinor: moneyMinorSchema,
  vatRateBp: vatRateBpSchema,
  allergenCodes: z.array(z.string()),
  stationId: uuidSchema,
  heroPhotoUrl: signedUrlSchema.nullable(),
  non_scoreable: z.boolean(),
  refsStale: z.boolean(),
  currentVersionNo: z.number().int().positive(),
  versionCount: z.number().int().positive(),
  referenceSet: adminReferenceSetSummarySchema.nullable(),
  tolerance: adminToleranceSummarySchema.nullable(),
  availability: z.array(dishAvailabilityEntrySchema),
});
export type AdminDishDetail = z.infer<typeof adminDishDetailSchema>;

export const createDishRequestSchema = z.object({
  categoryId: uuidSchema,
  name: bilingualTextSchema,
  description: bilingualTextSchema.optional(),
  story: bilingualTextSchema.optional(),
  priceMinor: moneyMinorSchema,
  vatRateBp: vatRateBpSchema.optional(),
  stationId: uuidSchema,
  allergenCodes: z.array(z.string()).optional(),
  non_scoreable: z.boolean().optional(),
  heroMediaId: uuidSchema.optional(),
});
export type CreateDishRequest = z.infer<typeof createDishRequestSchema>;

// PATCH copies unchanged fields from the current version into a NEW version;
// every field is optional. heroMediaId repoints hero_photo_key from a media
// asset. categoryId moves the dish between categories.
export const updateDishRequestSchema = z.object({
  categoryId: uuidSchema.optional(),
  name: bilingualTextSchema.optional(),
  description: bilingualTextSchema.nullable().optional(),
  story: bilingualTextSchema.nullable().optional(),
  priceMinor: moneyMinorSchema.optional(),
  vatRateBp: vatRateBpSchema.optional(),
  stationId: uuidSchema.optional(),
  allergenCodes: z.array(z.string()).optional(),
  non_scoreable: z.boolean().optional(),
  heroMediaId: uuidSchema.nullable().optional(),
});
export type UpdateDishRequest = z.infer<typeof updateDishRequestSchema>;

export const setAvailabilityRequestSchema = z.object({
  locationId: uuidSchema,
  is86ed: z.boolean(),
});
export type SetAvailabilityRequest = z.infer<typeof setAvailabilityRequestSchema>;

export const okResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof okResponseSchema>;

// --- Staff order receiving (guest orders seen by the floor) ----------------
export const adminOrderItemSchema = z.object({
  id: uuidSchema,
  dishName: bilingualTextSchema,
  quantity: z.number().int(),
  lineTotalMinor: moneyMinorSchema,
  status: orderStatusSchema,
  note: z.string().nullable(),
});
export const adminOrderSchema = z.object({
  id: uuidSchema,
  tableLabel: z.string(),
  status: orderStatusSchema,
  isFirstOfSession: z.boolean(),
  guest: z.object({ displayName: z.string(), emoji: z.string() }).nullable(),
  subtotalMinor: moneyMinorSchema,
  totalMinor: moneyMinorSchema,
  createdAt: z.string(),
  items: z.array(adminOrderItemSchema),
});
export type AdminOrder = z.infer<typeof adminOrderSchema>;
export const adminOrderListSchema = z.array(adminOrderSchema);

// --- Tables + QR ------------------------------------------------------------
export const adminTableSchema = z.object({
  id: uuidSchema,
  label: z.string(),
  seats: z.number().int().nullable(),
  qrSlug: z.string().nullable(),
  occupied: z.boolean(),
  section: z.string(),
});
export type AdminTable = z.infer<typeof adminTableSchema>;
export const adminTableListSchema = z.array(adminTableSchema);

// Open floor service requests (guest pressed "call waiter" / "request bill").
export const adminServiceRequestSchema = z.object({
  id: uuidSchema,
  tableLabel: z.string(),
  kind: serviceRequestKindSchema,
  createdAt: z.string(),
});
export type AdminServiceRequest = z.infer<typeof adminServiceRequestSchema>;
export const adminServiceRequestListSchema = z.array(adminServiceRequestSchema);

export const createTableRequestSchema = z.object({
  label: z.string().min(1).max(40),
  seats: z.number().int().min(1).max(50).optional(),
});
export type CreateTableRequest = z.infer<typeof createTableRequestSchema>;

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export const adminMediaAssetSchema = z.object({
  id: uuidSchema,
  url: signedUrlSchema,
  contentType: z.string(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: isoDateTimeSchema,
});
export type AdminMediaAsset = z.infer<typeof adminMediaAssetSchema>;

export const adminMediaListSchema = z.array(adminMediaAssetSchema);

// Response of the non-ts-rest multipart upload route (ADMIN_MEDIA_UPLOAD_PATH).
export const uploadMediaResponseSchema = z.object({
  mediaId: uuidSchema,
  storageKey: z.string(),
  url: signedUrlSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type UploadMediaResponse = z.infer<typeof uploadMediaResponseSchema>;

// ---------------------------------------------------------------------------
// Reference sets (real)
// ---------------------------------------------------------------------------

export const adminReferencePhotoSchema = z.object({
  id: uuidSchema,
  role: referencePhotoRoleSchema,
  url: signedUrlSchema,
  sortOrder: z.number().int().nonnegative(),
});
export type AdminReferencePhoto = z.infer<typeof adminReferencePhotoSchema>;

export const referenceSetDetailSchema = z.object({
  referenceSetId: uuidSchema,
  versionNo: z.number().int().positive(),
  status: referenceSetStatusSchema,
  // isStale === true when the set binds an OLDER dish_version than the current
  // one (a new dish version invalidates its references).
  staleness: z.object({
    isStale: z.boolean(),
    boundToVersionNo: z.number().int().positive(),
  }),
  photos: z.array(adminReferencePhotoSchema),
});
export type ReferenceSetDetail = z.infer<typeof referenceSetDetailSchema>;

export const createReferenceSetRequestSchema = z.object({
  // 3-5 photos, of which >= 3 must be primary (enforced in the service).
  photos: z
    .array(
      z.object({
        mediaId: uuidSchema,
        role: referencePhotoRoleSchema,
      }),
    )
    .min(3)
    .max(5),
});
export type CreateReferenceSetRequest = z.infer<typeof createReferenceSetRequestSchema>;

// ---------------------------------------------------------------------------
// Tolerances
// ---------------------------------------------------------------------------

// Head-chef authored per-criterion width. Contract enum is strict|balanced|
// permissive; the API maps it onto the DB/prompt vocabulary strict|normal|wide.
export const toleranceVarianceSchema = z.enum(["strict", "balanced", "permissive"]);
export type ToleranceVariance = z.infer<typeof toleranceVarianceSchema>;

export const toleranceCriterionSchema = z.object({
  allowedVariance: toleranceVarianceSchema,
  notesRo: z.string(),
});
export type ToleranceCriterion = z.infer<typeof toleranceCriterionSchema>;

// Exactly the 6 locked scoring criteria (@boca/config SCORING_CRITERION_KEYS).
export const toleranceCriteriaSchema = z
  .object({
    components: toleranceCriterionSchema,
    arrangement: toleranceCriterionSchema,
    sauce: toleranceCriterionSchema,
    cleanliness: toleranceCriterionSchema,
    color: toleranceCriterionSchema,
    portion: toleranceCriterionSchema,
  })
  .strict();
export type ToleranceCriteria = z.infer<typeof toleranceCriteriaSchema>;

export const putToleranceRequestSchema = z.object({
  criteria: toleranceCriteriaSchema,
});
export type PutToleranceRequest = z.infer<typeof putToleranceRequestSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const adminUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  role: userRoleSchema,
  locationId: uuidSchema.nullable(),
  isActive: z.boolean(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListSchema = z.array(adminUserSchema);

export const createUserRequestSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1),
  role: userRoleSchema,
  locationId: uuidSchema.optional(),
  password: z.string().min(8),
});
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const adminSettingsLocationSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  timezone: z.string(),
  address: z.string().nullable(),
});
export type AdminSettingsLocation = z.infer<typeof adminSettingsLocationSchema>;

export const adminSettingsSchema = z.object({
  tenant: z.object({
    name: z.string(),
    slug: z.string(),
  }),
  locations: z.array(adminSettingsLocationSchema),
  stations: z.array(adminStationSchema),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const updateTenantRequestSchema = z.object({
  name: z.string().min(1),
});
export type UpdateTenantRequest = z.infer<typeof updateTenantRequestSchema>;

export const updateLocationRequestSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  address: z.string().nullable().optional(),
});
export type UpdateLocationRequest = z.infer<typeof updateLocationRequestSchema>;

// ---------------------------------------------------------------------------
// Management dashboard (real plating-conformity reporting)
// ---------------------------------------------------------------------------

// Reporting window. Filters completed evaluations by capture time.
export const metricsPeriodSchema = z.enum(["day", "week", "month", "all"]);
export type MetricsPeriod = z.infer<typeof metricsPeriodSchema>;

// Per-dish conformity over the window — the dashboard's primary unit.
export const managementDishStatSchema = z.object({
  dishId: uuidSchema,
  name: bilingualTextSchema,
  median: z.number(), // 1-5, median of the dish's overall scores
  dispersion: z.number(), // population std-dev — the ± spread
  sample: z.number().int().nonnegative(),
  spark: z.array(z.number()), // chronological overall scores (last N), for the trendline
  trend: z.number(), // last − first across the series
});
export type ManagementDishStat = z.infer<typeof managementDishStatSchema>;

// Per pass operator (who photographed the plate) — the coaching drill-down.
export const managementStaffStatSchema = z.object({
  userId: uuidSchema.nullable(),
  name: z.string(),
  conformity: z.number(), // mean overall score across their plates
  plates: z.number().int().nonnegative(),
});
export type ManagementStaffStat = z.infer<typeof managementStaffStatSchema>;

export const managementMetricsSchema = z.object({
  period: metricsPeriodSchema,
  rangeLabel: z.string(), // human window label, e.g. "Ultimele 30 de zile"
  generatedAt: isoDateTimeSchema,
  kpis: z.object({
    avgConformity: z.number().nullable(), // mean overall score, null when no data
    platesEvaluated: z.number().int().nonnegative(),
    notScoreable: z.number().int().nonnegative(),
    dishesUnderThreshold: z.number().int().nonnegative(),
    dishesTracked: z.number().int().nonnegative(),
  }),
  dishes: z.array(managementDishStatSchema),
  staff: z.array(managementStaffStatSchema),
});
export type ManagementMetrics = z.infer<typeof managementMetricsSchema>;

// Drill-down: one evaluation of a dish (summary row in the dashboard list).
export const dishEvaluationSummarySchema = z.object({
  id: uuidSchema,
  status: evalStatusSchema,
  notScoreableReason: notScoreableReasonSchema.nullable(),
  overallMedian: z.number().nullable(), // null unless completed
  capturedByName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type DishEvaluationSummary = z.infer<typeof dishEvaluationSummarySchema>;

export const dishEvaluationListSchema = z.array(dishEvaluationSummarySchema);

// Full evaluation detail: the exact 6-criteria report as scored, plus the
// candidate photo and the reference set it was compared against.
export const evaluationDetailSchema = z.object({
  evaluation: aiEvaluationSchema,
  dishName: bilingualTextSchema,
  capturedByName: z.string().nullable(),
  candidateUrl: signedUrlSchema.nullable(),
  referenceUrls: z.array(signedUrlSchema),
});
export type EvaluationDetail = z.infer<typeof evaluationDetailSchema>;
