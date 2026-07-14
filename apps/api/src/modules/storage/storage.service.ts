import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ENV, type Env } from "../../config/env";

/** Presigned GET URLs live ~15 min — long enough for a page render, short
 * enough that a leaked URL expires quickly. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * MinIO access (S3 API, path-style). The DB stores object KEYS only; this
 * service is the single place holding bucket + endpoint knowledge. Reachable
 * from api/worker only — clients never talk to MinIO directly in this
 * increment (presigned URLs come with the staff-PWA increment).
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly client: S3Client;
  // Separate client bound to the BROWSER-facing endpoint — presigned URLs must
  // be signed against the host the browser will actually request.
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    const credentials = {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    };
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true, // MinIO serves buckets by path, not vhost
      credentials,
    });
    const publicEndpoint = env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT;
    this.presignClient =
      publicEndpoint === env.S3_ENDPOINT
        ? this.client
        : new S3Client({
            endpoint: publicEndpoint,
            region: env.S3_REGION,
            forcePathStyle: true,
            credentials,
          });
    this.bucket = env.S3_BUCKET;
  }

  /**
   * Short-lived presigned GET URL for a MinIO object key — the frontend drops
   * it straight into <img src>. Signed against S3_PUBLIC_ENDPOINT so the host
   * is browser-reachable. Does NOT probe existence (a stale/missing key yields
   * a URL that 404s on fetch, which the UI handles as a broken image).
   */
  async getSignedUrl(key: string, ttlSeconds: number = SIGNED_URL_TTL_SECONDS): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      {
        expiresIn: ttlSeconds,
      },
    );
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!result.Body) {
      throw new Error(`storage: empty body for key ${key}`);
    }
    return Buffer.from(await result.Body.transformToByteArray());
  }

  /** HeadObject existence probe — used to validate client-supplied photoKeys. */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    if (this.presignClient !== this.client) {
      this.presignClient.destroy();
    }
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}
