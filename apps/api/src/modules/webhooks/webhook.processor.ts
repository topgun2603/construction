import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WEBHOOK_QUEUE, type WebhookDeliverJob, type WebhookSweepTenantJob } from './webhook-queue.service';

/** Every minute: anything due that no queue job is carrying (Redis lost it, or a long transaction). */
const SWEEP_CRON = '* * * * *';
/** Old delivery history and idempotency answers, once an hour. */
const PRUNE_CRON = '17 * * * *';

/**
 * Sends webhooks, in the worker process only (registered by WebhooksModule when
 * SITEBOOK_ROLE=worker), on the `webhooks` queue.
 *
 *   deliver        one try at one delivery (queued after a change, and for each retry, with a delay)
 *   sweep-tenant   whatever is due for one company (the nudge after a change)
 *   sweep-all      whatever is due anywhere — the safety net the outbox relies on
 *   prune          history older than the retention window
 */
@Processor(WEBHOOK_QUEUE, { concurrency: 8 })
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly deliveries: WebhookDeliveryService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'deliver': {
        const data = job.data as WebhookDeliverJob;
        return this.deliveries.deliver(data.tenantId, data.deliveryId);
      }
      case 'sweep-tenant':
        return this.deliveries.processDue((job.data as WebhookSweepTenantJob).tenantId);
      case 'sweep-all':
        return this.forEachTenant((tenantId) => this.deliveries.processDue(tenantId));
      case 'prune':
        return this.forEachTenant((tenantId) => this.deliveries.prune(tenantId));
      default:
        this.logger.warn({ name: job.name }, 'Unknown webhook job');
        return null;
    }
  }

  /**
   * Each company in its own RLS scope, the way `TenantRoster` does it: the list comes from
   * `auth_identities` (outside RLS), never from a connection that can see across companies. One
   * company's failure is logged and the rest carry on.
   */
  private async forEachTenant(work: (tenantId: string) => Promise<unknown>): Promise<number> {
    const rows = await this.prisma.authIdentity.findMany({ distinct: ['tenantId'], select: { tenantId: true } });
    for (const { tenantId } of rows) {
      try {
        await work(tenantId);
      } catch (error) {
        this.logger.error({ err: error, tenantId }, 'Webhook sweep failed for a company');
      }
    }
    return rows.length;
  }
}

/** Puts the two repeatable jobs on the queue when the worker starts. */
@Injectable()
export class WebhookScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(WebhookScheduler.name);

  constructor(@InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const [name, pattern] of [
      ['sweep-all', SWEEP_CRON],
      ['prune', PRUNE_CRON],
    ] as const) {
      try {
        await this.queue.add(name, {}, { repeat: { pattern, tz: 'UTC' }, jobId: name, removeOnComplete: true, removeOnFail: 100 });
      } catch (error) {
        this.logger.error({ err: error, name }, 'Could not schedule a webhook job');
      }
    }
  }
}
