import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { env } from '../config/env';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE,
  type DprSubmittedJob,
  type IndentStatusJob,
  type SiteMessagePostedJob,
  type ThumbnailJob,
  type WagePeriodFinalisedJob,
} from './job-types';

/**
 * The only thing domain services touch. They describe what happened; this decides
 * which queue carries it.
 *
 * Every queue is `@Optional()`. With `JOBS_ENABLED=false` — tests, and any
 * environment without Redis — nothing is registered and each enqueue becomes a
 * logged no-op. A missing Redis must never turn approving an indent into a 500;
 * the notification is a consequence of the write, not part of it.
 */
@Injectable()
export class JobQueueService {
  private readonly logger = new Logger(JobQueueService.name);
  private readonly enabled = env().JOBS_ENABLED;

  constructor(
    @Optional() @Inject(getQueueToken(QUEUE.notifications)) private readonly notifications?: Queue,
    @Optional() @Inject(getQueueToken(QUEUE.whatsapp)) private readonly whatsapp?: Queue,
    @Optional() @Inject(getQueueToken(QUEUE.media)) private readonly media?: Queue,
  ) {}

  async indentStatusChanged(job: IndentStatusJob): Promise<void> {
    await this.add(this.notifications, QUEUE.notifications, 'indent-status', job);
  }

  async dprSubmitted(job: DprSubmittedJob): Promise<void> {
    await this.add(this.notifications, QUEUE.notifications, 'dpr-submitted', job);
  }

  async siteMessagePosted(job: SiteMessagePostedJob): Promise<void> {
    await this.add(this.notifications, QUEUE.notifications, 'site-message', job);
  }

  async wagePeriodFinalised(job: WagePeriodFinalisedJob): Promise<void> {
    await this.add(this.whatsapp, QUEUE.whatsapp, 'wage-period-finalised', job);
  }

  /**
   * One thumbnail job per photo, ever.
   *
   * The id is derived from the row, so asking twice — a fresh upload and then a gallery noticing
   * the thumbnail is still missing — is one job, not two. Without that, opening a site with two
   * hundred photographs would queue two hundred duplicates on every page load.
   *
   * A hyphen, not a colon: BullMQ namespaces its Redis keys with colons and rejects a custom id
   * containing one.
   */
  async generateThumbnail(job: ThumbnailJob): Promise<void> {
    await this.add(this.media, QUEUE.media, 'thumbnail', job, `thumb-${job.mediaId}`);
  }

  private async add(
    queue: Queue | undefined,
    queueName: string,
    jobName: string,
    data: object,
    jobId?: string,
  ): Promise<void> {
    if (!this.enabled || !queue) {
      this.logger.debug({ queueName, jobName }, 'Queues disabled - job not enqueued');
      return;
    }
    try {
      await queue.add(jobName, data, { ...DEFAULT_JOB_OPTIONS, ...(jobId ? { jobId } : {}) });
    } catch (error) {
      // Redis being down is an operational problem, not a reason to fail the
      // request that triggered this. Log loudly and let the write stand.
      this.logger.error({ err: error, queueName, jobName }, 'Could not enqueue job');
    }
  }
}
