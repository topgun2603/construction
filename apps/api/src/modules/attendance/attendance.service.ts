import { Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  attendanceEarning,
  decimalToTenths,
  isoDateToUtcDate,
  tenthsToDecimal,
  utcDateToIsoDate,
  type AttendanceSummaryQuery,
  type BulkAttendanceInput,
} from '@sitebook/shared';
import { HttpStatus } from '@nestjs/common';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { oneDecimal } from '../../common/decimal';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';

export interface AttendanceRowView {
  id: string;
  worker_id: string;
  worker_name: string;
  contractor_id: string | null;
  contractor_name: string | null;
  trade: string | null;
  status: string;
  overtime_hours: string;
  wage_snapshot: bigint;
  overtime_rate_snapshot: bigint;
  earned: bigint;
  client_id: string | null;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  /** The roll call as recorded for one site on one day. */
  async forDate(actor: RequestUser, projectId: string, date: string) {
    await this.access.assertAccess(actor, projectId);

    const rows = await this.tenantDb.clientFor(actor.tenantId).attendance.findMany({
      where: { projectId, attendanceDate: isoDateToUtcDate(date) },
      select: ROW_SELECT,
      orderBy: [{ worker: { contractorId: 'asc' } }, { worker: { name: 'asc' } }],
    });

    const items = rows.map(toRowView);
    return {
      project_id: projectId,
      attendance_date: date,
      locked: await this.isLocked(actor, projectId, date),
      total_earned: items.reduce((sum, row) => sum + row.earned, 0n),
      present_count: items.filter((row) => row.status === 'present').length,
      half_day_count: items.filter((row) => row.status === 'half_day').length,
      items,
    };
  }

  /**
   * Bulk upsert of a whole roll call (spec §9: "one row per worker").
   *
   * Four rules are enforced here rather than in the database, because each needs
   * more context than a constraint can see:
   *   1. the wage period covering this date must still be open;
   *   2. the wage and overtime rate are frozen onto the row at record time;
   *   3. a worker cannot be `present` on two sites the same day;
   *   4. a retry with the same `client_id` must not double-count.
   */
  async record(actor: RequestUser, input: BulkAttendanceInput) {
    await this.access.assertAccess(actor, input.project_id);
    const date = isoDateToUtcDate(input.attendance_date);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const workerIds = input.rows.map((row) => row.worker_id);
      const workers = await tx.worker.findMany({
        where: { id: { in: workerIds }, deletedAt: null },
        select: {
          id: true,
          contractorId: true,
          dailyWage: true,
          overtimeRatePerHour: true,
          name: true,
        },
      });

      const byId = new Map(workers.map((worker) => [worker.id, worker]));
      const missing = workerIds.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw ApiError.validationFailed({ unknown_worker_ids: missing }, 'Unknown workers');
      }

      await this.assertPeriodsOpen(
        tx,
        workers.map((w) => w.contractorId),
        date,
        input.attendance_date,
      );

      // Rule 3: a full day on another site the same date blocks a present here.
      // Two half days are the only sanctioned way to split a worker (spec §8A).
      const elsewhere = await tx.attendance.findMany({
        where: {
          workerId: { in: workerIds },
          attendanceDate: date,
          projectId: { not: input.project_id },
        },
        select: { workerId: true, status: true },
      });
      const busy = new Map(elsewhere.map((row) => [row.workerId, row.status]));

