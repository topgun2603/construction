import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The raw connection. Every tenant table has FORCE ROW LEVEL SECURITY, so queries
 * made through this client directly see *no rows* until `app.tenant_id` is set —
 * which is what makes forgetting the tenant context a visible bug rather than a
 * silent cross-tenant read.
 *
 * Use `TenantDb` for anything tenant-scoped. Reach for this client only where
 * there genuinely is no tenant yet: the `auth_identities` lookup and health checks.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
