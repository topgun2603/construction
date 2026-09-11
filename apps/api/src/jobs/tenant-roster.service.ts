import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * The list of tenants a scheduled job should run for.
 *
 * A cron job has no tenant context, and every tenant table is behind FORCE row
 * level security, so `tenants` cannot simply be listed — an untenanted read
 * returns nothing by design (ADR 0001). Rather than hand the worker an
 * RLS-bypassing connection, the roster is read from `auth_identities`, the one
 * table deliberately outside RLS.
 *
 * It also happens to be the right set: a tenant appears there only once it has a
 * live user, and a tenant with nobody to notify has nothing to run.
 */
@Injectable()
export class TenantRoster {
  constructor(private readonly prisma: PrismaService) {}

  async activeTenantIds(): Promise<string[]> {
    const rows = await this.prisma.authIdentity.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    return rows.map((row) => row.tenantId);
  }
}