      const conflicts: Array<{ worker_id: string; worker_name: string; reason: string }> = [];
      for (const row of input.rows) {
        const other = busy.get(row.worker_id);
        if (!other || row.status === 'absent') continue;
        if (other === 'present' || row.status === 'present') {
          conflicts.push({
            worker_id: row.worker_id,
            worker_name: byId.get(row.worker_id)?.name ?? row.worker_id,
            reason:
              other === 'present'
                ? 'already marked present on another site today'
                : 'already on another site today — record a half day on both',
          });
        }
      }
      if (conflicts.length > 0) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          ERROR_CODES.WORKER_OVERBOOKED,
          'Some workers are already on another site today',
          { conflicts },
        );
      }

      for (const row of input.rows) {
        const worker = byId.get(row.worker_id);
        if (!worker) continue;

        const data = {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          attendanceDate: date,
          workerId: row.worker_id,
          status: row.status,
          overtimeHours: row.overtime_hours,
          // Frozen here, never read from the worker again (ADR 0003).
          wageSnapshot: worker.dailyWage,
          overtimeRateSnapshot: worker.overtimeRatePerHour,
          recordedBy: actor.userId,
          recordedAt: new Date(),
          lat: row.lat,
          lng: row.lng,
          clientId: row.client_id,
        };

        await tx.attendance.upsert({
          where: {
            projectId_attendanceDate_workerId: {
              projectId: input.project_id,
              attendanceDate: date,
              workerId: row.worker_id,
            },
          },
          create: data,
          // An edit re-freezes the rate: the supervisor is correcting today's
          // record, and today's rate is the right one to apply.
          update: {
            status: data.status,
            overtimeHours: data.overtimeHours,
            wageSnapshot: data.wageSnapshot,
            overtimeRateSnapshot: data.overtimeRateSnapshot,
            recordedBy: data.recordedBy,
            recordedAt: data.recordedAt,
            lat: data.lat,
            lng: data.lng,
          },
        });
      }

      return this.forDateInTx(tx, input.project_id, input.attendance_date, false);
    });
  }

  /**
   * Days and cost over a range — the input to the labour dashboard and to wage
   * period generation.
   */
  async summary(actor: RequestUser, query: AttendanceSummaryQuery) {
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
        status: true,
        overtimeHours: true,
        wageSnapshot: true,
        overtimeRateSnapshot: true,
        worker: {
          select: { id: true, name: true, contractorId: true, contractor: { select: { name: true } } },
        },
        project: { select: { id: true, name: true } },
      },
    });

    const perWorker = new Map<
      string,
      {
        worker_id: string;
        worker_name: string;
        contractor_id: string | null;
        contractor_name: string | null;
        day_tenths: bigint;
        overtime_tenths: bigint;
        earned: bigint;
      }
    >();
    const perContractor = new Map<
      string,
      { contractor_id: string | null; contractor_name: string; earned: bigint; day_tenths: bigint }
    >();
    const perProject = new Map<string, { project_id: string; project_name: string; earned: bigint }>();

    for (const row of rows) {
      const earning = attendanceEarning({
        status: row.status,
        overtimeHours: row.overtimeHours.toString(),
        wageSnapshot: row.wageSnapshot,
        overtimeRateSnapshot: row.overtimeRateSnapshot,
      });

      const worker = perWorker.get(row.worker.id) ?? {
        worker_id: row.worker.id,
        worker_name: row.worker.name,
        contractor_id: row.worker.contractorId,
        contractor_name: row.worker.contractor?.name ?? null,
        day_tenths: 0n,
        overtime_tenths: 0n,
        earned: 0n,
      };
      worker.day_tenths += earning.dayTenths;
      worker.overtime_tenths += decimalToTenths(row.overtimeHours.toString());
      worker.earned += earning.totalPaise;
      perWorker.set(row.worker.id, worker);

      const contractorKey = row.worker.contractorId ?? 'direct';
      const contractor = perContractor.get(contractorKey) ?? {
        contractor_id: row.worker.contractorId,
        contractor_name: row.worker.contractor?.name ?? 'Direct labour',
        earned: 0n,
        day_tenths: 0n,
      };
      contractor.earned += earning.totalPaise;
      contractor.day_tenths += earning.dayTenths;
      perContractor.set(contractorKey, contractor);

      const project = perProject.get(row.project.id) ?? {
        project_id: row.project.id,
        project_name: row.project.name,
        earned: 0n,
      };
      project.earned += earning.totalPaise;
      perProject.set(row.project.id, project);
    }

    return {
      from: query.from,
      to: query.to,
      total_earned: [...perWorker.values()].reduce((sum, w) => sum + w.earned, 0n),
      by_worker: [...perWorker.values()].map((w) => ({
        ...w,
        days_present: tenthsToDecimal(w.day_tenths),
        overtime_hours: tenthsToDecimal(w.overtime_tenths),
      })),
      by_contractor: [...perContractor.values()].map((c) => ({
        contractor_id: c.contractor_id,
        contractor_name: c.contractor_name,
        earned: c.earned,
        days: tenthsToDecimal(c.day_tenths),
      })),
      by_project: [...perProject.values()],
    };
  }

  /** True when the wage period covering this date has been finalised. */
  private async isLocked(actor: RequestUser, projectId: string, date: string): Promise<boolean> {
    const at = isoDateToUtcDate(date);
    const locked = await this.tenantDb.clientFor(actor.tenantId).wagePeriod.findFirst({
      where: {
        status: { in: ['finalised', 'paid'] },
        periodStart: { lte: at },
        periodEnd: { gte: at },
      },
      select: { id: true },
    });
    return locked !== null;
  }

  private async assertPeriodsOpen(
    tx: TenantTx,
    contractorIds: Array<string | null>,
    date: Date,
    isoDate: string,
  ): Promise<void> {
    const distinct = [...new Set(contractorIds)];
    const locked = await tx.wagePeriod.findFirst({
      where: {
        status: { in: ['finalised', 'paid'] },
        periodStart: { lte: date },
        periodEnd: { gte: date },
        OR: distinct.map((id) => ({ contractorId: id })),
      },
      select: { id: true, contractorId: true, periodStart: true, periodEnd: true },
    });

    if (locked) {
      throw ApiError.periodFinalised({
        attendance_date: isoDate,
        wage_period_id: locked.id,
        contractor_id: locked.contractorId,
        period_start: utcDateToIsoDate(locked.periodStart),
        period_end: utcDateToIsoDate(locked.periodEnd),
      });
    }
  }

  private async forDateInTx(tx: TenantTx, projectId: string, date: string, locked: boolean) {
    const rows = await tx.attendance.findMany({
      where: { projectId, attendanceDate: isoDateToUtcDate(date) },
      select: ROW_SELECT,
      orderBy: [{ worker: { contractorId: 'asc' } }, { worker: { name: 'asc' } }],
    });
    const items = rows.map(toRowView);
    return {
      project_id: projectId,
      attendance_date: date,
      locked,
      total_earned: items.reduce((sum, row) => sum + row.earned, 0n),
      present_count: items.filter((row) => row.status === 'present').length,
      half_day_count: items.filter((row) => row.status === 'half_day').length,
      items,
    };
  }
}

