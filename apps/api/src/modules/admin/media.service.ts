import type { AdminMediaAsset, UploadMediaResponse } from "@boca/contracts";
import { withTenant } from "@boca/db";
import { Injectable } from "@nestjs/common";
import sharp from "sharp";
import type { Principal } from "../../common/principal";
import type { ServiceResult } from "../evaluation/evaluation.service";
import { toOriginalJpeg } from "../evaluation/preprocess";
import { mintLibraryKey } from "../storage/keys";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class MediaService {
  constructor(private readonly storage: StorageService) {}

  /** Photo library, newest first, each url a short-lived presigned GET. */
  async listMedia(principal: Principal): Promise<AdminMediaAsset[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await trx
        .selectFrom("media_asset")
        .select(["id", "storage_key", "content_type", "width", "height", "created_at"])
        .where("tenant_id", "=", principal.tenantId)
        .orderBy("created_at", "desc")
        .execute();
      return Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          url: await this.storage.getSignedUrl(row.storage_key),
          contentType: row.content_type,
          width: row.width,
          height: row.height,
          createdAt: row.created_at.toISOString(),
        })),
      );
    });
  }

  /**
   * Store an uploaded image: sharp re-encodes (EXIF stripped, <=2560px long
   * edge) into a JPEG under tenant/{id}/library/{uuid}.jpg, records a
   * media_asset row and returns a presigned url the UI can render immediately.
   */
  async storeUpload(principal: Principal, fileBuffer: Buffer): Promise<UploadMediaResponse> {
    const original = await toOriginalJpeg(fileBuffer);
    const meta = await sharp(original).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    const byteSize = original.byteLength;
    const storageKey = mintLibraryKey(principal.tenantId);

    await this.storage.putObject(storageKey, original, "image/jpeg");

    const mediaId = await withTenant(principal.tenantId, async (trx) => {
      const inserted = await trx
        .insertInto("media_asset")
        .values({
          tenant_id: principal.tenantId,
          storage_key: storageKey,
          content_type: "image/jpeg",
          byte_size: byteSize,
          width,
          height,
          created_by: principal.userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return inserted.id;
    });

    const url = await this.storage.getSignedUrl(storageKey);
    return { mediaId, storageKey, url, width, height };
  }

  /**
   * Delete a library photo + its stored object. media_asset has no FK referrers,
   * but its storage_key is COPIED by value into dish_version.hero_photo_key and
   * reference_photo.storage_key — so deleting one still in use would break a live
   * image. Block that (409); otherwise remove the row, then best-effort the S3
   * object (a leftover object after a row delete is harmless, storage-only).
   */
  async deleteMedia(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    const outcome = await withTenant(
      principal.tenantId,
      async (
        trx,
      ): Promise<
        { ok: false; status: 404 | 409; message: string } | { ok: true; storageKey: string }
      > => {
        const asset = await trx
          .selectFrom("media_asset")
          .select(["storage_key"])
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", id)
          .executeTakeFirst();
        if (!asset) {
          return { ok: false, status: 404, message: "media not found" };
        }
        const heroUse = await trx
          .selectFrom("dish_version")
          .select("id")
          .where("tenant_id", "=", principal.tenantId)
          .where("hero_photo_key", "=", asset.storage_key)
          .limit(1)
          .executeTakeFirst();
        const refUse = await trx
          .selectFrom("reference_photo")
          .select("id")
          .where("tenant_id", "=", principal.tenantId)
          .where("storage_key", "=", asset.storage_key)
          .limit(1)
          .executeTakeFirst();
        const logoUse = await trx
          .selectFrom("tenant_branding")
          .select("tenant_id")
          .where("tenant_id", "=", principal.tenantId)
          .where("logo_media_id", "=", id)
          .limit(1)
          .executeTakeFirst();
        if (heroUse || refUse || logoUse) {
          return {
            ok: false,
            status: 409,
            message:
              "Fotografia e folosită de un preparat, un set de referință sau ca logo. Înlocuiește-o acolo întâi.",
          };
        }
        await trx
          .deleteFrom("media_asset")
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", id)
          .execute();
        return { ok: true, storageKey: asset.storage_key };
      },
    );
    if (!outcome.ok) {
      return outcome;
    }
    try {
      await this.storage.deleteObject(outcome.storageKey);
    } catch {
      /* row already deleted; a leftover object is harmless (storage-only) */
    }
    return { ok: true, value: { ok: true } };
  }
}
