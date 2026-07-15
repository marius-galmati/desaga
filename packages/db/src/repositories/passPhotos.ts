import type { CaptureMode, PhotoUploadStatus, QualityGateStatus } from "../generated/db";
import type { TenantTransaction } from "../tenant";

export interface InsertPassPhotoParams {
  tenantId: string;
  locationId: string;
  orderItemId: string;
  /** MinIO key: tenant/{t}/location/{l}/pass/{yyyy-mm-dd}/{photo_id}.jpg */
  storageKey: string;
  capturedBy?: string;
  /** Composite FK: the device must belong to the same location. */
  captureDeviceId?: string;
  captureProfileVersion?: string;
  captureMode?: CaptureMode;
  capturedAt?: Date;
  /** Demo flow uploads the object before inserting the row. */
  uploadStatus?: PhotoUploadStatus;
  /**
   * Plate-slot position. Defaults to the original plate (0). Re-shooting the
   * same real order_item is a refire (1, 2, ...) — required so the unique
   * slot index `uq_pass_photo_plate_slot` (tenant, order_item, refire, plate)
   * does not collide on a second capture. See {@link getNextRefireSequence}.
   */
  refireSequence?: number;
}

/** Live capture row (default refire_sequence 0, plate 1-of-1). Returns the photo id. */
export async function insertPassPhoto(
  trx: TenantTransaction,
  params: InsertPassPhotoParams,
): Promise<string> {
  const uploadStatus = params.uploadStatus ?? "uploaded";
  const inserted = await trx
    .insertInto("pass_photo")
    .values({
      tenant_id: params.tenantId,
      location_id: params.locationId,
      order_item_id: params.orderItemId,
      storage_key: params.storageKey,
      captured_by: params.capturedBy ?? null,
      capture_device_id: params.captureDeviceId ?? null,
      capture_profile_version: params.captureProfileVersion ?? null,
      capture_mode: params.captureMode ?? null,
      captured_at: params.capturedAt ?? new Date(),
      upload_status: uploadStatus,
      uploaded_at: uploadStatus === "uploaded" ? new Date() : null,
      refire_sequence: params.refireSequence ?? 0,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

/**
 * Next free refire slot for a real order_item: max(refire_sequence) + 1 over its
 * LIVE (non-skipped) photos, or 0 if none exist yet. Lets the pass re-shoot the
 * same plate without colliding on `uq_pass_photo_plate_slot`.
 */
export async function getNextRefireSequence(
  trx: TenantTransaction,
  tenantId: string,
  orderItemId: string,
): Promise<number> {
  const row = await trx
    .selectFrom("pass_photo")
    .select((eb) => eb.fn.max("refire_sequence").as("maxRefire"))
    .where("tenant_id", "=", tenantId)
    .where("order_item_id", "=", orderItemId)
    .where("skip_reason", "is", null)
    .executeTakeFirst();
  const max = row?.maxRefire;
  return max === null || max === undefined ? 0 : Number(max) + 1;
}

/**
 * Quality-gate outcome (sharp preprocessing). `quality` is the machine-readable
 * detail home (blur/exposure/resolution heuristics + preprocessing_version);
 * ai_evaluation only carries the not_scoreable_reason enum.
 */
export async function updatePassPhotoQuality(
  trx: TenantTransaction,
  params: { passPhotoId: string; quality: unknown; qualityStatus: QualityGateStatus },
): Promise<boolean> {
  const result = await trx
    .updateTable("pass_photo")
    .set({
      quality: JSON.stringify(params.quality),
      quality_status: params.qualityStatus,
    })
    .where("id", "=", params.passPhotoId)
    .executeTakeFirst();
  return result.numUpdatedRows > 0n;
}

export async function getPassPhotoById(trx: TenantTransaction, passPhotoId: string) {
  return trx.selectFrom("pass_photo").selectAll().where("id", "=", passPhotoId).executeTakeFirst();
}
