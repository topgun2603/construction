import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { utcDateToIsoDate } from '@sitebook/shared';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { WhatsappService, TEMPLATES } from '../../integrations/whatsapp.service';
import {
  QUEUE,
  type DprSubmittedJob,
  type IndentStatusJob,
  type SiteMessagePostedJob,
} from '../job-types';

/** Push and in-app notifications for events (spec §10, notifications queue). */
@Processor(QUEUE.notifications)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsappService,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'indent-status':
        return this.indentStatus(job.data as IndentStatusJob);
      case 'dpr-submitted':
        return this.dprSubmitted(job.data as DprSubmittedJob);
      case 'site-message':
        return this.siteMessage(job.data as SiteMessagePostedJob);
      default:
        this.logger.warn({ name: job.name }, 'Unknown notifications job');
        return null;
    }
  }

  private async indentStatus(data: IndentStatusJob) {
    const indent = await this.tenantDb.clientFor(data.tenantId).materialIndent.findFirst({
      where: { id: data.indentId },
      select: {
        id: true,
        status: true,
        projectId: true,
        requestedBy: true,
        project: { select: { name: true } },
        items: { select: { quantity: true, material: { select: { name: true, unit: true } } } },
        requester: { select: { id: true, phone: true } },
      },
    });
    if (!indent) return { skipped: 'indent gone' };

    const summary = indent.items
      .map((item) => `${item.material.name} ${String(item.quantity)} ${item.material.unit}`)
      .join(', ');

    // The person who raised it always hears; the site's team hears the outcome.
    const result = await this.notifications.notify({
      tenantId: data.tenantId,
      userIds: [indent.requestedBy],
      roles: ['owner', 'project_manager'],
      projectId: indent.projectId,
      exceptUserId: data.actorId,
      type: `indent.${data.status}`,
      title: `Indent ${data.status}`,
      body: `${indent.project.name}: ${summary}`,
      payload: { indent_id: indent.id, project_id: indent.projectId, status: data.status },
    });

    // The supervisor who raised it is the one waiting on site, so they also get a
    // WhatsApp — they may not have the app open when the lorry needs ordering.
    if (indent.requester.phone && indent.requestedBy !== data.actorId) {
      await this.whatsapp.send({
        to: indent.requester.phone,
        template: TEMPLATES.indentStatus,
        params: [indent.project.name, data.status],
      });
    }

    return result;
  }

  /**
   * Somebody said something on a site.
   *
   * Who hears depends on who spoke. A client's question goes to the people who can answer it; the
   * team's reply goes to the client. A team-only note goes to the team and, by construction, can
   * never reach the client — the audience is checked here rather than trusted from the caller,
   * because a private note delivered to a client is the one failure this feature must not have.
   */
  private async siteMessage(data: SiteMessagePostedJob) {
    const db = this.tenantDb.clientFor(data.tenantId);
    const message = await db.siteMessage.findFirst({
      where: { id: data.messageId, deletedAt: null },
      select: {
        id: true,
        body: true,
        audience: true,
        projectId: true,
        author: { select: { id: true, name: true, role: true } },
        recipientId: true,
        project: { select: { name: true } },
        attachments: { select: { id: true } },
      },
    });
    if (!message) return { skipped: 'message gone' };

    const preview = message.body.trim().length > 0
      ? message.body.trim().slice(0, 140)
      : `${message.attachments.length} ${message.attachments.length === 1 ? 'file' : 'files'}`;

    /*
     * A direct message is told to one person, by id.
     *
     * Not by role and not by project membership: those are how a broadcast finds an audience, and
     * reusing either here would push somebody's private question to everybody who shares the
     * sender's role — which is the notification telling the whole team what the message itself was
     * careful not to.
     */
    if (message.audience === 'direct') {
      if (!message.recipientId) return { skipped: 'direct message with nobody to tell' };
      return this.notifications.notify({
        tenantId: data.tenantId,
        userIds: [message.recipientId],
        projectId: message.projectId,
        exceptUserId: message.author.id,
        type: 'message.direct',
        title: `${message.author.name} messaged you`,
        body: `${message.project.name}: ${preview}`,
        payload: {
          project_id: message.projectId,
          message_id: message.id,
          audience: 'direct',
        },
      });
    }

    if (message.audience === 'team') {
      return this.notifications.notify({
        tenantId: data.tenantId,
        roles: ['owner', 'project_manager', 'site_supervisor', 'accounts'],
        projectId: message.projectId,
        exceptUserId: message.author.id,
        type: 'message.team',
        title: `Team note on ${message.project.name}`,
        body: `${message.author.name}: ${preview}`,
        payload: { project_id: message.projectId, message_id: message.id, audience: 'team' },
      });
    }

    // A client wrote: the people who can act on it hear. The team wrote: everyone on the site does,
    // which includes the client.
    const fromClient = message.author.role === 'client';
    return this.notifications.notify({
      tenantId: data.tenantId,
      roles: fromClient
        ? ['owner', 'project_manager', 'site_supervisor']
        : ['owner', 'project_manager', 'site_supervisor', 'client'],
      projectId: message.projectId,
      exceptUserId: message.author.id,
      type: 'message.posted',
      title: fromClient
        ? `${message.author.name} asked about ${message.project.name}`
        : `New message on ${message.project.name}`,
      body: fromClient ? preview : `${message.author.name}: ${preview}`,
      payload: { project_id: message.projectId, message_id: message.id, audience: 'everyone' },
    });
  }

  private async dprSubmitted(data: DprSubmittedJob) {
    const report = await this.tenantDb.clientFor(data.tenantId).dailyReport.findFirst({
      where: { id: data.dailyReportId },
      select: {
        id: true,
        projectId: true,
        reportDate: true,
        issues: true,
        submittedBy: true,
        project: { select: { name: true } },
        manpower: { select: { count: true } },
      },
    });
    if (!report) return { skipped: 'report gone' };

    const headcount = report.manpower.reduce((sum, entry) => sum + entry.count, 0);
    const hasIssues = Boolean(report.issues && report.issues.trim().length > 0);

    return this.notifications.notify({
      tenantId: data.tenantId,
      roles: ['owner', 'project_manager'],
      projectId: report.projectId,
      exceptUserId: report.submittedBy,
      type: 'dpr.submitted',
      title: hasIssues ? `Report filed with issues: ${report.project.name}` : `Report filed: ${report.project.name}`,
      body: `${utcDateToIsoDate(report.reportDate)} - ${headcount} on site${hasIssues ? ' - issues flagged' : ''}`,
      payload: {
        daily_report_id: report.id,
        project_id: report.projectId,
        has_issues: hasIssues,
      },
    });
  }
}
