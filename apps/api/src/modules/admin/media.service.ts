import type { AdminMediaAsset, UploadMediaResponse } from "@boca/contracts";
import { withTenant } from "@boca/db";
import { Injectable } from "@nestjs/common";
import sharp from "sharp";
import type { Principal } from "../../common/principal";
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
}
