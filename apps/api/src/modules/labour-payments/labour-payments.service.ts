import { Injectable } from '@nestjs/common';
import {
  isoDateToUtcDate,
  utcDateToIsoDate,
  type CreateLabourPaymentInput,
  type ListLabourPaymentsQuery,
  type Page,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb } from '../../common/prisma/tenant-db.service';

export interface LabourPaymentView {
  id: string;
  type: string;
  amount: bigint;
  paid_on: string;
  mode: string;
  worker_id: string | null;
  worker_name: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  project_id: string | null;
  wage_period_id: string | null;
  reference: string | null;
  note: string | null;
  client_id: string | null;
}

const SELECT = {
  id: true,
  type: true,
  amount: true,
  paidOn: true,
  mode: true,
  workerId: true,
  contractorId: true,
  projectId: true,
  wagePeriodId: true,
  reference: true,
  note: true,
  clientId: true,
  worker: { select: { name: true } },
  contractor: { select: { name: true } },
} as const;

@Injectable()
export class LabourPaymentsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  async list(
    actor: RequestUser,
    query: ListLabourPaymentsQuery,
  ): Promise<Page<LabourPaymentView>> {
    const rows = await this.tenantDb.clientFor(actor.tenantId).labourPayment.findMany({
      where: {
        deletedAt: null,
        ...(query.worker_id ? { workerId: query.worker_id } : {}),
        ...(query.contractor_id ? { contractorId: query.contractor_id } : {}),
        ...(query.project_id ? { projectId: query.project_id } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.from || query.to
          ? {
              paidOn: {
                ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
              },
            }
          : {}),
      },
      select: SELECT,
      orderBy: [{ paidOn: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    });
    return toPage(rows, query.limit, toView);
  }

  /**
   * Advances and ad-hoc payments (spec §8A "Advances").
   *
   * Idempotent on `client_id` because a supervisor hands over cash on site with no
   * signal: the outbox will retry, and paying a worker twice in the ledger is a
   * real-money error.
   */
  async create(actor: RequestUser, input: CreateLabourPaymentInput): Promise<LabourPaymentView> {
    if (input.project_id) await this.access.assertAccess(actor, input.project_id);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.labourPayment.findFirst({
          where: { clientId: input.client_id },
          select: SELECT,
        });
        if (existing) return toView(existing);
      }

      // Resolve the contractor from the worker when it was not supplied, so a
      // contractor-level balance stays correct without the client having to know it.
      let contractorId = input.contractor_id ?? null;
      if (input.worker_id) {
        const worker = await tx.worker.findFirst({
          where: { id: input.worker_id, deletedAt: null },
          select: { contractorId: true },
        });
        if (!worker) throw ApiError.notFound('Worker');
        contractorId ??= worker.contractorId;
      } else if (contractorId) {
        const contractor = await tx.contractor.findFirst({
          where: { id: contractorId, deletedAt: null },
          select: { id: true },
        });
        if (!contractor) throw ApiError.notFound('Contractor');
      }

      // A wage payment is created by the wage-period `pay` flow, which keeps the
      // line totals in step. Letting one in here would leave paid_amount stale.
      if (input.type === 'wage' && !input.wage_period_id) {
        throw ApiError.validationFailed(
          { type: 'wage' },
          'Record wage payments through POST /wage-periods/:id/pay',
        );
      }

      const payment = await tx.labourPayment.create({
        data: {
          tenantId: actor.tenantId,
          type: input.type,
          amount: input.amount,
          paidOn: isoDateToUtcDate(input.paid_on),
          mode: input.mode,
          workerId: input.worker_id ?? null,
          contractorId,
          projectId: input.project_id ?? null,
          wagePeriodId: input.wage_period_id ?? null,
          reference: input.reference,
          note: input.note,
          recordedBy: actor.userId,
          clientId: input.client_id,
        },
        select: SELECT,
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: `labour_payment.${input.type}`,
          entity: 'labour_payments',
          entityId: payment.id,
          after: { amount: input.amount.toString(), worker_id: input.worker_id ?? null },
        },
      });

      return toView(payment);
    });
  }

  /** Contractor balance: their workers' earnings less everything paid out. */
  /**
   * Soft delete a payment entry (spec §7).
   *
   * Refused for anything attached to a wage period. A wage payment is created by the
   * `pay` flow, which also moves `paid_amount` on the lines and `total_paid` on the
   * period; an advance gets its `wage_period_id` set at the moment a sheet deducts it.
   * Deleting either behind the period's back would leave those totals claiming money
   * that no longer has a record — the sheet would still say the worker was paid.
   *
   * What is left is exactly the set that is safe: a cash entry nothing has consumed
   * yet. That is also the one people actually need to delete, because it is the one
   * they mistype.
   */
  async archive(actor: RequestUser, id: string): Promise<void> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const payment = await db.labourPayment.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, type: true, wagePeriodId: true },
    });
    if (!payment) throw ApiError.notFound('Payment');
    if (payment.projectId) await this.access.assertAccess(actor, payment.projectId);

    if (payment.wagePeriodId) {
      throw ApiError.conflict(
        payment.type === 'wage'
          ? 'This is a wage payment from a wage sheet. Reverse it through the wage period instead.'
          : 'This advance has already been deducted on a wage sheet and cannot be deleted.',
        { wage_period_id: payment.wagePeriodId },
      );
    }

    await db.labourPayment.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async contractorBalance(actor: RequestUser, contractorId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const contractor = await db.contractor.findFirst({
      where: { id: contractorId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!contractor) throw ApiError.notFound('Contractor');

    const [lines, payments] = await Promise.all([
      db.wageLine.findMany({
        where: { worker: { contractorId } },
        select: { grossAmount: true, paidAmount: true },
      }),
      db.labourPayment.findMany({
        where: { contractorId, deletedAt: null },
        select: { type: true, amount: true },
      }),
    ]);

    const earned = lines.reduce((sum, line) => sum + line.grossAmount, 0n);
    let paid = 0n;
    let bonus = 0n;
    let deduction = 0n;
    for (const payment of payments) {
      if (payment.type === 'bonus') bonus += payment.amount;
      else if (payment.type === 'deduction') deduction += payment.amount;
      else paid += payment.amount;
    }

    return {
      contractor_id: contractor.id,
      contractor_name: contractor.name,
      total_earned: earned,
      total_paid: paid,
      bonus,
      deduction,
      outstanding: earned + bonus - deduction - paid,
    };
  }
}

function toView(row: {
  id: string;
  type: string;
  amount: bigint;
  paidOn: Date;
  mode: string;
  workerId: string | null;
  contractorId: string | null;
  projectId: string | null;
  wagePeriodId: string | null;
  reference: string | null;
  note: string | null;
  clientId: string | null;
  worker: { name: string } | null;
  contractor: { name: string } | null;
}): LabourPaymentView {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    paid_on: utcDateToIsoDate(row.paidOn),
    mode: row.mode,
    worker_id: row.workerId,
    worker_name: row.worker?.name ?? null,
    contractor_id: row.contractorId,
    contractor_name: row.contractor?.name ?? null,
    project_id: row.projectId,
    wage_period_id: row.wagePeriodId,
    reference: row.reference,
    note: row.note,
    client_id: row.clientId,
  };
}
