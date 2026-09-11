import { Injectable } from '@nestjs/common';
import { effectiveModules, type Plan, type TenantStatus } from '@sitebook/shared';
import { env } from '../../config/env';
import { TenantDb } from '../prisma/tenant-db.service';

export interface TenantGateInfo {
  id: string;
  status: TenantStatus;
  plan: Plan;
  enabledModules: string[];
}

interface CacheEntry {
  value: TenantGateInfo;
  expiresAt: number;
}

/**
 * Every authenticated request needs the tenant's plan and module list to run
 * PlanGuard. Reading it from Postgres each time would put a query in front of the
 * fast dashboard endpoints for data that changes a few times a year, so it is held
 * in process for a few seconds.
 *
 * In-process means a plan change can take up to TENANT_CACHE_TTL_SECONDS to reach
 * every instance; `invalidate` makes it immediate on the instance that handled the
 * change. Once Redis is wired up (build order step 5) this moves there so the
 * invalidation is cluster-wide.
 */
@Injectable()
export class TenantCache {
  private readonly ttlMs = env().TENANT_CACHE_TTL_SECONDS * 1000;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly tenantDb: TenantDb) {}

  async get(tenantId: string): Promise<TenantGateInfo | null> {
    const cached = this.entries.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const tenant = await this.tenantDb.clientFor(tenantId).tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true, plan: true, enabledModules: true },
    });
    if (!tenant) {
      this.entries.delete(tenantId);
      return null;
    }

    const value: TenantGateInfo = {
      id: tenant.id,
      status: tenant.status,
      plan: tenant.plan,
      // Resolve plan defaults here so every caller sees the same effective list.
      enabledModules: effectiveModules(tenant.plan, tenant.enabledModules),
    };
    this.entries.set(tenantId, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }

  clear(): void {
    this.entries.clear();
  }
}
