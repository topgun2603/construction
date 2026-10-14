import { Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env';

/** S3's floor for every part but the last is 5 MiB; 8 MiB keeps a 40 GB export under the 10,000 parts. */
const PART_BYTES = 8 * 1024 * 1024;

/** Where a company's finished exports live, inside its own prefix. */
export function dataExportKey(tenantId: string, exportId: string): string {
  return `${tenantId}/exports/${exportId}.zip`;
}

/** The prefix of the exports themselves, which an export must not copy into itself. */
export function dataExportPrefix(tenantId: string): string {
  return `${tenantId}/exports/`;
}

/**
 * Object storage for exports and deletions: listing, streaming and removing everything under one
 * company's prefix, and writing a ZIP of unknown length without holding it in memory.
 *
 * Every method takes the tenant id and refuses a key outside `<tenant>/` — the same rule as
 * `UploadsService`, held here too because these are the methods that read or delete a company's
 * files wholesale, and a prefix check is what keeps one company's export or deletion from ever
 * touching another's. The keys themselves come out of the database or a listing of the company's
 * own prefix, never off the wire.
 */
@Injectable()
export class PortabilityStorage {
  private readonly logger = new Logger(PortabilityStorage.name);
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

  /** Every object under the company's prefix, page by page. */
  async *list(tenantId: string, prefix = `${tenantId}/`): AsyncGenerator<{ key: string; size: number }> {
    this.assertOwn(tenantId, prefix);
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.S3_BUCKET,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        if (item.Key) yield { key: item.Key, size: item.Size ?? 0 };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  /** One object as a stream, so a 200 MB drawing set never sits in the worker's heap. */
  async read(tenantId: string, key: string): Promise<Readable> {
    this.assertOwn(tenantId, key);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }),
    );
    if (!response.Body) throw new Error(`empty object at ${key}`);
    return response.Body as Readable;
  }

  /**
   * Streams `body` into one object with a multipart upload, part by part as it arrives, and returns
   * the size written. A ZIP being built has no length until it is finished, which a single PUT needs
   * up front; a multipart upload does not. Aborted on any failure so no half-written parts are left
   * to be billed.
   */
  async write(tenantId: string, key: string, body: Readable, contentType: string): Promise<number> {
    this.assertOwn(tenantId, key);
    const bucket = this.config.S3_BUCKET;
    const created = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    );
    const uploadId = created.UploadId;
    if (!uploadId) throw new Error('storage did not start the upload');

    const parts: Array<{ ETag: string; PartNumber: number }> = [];
    let buffered: Buffer[] = [];
    let bufferedBytes = 0;
    let total = 0;

    const flush = async (): Promise<void> => {
      if (bufferedBytes === 0 && parts.length > 0) return;
      const PartNumber = parts.length + 1;
      const chunk = Buffer.concat(buffered, bufferedBytes);
      buffered = [];
      bufferedBytes = 0;
      const sent = await this.client.send(
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber, Body: chunk }),
      );
      parts.push({ ETag: sent.ETag ?? '', PartNumber });
    };

    try {
      for await (const piece of body as AsyncIterable<Buffer>) {
        buffered.push(piece);
        bufferedBytes += piece.length;
        total += piece.length;
        if (bufferedBytes >= PART_BYTES) await flush();
      }
      await flush();
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
      return total;
    } catch (error) {
      await this.client
        .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
        .catch((abortError: unknown) => this.logger.warn({ err: abortError, key }, 'Could not abort upload'));
      throw error;
    }
  }

  /**
   * A download link for a finished export. Short-lived — the export itself lives seven days, but
   * the link is fetched fresh each time the owner presses download, so a link pasted into a chat
   * stops working within minutes rather than lasting the week.
   */
  async signedDownload(tenantId: string, key: string, fileName: string, ttlSeconds: number): Promise<string> {
    this.assertOwn(tenantId, key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.S3_BUCKET,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  /** Removes the given keys, all of which must be the company's. */
  async remove(tenantId: string, keys: string[]): Promise<number> {
    for (const key of keys) this.assertOwn(tenantId, key);
    let removed = 0;
    for (let start = 0; start < keys.length; start += 1000) {
      const batch = keys.slice(start, start + 1000);
      try {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.config.S3_BUCKET,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      } catch (error) {
        // Some S3-compatible stores refuse the batch call (it needs a checksum header they do not
        // accept). One by one is slower and always works.
        this.logger.warn({ err: error }, 'Batch delete refused; deleting one by one');
        for (const Key of batch) {
          await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key }));
        }
      }
      removed += batch.length;
    }
    return removed;
  }

  /** Everything under the company's prefix — the files half of deleting a company. */
  async removePrefix(tenantId: string): Promise<number> {
    let removed = 0;
    let keys: string[] = [];
    for await (const item of this.list(tenantId)) {
      keys.push(item.key);
      if (keys.length === 1000) {
        removed += await this.remove(tenantId, keys);
        keys = [];
      }
    }
    if (keys.length > 0) removed += await this.remove(tenantId, keys);
    return removed;
  }

  private assertOwn(tenantId: string, key: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !key.startsWith(`${tenantId}/`) || key.includes('..')) {
      throw new Error('That object does not belong to this company');
    }
  }
}
