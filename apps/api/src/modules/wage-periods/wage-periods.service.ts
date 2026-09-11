import { Injectable } from '@nestjs/common';
import {
  isoDateToUtcDate,
  netPayable,
  utcDateToIsoDate,
  wageLineTotals,
  type GenerateWagePeriodInput,
  type ListWagePeriodsQuery,
  type Page,
  type PayWagePeriodInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { oneDecimal } from '../../common/decimal';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { JobQueueService } from '../../jobs/job-queue.service';

export interface WagePeriodView {
  id: string;
  contractor_id: string | null;
  contractor_name: string;
  period_start: string;
  period_end: string;
  status: string;
  total_earned: bigint;
  total_advances: bigint;
  total_paid: bigint;
  line_count: number;
  /** `scheduled` when the nightly job drafted it rather than a person asking for it. */
  source: string;
}

@Injectable()
export class WagePeriodsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly jobs: JobQueueService,
  ) {}

  async list(actor: RequestUser, query: ListWagePeriodsQuery): Promise<Page<WagePeriodView>> {
    const rows = await this.tenantDb.clientFor(actor.tenantId).wagePeriod.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.contractor_id ? { contractorId: query.contractor_id } : {}),
      },
      select: PERIOD_SELECT,
      orderBy: [{ periodEnd: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    });
    return toPage(rows, query.limit, toPeriodView);
  }

  async get(actor: RequestUser, id: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const period = await db.wagePeriod.findUnique({ where: { id }, select: PERIOD_SELECT });
    if (!period) throw ApiError.notFound('Wage period');

    const lines = await db.wageLine.findMany({
      where: { wagePeriodId: id },
      select: LINE_SELECT,
      orderBy: { worker: { name: 'asc' } },
    });

    return { ...toPeriodView(period), lines: lines.map(toLineView) };
  }

  /**
   * Build a period's lines from attendance (spec §8A step 1).
   *
   * Re-running on an open period recomputes it — the supervisor is still editing
   * attendance during the week, so the draft has to be able to catch up. Once
   * finalised the lines are frozen and this refuses.
   */
  async generate(
    actor: RequestUser,
    input: GenerateWagePeriodInput,
    source: 'manual' | 'scheduled' = 'manual',
  ) {
    const start = isoDateToUtcDate(input.period_start);
    const end = isoDateToUtcDate(input.period_end);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.contractor_id) {
        const contractor = await tx.contractor.findFirst({
          where: { id: input.contractor_id, deletedAt: null },
          select: { id: true },
        });
        if (!contractor) throw ApiError.notFound('Contractor');
      }

      const existing = await tx.wagePeriod.findFirst({
        where: {
          contractorId: input.contractor_id,
          periodStart: start,
          periodEnd: end,
        },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== 'open') {
        throw ApiError.periodFinalised({
          wage_period_id: existing.id,
          message: 'This period is already finalised and cannot be regenerated',
        });
      }

      const period =
        existing ??
        (await tx.wagePeriod.create({
          data: {
            tenantId: actor.tenantId,
            contractorId: input.contractor_id,
            periodStart: start,
            periodEnd: end,
            status: 'open',
            source,
          },
          select: { id: true },
        }));

      // Every attendance row in the window for workers under this contractor.
      // `contractorId: null` is direct labour, which is a real group, not a gap.
      const rows = await tx.attendance.findMany({
        where: {
          attendanceDate: { gte: start, lte: end },
          worker: { contractorId: input.contractor_id, deletedAt: null },
        },
        select: {
          status: true,
          overtimeHours: true,
          wageSnapshot: true,
          overtimeRateSnapshot: true,
          workerId: true,
        },
      });

      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        const list = grouped.get(row.workerId) ?? [];
        list.push(row);
        grouped.set(row.workerId, list);
      }

      // Advances not yet attached to any period are the ones available to deduct.
      const openAdvances = await tx.labourPayment.findMany({
        where: {
          type: 'advance',
          wagePeriodId: null,
          deletedAt: null,
          worker: { contractorId: input.contractor_id },
        },
        select: { workerId: true, amount: true },
      });
      const advanceByWorker = new Map<string, bigint>();
      for (const advance of openAdvances) {
        if (!advance.workerId) continue;
        advanceByWorker.set(
          advance.workerId,
          (advanceByWorker.get(advance.workerId) ?? 0n) + advance.amount,
        );
      }

      await tx.wageLine.deleteMany({
        where: { wagePeriodId: period.id, workerId: { notIn: [...grouped.keys()] } },
      });

      let totalEarned = 0n;
      let totalAdvances = 0n;

      for (const [workerId, workerRows] of grouped) {
        const totals = wageLineTotals(
          workerRows.map((row) => ({
            status: row.status,
            overtimeHours: row.overtimeHours.toString(),
            wageSnapshot: row.wageSnapshot,
            overtimeRateSnapshot: row.overtimeRateSnapshot,
          })),
        );
        const { advancesDeducted, netPayable: net } = netPayable(
          totals.grossAmount,
          advanceByWorker.get(workerId) ?? 0n,
        );

        totalEarned += totals.grossAmount;
        totalAdvances += advancesDeducted;

        await tx.wageLine.upsert({
          where: { wagePeriodId_workerId: { wagePeriodId: period.id, workerId } },
          create: {
            tenantId: actor.tenantId,
            wagePeriodId: period.id,
            workerId,
            daysPresent: totals.daysPresent,
            overtimeHours: totals.overtimeHours,
            grossAmount: totals.grossAmount,
            advancesDeducted,
            netPayable: net,
          },
          update: {
            daysPresent: totals.daysPresent,
            overtimeHours: totals.overtimeHours,
            grossAmount: totals.grossAmount,
            advancesDeducted,
            netPayable: net,
          },
        });
      }

      await tx.wagePeriod.update({
        where: { id: period.id },
        data: { totalEarned, totalAdvances },
      });

      return this.getInTx(tx, period.id);
    });
  }

  /**
   * Freeze the period (spec §8A step 3). This is what locks attendance for the
   * date range — `AttendanceService` refuses edits once a covering period is
   * finalised — and it claims the advances the lines deducted, so the next period
   * cannot deduct them a second time.
   */
  async finalise(actor: RequestUser, id: string) {
    const result = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const period = await tx.wagePeriod.findUnique({
        where: { id },
        select: { id: true, status: true, contractorId: true },
      });
      if (!period) throw ApiError.notFound('Wage period');
      if (period.status !== 'open') {
        throw ApiError.conflict('This period is already finalised', { status: period.status });
      }

      const lines = await tx.wageLine.findMany({
        where: { wagePeriodId: id },
        select: { workerId: true, advancesDeducted: true },
      });
      if (lines.length === 0) {
        throw ApiError.conflict('Generate the period before finalising it');
      }

      for (const line of lines) {
        if (line.advancesDeducted === 0n) continue;
        await tx.labourPayment.updateMany({
          where: { type: 'advance', wagePeriodId: null, workerId: line.workerId, deletedAt: null },
          data: { wagePeriodId: id },
        });
      }

      await tx.wagePeriod.update({
        where: { id },
        data: { status: 'finalised', finalisedBy: actor.userId, finalisedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'wage_period.finalised',
          entity: 'wage_periods',
          entityId: id,
          after: { line_count: lines.length },
        },
      });

      return this.getInTx(tx, id);
    });

    // After the commit: the contractor should never get a wage total for a
    // freeze that did not stick.
    await this.jobs.wagePeriodFinalised({ tenantId: actor.tenantId, wagePeriodId: id });

    return result;
  }

  /**
   * Record payment against the period (spec §8A step 4). Partial payments are
   * allowed, so the period only becomes `paid` once every line is settled.
   */
  async pay(actor: RequestUser, id: string, input: PayWagePeriodInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const period = await tx.wagePeriod.findUnique({
        where: { id },
        select: { id: true, status: true, contractorId: true, totalPaid: true },
      });
      if (!period) throw ApiError.notFound('Wage period');
      if (period.status === 'open') {
        throw ApiError.conflict('Finalise the period before paying it');
      }

      const lines = await tx.wageLine.findMany({
        where: { wagePeriodId: id },
        select: { id: true, workerId: true, netPayable: true, paidAmount: true },
      });
      const byWorker = new Map(lines.map((line) => [line.workerId, line]));

      // No explicit lines means "settle everything outstanding".
      const instructions =
        input.lines ??
        lines
          .filter((line) => line.netPayable > line.paidAmount)
          .map((line) => ({ worker_id: line.workerId, amount: line.netPayable - line.paidAmount }));

      if (instructions.length === 0) {
        throw ApiError.conflict('Nothing outstanding on this period');
      }

      let paidNow = 0n;
      for (const instruction of instructions) {
        const line = byWorker.get(instruction.worker_id);
        if (!line) {
          throw ApiError.validationFailed(
            { worker_id: instruction.worker_id },
            'That worker has no line in this period',
          );
        }
        const outstanding = line.netPayable - line.paidAmount;
        if (instruction.amount > outstanding) {
          throw ApiError.validationFailed(
            {
              worker_id: instruction.worker_id,
              outstanding: outstanding.toString(),
              attempted: instruction.amount.toString(),
            },
            'Payment exceeds what is outstanding on this line',
          );
        }

        await tx.labourPayment.create({
          data: {
            tenantId: actor.tenantId,
            workerId: instruction.worker_id,
            contractorId: period.contractorId,
            wagePeriodId: id,
            type: 'wage',
            amount: instruction.amount,
            paidOn: isoDateToUtcDate(input.paid_on),
            mode: input.mode,
            reference: input.reference,
            note: input.note,
            recordedBy: actor.userId,
          },
        });

        await tx.wageLine.update({
          where: { id: line.id },
          data: { paidAmount: { increment: instruction.amount } },
        });
        paidNow += instruction.amount;
      }

      const settled = await tx.wageLine.findMany({
        where: { wagePeriodId: id },
        select: { netPayable: true, paidAmount: true },
      });
      const fullySettled = settled.every((line) => line.paidAmount >= line.netPayable);

      await tx.wagePeriod.update({
        where: { id },
        data: {
          totalPaid: { increment: paidNow },
          ...(fullySettled ? { status: 'paid' as const } : {}),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'wage_period.paid',
          entity: 'wage_periods',
          entityId: id,
          after: { amount: paidNow.toString(), fully_settled: fullySettled },
        },
      });

      return this.getInTx(tx, id);
    });
  }

  /**
   * Throw away an open period.
   *
   * Needed because the nightly job drafts periods unattended: a sheet you did not ask for and
   * do not want has to be removable, or the list fills with drafts nobody will finalise and
   * the real ones get lost among them.
   *
   * A hard delete, not a soft one. An open period holds no decisions — the figures are derived
   * from attendance, which is untouched, and no advance has been stamped yet (finalise does
   * that). There is nothing worth a tombstone, and a soft-deleted period would still collide
   * with the unique window when the next one is generated for the same dates.
   */
  async discard(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const period = await tx.wagePeriod.findUnique({
        where: { id },
        select: { id: true, status: true, periodStart: true, periodEnd: true },
      });
      if (!period) throw ApiError.notFound('Wage period');
      if (period.status !== 'open') {
        throw ApiError.conflict('Only an open period can be discarded. Reopen it first.', {
          wage_period_id: id,
          status: period.status,
        });
      }

      // Defensive: `pay` refuses until a period is finalised, so an open one should have no
      // payments. If one somehow does, deleting would orphan real money.
      const payments = await tx.labourPayment.count({ where: { wagePeriodId: id } });
      if (payments > 0) {
        throw ApiError.conflict(
          'This period already has payments against it and cannot be discarded',
          { payment_count: payments },
        );
      }

      await tx.wageLine.deleteMany({ where: { wagePeriodId: id } });
      await tx.wagePeriod.delete({ where: { id } });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'wage_period.discarded',
          entity: 'wage_periods',
          entityId: id,
          before: {
            period_start: utcDateToIsoDate(period.periodStart),
            period_end: utcDateToIsoDate(period.periodEnd),
          },
        },
      });
    });
  }

  /**
   * Reopen a finalised period so it can be corrected and finalised again.
   *
   * Only while nothing has been paid. Once money has moved the sheet is the record of what was
   * paid against what, and reopening would let the figures drift away from the cash that
   * actually left the office — reverse the payment first.
   *
   * The part that matters is giving the advances back. Finalising stamps every advance it
   * deducted with this period's id, which is what stops the same ₹5,000 being deducted twice.
   * Reopening without clearing those stamps would leave them consumed by a sheet that no
   * longer deducts anything: the worker would have had the advance taken off once and never
   * credited back, and nothing on screen would show it.
   */
  async reopen(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const period = await tx.wagePeriod.findUnique({
        where: { id },
        select: { id: true, status: true, totalPaid: true },
      });
      if (!period) throw ApiError.notFound('Wage period');

      if (period.status === 'open') throw ApiError.conflict('This period is already open');
      if (period.totalPaid > 0n) {
        throw ApiError.conflict(
          'Money has already been paid against this period. Reverse the payments before reopening it.',
          { total_paid: period.totalPaid.toString() },
        );
      }

      // Hand the advances back, or they stay deducted by a sheet that deducts nothing.
      const released = await tx.labourPayment.updateMany({
        where: { wagePeriodId: id, type: 'advance' },
        data: { wagePeriodId: null },
      });

      await tx.wagePeriod.update({
        where: { id },
        data: { status: 'open', finalisedBy: null, finalisedAt: null },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'wage_period.reopened',
          entity: 'wage_periods',
          entityId: id,
          after: { advances_released: released.count },
        },
      });

      return this.getInTx(tx, id);
    });
  }

  private async getInTx(tx: TenantTx, id: string) {
    const period = await tx.wagePeriod.findUnique({ where: { id }, select: PERIOD_SELECT });
    if (!period) throw ApiError.notFound('Wage period');
    const lines = await tx.wageLine.findMany({
      where: { wagePeriodId: id },
      select: LINE_SELECT,
      orderBy: { worker: { name: 'asc' } },
    });
    return { ...toPeriodView(period), lines: lines.map(toLineView) };
  }
}

