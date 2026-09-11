import { BullModule } from '@nestjs/bullmq';
import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { ObjectStore } from '../common/storage/object-store.service';
import { env } from '../config/env';
import { BillingModule } from '../modules/billing/billing.module';
import { WagePeriodsModule } from '../modules/wage-periods/wage-periods.module';
import { DEFAULT_JOB_OPTIONS, QUEUE } from './job-types';
import { JobQueueService } from './job-queue.service';
import { SchedulerService } from './scheduler.service';
import { TenantRoster } from './tenant-roster.service';
import { MediaProcessor } from './processors/media.processor';
import { NotificationsProcessor } from './processors/notifications.processor';
import { ReportsProcessor } from './processors/reports.processor';
import { WhatsappProcessor } from './processors/whatsapp.processor';

/**
 * Queues, producers and — in the worker only — processors and the scheduler.
 *
 * The split matters: if the API process attached processors it would spend its
 * request threads sending WhatsApp messages, and every API replica would compete
 * for the same jobs. `SITEBOOK_ROLE=worker` is set by `worker.ts` and by nothing
 * else, so the division cannot drift.
 *
 * With `JOBS_ENABLED=false` nothing registers at all. `JobQueueService` still
 * exists and no-ops, so domain code has one code path whether or not Redis is
 * present — tests need no broker.
 */
@Global()
@Module({})
export class JobsModule {
  static register(): DynamicModule {
    const config = env();
    const providers: Provider[] = [JobQueueService];

    if (!config.JOBS_ENABLED) {
      return { module: JobsModule, providers, exports: [JobQueueService] };
    }

    const isWorker = config.SITEBOOK_ROLE === 'worker';
    const queues = Object.values(QUEUE);

    if (isWorker) {
      providers.push(
        TenantRoster,
        SchedulerService,
        NotificationsProcessor,
        WhatsappProcessor,
        ReportsProcessor,
        MediaProcessor,
        // Raw object storage, worker-side only: it has no actor to check a key against, so it must
        // never be reachable from a request.
        ObjectStore,
      );
    }

    return {
      module: JobsModule,
      imports: [
        BullModule.forRoot({
          connection: { url: config.REDIS_URL },
          defaultJobOptions: DEFAULT_JOB_OPTIONS,
        }),
        ...queues.map((name) => BullModule.registerQueue({ name })),
        // Only the worker drafts wage periods, and only it needs the service.
        // Only the worker runs these: it drafts wage periods and sweeps lapsed subscriptions.
        ...(isWorker ? [WagePeriodsModule, BillingModule] : []),
      ],
      providers,
      exports: [JobQueueService],
    };
  }
}
