import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { formatInrCompact, isoDateToUtcDate, todayInIst, utcDateToIsoDate } from '@sitebook/shared';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TEMPLATES, WhatsappService, type TemplateMessage } from '../../integrations/whatsapp.service';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE,
  type DailySummaryJob,
  type DprReminderJob,
  type FanOutJob,
  type WagePeriodFinalisedJob,
} from '../job-types';
import { TenantRoster } from '../tenant-roster.service';

/**
 * WhatsApp queue (spec §10).
 *
 * The cron entries fan out rather than doing the work inline: one job per tenant
 * means a slow send for one builder cannot delay every other builder's summary,
 * and a failure retries just that tenant.
 */
@Processor(QUEUE.whatsapp)
export class WhatsappProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappProcessor.name);

  constructor(
    @InjectQueue(QUEUE.whatsapp) private readonly queue: Queue,
    private readonly tenantDb: TenantDb,
    private readonly roster: TenantRoster,
    private readonly whatsapp: WhatsappService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'fan-out-daily-summary':
        return this.fanOut(job.data as FanOutJob, 'daily-summary');
      case 'fan-out-dpr-reminder':
        return this.fanOut(job.data as FanOutJob, 'dpr-reminder');
      case 'daily-summary':
        return this.dailySummary(job.data as DailySummaryJob);
      case 'dpr-reminder':
        return this.dprReminder(job.data as DprReminderJob);
      case 'wage-period-finalised':
        return this.wagePeriodFinalised(job.data as WagePeriodFinalisedJob);
      default:
        this.logger.warn({ name: job.name }, 'Unknown whatsapp job');
        return null;
    }
  }

  private async fanOut(data: FanOutJob, jobName: 'daily-summary' | 'dpr-reminder') {
    const date = data.date ?? todayInIst();
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
   * The owner's 7pm summary: what came in today, who was on site, what it cost.
   * This is the message the product is judged by, so it goes out even when no site
   * reported — "nothing came in" is exactly what an owner needs to know at 7pm.
   */
  private async dailySummary(data: DailySummaryJob) {
    const db = this.tenantDb.clientFor(data.tenantId);
    const on = isoDateToUtcDate(data.date);

    const [tenant, owners, projects, reports, attendance] = await Promise.all([
      db.tenant.findUnique({ where: { id: data.tenantId }, select: { name: true } }),
      db.user.findMany({
        where: { role: 'owner', status: 'active', deletedAt: null },
        select: { phone: true },
      }),
      db.project.findMany({
        where: { deletedAt: null, status: 'active' },
        select: { id: true },
      }),
      db.dailyReport.findMany({
        where: { reportDate: on, deletedAt: null, status: 'submitted' },
        select: { projectId: true, issues: true, photos: { select: { id: true } } },
      }),
      db.attendance.findMany({
        where: { attendanceDate: on, status: { not: 'absent' } },
        select: { id: true },
      }),
    ]);

    if (!tenant || owners.length === 0 || projects.length === 0) {
      return { skipped: 'no owner or no active sites' };
    }

    const issues = reports.filter((r) => r.issues && r.issues.trim().length > 0).length;
    const photos = reports.reduce((sum, r) => sum + r.photos.length, 0);

    // Template daily_site_summary:
    // {builder} {date} {site_count} {sites_reported} {total_headcount} {issues_count}
    const params = [
      tenant.name,
      data.date,
      String(projects.length),
      String(reports.length),
      String(attendance.length),
      String(issues),
    ];

    const result = await this.whatsapp.sendMany(
      owners
        .filter((owner) => Boolean(owner.phone))
        .map((owner) => ({
          to: owner.phone,
          template: TEMPLATES.dailySiteSummary,
          params,
        })),
    );

    this.logger.log(
      { tenantId: data.tenantId, date: data.date, ...result, photos },
      'Daily summary sent',
    );
    return { ...result, sites: projects.length, reported: reports.length, issues, photos };
  }

  /** 5:30pm nudge to supervisors whose site has no report yet. */
  private async dprReminder(data: DprReminderJob) {
    const db = this.tenantDb.clientFor(data.tenantId);
    const on = isoDateToUtcDate(data.date);

    const projects = await db.project.findMany({
      where: { deletedAt: null, status: 'active' },
      select: {
        id: true,
        name: true,
        members: {
          where: { roleOnProject: 'site_supervisor' },
          select: { user: { select: { phone: true, status: true } } },
        },
      },
    });

    const reported = new Set(
      (
        await db.dailyReport.findMany({
          where: { reportDate: on, deletedAt: null, status: 'submitted' },
          select: { projectId: true },
        })
      ).map((row) => row.projectId),
    );

    const messages: TemplateMessage[] = [];
    for (const project of projects) {
      if (reported.has(project.id)) continue;
      for (const member of project.members) {
        if (member.user.status !== 'active' || !member.user.phone) continue;
        messages.push({
          to: member.user.phone,
          template: TEMPLATES.dprReminder,
          params: [project.name],
        });
      }
    }

    if (messages.length === 0) return { skipped: 'every site reported' };

    const result = await this.whatsapp.sendMany(messages);
    this.logger.log({ tenantId: data.tenantId, nudged: messages.length }, 'DPR reminders sent');
    return { ...result, nudged: messages.length };
  }

  /** Contractor gets the totals the moment accounts freeze their period. */
  private async wagePeriodFinalised(data: WagePeriodFinalisedJob) {
    const db = this.tenantDb.clientFor(data.tenantId);

    const period = await db.wagePeriod.findUnique({
      where: { id: data.wagePeriodId },
      select: {
        periodStart: true,
        periodEnd: true,
        contractor: { select: { name: true, phone: true } },
        lines: { select: { netPayable: true } },
      },
    });
    if (!period?.contractor?.phone) return { skipped: 'direct labour or no phone' };

    const net = period.lines.reduce((sum, line) => sum + line.netPayable, 0n);

    // Template wage_sheet_summary: {contractor} {from} {to} {workers} {net}
    return this.whatsapp.send({
      to: period.contractor.phone,
      template: TEMPLATES.wageSheetSummary,
      params: [
        period.contractor.name,
        utcDateToIsoDate(period.periodStart),
        utcDateToIsoDate(period.periodEnd),
        String(period.lines.length),
        formatInrCompact(net),
      ],
    });
  }
}
