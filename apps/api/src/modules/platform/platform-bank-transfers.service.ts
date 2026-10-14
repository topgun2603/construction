import { Injectable, Logger } from '@nestjs/common';
import {
  effectiveModules,
  expiryAfterMonths,
  type Plan,
  type PlanBankTransferListQuery,
  type PlanBankTransferSettleInput,
} from '@sitebook/shared';
import { TenantCache } from '../../common/auth/tenant-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { bankTransferView } from '../billing/billing.service';
import { PlansService } from '../plans/plans.service';
import { PlatformDb } from './platform-db.service';

/**
 * Bank-transfer invoices, from the console's side: what is waiting to be paid across every
 * company, and marking one paid — which is the only thing that applies the plan it was for.
 *
 * On the console's own BYPASSRLS connection, like the rest of the console. Every settlement is
 * written to the console's trail, and the row change itself lands in the company's audit log
 * through the table's audit trigger.
 */
@Injectable()
export class PlatformBankTransfers {
  private readonly logger = new Logger(PlatformBankTransfers.name);

  constructor(
    private readonly db: PlatformDb,
    private readonly plans: PlansService,
    private readonly tenantCache: TenantCache,
  ) {}

  async list(query: PlanBankTransferListQuery) {
    const rows = await this.db.client.planBankTransferInvoice.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { tenant: { select: { name: true, country: true } } },
    });
    const pending = await this.db.client.planBankTransferInvoice.count({
      where: { status: 'pending' },
    });
    return {
      pending,
      items: rows.map((row) => ({
        ...bankTransferView(row),
        tenant_id: row.tenantId,
        tenant_name: row.tenant.name,
        country: row.tenant.country,
        settled_by: row.settledBy,
      })),
    };
  }

  /**
   * Paid: the plan applies from today for its full term, exactly as an operator setting a plan by
   * hand does (`PlatformService.updateTenant`) — somebody has paid for that length of time, and
   * they paid for it starting now. Cancelled: nothing changes but the row.
   *
   * Only a pending invoice can be settled, so a double click cannot extend a term twice.
   */
  async settle(actorPhone: string, id: string, input: PlanBankTransferSettleInput) {
    const prisma = this.db.client;
    const result = await prisma.$transaction(async (tx) => {
      const invoice = await tx.planBankTransferInvoice.findUnique({ where: { id } });
      if (!invoice) throw ApiError.notFound('Bank-transfer invoice');
      if (invoice.status !== 'pending') {
        throw ApiError.conflict(`This invoice is already ${invoice.status}`);
      }

      const now = new Date();
      const updated = await tx.planBankTransferInvoice.update({
        where: { id },
        data: {
          status: input.status,
          settledBy: actorPhone,
          ...(input.status === 'paid' ? { paidAt: now } : {}),
          ...(input.payment_reference ? { paymentReference: input.payment_reference } : {}),
        },
      });

      let tenantAfter: { plan: string; planExpiresOn: Date | null } | null = null;
      if (input.status === 'paid') {
        const months = await this.plans.monthsFor(invoice.plan);
        tenantAfter = await tx.tenant.update({
          where: { id: invoice.tenantId },
          data: {
            plan: invoice.plan,
            planStartedOn: now,
            planExpiresOn: expiryAfterMonths(months, now),
            enabledModules: [...effectiveModules(invoice.plan as Plan, [])],
          },
          select: { plan: true, planExpiresOn: true },
        });
      }

      await tx.platformAuditLog.create({
        data: {
          actorPhone,
          action: input.status === 'paid' ? 'bank_transfer.paid' : 'bank_transfer.cancelled',
          tenantId: invoice.tenantId,
          before: { number: invoice.number, status: invoice.status },
          after: {
            number: invoice.number,
            status: updated.status,
            plan: invoice.plan,
            currency: invoice.currency,
            amount: invoice.amount.toString(),
            payment_reference: updated.paymentReference,
            ...(tenantAfter
              ? { plan_expires_on: tenantAfter.planExpiresOn?.toISOString() ?? null }
              : {}),
          },
        },
      });
      return updated;
    });

    // The plan gates writes through the tenant cache; a builder who has just paid should not wait
    // out its TTL to stop being read-only.
    this.tenantCache.invalidate(result.tenantId);
    this.logger.log(`Bank-transfer invoice ${result.number} ${result.status} by ${actorPhone}`);
    return { ...bankTransferView(result), settled_by: result.settledBy };
  }
}
