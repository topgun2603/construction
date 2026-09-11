import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

/**
 * The platform console's database connection: a second Prisma client on
 * ADMIN_DATABASE_URL, which points at `sitebook_admin` (BYPASSRLS).
 *
 * Kept deliberately separate from `PrismaService` and `TenantDb`. Those serve tenant
 * requests and must stay unable to read across tenants, because isolation has to be
 * the thing a bug falls back to rather than the thing a bug switches off. Nothing
 * outside this module is given a reference to this client.
 *
 * `client` throws rather than returning a tenant-scoped fallback when the console is
 * not configured. A fallback would appear to work and silently return nothing, which
 * looks exactly like "you have no tenants" — the worst possible failure for a console.
 */
@Injectable()
export class PlatformDb implements OnModuleDestroy {
  private readonly logger = new Logger(PlatformDb.name);
  private readonly url = env().ADMIN_DATABASE_URL;
  private prisma?: PrismaClient;

  /** False when the deployment has no platform console configured. */
  get enabled(): boolean {
    return Boolean(this.url);
  }

  get client(): PrismaClient {
    if (!this.url) {
      throw new Error('ADMIN_DATABASE_URL is not set; the platform console is disabled');
    }
    if (!this.prisma) {
      // Connected lazily: a deployment that never opens the console should not hold a
      // pool on the privileged role just in case.
      this.prisma = new PrismaClient({ datasources: { db: { url: this.url } } });
      this.logger.log('Platform console connected on the admin role');
    }
    return this.prisma;
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma?.$disconnect();
  }
}