const ROW_SELECT = {
  id: true,
  status: true,
  overtimeHours: true,
  wageSnapshot: true,
  overtimeRateSnapshot: true,
  clientId: true,
  worker: {
    select: {
      id: true,
      name: true,
      trade: true,
      contractorId: true,
      contractor: { select: { name: true } },
    },
  },
} as const;

function toRowView(row: {
  id: string;
  status: string;
  overtimeHours: { toString(): string; toFixed(digits: number): string };
  wageSnapshot: bigint;
  overtimeRateSnapshot: bigint;
  clientId: string | null;
  worker: {
    id: string;
    name: string;
    trade: string | null;
    contractorId: string | null;
    contractor: { name: string } | null;
  };
}): AttendanceRowView {
  const earning = attendanceEarning({
    status: row.status as 'present' | 'half_day' | 'absent',
    overtimeHours: row.overtimeHours.toString(),
    wageSnapshot: row.wageSnapshot,
    overtimeRateSnapshot: row.overtimeRateSnapshot,
  });

  return {
    id: row.id,
    worker_id: row.worker.id,
    worker_name: row.worker.name,
    contractor_id: row.worker.contractorId,
    contractor_name: row.worker.contractor?.name ?? null,
    trade: row.worker.trade,
    status: row.status,
    overtime_hours: oneDecimal(row.overtimeHours),
    wage_snapshot: row.wageSnapshot,
    overtime_rate_snapshot: row.overtimeRateSnapshot,
    earned: earning.totalPaise,
    client_id: row.clientId,
  };
}
