import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  addDays,
  equipmentLitresToHundredths,
  equipmentToTenths,
  INDIA_LOCALE,
  isoDateToUtcDate,
  todayIn,
  utcDateToIsoDate,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import {
  CHECK_RULES,
  doubleBooked,
  duplicateExpenses,
  fuelOutliers,
  headcountGap,
  neverOff,
  unidentifiedPaid,
  unusualExpenses,
  type Finding,
  type FuelDayRow,
} from './leak-rules';

export interface CheckView {
  id: string;
  project_id: string | null;
  project_name: string | null;
  kind: string;
  severity: string;
  title: string;
  details: Prisma.JsonValue;
  status: string;
  note: string | null;
  decided_at: string | null;
  created_at: string;
}

/** How far back the expense medians look, before the window being checked. */
const HISTORY_DAYS = 120;

/**
 * Leakage and fraud checks (roadmap: AI agent 3): run the rules over a company's last month,
 * keep what is new, and let a person confirm or dismiss each finding.
 */
@Injectable()
export class ChecksService {
  private readonly logger = new Logger(ChecksService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  /** The nightly run for one company. Returns how many findings were new. */
  async runTenant(tenantId: string): Promise<{ found: number; added: number }> {
    const findings = await this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const today = todayIn(tenant?.timezone ?? INDIA_LOCALE.timezone);
      const from = addDays(today, -CHECK_RULES.lookbackDays);
      const window = { gte: isoDateToUtcDate(from), lte: isoDateToUtcDate(today) };
      const live = { deletedAt: null };

      const [attendance, reports, expenses, history, payments, fuel, machineLogs] = await Promise.all([
        tx.attendance.findMany({
          where: { attendanceDate: window, project: live },
          select: {
            workerId: true,
            projectId: true,
            attendanceDate: true,
            status: true,
            worker: { select: { name: true } },
            project: { select: { name: true } },
          },
        }),
        tx.dailyReport.findMany({
          where: { reportDate: window, deletedAt: null, status: 'submitted', project: live },
          select: {
            projectId: true,
            reportDate: true,
            project: { select: { name: true } },
            manpower: { select: { count: true } },
          },
        }),
        tx.expense.findMany({
          where: { spentOn: window, deletedAt: null, status: { not: 'rejected' }, project: live },
          select: {
            id: true,
            projectId: true,
            amount: true,
            category: true,
            spentOn: true,
            project: { select: { name: true } },
          },
        }),
        tx.expense.findMany({
          where: {
            spentOn: {
              gte: isoDateToUtcDate(addDays(from, -HISTORY_DAYS)),
              lt: isoDateToUtcDate(from),
            },
            deletedAt: null,
            status: { not: 'rejected' },
          },
          select: { id: true, projectId: true, amount: true, category: true, spentOn: true },
        }),
        tx.labourPayment.findMany({
          where: { paidOn: window, deletedAt: null, workerId: { not: null } },
          distinct: ['workerId'],
          select: {
            projectId: true,
            worker: {
              select: { id: true, name: true, phone: true, idProofS3Key: true, photoS3Key: true },
            },
          },
        }),
        // Equipment: diesel issued and hours worked per machine per day, for the fuel check.
        tx.equipmentFuel.findMany({
          where: { issuedOn: window, project: live },
          select: {
            equipmentId: true,
            projectId: true,
            issuedOn: true,
            litres: true,
            equipment: { select: { code: true, name: true } },
            project: { select: { name: true } },
          },
        }),
        tx.equipmentLog.findMany({
          where: { logDate: window, project: live },
          select: { equipmentId: true, logDate: true, hoursWorked: true },
        }),
      ]);

      const rows = attendance.map((row) => ({
        workerId: row.workerId,
        workerName: row.worker.name,
        projectId: row.projectId,
        projectName: row.project.name,
        date: utcDateToIsoDate(row.attendanceDate),
        status: row.status,
      }));
      const expenseRows = (list: typeof expenses | typeof history) =>
        list.map((row) => ({
          id: row.id,
          projectId: row.projectId,
          projectName: 'project' in row ? row.project.name : '',
          amount: row.amount,
          category: row.category,
          spentOn: utcDateToIsoDate(row.spentOn),
        }));

      const fuelDays = new Map<string, FuelDayRow>();
      for (const entry of fuel) {
        const date = utcDateToIsoDate(entry.issuedOn);
        const key = `${entry.equipmentId}:${date}`;
        const day = fuelDays.get(key) ?? {
          equipmentId: entry.equipmentId,
          projectId: entry.projectId,
          date,
          litresHundredths: 0,
          workedTenths: 0,
          machineLabel: `${entry.equipment.code} ${entry.equipment.name}`,
          projectName: entry.project.name,
        };
        day.litresHundredths += equipmentLitresToHundredths(Number(entry.litres.toString()).toFixed(2));
        fuelDays.set(key, day);
      }
      for (const log of machineLogs) {
        const day = fuelDays.get(`${log.equipmentId}:${utcDateToIsoDate(log.logDate)}`);
        if (day) day.workedTenths += equipmentToTenths(Number(log.hoursWorked.toString()).toFixed(1));
      }

      return [
        ...doubleBooked(rows),
        ...fuelOutliers([...fuelDays.values()]),
        ...neverOff(rows, today),
        ...headcountGap(
          rows,
          reports.map((report) => ({
            projectId: report.projectId,
            projectName: report.project.name,
            date: utcDateToIsoDate(report.reportDate),
            reported: report.manpower.reduce((sum, line) => sum + line.count, 0),
          })),
        ),
        ...duplicateExpenses(expenseRows(expenses)),
        ...unusualExpenses(expenseRows(expenses), expenseRows(history)),
        ...unidentifiedPaid(
          payments
            .filter((payment) => payment.worker)
            .map((payment) => ({
              workerId: payment.worker!.id,
              workerName: payment.worker!.name,
              projectId: payment.projectId,
              hasPhone: Boolean(payment.worker!.phone),
              hasIdProof: Boolean(payment.worker!.idProofS3Key),
              hasPhoto: Boolean(payment.worker!.photoS3Key),
            })),
        ),
      ];
    });

