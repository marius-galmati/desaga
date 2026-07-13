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
}

/** Live capture row (refire_sequence 0, plate 1-of-1). Returns the photo id. */
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
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
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
