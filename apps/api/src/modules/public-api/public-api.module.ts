import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { AuditContextMiddleware } from '../../common/audit/audit-context';
import { RequestIdMiddleware } from '../../common/middleware/request-id.middleware';
import { CostCodesModule } from '../cost-codes/cost-codes.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { PublicApiController, PublicApiDocsController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { PublicRateLimiter } from './public-rate-limiter';

/**
 * The public REST API (`/public/v1`, authenticated by API key) and the owner's key management
 * (`/v1/developers/api-keys`, authenticated by session). Webhooks live in WebhooksModule.
 */
@Module({
  imports: [ExpensesModule, CostCodesModule],
  controllers: [ApiKeysController, PublicApiController, PublicApiDocsController],
  providers: [ApiKeysService, PublicApiService, ApiKeyGuard, PublicRateLimiter, IdempotencyInterceptor],
})
export class PublicApiModule implements NestModule {
  /*
   * AppModule applies these to `*`, which Nest expands under the global `/v1` prefix — so routes
   * excluded from the prefix, these, never got them. Without the audit context a key's writes would
   * be logged as the system's and the request id would be missing. Applied by controller, Nest maps
   * them to the routes' real, unprefixed paths.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, AuditContextMiddleware).forRoutes(PublicApiController, PublicApiDocsController);
  }
}
