import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  addDays,
  attendanceEarning,
  isoDateToUtcDate,
  permissionsForSystemRole,
  todayInIst,
} from '@sitebook/shared';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { BillingService } from '../../modules/billing/billing.service';
import { WagePeriodsService } from '../../modules/wage-periods/wage-periods.service';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE,
  type FanOutJob,
  type LabourRollupJob,
  type WagePeriodDraftJob,
} from '../job-types';
import { TenantRoster } from '../tenant-roster.service';
import { isPeriodEnd, periodStartFor } from '../pay-cycle';
import type { RequestUser } from '../../common/auth/request-user';

/** No user performed this; the audit log stores no actor for a system action. */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

/** Nightly rollups and wage-period drafting (spec §10, reports queue). */
@Processor(QUEUE.reports)
export class ReportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsProcessor.name);

  constructor(
    @InjectQueue(QUEUE.reports) private readonly queue: Queue,
    private readonly tenantDb: TenantDb,
    private readonly roster: TenantRoster,
    private readonly notifications: NotificationsService,
    private readonly wagePeriods: WagePeriodsService,
    private readonly billing: BillingService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'fan-out-labour-rollup':
        return this.fanOut(job.data as FanOutJob, 'labour-rollup');
      case 'fan-out-wage-period-draft':
        return this.fanOut(job.data as FanOutJob, 'wage-period-draft');
      case 'labour-rollup':
        return this.labourRollup(job.data as LabourRollupJob);
      case 'wage-period-draft':
        return this.wagePeriodDraft(job.data as WagePeriodDraftJob);
      case 'drop-lapsed-subscriptions':
        return this.billing.dropLapsedSubscriptions();
      default:
        this.logger.warn({ name: job.name }, 'Unknown reports job');
        return null;
    }
  }

  private async fanOut(data: FanOutJob, jobName: 'labour-rollup' | 'wage-period-draft') {
    // Runs after midnight for the day that just ended, not the one minutes old.
    const date = data.date ?? addDays(todayInIst(), -1);
    const tenantIds = await this.roster.activeTenantIds();

    await this.queue.addBulk(
      tenantIds.map((tenantId) => ({
        name: jobName,
        data: { tenantId, date },
        opts: DEFAULT_JOB_OPTIONS,
      })),
    );

    this.logger.log({ jobName, date, tenants: tenantIds.length }, 'Fanned out');
    return { queued: tenantIds.length, date };
  }

  /**
   * Labour cost per project for one day, written to the audit log.
   *
   * The figures come from the snapshots frozen on each attendance row, so a rollup
   * re-run for an old date reproduces exactly what it produced the first time
   * (ADR 0003). It is recorded rather than cached: this is a number an owner may
   * be asked to justify months later.
   */
  private async labourRollup(data: LabourRollupJob) {
    const on = isoDateToUtcDate(data.date);

    return this.tenantDb.transaction(data.tenantId, async (tx) => {
      const rows = await tx.attendance.findMany({
        where: { attendanceDate: on },
        select: {
          projectId: true,
          status: true,
          overtimeHours: true,
          wageSnapshot: true,
          overtimeRateSnapshot: true,
        },
      });

      if (rows.length === 0) return { skipped: 'no attendance', date: data.date };

      const perProject = new Map<string, { amount: bigint; headcount: number }>();
      for (const row of rows) {
        const earning = attendanceEarning({
          status: row.status,
          overtimeHours: row.overtimeHours.toString(),
          wageSnapshot: row.wageSnapshot,
          overtimeRateSnapshot: row.overtimeRateSnapshot,
        });
        const current = perProject.get(row.projectId) ?? { amount: 0n, headcount: 0 };
        current.amount += earning.totalPaise;
        if (row.status !== 'absent') current.headcount += 1;
        perProject.set(row.projectId, current);
      }

      const summary = [...perProject.entries()].map(([projectId, totals]) => ({
        project_id: projectId,
        amount: totals.amount.toString(),
        headcount: totals.headcount,
      }));

      await tx.auditLog.create({
        data: {
          tenantId: data.tenantId,
          action: 'reports.labour_rollup',
          entity: 'attendance',
          after: { date: data.date, projects: summary },
        },
      });

      const total = summary.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
      this.logger.log(
        { tenantId: data.tenantId, date: data.date, projects: summary.length },
        'Labour rollup written',
      );
      return { date: data.date, projects: summary.length, total: total.toString() };
    });
  }

  /**
   * Drafts a wage period for every contractor whose cycle ended yesterday, then
   * tells accounts. Accounts still reviews and finalises — this only removes the
   * clerical step of remembering which gangs are due.
   */
  private async wagePeriodDraft(data: WagePeriodDraftJob) {
    const db = this.tenantDb.clientFor(data.tenantId);
    const periodEnd = data.date;

    const contractors = await db.contractor.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, paymentTerms: true },
    });

    const due = contractors.filter((contractor) => isPeriodEnd(contractor.paymentTerms, periodEnd));
    if (due.length === 0) return { skipped: 'no contractor cycle ends today', date: periodEnd };

    // The scheduler acts for the tenant rather than as a person: it sees every
    // project, and the audit trail records the action with no human actor.
    const actor: RequestUser = {
      userId: SYSTEM_ACTOR,
      tenantId: data.tenantId,
      role: 'accounts',
      roleName: 'Scheduler',
      // The built-in accounts preset, not every permission: a scheduled draft should be
      // able to do exactly what an accounts user could do by hand, and no more.
      permissions: permissionsForSystemRole('accounts'),
      projectIds: [],
      seesAllProjects: true,
      plan: 'pro',
      enabledModules: ['labour'],
    };

    const drafted: Array<{ contractor: string; lines: number }> = [];
    for (const contractor of due) {
      const periodStart = periodStartFor(contractor.paymentTerms, periodEnd);
      try {
        const period = await this.wagePeriods.generate(
          actor,
          {
            contractor_id: contractor.id,
            period_start: periodStart,
            period_end: periodEnd,
          },
          // Marked so the owner opening a sheet they did not ask for is told it was drafted
          // for them, rather than wondering who else has been in the account.
          'scheduled',
        );
        if (period.lines.length > 0) {
          drafted.push({ contractor: contractor.name, lines: period.lines.length });
        }
      } catch (error) {
        // A period already finalised for this range is the expected case when a
        // human got there first, never a reason to fail the whole tenant.
        this.logger.log(
          { contractor: contractor.name, err: (error as Error).message },
          'Skipped contractor',
        );
      }
    }

    if (drafted.length === 0) return { skipped: 'nothing to draft', date: periodEnd };

    await this.notifications.notify({
      tenantId: data.tenantId,
      roles: ['owner', 'accounts'],
      type: 'wage_period.drafted',
      title: 'Wage sheets ready to review',
      body: drafted.map((entry) => entry.contractor + ' (' + entry.lines + ')').join(', '),
      payload: { date: periodEnd, drafted },
    });

    return { date: periodEnd, drafted };
  }
}