import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignInput, ViewObjectInput } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { env } from '../../config/env';

/** Spec §15: presigned URLs expire in 10 minutes. */
const URL_TTL_SECONDS = 600;

/**
 * Read URLs live longer than upload URLs — an hour.
 *
 * A gallery signs a URL per image on render, and a ten-minute expiry means every photo on a tab left
 * open over lunch is a broken image. An hour is still short enough that a leaked URL is not a
 * standing grant, and the object itself stays private.
 */
const VIEW_TTL_SECONDS = 3600;

export interface PresignResult {
  url: string;
  s3_key: string;
  expires_in: number;
  headers: Record<string, string>;
}

@Injectable()
export class UploadsService {
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

  constructor(private readonly access: ProjectAccess) {}

  /**
   * Hand the client a short-lived URL to PUT one object (spec §8: photos upload
   * separately from the record that references them).
   *
   * The key is built server-side and always starts with the tenant id — the client
   * never chooses where its bytes land, so one builder's key can never address
   * another's prefix even if the bucket policy were later loosened.
   */
  async presign(actor: RequestUser, input: PresignInput): Promise<PresignResult> {
    if (input.project_id) await this.access.assertAccess(actor, input.project_id);

    const key = this.buildKey(actor, input);

    const command = new PutObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: key,
      ContentType: input.content_type,
      ContentLength: input.content_length,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: URL_TTL_SECONDS });

    return {
      url,
      s3_key: key,
      expires_in: URL_TTL_SECONDS,
      // Signed headers must be replayed exactly or S3 rejects the PUT.
      headers: {
        'Content-Type': input.content_type,
        'Content-Length': String(input.content_length),
      },
    };
  }

  /**
   * A short-lived URL to read one object back.
   *
   * Until this existed the API could only accept uploads, never show them — every key written was
   * write-only from the client's point of view.
   *
   * Authorisation is the tenant prefix, checked here rather than inferred from the caller knowing the
   * key. Every key this service issues begins with the tenant id (see `buildKey`), so a key from
   * another builder fails the comparison even if it leaked. A guessed key fails too: the rest of the
   * path is a random UUID.
   */
  async viewUrl(actor: RequestUser, input: ViewObjectInput): Promise<{ url: string; expires_in: number }> {
    const prefix = `${actor.tenantId}/`;
    if (!input.s3_key.startsWith(prefix)) {
      throw ApiError.forbidden('That file does not belong to this account');
    }
    // Defensive: a key containing traversal segments should never have been issued, and must not be
    // signed if one ever appears.
    if (input.s3_key.includes('..')) {
      throw ApiError.forbidden('That file does not belong to this account');
    }

    const command = new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: input.s3_key });
    const url = await getSignedUrl(this.client, command, { expiresIn: VIEW_TTL_SECONDS });
    return { url, expires_in: VIEW_TTL_SECONDS };
  }

  /**
   * The same signed read URL, for server-side callers that already own the key.
   *
   * Returns null rather than throwing when the key is not the caller's: a list of sites should render
   * with one thumbnail missing, not fail entirely because a single row is odd.
   */
  async signedViewUrl(actor: RequestUser, s3Key: string): Promise<string | null> {
    try {
      const { url } = await this.viewUrl(actor, { s3_key: s3Key });
      return url;
    } catch {
      return null;
    }
  }

  private buildKey(actor: RequestUser, input: PresignInput): string {
    const now = new Date();
    const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const extension = EXTENSIONS[input.content_type] ?? 'bin';
    const scope = input.project_id ? `p/${input.project_id}` : 'tenant';
    return `${actor.tenantId}/${input.kind}/${scope}/${yyyymm}/${randomUUID()}.${extension}`;
  }
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};
