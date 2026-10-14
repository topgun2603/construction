import { BullModule } from '@nestjs/bullmq';
import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { env } from '../../config/env';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEndpointsService } from './webhook-endpoints.service';
import { WebhookEvents } from './webhook-events.service';
import { WebhookProcessor, WebhookScheduler } from './webhook.processor';
import { WEBHOOK_QUEUE, WebhookQueue } from './webhook-queue.service';
import { WebhookSender } from './webhook-sender.service';
import { WebhooksController } from './webhooks.controller';

/**
 * Signed webhooks (roadmap Phase 3).
 *
 * Global so any service can announce an event with `WebhookEvents.emit(tx, …)` without importing
 * this module — the same reason NotificationsModule is global.
 *
 * Its own queue rather than one of JobsModule's, registered the same way: producers everywhere when
 * Redis is on, the processor and its schedule only in the worker (`SITEBOOK_ROLE=worker`), nothing
 * at all without Redis — the outbox rows wait, and the e2e suite drives `WebhookDeliveryService`
 * itself. The connection is JobsModule's `BullModule.forRoot`, which is global.
 */
@Global()
@Module({})
export class WebhooksModule {
  static register(): DynamicModule {
    const config = env();
    const providers: Provider[] = [
      WebhookQueue,
      WebhookEvents,
      WebhookSender,
      WebhookDeliveryService,
      WebhookEndpointsService,
    ];
    const imports: DynamicModule[] = [];

    if (config.JOBS_ENABLED) {
      imports.push(BullModule.registerQueue({ name: WEBHOOK_QUEUE }));
      if (config.SITEBOOK_ROLE === 'worker') providers.push(WebhookProcessor, WebhookScheduler);
    }

    return {
      module: WebhooksModule,
      imports,
      controllers: [WebhooksController],
      providers,
      exports: [WebhookEvents, WebhookDeliveryService, WebhookSender],
    };
  }
}
