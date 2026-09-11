import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import sharp from 'sharp';
import { ObjectStore } from '../../common/storage/object-store.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { QUEUE, type ThumbnailJob } from '../job-types';

/**
 * Thumbnails (spec §10).
 *
 * A site gallery shows a dozen photographs at 190 pixels and a report feed shows them at 96. The
 * originals are 1600px captures from a phone camera — two or three megabytes each. Serving those
 * to a supervisor on mobile data is the difference between a page that opens and a page they close,
 * and they are paying for those megabytes.
 *
 * The work is deliberately forgiving. A photo whose object has gone, or a file that is not really
 * an image, marks the job done rather than failing: a thumbnail is an optimisation, and both
 * clients already fall back to the original when `thumbS3Key` is null. Retrying forever over a
 * corrupt upload would just fill the queue.
 */
@Processor(QUEUE.media)
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly store: ObjectStore,
  ) {
    super();
  }

  /** Wide enough for a retina phone at 190dp, small enough to be tens of kilobytes. */
  private static readonly WIDTH = 480;

  async process(job: Job): Promise<unknown> {
    if (job.name !== 'thumbnail') {
      this.logger.warn({ name: job.name }, 'Unknown media job');
      return null;
    }

    const data = job.data as ThumbnailJob;
    const db = this.tenantDb.clientFor(data.tenantId);
    const kind = data.kind ?? 'dpr_photo';

    // The row is read back rather than trusted from the job: it may have been deleted, or already
    // have a thumbnail from an earlier attempt.
    const source =
      kind === 'project_media'
        ? await db.projectMedia.findFirst({
            where: { id: data.mediaId, deletedAt: null },
            select: { id: true, s3Key: true, thumbS3Key: true, kind: true },
          })
        : await db.dprPhoto.findFirst({
            where: { id: data.mediaId },
            select: { id: true, s3Key: true, thumbS3Key: true },
          });

    if (!source) return { skipped: 'row gone' };
    if (source.thumbS3Key) return { skipped: 'already has one' };
    // A video's first frame needs decoding, which is a different job with different dependencies.
    if ('kind' in source && source.kind === 'video') return { skipped: 'video' };

    const key = thumbKeyFor(source.s3Key);

    let thumbnail: Buffer;
    try {
      const original = await this.store.get(source.s3Key);
      thumbnail = await sharp(original)
        .rotate() // Honour the EXIF orientation, or every portrait photo lands on its side.
        .resize({ width: MediaProcessor.WIDTH, withoutEnlargement: true })
        // Flattened because a PNG with transparency becomes black behind a JPEG.
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
    } catch (error) {
      this.logger.warn(
        { err: error, photoId: source.id, s3Key: source.s3Key },
        'Could not read or resize the original; leaving the full image in place',
      );
      return { photoId: source.id, skipped: 'unreadable' };
    }

    await this.store.put(key, thumbnail, 'image/jpeg');

    // Only now: a row pointing at a thumbnail that does not exist would show a broken image, which
    // is worse than showing the original.
    if (kind === 'project_media') {
      await db.projectMedia.update({ where: { id: source.id }, data: { thumbS3Key: key } });
    } else {
      await db.dprPhoto.update({ where: { id: source.id }, data: { thumbS3Key: key } });
    }

    this.logger.log(
      { photoId: source.id, key, bytes: thumbnail.length },
      'Thumbnail generated',
    );
    return { photoId: source.id, key, bytes: thumbnail.length };
  }
}

/**
 * `<tenant>/site_media/.../abc.png` becomes `.../abc.thumb.jpg`.
 *
 * Always `.jpg`, whatever came in: the output is always JPEG, and a `.thumb.png` holding JPEG bytes
 * is the kind of thing that works everywhere until the one place it does not.
 */
export function thumbKeyFor(s3Key: string): string {
  const dot = s3Key.lastIndexOf('.');
  const stem = dot > 0 ? s3Key.slice(0, dot) : s3Key;
  return `${stem}.thumb.jpg`;
}
