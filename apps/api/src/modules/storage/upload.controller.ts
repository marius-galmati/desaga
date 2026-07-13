import {
  ADMIN_UPLOAD_PATH,
  UPLOAD_ALLOWED_CONTENT_TYPES,
  UPLOAD_FILE_FIELD,
  UPLOAD_MAX_BYTES,
  type UploadResponse,
} from "@boca/contracts";
import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { toAiInputJpeg, toOriginalJpeg } from "../evaluation/preprocess";
import { mintDemoPhotoKeys } from "./keys";
import { StorageService } from "./storage.service";

// Minimal multer file shape — avoids depending on express/multer types in app
// code (same pattern as RequestWithPrincipal in common/principal.ts).
interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Step 1 of the two-step upload flow (see @boca/contracts routers/evaluation.ts):
 * a documented NON-ts-rest multipart route. Single image in form field
 * UPLOAD_FILE_FIELD, re-encoded with sharp (EXIF stripped by re-encode) into
 * an original-ish JPEG (≤2560px) plus the model-input derivative (≤1024px q80),
 * both streamed to MinIO. Responds 201 { photoKey } (uploadResponseSchema);
 * the key then feeds the JSON ts-rest endpoints.
 *
 * Oversized files are cut off by multer's fileSize limit (413 from Nest).
 */
@Controller()
export class UploadController {
  constructor(private readonly storage: StorageService) {}

  @Post(ADMIN_UPLOAD_PATH)
  @Roles("tenant_admin", "manager")
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor(UPLOAD_FILE_FIELD, { limits: { fileSize: UPLOAD_MAX_BYTES } }))
  async upload(
    @UploadedFile() file: UploadedImageFile | undefined,
    @Req() request: RequestWithPrincipal,
  ): Promise<UploadResponse> {
    const principal = requirePrincipal(request);
    if (!file) {
      throw new BadRequestException(
        `multipart field '${UPLOAD_FILE_FIELD}' with an image file is required`,
      );
    }
    if (!(UPLOAD_ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException(
        `unsupported content type '${file.mimetype}'; allowed: ${UPLOAD_ALLOWED_CONTENT_TYPES.join(", ")}`,
      );
    }

    let original: Buffer;
    let aiInput: Buffer;
    try {
      original = await toOriginalJpeg(file.buffer);
      aiInput = await toAiInputJpeg(file.buffer);
    } catch {
      throw new BadRequestException("file is not a decodable image");
    }

    const keys = mintDemoPhotoKeys(principal.tenantId);
    await this.storage.putObject(keys.photoKey, original, "image/jpeg");
    await this.storage.putObject(keys.aiInputKey, aiInput, "image/jpeg");
    return { photoKey: keys.photoKey };
  }
}
