import { Injectable, Logger } from '@nestjs/common';
import {
  INDIA_LOCALE,
  addDays,
  isoDateToUtcDate,
  rfiLabel,
  submittalLabel,
  todayIn,
  utcDateToIsoDate,
} from '@sitebook/shared';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { rfiSettingsFor } from './rfi-common';

interface Reminder {
  projectId: string;
  projectName: string;
  userIds: string[];
  line: string;
  overdue: boolean;
  kind: 'rfi' | 'submittal';
}

/**
 * "Due soon" and "overdue" reminders for RFIs and submittals, once a day on each company's own clock
 * (the reports queue's per-company tick, like worker-document expiry and cube tests).
 *
 * Each reminder is claimed on the row before anything is sent — `due_soon_reminded_at` and
 * `overdue_reminded_at` — so a retried job cannot send it twice, and moving the due date clears both
 * so the new deadline is reminded afresh. The people told are the ones who chase the answer: whoever
 * raised or submitted it, the assignee, and the site's project managers. The designer is chased by
 * them, from their own phone; this product does not email people who never signed up for it.
 */
@Injectable()
export class RfiRemindersService {
  private readonly logger = new Logger(RfiRemindersService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly notifications: NotificationsService,
  ) {}

  async remindTenant(tenantId: string): Promise<{ reminded: number }> {
    const reminders = await this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
      const today = todayIn(tenant?.timezone ?? INDIA_LOCALE.timezone);
      const settings = await rfiSettingsFor(tx);
      const todayDate = isoDateToUtcDate(today);
      const soonDate = isoDateToUtcDate(addDays(today, settings.reminder_days_before));
      const now = new Date();
      const out: Reminder[] = [];

      const managers = new Map<string, string[]>();
      const managersOf = async (projectId: string) => {
        if (!managers.has(projectId)) {
          const users = await tx.user.findMany({
            where: {
              status: 'active',
              deletedAt: null,
              role: 'project_manager',
              projectMemberships: { some: { projectId } },
            },
            select: { id: true },
          });
          managers.set(projectId, users.map((user) => user.id));
        }
        return managers.get(projectId)!;
      };

      // --- RFIs waiting on an answer
      const rfiSelect = {
        id: true,
        number: true,
        subject: true,
        projectId: true,
        dueOn: true,
        raisedBy: true,
        assigneeId: true,
        addressedToName: true,
        addressedToCompany: true,
        project: { select: { name: true } },
      } as const;
      const overdueRfis = await tx.rfi.findMany({
        where: { status: 'open', dueOn: { lt: todayDate }, overdueRemindedAt: null, project: { deletedAt: null } },
        select: rfiSelect,
      });
      const soonRfis = await tx.rfi.findMany({
        where: {
          status: 'open',
          dueOn: { gte: todayDate, lte: soonDate },
          dueSoonRemindedAt: null,
          overdueRemindedAt: null,
          project: { deletedAt: null },
        },
        select: rfiSelect,
      });
      if (overdueRfis.length > 0) {
        await tx.rfi.updateMany({ where: { id: { in: overdueRfis.map((row) => row.id) } }, data: { overdueRemindedAt: now } });
      }
      if (soonRfis.length > 0) {
        await tx.rfi.updateMany({ where: { id: { in: soonRfis.map((row) => row.id) } }, data: { dueSoonRemindedAt: now } });
      }
      for (const [rows, overdue] of [
        [overdueRfis, true],
        [soonRfis, false],
      ] as const) {
        for (const row of rows) {
          const party = row.addressedToCompany ?? row.addressedToName;
          out.push({
            kind: 'rfi',
            overdue,
            projectId: row.projectId,
            projectName: row.project.name,
            userIds: [row.raisedBy, ...(row.assigneeId ? [row.assigneeId] : []), ...(await managersOf(row.projectId))],
            line: `${rfiLabel(row.number)} ${row.subject}${party ? ` (${party})` : ''} · due ${utcDateToIsoDate(row.dueOn!)}`,
          });
        }
      }

      // --- submittal revisions waiting on a review
      const revisionSelect = {
        id: true,
        revision: true,
        dueOn: true,
        submittedBy: true,
        submittal: {
          select: {
            number: true,
            title: true,
            projectId: true,
            createdBy: true,
            currentRevision: true,
            reviewerCompany: true,
            reviewerName: true,
            project: { select: { name: true } },
          },
        },
      } as const;
      const live = { status: { in: ['submitted' as const, 'under_review' as const] }, submittal: { project: { deletedAt: null } } };
      const overdueRevisions = await tx.submittalRevision.findMany({
        where: { ...live, dueOn: { lt: todayDate }, overdueRemindedAt: null },
        select: revisionSelect,
      });
      const soonRevisions = await tx.submittalRevision.findMany({
        where: { ...live, dueOn: { gte: todayDate, lte: soonDate }, dueSoonRemindedAt: null, overdueRemindedAt: null },
        select: revisionSelect,
      });
      if (overdueRevisions.length > 0) {
        await tx.submittalRevision.updateMany({
          where: { id: { in: overdueRevisions.map((row) => row.id) } },
          data: { overdueRemindedAt: now },
        });
      }
      if (soonRevisions.length > 0) {
        await tx.submittalRevision.updateMany({
          where: { id: { in: soonRevisions.map((row) => row.id) } },
          data: { dueSoonRemindedAt: now },
        });
      }
      for (const [rows, overdue] of [
        [overdueRevisions, true],
        [soonRevisions, false],
      ] as const) {
        for (const row of rows) {
          const party = row.submittal.reviewerCompany ?? row.submittal.reviewerName;
          out.push({
            kind: 'submittal',
            overdue,
            projectId: row.submittal.projectId,
            projectName: row.submittal.project.name,
            userIds: [
              row.submittal.createdBy,
              ...(row.submittedBy ? [row.submittedBy] : []),
              ...(await managersOf(row.submittal.projectId)),
            ],
            line: `${submittalLabel(row.submittal.number, row.revision)} ${row.submittal.title}${party ? ` (${party})` : ''} · due ${utcDateToIsoDate(row.dueOn!)}`,
          });
        }
      }
      return out;
    });
    if (reminders.length === 0) return { reminded: 0 };

    // One notification per site, kind and urgency — a list, not a burst of pushes.
    const groups = new Map<string, Reminder[]>();
    for (const reminder of reminders) {
      const key = `${reminder.projectId}:${reminder.kind}:${reminder.overdue}`;
      groups.set(key, [...(groups.get(key) ?? []), reminder]);
    }
    for (const rows of groups.values()) {
      const first = rows[0]!;
      const noun = first.kind === 'rfi' ? (rows.length === 1 ? 'RFI' : 'RFIs') : rows.length === 1 ? 'submittal' : 'submittals';
      const title = first.overdue
        ? `${rows.length} ${noun} overdue at ${first.projectName}`
        : `${rows.length} ${noun} due soon at ${first.projectName}`;
      try {
        await this.notifications.notify({
          tenantId,
          userIds: [...new Set(rows.flatMap((row) => row.userIds))],
          projectId: first.projectId,
          type: `${first.kind}.${first.overdue ? 'overdue' : 'due_soon'}`,
          title,
          body: rows.slice(0, 5).map((row) => row.line).join('\n') + (rows.length > 5 ? `\n…and ${rows.length - 5} more` : ''),
          payload: { title, project_name: first.projectName, project_id: first.projectId },
        });
      } catch (error) {
        this.logger.warn({ err: error, tenantId }, 'RFI reminder failed');
      }
    }
    this.logger.log({ tenantId, reminded: reminders.length }, 'RFI and submittal reminders sent');
    return { reminded: reminders.length };
  }
}
