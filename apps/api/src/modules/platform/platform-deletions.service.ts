import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/errors/api-error';
import { CompanyDeletionService } from '../data-portability/company-deletion.service';
import { PlatformDb } from './platform-db.service';

/**
 * The console's view of company deletions: who is waiting out the grace period, the certificates of
 * those already gone, and the two things an operator may do — cancel (a customer who changed their
 * mind and cannot sign in to do it) or expedite (a customer who wants it done today).
 *
 * Reading is cross-company and so runs on the console's connection. Acting goes through
 * `CompanyDeletionService`, the same code the owner and the worker use, which works in the one
 * company's RLS context — so cancelling or expediting from here is exactly what the owner's button
 * or the sweep would have done. An operator cannot start a deletion; only an owner can ask for one.
 * Every action is written to the platform audit log, and the company's own log records it too.
 */
@Injectable()
export class PlatformDeletions {
  constructor(
    private readonly db: PlatformDb,
    private readonly deletion: CompanyDeletionService,
  ) {}

  /** `GET /admin/deletions`. */
  async overview() {
    const prisma = this.db.client;
    const [pending, certificates] = await Promise.all([
      prisma.companyDeletionRequest.findMany({
        where: { status: 'pending' },
        orderBy: { purgeAfter: 'asc' },
        include: { tenant: { select: { name: true, plan: true } } },
      }),
      prisma.deletionCertificate.findMany({ orderBy: { deletedAt: 'desc' }, take: 50 }),
    ]);
    return {
      pending: pending.map((row) => ({
        tenant_id: row.tenantId,
        tenant_name: row.tenant.name,
        plan: row.tenant.plan,
        requested_at: row.requestedAt.toISOString(),
        purge_after: row.purgeAfter.toISOString(),
      })),
      certificates: certificates.map((row) => ({
        id: row.id,
        company_id: row.companyId,
        name_hash: row.nameHash,
        trigger: row.trigger,
        requested_at: row.requestedAt?.toISOString() ?? null,
        deleted_at: row.deletedAt.toISOString(),
        rows: Object.values(row.tableCounts as Record<string, number>).reduce((sum, n) => sum + n, 0),
        tables: Object.keys(row.tableCounts as Record<string, number>).length,
        objects: row.objectCount,
      })),
    };
  }

  /** `POST /admin/tenants/:id/deletion/cancel`. */
  async cancel(actorPhone: string, tenantId: string) {
    const name = await this.pendingName(tenantId);
    const outcome = await this.deletion.cancelByPlatform(tenantId);
    if (!outcome) throw ApiError.conflict('This company is not scheduled for deletion.');
    await this.db.client.platformAuditLog.create({
      data: { actorPhone, action: 'tenant.deletion_cancelled', tenantId, before: { name } },
    });
    return { cancelled: true };
  }

  /**
   * `POST /admin/tenants/:id/deletion/expedite`. Asks for the company's name back, like the console's
   * immediate delete: this is the moment the data stops existing. Logged before it runs, for the same
   * reason as that delete — afterwards there is no company left to say what happened to it.
   */
  async expedite(actorPhone: string, tenantId: string, confirmName: string) {
    const name = await this.pendingName(tenantId);
    if (confirmName.trim() !== name.trim()) {
      throw ApiError.conflict('The name typed does not match this account');
    }
    await this.db.client.platformAuditLog.create({
      data: { actorPhone, action: 'tenant.deletion_expedited', tenantId, before: { name } },
    });
    const outcome = await this.deletion.expedite(tenantId);
    if (!outcome) throw ApiError.conflict('This company is not scheduled for deletion.');
    return outcome;
  }

  private async pendingName(tenantId: string): Promise<string> {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, status: true },
    });
    if (!tenant) throw ApiError.notFound('Tenant');
    if (tenant.status !== 'pending_deletion') {
      throw ApiError.conflict('This company is not scheduled for deletion.');
    }
    return tenant.name;
  }
}
