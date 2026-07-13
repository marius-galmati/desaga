import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ENV, type Env } from "../../config/env";

/**
 * MinIO access (S3 API, path-style). The DB stores object KEYS only; this
 * service is the single place holding bucket + endpoint knowledge. Reachable
 * from api/worker only — clients never talk to MinIO directly in this
 * increment (presigned URLs come with the staff-PWA increment).
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(ENV) env: Env) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: true, // MinIO serves buckets by path, not vhost
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY,
        secretAccessKey: env.S3_SECRET_KEY,
      },
    });
    this.bucket = env.S3_BUCKET;
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
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404;
}
