import { DEFAULT_TOLERANCE_CRITERIA } from "../criteria";
import type { ReferencePhotoRole } from "../generated/db";
import type { TenantTransaction } from "../tenant";

// Production rule is N primary (tenant_settings.reference_photo_count, 1..5)
// + holdout, enforced at activation (the deferred trigger from schema.sql is
// not implemented yet, so the app rule here is the only gate). Demo
// relaxation: holdouts optional (0..2).
export const PRIMARY_REFERENCE_MIN = 1;
export const PRIMARY_REFERENCE_MAX = 5;
export const HOLDOUT_REFERENCE_MAX = 2;

export interface ReferencePhotoInput {
  role: ReferencePhotoRole;
  storageKey: string;
  captureDeviceId: string;
  captureProfileVersion: string;
  shotAt: Date;
  sortOrder?: number;
  metadata?: unknown;
}

export interface CreateReferenceSetParams {
  tenantId: string;
  dishId: string;
  dishVersionId: string;
  createdBy: string;
  photos: ReferencePhotoInput[];
}

export interface CreatedReferenceSet {
  referenceSetId: string;
  versionNo: number;
  photoIds: string[];
}

/** Draft set + immutable photo rows; activation is a separate explicit step. */
export async function createReferenceSet(
  trx: TenantTransaction,
  params: CreateReferenceSetParams,
): Promise<CreatedReferenceSet> {
  if (params.photos.length === 0) {
    throw new Error("createReferenceSet: at least one photo is required");
  }

  const maxRow = await trx
    .selectFrom("reference_set")
    .select((eb) => eb.fn.max<number | null>("version_no").as("max_version"))
    .where("dish_version_id", "=", params.dishVersionId)
    .executeTakeFirst();
  const versionNo = (maxRow?.max_version ?? 0) + 1;

  const set = await trx
    .insertInto("reference_set")
    .values({
      tenant_id: params.tenantId,
      dish_id: params.dishId,
      dish_version_id: params.dishVersionId,
      version_no: versionNo,
      created_by: params.createdBy,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  const photos = await trx
    .insertInto("reference_photo")
    .values(
      params.photos.map((photo, index) => ({
        tenant_id: params.tenantId,
        reference_set_id: set.id,
        role: photo.role,
        storage_key: photo.storageKey,
        capture_device_id: photo.captureDeviceId,
        capture_profile_version: photo.captureProfileVersion,
        shot_at: photo.shotAt,
        sort_order: photo.sortOrder ?? index,
        metadata: photo.metadata === undefined ? null : JSON.stringify(photo.metadata),
      })),
    )
    .returning("id")
    .execute();

  return { referenceSetId: set.id, versionNo, photoIds: photos.map((p) => p.id) };
}

export interface ActivatedReferenceSet {
  referenceSetId: string;
  dishId: string;
  dishVersionId: string;
}

/**
 * draft -> active with app-side cardinality gate: exactly
 * `requiredPrimaryCount` primaries when the caller passes the tenant's
 * configured count, otherwise 1..5 primaries; holdout optional in demo, max 2.
 * Retires the previously active set for the same dish_version and clears
 * dish.refs_stale when the set binds the dish's current version
 * (trg_refs_stale is not implemented yet — app-maintained).
 */
export async function activateReferenceSet(
  trx: TenantTransaction,
  params: { referenceSetId: string; approvedBy: string; requiredPrimaryCount?: number },
): Promise<ActivatedReferenceSet> {
  const set = await trx
    .selectFrom("reference_set")
    .select(["id", "dish_id", "dish_version_id", "status"])
    .where("id", "=", params.referenceSetId)
    .executeTakeFirst();
  if (!set) {
    throw new Error(`activateReferenceSet: reference set ${params.referenceSetId} not found`);
  }
  if (set.status !== "draft") {
    throw new Error(`activateReferenceSet: set ${set.id} is '${set.status}', expected 'draft'`);
  }

  const photoRoles = await trx
    .selectFrom("reference_photo")
    .select(["role"])
    .where("reference_set_id", "=", set.id)
    .execute();
  const primaryCount = photoRoles.filter((p) => p.role === "primary").length;
  const holdoutCount = photoRoles.filter((p) => p.role === "holdout").length;
  if (params.requiredPrimaryCount !== undefined && primaryCount !== params.requiredPrimaryCount) {
    throw new Error(
      `activateReferenceSet: set ${set.id} has ${primaryCount} primary photos, expected exactly ${params.requiredPrimaryCount}`,
    );
  }
  if (primaryCount < PRIMARY_REFERENCE_MIN || primaryCount > PRIMARY_REFERENCE_MAX) {
    throw new Error(
      `activateReferenceSet: set ${set.id} has ${primaryCount} primary photos, expected ${PRIMARY_REFERENCE_MIN}..${PRIMARY_REFERENCE_MAX}`,
    );
  }
  if (holdoutCount > HOLDOUT_REFERENCE_MAX) {
    throw new Error(
      `activateReferenceSet: set ${set.id} has ${holdoutCount} holdout photos, max ${HOLDOUT_REFERENCE_MAX}`,
    );
  }

  await trx
    .updateTable("reference_set")
    .set({ status: "retired", retired_at: new Date() })
    .where("dish_version_id", "=", set.dish_version_id)
    .where("status", "=", "active")
    .execute();

  const activated = await trx
    .updateTable("reference_set")
    .set({ status: "active", approved_by: params.approvedBy, approved_at: new Date() })
    .where("id", "=", set.id)
    .where("status", "=", "draft")
    .executeTakeFirst();
  if (activated.numUpdatedRows === 0n) {
    throw new Error(`activateReferenceSet: set ${set.id} was concurrently modified`);
  }

  await trx
    .updateTable("dish")
    .set({ refs_stale: false })
    .where("id", "=", set.dish_id)
    .where("current_version_id", "=", set.dish_version_id)
    .execute();

  return { referenceSetId: set.id, dishId: set.dish_id, dishVersionId: set.dish_version_id };
}

/**
 * Enqueue rule (0009): resolve the ACTIVE set for the dish_version PINNED on
 * the order_item. Photos come back sort_order-first so REF1..REFn labeling is
 * stable across ensemble calls.
 */
export async function getActiveReferenceSetForDishVersion(
  trx: TenantTransaction,
  dishVersionId: string,
) {
  const set = await trx
    .selectFrom("reference_set")
    .selectAll()
    .where("dish_version_id", "=", dishVersionId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!set) {
    return undefined;
  }
  const photos = await trx
    .selectFrom("reference_photo")
    .selectAll()
    .where("reference_set_id", "=", set.id)
    .orderBy("sort_order")
    .orderBy("id")
    .execute();
  return { set, photos };
}

/**
 * ai_evaluation's completed-CHECK requires a pinned tolerance_profile_id, so
 * the demo chain needs at least a minimal 'default' active profile per dish.
 * Idempotent: returns the existing active profile when present.
 */
export async function ensureDefaultToleranceProfile(
  trx: TenantTransaction,
  params: { tenantId: string; dishId: string; createdBy: string },
): Promise<string> {
  const active = await trx
    .selectFrom("tolerance_profile")
    .select(["id"])
    .where("dish_id", "=", params.dishId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (active) {
    return active.id;
  }

  const maxRow = await trx
    .selectFrom("tolerance_profile")
    .select((eb) => eb.fn.max<number | null>("version_no").as("max_version"))
    .where("dish_id", "=", params.dishId)
    .executeTakeFirst();
  const versionNo = (maxRow?.max_version ?? 0) + 1;

  const inserted = await trx
    .insertInto("tolerance_profile")
    .values({
      tenant_id: params.tenantId,
      dish_id: params.dishId,
      version_no: versionNo,
      criteria: JSON.stringify(DEFAULT_TOLERANCE_CRITERIA),
      status: "active",
      activated_at: new Date(),
      created_by: params.createdBy,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

/** Active tolerance profile id for a dish (enqueue-time pinning). */
export async function getActiveToleranceProfileForDish(
  trx: TenantTransaction,
  dishId: string,
): Promise<string | undefined> {
  const row = await trx
    .selectFrom("tolerance_profile")
    .select(["id"])
    .where("dish_id", "=", dishId)
    .where("status", "=", "active")
    .executeTakeFirst();
  return row?.id;
}