    const added = await this.keepNew(tenantId, findings);
    this.logger.log({ tenantId, found: findings.length, added }, 'Leak checks run');
    return { found: findings.length, added };
  }

  /** Open findings (or decided ones, for the history) on the sites this person can see. */
  async list(actor: RequestUser, status: 'open' | 'decided'): Promise<CheckView[]> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const scope = actor.seesAllProjects
      ? {}
      : { OR: [{ projectId: { in: actor.projectIds } }, { projectId: null }] };
    const rows = await db.siteCheck.findMany({
      where: { ...scope, status: status === 'open' ? 'open' : { in: ['confirmed', 'dismissed'] } },
      orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      take: 200,
      include: { project: { select: { name: true } } },
    });
    return rows.map(toView);
  }

  /** Confirm or dismiss. Either way it leaves the open list and is never raised again. */
  async decide(
    actor: RequestUser,
    id: string,
    input: { decision: 'confirmed' | 'dismissed'; note?: string },
  ): Promise<CheckView> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const check = await db.siteCheck.findUnique({
      where: { id },
      select: { projectId: true, status: true },
    });
    if (!check) throw ApiError.notFound('Check');
    if (check.projectId) await this.access.assertAccess(actor, check.projectId);
    if (check.status !== 'open') throw ApiError.conflict('This check has already been decided');

    const updated = await db.siteCheck.update({
      where: { id },
      data: {
        status: input.decision,
        note: input.note ?? null,
        decidedBy: actor.userId,
        decidedAt: new Date(),
      },
      include: { project: { select: { name: true } } },
    });
    return toView(updated);
  }

  /** Inserts what is new; leaves alone anything already raised, open or decided. */
  private async keepNew(tenantId: string, findings: Finding[]): Promise<number> {
    if (findings.length === 0) return 0;
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const result = await tx.siteCheck.createMany({
        data: findings.map((finding) => ({
          tenantId,
          projectId: finding.projectId,
          kind: finding.kind,
          subjectKey: finding.subjectKey,
          severity: finding.severity,
          title: finding.title,
          details: finding.details as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
      return result.count;
    });
  }
}

function toView(row: {
  id: string;
  projectId: string | null;
  project: { name: string } | null;
  kind: string;
  severity: string;
  title: string;
  details: Prisma.JsonValue;
  status: string;
  note: string | null;
  decidedAt: Date | null;
  createdAt: Date;
}): CheckView {
  return {
    id: row.id,
    project_id: row.projectId,
    project_name: row.project?.name ?? null,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    details: row.details,
    status: row.status,
    note: row.note,
    decided_at: row.decidedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}