const PERIOD_SELECT = {
  id: true,
  contractorId: true,
  periodStart: true,
  periodEnd: true,
  status: true,
  totalEarned: true,
  totalAdvances: true,
  totalPaid: true,
  source: true,
  contractor: { select: { name: true } },
  _count: { select: { lines: true } },
} as const;

const LINE_SELECT = {
  id: true,
  workerId: true,
  daysPresent: true,
  overtimeHours: true,
  grossAmount: true,
  advancesDeducted: true,
  netPayable: true,
  paidAmount: true,
  note: true,
  worker: { select: { name: true, trade: true, phone: true } },
} as const;

function toPeriodView(row: {
  id: string;
  contractorId: string | null;
  periodStart: Date;
  periodEnd: Date;
  status: string;
  totalEarned: bigint;
  totalAdvances: bigint;
  totalPaid: bigint;
  source: string;
  contractor: { name: string } | null;
  _count: { lines: number };
}): WagePeriodView {
  return {
    id: row.id,
    contractor_id: row.contractorId,
    contractor_name: row.contractor?.name ?? 'Direct labour',
    period_start: utcDateToIsoDate(row.periodStart),
    period_end: utcDateToIsoDate(row.periodEnd),
    status: row.status,
    total_earned: row.totalEarned,
    total_advances: row.totalAdvances,
    total_paid: row.totalPaid,
    line_count: row._count.lines,
    source: row.source,
  };
}

function toLineView(row: {
  id: string;
  workerId: string;
  daysPresent: { toFixed(digits: number): string };
  overtimeHours: { toFixed(digits: number): string };
  grossAmount: bigint;
  advancesDeducted: bigint;
  netPayable: bigint;
  paidAmount: bigint;
  note: string | null;
  worker: { name: string; trade: string | null; phone: string | null };
}) {
  return {
    id: row.id,
    worker_id: row.workerId,
    worker_name: row.worker.name,
    trade: row.worker.trade,
    phone: row.worker.phone,
    days_present: oneDecimal(row.daysPresent),
    overtime_hours: oneDecimal(row.overtimeHours),
    gross_amount: row.grossAmount,
    advances_deducted: row.advancesDeducted,
    net_payable: row.netPayable,
    paid_amount: row.paidAmount,
    outstanding: row.netPayable - row.paidAmount,
    note: row.note,
  };
}
