import { Injectable } from '@nestjs/common';
import { INDIA_LOCALE, todayIn } from '@sitebook/shared';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantDb } from '../common/prisma/tenant-db.service';
import { firesIn, tickWindow } from './tenant-clock';

export interface RosterTenant {
  id: string;
  /** IANA zone the company's scheduled jobs run on. */
  timezone: string;
}

/** Zones change rarely and are read every 15 minutes; ten minutes stale is fine. */
const ZONE_TTL_MS = 10 * 60_000;

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
  private zones = new Map<string, { timezone: string; readAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
  ) {}

  async activeTenantIds(): Promise<string[]> {
    const rows = await this.prisma.authIdentity.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });
    return rows.map((row) => row.tenantId);
  }

  /**
   * The same tenants with their time zones, for jobs that run on each company's clock.
   *
   * Each zone is read inside that tenant's own RLS context — the same route a request takes —
   * so the worker still never needs a connection that can see across tenants.
   */
  async activeTenants(now = Date.now()): Promise<RosterTenant[]> {
    const ids = await this.activeTenantIds();
    return Promise.all(ids.map(async (id) => ({ id, timezone: await this.zoneOf(id, now) })));
  }

  /**
   * The companies whose clock reached `cron` in the quarter-hour that just ended, each with the
   * date it is for them at that moment — a Dubai summary at 7 pm on the 5th is for the 5th even
   * when it is already the 6th somewhere else.
   */
  async dueTenants(cron: string, now = new Date()): Promise<Array<RosterTenant & { localDate: string }>> {
    const window = tickWindow(now);
    const tenants = await this.activeTenants(now.getTime());
    return tenants
      .filter((tenant) => firesIn(cron, tenant.timezone, window))
      .map((tenant) => ({ ...tenant, localDate: todayIn(tenant.timezone, window.end) }));
  }

  private async zoneOf(tenantId: string, now: number): Promise<string> {
    const cached = this.zones.get(tenantId);
    if (cached && now - cached.readAt < ZONE_TTL_MS) return cached.timezone;

    const row = await this.tenantDb
      .clientFor(tenantId)
      .tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    // A tenant row that vanished between the two reads keeps the old default rather than failing
    // every other company's run with it.
    const timezone = row?.timezone ?? INDIA_LOCALE.timezone;
    this.zones.set(tenantId, { timezone, readAt: now });
    return timezone;
  }
}
