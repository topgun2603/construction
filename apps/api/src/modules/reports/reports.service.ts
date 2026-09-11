import { Injectable } from '@nestjs/common';
import {
  attendanceEarning,
  decimalToTenths,
  isoDateToUtcDate,
  tenthsToDecimal,
  utcDateToIsoDate,
  type AttendanceRegisterQuery,
  type LabourCostQuery,
  type PersonLedgerQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { oneDecimal } from '../../common/decimal';
import { TenantDb } from '../../common/prisma/tenant-db.service';

export interface LabourCostRow {
  key: string;
  label: string;
  days: string;
  overtime_hours: string;
  amount: bigint;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  /**
   * Labour cost for a date range, grouped three ways (spec §8A "Reports").
   *
   * Every figure comes from the snapshots frozen on each attendance row, so
   * re-running last month's report tomorrow returns exactly what it returned
   * yesterday — which is what makes it usable as a record (ADR 0003).
   */
  async labourCost(actor: RequestUser, query: LabourCostQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const rows = await this.tenantDb.clientFor(actor.tenantId).attendance.findMany({
      where: {
        attendanceDate: {
          gte: isoDateToUtcDate(query.from),
          lte: isoDateToUtcDate(query.to),
        },
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
      },
      select: {
        status: true,
        overtimeHours: true,
        wageSnapshot: true,
        overtimeRateSnapshot: true,
        project: { select: { id: true, name: true } },
        worker: {
          select: {
            id: true,
            name: true,
            contractorId: true,
            contractor: { select: { name: true } },
          },
        },
      },
    });

    const buckets = new Map<
      string,
      { key: string; label: string; dayTenths: bigint; otTenths: bigint; amount: bigint }
    >();
    let total = 0n;

    for (const row of rows) {
      const earning = attendanceEarning({
        status: row.status,
        overtimeHours: row.overtimeHours.toString(),
        wageSnapshot: row.wageSnapshot,
        overtimeRateSnapshot: row.overtimeRateSnapshot,
      });
      total += earning.totalPaise;

      const { key, label } = this.bucketOf(query.group_by, row);
      const bucket = buckets.get(key) ?? { key, label, dayTenths: 0n, otTenths: 0n, amount: 0n };
      bucket.dayTenths += earning.dayTenths;
      bucket.otTenths += decimalToTenths(row.overtimeHours.toString());
      bucket.amount += earning.totalPaise;
      buckets.set(key, bucket);
    }

    const groups: LabourCostRow[] = [...buckets.values()]
      .map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        days: tenthsToDecimal(bucket.dayTenths),
        overtime_hours: tenthsToDecimal(bucket.otTenths),
        amount: bucket.amount,
      }))
      // Biggest cost first: the point of the report is to find where the money went.
      .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

    return { from: query.from, to: query.to, group_by: query.group_by, total, groups };
  }

  /**
   * The wage sheet a builder prints and carries to site for cash disbursement
   * (spec §8A). Returned as data rather than a PDF: rendering belongs to the
   * client, and the same payload drives both the screen and the print view.
   */
  /**
   * The attendance register for a period — the muster roll.
   *
   * One row per worker, one cell per calendar day, plus the totals that row adds up
   * to. This is the report people ask for when a contractor disputes a wage sheet,
   * so it shows the days rather than only the sum: "you paid me for 22" is answered
   * by pointing at which 22.
   *
   * Days with no record are left absent-by-omission rather than marked absent. A
   * worker who was not on the site that week has no opinion recorded about them, and
   * printing A across a fortnight they were never expected implies one.
   */
  async attendanceRegister(actor: RequestUser, query: AttendanceRegisterQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const rows = await this.tenantDb.clientFor(actor.tenantId).attendance.findMany({
      where: {
        attendanceDate: {
          gte: isoDateToUtcDate(query.from),
          lte: isoDateToUtcDate(query.to),
        },
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
        ...(query.contractor_id ? { worker: { contractorId: query.contractor_id } } : {}),
      },
      select: {
        attendanceDate: true,
        status: true,
        overtimeHours: true,
        wageSnapshot: true,
        overtimeRateSnapshot: true,
        project: { select: { id: true, name: true } },
        worker: {
          select: {
            id: true,
            name: true,
            trade: true,
            contractorId: true,
            contractor: { select: { name: true } },
          },
        },
      },
      orderBy: { attendanceDate: 'asc' },
    });

    const dates = datesBetween(query.from, query.to);

    interface RegisterRow {
      worker_id: string;
      worker_name: string;
      trade: string | null;
      contractor_id: string | null;
      contractor_name: string | null;
      /** Keyed by ISO date; only days with a record appear. */
      days: Record<string, { status: string; overtime_hours: string; project_id: string }>;
      present_count: number;
      half_day_count: number;
      absent_count: number;
      day_tenths: bigint;
      overtime_tenths: bigint;
      earned: bigint;
    }

    const byWorker = new Map<string, RegisterRow>();

    for (const row of rows) {
      const earning = attendanceEarning({
        status: row.status,
        overtimeHours: row.overtimeHours.toString(),
        wageSnapshot: row.wageSnapshot,
        overtimeRateSnapshot: row.overtimeRateSnapshot,
      });

      const entry: RegisterRow = byWorker.get(row.worker.id) ?? {
        worker_id: row.worker.id,
        worker_name: row.worker.name,
        trade: row.worker.trade,
        contractor_id: row.worker.contractorId,
        contractor_name: row.worker.contractor?.name ?? null,
        days: {},
        present_count: 0,
        half_day_count: 0,
        absent_count: 0,
        day_tenths: 0n,
        overtime_tenths: 0n,
        earned: 0n,
      };

      entry.days[utcDateToIsoDate(row.attendanceDate)] = {
        status: row.status,
        overtime_hours: oneDecimal(row.overtimeHours),
        project_id: row.project.id,
      };
      if (row.status === 'present') entry.present_count += 1;
      else if (row.status === 'half_day') entry.half_day_count += 1;
      else entry.absent_count += 1;

      entry.day_tenths += earning.dayTenths;
      entry.overtime_tenths += decimalToTenths(row.overtimeHours.toString());
      entry.earned += earning.totalPaise;
      byWorker.set(row.worker.id, entry);
    }

    const workers = [...byWorker.values()]
      .map((row) => ({
        ...row,
        days_present: tenthsToDecimal(row.day_tenths),
        overtime_hours: tenthsToDecimal(row.overtime_tenths),
      }))
      .sort((a, b) => a.worker_name.localeCompare(b.worker_name));

    return {
      from: query.from,
      to: query.to,
      dates,
      workers,
      totals: {
        worker_count: workers.length,
        days_present: tenthsToDecimal(
          workers.reduce((sum, row) => sum + row.day_tenths, 0n),
        ),
        overtime_hours: tenthsToDecimal(
          workers.reduce((sum, row) => sum + row.overtime_tenths, 0n),
        ),
        earned: workers.reduce((sum, row) => sum + row.earned, 0n),
      },
    };
  }

  /**
   * Money accountability per person for a period — supervisors, PMs, owners.
   *
   * Not the same question as a worker's sheet. A worker's ledger is earnings against
   * payments, and `/workers/:id/ledger` answers it. For the people who *run* sites
   * there is no wage to net off; what an owner wants to see is what each of them
   * committed on the company's behalf: expenses recorded, indents raised, and the
   * labour cost booked through their own roll calls.
   *
   * Expenses are split approved / pending / rejected rather than summed, because
   * "₹80,000 through Ravi" means something very different if a third of it was turned
   * down.
   *
   * Labour booked is attributed to whoever recorded the attendance, which is a measure
   * of what passed through their hands — not a cost they personally caused. The wage
   * is the worker's regardless of who ticked the box.
   */
  async personLedger(actor: RequestUser, query: PersonLedgerQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const db = this.tenantDb.clientFor(actor.tenantId);
    const from = isoDateToUtcDate(query.from);
    const to = isoDateToUtcDate(query.to);
    const projectScope = query.project_id
      ? { projectId: query.project_id }
      : this.access.scopeFilterByProjectId(actor);

    const [people, expenses, indents, attendance, reports] = await Promise.all([
      db.user.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, phone: true, role: true, status: true },
      }),
      db.expense.findMany({
        where: { deletedAt: null, spentOn: { gte: from, lte: to }, ...projectScope },
        select: { submittedBy: true, amount: true, status: true },
      }),
      db.materialIndent.findMany({
        where: { deletedAt: null, createdAt: { gte: from }, ...projectScope },
        select: { requestedBy: true, status: true },
      }),
      db.attendance.findMany({
        where: { attendanceDate: { gte: from, lte: to }, ...projectScope },
        select: {
          recordedBy: true,
          status: true,
          overtimeHours: true,
          wageSnapshot: true,
          overtimeRateSnapshot: true,
        },
      }),
      db.dailyReport.findMany({
        where: { deletedAt: null, reportDate: { gte: from, lte: to }, ...projectScope },
        select: { submittedBy: true, status: true },
      }),
    ]);

    interface PersonRow {
      user_id: string;
      name: string;
      phone: string;
      role: string;
      status: string;
      expenses_approved: bigint;
      expenses_pending: bigint;
      expenses_rejected: bigint;
      expense_count: number;
      indents_raised: number;
      indents_approved: number;
      labour_booked: bigint;
      day_tenths: bigint;
      roll_calls: number;
      reports_filed: number;
    }

    const byUser = new Map<string, PersonRow>();
    for (const person of people) {
      byUser.set(person.id, {
        user_id: person.id,
        name: person.name,
        phone: person.phone,
        role: person.role,
        status: person.status,
        expenses_approved: 0n,
        expenses_pending: 0n,
        expenses_rejected: 0n,
        expense_count: 0,
        indents_raised: 0,
        indents_approved: 0,
        labour_booked: 0n,
        day_tenths: 0n,
        roll_calls: 0,
        reports_filed: 0,
      });
    }

    for (const expense of expenses) {
      const row = byUser.get(expense.submittedBy);
      if (!row) continue;
      row.expense_count += 1;
      if (expense.status === 'approved') row.expenses_approved += expense.amount;
      else if (expense.status === 'pending') row.expenses_pending += expense.amount;
      else row.expenses_rejected += expense.amount;
    }

    for (const indent of indents) {
      const row = byUser.get(indent.requestedBy);
      if (!row) continue;
      row.indents_raised += 1;
      if (indent.status !== 'requested' && indent.status !== 'rejected') {
        row.indents_approved += 1;
      }
    }

    for (const row of attendance) {
      const person = byUser.get(row.recordedBy);
      if (!person) continue;
      const earning = attendanceEarning({
        status: row.status,
        overtimeHours: row.overtimeHours.toString(),
        wageSnapshot: row.wageSnapshot,
        overtimeRateSnapshot: row.overtimeRateSnapshot,
      });
      person.labour_booked += earning.totalPaise;
      person.day_tenths += earning.dayTenths;
      person.roll_calls += 1;
    }

    for (const report of reports) {
      const row = byUser.get(report.submittedBy);
      if (row && report.status === 'submitted') row.reports_filed += 1;
    }

    // Only people who actually did something in the window. A roster of everyone with
    // zeros across the board is a list of accounts, not a report.
    const rows = [...byUser.values()]
      .filter(
        (row) =>
          row.expense_count > 0 ||
          row.indents_raised > 0 ||
          row.roll_calls > 0 ||
          row.reports_filed > 0,
      )
      .map((row) => ({
        ...row,
        days_booked: tenthsToDecimal(row.day_tenths),
        committed: row.expenses_approved + row.expenses_pending,
      }))
      .sort((a, b) => Number(b.committed - a.committed) || a.name.localeCompare(b.name));

    return {
      from: query.from,
      to: query.to,
      people: rows,
      totals: {
        expenses_approved: rows.reduce((sum, row) => sum + row.expenses_approved, 0n),
        expenses_pending: rows.reduce((sum, row) => sum + row.expenses_pending, 0n),
        expenses_rejected: rows.reduce((sum, row) => sum + row.expenses_rejected, 0n),
        labour_booked: rows.reduce((sum, row) => sum + row.labour_booked, 0n),
        indents_raised: rows.reduce((sum, row) => sum + row.indents_raised, 0),
        reports_filed: rows.reduce((sum, row) => sum + row.reports_filed, 0),
      },
    };
  }

  async wageSheet(actor: RequestUser, wagePeriodId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const period = await db.wagePeriod.findUnique({
      where: { id: wagePeriodId },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        status: true,
        totalEarned: true,
        totalAdvances: true,
        totalPaid: true,
        contractor: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!period) throw ApiError.notFound('Wage period');

    const [tenant, lines] = await Promise.all([
      db.tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } }),
      db.wageLine.findMany({
        where: { wagePeriodId },
        select: {
          workerId: true,
          daysPresent: true,
          overtimeHours: true,
          grossAmount: true,
          advancesDeducted: true,
          netPayable: true,
          paidAmount: true,
          worker: { select: { name: true, trade: true, phone: true } },
        },
        orderBy: { worker: { name: 'asc' } },
      }),
    ]);

    return {
      builder: tenant?.name ?? '',
      wage_period_id: period.id,
      contractor: period.contractor
        ? { id: period.contractor.id, name: period.contractor.name, phone: period.contractor.phone }
        : { id: null, name: 'Direct labour', phone: null },
      period_start: utcDateToIsoDate(period.periodStart),
      period_end: utcDateToIsoDate(period.periodEnd),
      status: period.status,
      totals: {
        gross: lines.reduce((sum, line) => sum + line.grossAmount, 0n),
        advances: lines.reduce((sum, line) => sum + line.advancesDeducted, 0n),
        net: lines.reduce((sum, line) => sum + line.netPayable, 0n),
        paid: lines.reduce((sum, line) => sum + line.paidAmount, 0n),
      },
      rows: lines.map((line, index) => ({
        serial: index + 1,
        worker_id: line.workerId,
        name: line.worker.name,
        trade: line.worker.trade,
        phone: line.worker.phone,
        days: line.daysPresent.toString(),
        overtime_hours: line.overtimeHours.toString(),
        gross: line.grossAmount,
        advances: line.advancesDeducted,
        net: line.netPayable,
        paid: line.paidAmount,
        // The printed sheet carries a signature column; it has no server value.
        signature: null,
      })),
    };
  }

  private bucketOf(
    groupBy: LabourCostQuery['group_by'],
    row: {
      project: { id: string; name: string };
      worker: { id: string; name: string; contractorId: string | null; contractor: { name: string } | null };
    },
  ): { key: string; label: string } {
    switch (groupBy) {
      case 'project':
        return { key: row.project.id, label: row.project.name };
      case 'worker':
        return { key: row.worker.id, label: row.worker.name };
      case 'contractor':
        return {
          key: row.worker.contractorId ?? 'direct',
          label: row.worker.contractor?.name ?? 'Direct labour',
        };
    }
  }
}

/**
 * Every calendar day in the range, inclusive.
 *
 * Walks as UTC midnights rather than adding 24h to a local date: the app's clock is
 * Asia/Kolkata and a naive +1 day across a DST boundary in any other zone would skip
 * or repeat a column. Dates here are plain calendar dates with no zone of their own.
 */
function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
