import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import {
  SAFETY_INCIDENT_TYPE_LABELS,
  addDays,
  formatMoneyCompact,
  isoDateToUtcDate,
  safetyInstantToLocal,
  safetyNumber,
  siteTimeToday,
  todayIn,
  utcDateToIsoDate,
  type SafetyIncidentType,
} from '@sitebook/shared';
import { env } from '../../config/env';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { TEMPLATES, WhatsappService, type TemplateMessage } from '../../integrations/whatsapp.service';
import {
  DEFAULT_JOB_OPTIONS,
  QUEUE,
  type DailySummaryJob,
  type DprReminderJob,
  type FanOutJob,
  type SafetyIncidentReportedJob,
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
      case 'safety-incident':
        return this.safetyIncident(job.data as SafetyIncidentReportedJob);
      default:
        this.logger.warn({ name: job.name }, 'Unknown whatsapp job');
        return null;
    }
  }

  /**
   * Runs every 15 minutes and queues the job for each company whose own clock just reached the
   * configured time (tenant-clock.ts). The job id is per company and local day, so a retried or
   * overlapping tick cannot send the same summary twice.
   *
   * A run carrying `date` is a manual re-run for that day, and goes to every company as before.
   */
  private async fanOut(data: FanOutJob, jobName: 'daily-summary' | 'dpr-reminder') {
    if (data.date) {
      const tenantIds = await this.roster.activeTenantIds();
      await this.queue.addBulk(
        tenantIds.map((tenantId) => ({
          name: jobName,
          data: { tenantId, date: data.date },
          opts: DEFAULT_JOB_OPTIONS,
        })),
      );
      this.logger.log({ jobName, date: data.date, tenants: tenantIds.length }, 'Fanned out');
      return { queued: tenantIds.length, date: data.date };
    }

    const config = env();
    const cron =
      jobName === 'daily-summary' ? config.WHATSAPP_SUMMARY_CRON : config.WHATSAPP_DPR_REMINDER_CRON;
    const due = await this.roster.dueTenants(cron);
    if (due.length === 0) return { queued: 0 };

    await this.queue.addBulk(
      due.map((tenant) => ({
        name: jobName,
        data: { tenantId: tenant.id, date: tenant.localDate },
        opts: { ...DEFAULT_JOB_OPTIONS, jobId: `${jobName}:${tenant.id}:${tenant.localDate}` },
      })),
    );

    this.logger.log({ jobName, tenants: due.length }, 'Fanned out on company clocks');
    return { queued: due.length };
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
    const tenant = await db.tenant.findUnique({
      where: { id: data.tenantId },
      select: { timezone: true },
    });

    const projects = await db.project.findMany({
      where: { deletedAt: null, status: 'active' },
      select: {
        id: true,
        name: true,
        timeZone: true,
        members: {
          where: { roleOnProject: 'site_supervisor' },
          select: { user: { select: { phone: true, status: true } } },
        },
      },
    });

    /*
     * The reminder fires on the company's clock, but the report it chases is for each site's own
     * today (a separate time zone per site) — a site already past midnight is on the next day's
     * report. The job's date is the company's; each site's is that date moved by however many
     * days the site's clock is ahead or behind right now, so a retried job still chases the day it
     * was queued for. Without a company zone to hand, the job's own date stands for every site.
     */
    const companyNow = tenant ? isoDateToUtcDate(todayIn(tenant.timezone)).getTime() : 0;
    const siteDay = new Map(
      projects.map((project) => {
        if (!tenant) return [project.id, data.date] as const;
        const ahead = Math.round(
          (isoDateToUtcDate(siteTimeToday(project, tenant)).getTime() - companyNow) / 86_400_000,
        );
        return [project.id, addDays(data.date, ahead)] as const;
      }),
    );
    const reported = new Set(
      (
        await db.dailyReport.findMany({
          where: {
            reportDate: { in: [...new Set(siteDay.values())].map((day) => isoDateToUtcDate(day)) },
            deletedAt: null,
            status: 'submitted',
          },
          select: { projectId: true, reportDate: true },
        })
      )
        .filter((row) => utcDateToIsoDate(row.reportDate) === siteDay.get(row.projectId))
        .map((row) => row.projectId),
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

  /**
   * A lost-time injury or a fatality, to every owner's phone. The in-app notification and push went
   * out with the report itself; this is the channel an owner on a plane or at a wedding still reads.
   */
  private async safetyIncident(data: SafetyIncidentReportedJob) {
    const db = this.tenantDb.clientFor(data.tenantId);
    const [tenant, owners, incident] = await Promise.all([
      db.tenant.findUnique({ where: { id: data.tenantId }, select: { name: true, timezone: true } }),
      db.user.findMany({
        where: { role: 'owner', status: 'active', deletedAt: null },
        select: { phone: true },
      }),
      db.safetyIncident.findFirst({
        where: { id: data.incidentId },
        select: {
          number: true,
          type: true,
          title: true,
          occurredAt: true,
          project: { select: { name: true } },
        },
      }),
    ]);
    if (!tenant || !incident) return { skipped: 'incident gone' };

    // Template safety_incident_alert: {builder} {type} {site} {number and title} {when}
    const params = [
      tenant.name,
      SAFETY_INCIDENT_TYPE_LABELS[incident.type as SafetyIncidentType],
      incident.project.name,
      `${safetyNumber('INC', incident.number)} ${incident.title}`,
      safetyInstantToLocal(incident.occurredAt, tenant.timezone).replace('T', ' '),
    ];
    return this.whatsapp.sendMany(
      owners
        .filter((owner) => Boolean(owner.phone))
        .map((owner) => ({ to: owner.phone, template: TEMPLATES.safetyIncidentAlert, params })),
    );
  }

  /** Contractor gets the totals the moment accounts freeze their period. */
  private async wagePeriodFinalised(data: WagePeriodFinalisedJob) {
    const db = this.tenantDb.clientFor(data.tenantId);

    const [tenant, period] = await Promise.all([
      db.tenant.findUnique({
        where: { id: data.tenantId },
        select: { currency: true, locale: true },
      }),
      db.wagePeriod.findUnique({
        where: { id: data.wagePeriodId },
        select: {
          periodStart: true,
          periodEnd: true,
          contractor: { select: { name: true, phone: true } },
          lines: { select: { netPayable: true } },
        },
      }),
    ]);
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
        // In the company's currency: a Dubai contractor is paid in dirhams.
        formatMoneyCompact(net, tenant ?? undefined),
      ],
    });
  }
}
