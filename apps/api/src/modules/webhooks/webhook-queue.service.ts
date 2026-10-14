import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

/** The BullMQ queue webhook sends run on — its own, so a slow receiver never holds up a WhatsApp message. */
export const WEBHOOK_QUEUE = 'webhooks';

export interface WebhookDeliverJob {
  tenantId: string;
  deliveryId: string;
}

export interface WebhookSweepTenantJob {
  tenantId: string;
}

/**
 * Producer for the webhook queue. Like `JobQueueService`, a missing Redis (JOBS_ENABLED=false — the
 * tests, a laptop) makes every enqueue a no-op: the outbox rows are already committed, and the
 * worker's sweep, or a test calling `WebhookDeliveryService` directly, sends them.
 *
 * Job ids are derived from the row, so the same delivery is never queued twice for the same try.
 * Retries are this module's own (`webhookRetryDelaySeconds`), not BullMQ's: the schedule spans a
 * day and is kept in Postgres, where the delivery log can show it, not in Redis.
 */
@Injectable()
export class WebhookQueue {
  private readonly logger = new Logger(WebhookQueue.name);

  constructor(@Optional() @Inject(getQueueToken(WEBHOOK_QUEUE)) private readonly queue?: Queue) {}

  async deliver(job: WebhookDeliverJob, attempt: number, delayMs = 0): Promise<void> {
    await this.add('deliver', job, `whd-${job.deliveryId}-${attempt}`, delayMs);
  }

  /**
   * "Something was just written for this company": look for due deliveries in a second, by which
   * time the transaction that wrote them has committed. One per company per second at most.
   */
  async nudge(tenantId: string): Promise<void> {
    const second = Math.floor(Date.now() / 1000);
    await this.add('sweep-tenant', { tenantId } satisfies WebhookSweepTenantJob, `whs-${tenantId}-${second}`, 1_000);
  }

  private async add(name: string, data: object, jobId: string, delay: number): Promise<void> {
    if (!this.queue) return;
    try {
      await this.queue.add(name, data, {
        jobId,
        delay,
        // The queue only carries "try now"; the row is the record of what happened.
        attempts: 1,
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 24 * 3_600 },
      });
    } catch (error) {
      // The sweep picks the delivery up anyway; a Redis hiccup must not fail the write behind it.
      this.logger.warn({ err: error, name, jobId }, 'Could not queue a webhook job');
    }
  }
}
