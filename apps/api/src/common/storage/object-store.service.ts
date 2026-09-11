import { Injectable, Logger } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

/**
 * Raw object storage, for code that has no user behind it.
 *
 * `UploadsService` is the tenant-facing door: every method there takes an actor and refuses a key
 * outside their prefix, because a key arriving from a client is a string somebody could have made
 * up. This is the other half — the worker generating a thumbnail has no actor, only a job it was
 * given, and the keys it touches came out of the database rather than off the wire.
 *
 * Keep it that way. Nothing here should ever be reachable from an HTTP request.
 */
@Injectable()
export class ObjectStore {
  private readonly logger = new Logger(ObjectStore.name);
  private readonly config = env();

  private readonly client = new S3Client({
    region: this.config.S3_REGION,
    ...(this.config.S3_ENDPOINT ? { endpoint: this.config.S3_ENDPOINT } : {}),
    forcePathStyle: this.config.S3_FORCE_PATH_STYLE,
    ...(this.config.S3_ACCESS_KEY_ID && this.config.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: this.config.S3_ACCESS_KEY_ID,
            secretAccessKey: this.config.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
    );
    const body = response.Body;
    if (!body) throw new Error(`empty object at ${key}`);

    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: contentType,
      }),
    );
    this.logger.debug({ key, bytes: bytes.length }, 'object written');
  }
}
