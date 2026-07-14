import {
  ADMIN_MEDIA_UPLOAD_PATH,
  apiContract,
  MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES,
  MEDIA_UPLOAD_FILE_FIELD,
  MEDIA_UPLOAD_MAX_BYTES,
  type UploadMediaResponse,
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
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { MediaService } from "./media.service";

// Minimal multer file shape (same pattern as the demo UploadController).
interface UploadedImageFile {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller()
@Roles("tenant_admin", "manager")
export class AdminMediaController {
  constructor(private readonly media: MediaService) {}

  @TsRestHandler(apiContract.admin.listMedia)
  listMedia(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.listMedia, async () => {
      const principal = requirePrincipal(request);
      return { status: 200 as const, body: await this.media.listMedia(principal) };
    });
  }

  @TsRestHandler(apiContract.admin.deleteMedia)
  deleteMedia(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.deleteMedia, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.media.deleteMedia(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  /**
   * Multipart image upload (NON-ts-rest). Single image in field
   * MEDIA_UPLOAD_FILE_FIELD, re-encoded (EXIF stripped) and stored in the
   * tenant library; returns { mediaId, storageKey, url(signed), width, height }.
   */
  @Post(ADMIN_MEDIA_UPLOAD_PATH)
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor(MEDIA_UPLOAD_FILE_FIELD, { limits: { fileSize: MEDIA_UPLOAD_MAX_BYTES } }),
  )
  async upload(
    @UploadedFile() file: UploadedImageFile | undefined,
    @Req() request: RequestWithPrincipal,
  ): Promise<UploadMediaResponse> {
    const principal = requirePrincipal(request);
    if (!file) {
      throw new BadRequestException(
        `multipart field '${MEDIA_UPLOAD_FILE_FIELD}' with an image file is required`,
      );
    }
    if (!(MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException(
        `unsupported content type '${file.mimetype}'; allowed: ${MEDIA_UPLOAD_ALLOWED_CONTENT_TYPES.join(", ")}`,
      );
    }
    try {
      return await this.media.storeUpload(principal, file.buffer);
    } catch {
      throw new BadRequestException("file is not a decodable image");
    }
  }
}
