import { Injectable, Logger } from '@nestjs/common';
import {
  changeOrderScopeCreepMatch,
  type ListChangeOrderSuggestionsQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ScopeCreepReader } from '../ai/scope-creep-reader.service';
import { NotificationsService } from '../notifications/notifications.service';
import { managersOf } from './change-order-records';

type SourceKind = 'daily_report' | 'site_message';

/**
 * The scope-creep catcher (roadmap: "change orders through the scope-creep catcher").
 *
 * Extra work is usually agreed on site in a sentence — "client asked for one more window", "kitchen
 * wall shifted as the owner wanted" — written into the day's report or the site conversation and
 * never priced. This reads each submitted report and each message as it arrives, and when one reads
 * like extra work, puts a suggestion in front of the managers: "Looks like extra work — raise a
 * change order?". One click turns it into a draft change order carrying the report's photos.
 *
 * Keyword rules decide (`changeOrderScopeCreepMatch`), so it works with no AI key. With a key, the
 * model is asked only about what the rules flagged, and may veto a false alarm or name the work.
 *
 * Called from the report and message services after their own write has committed, and it never
 * throws back at them: a missed suggestion is a shame, a daily report that failed to file is not
 * acceptable.
 */
@Injectable()
export class ScopeCreepService {
  private readonly logger = new Logger(ScopeCreepService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly reader: ScopeCreepReader,
    private readonly notifications: NotificationsService,
  ) {}

  async fromDailyReport(actor: RequestUser, reportId: string): Promise<void> {
    try {
      const report = await this.tenantDb.clientFor(actor.tenantId).dailyReport.findFirst({
        where: { id: reportId, deletedAt: null, status: 'submitted' },
        select: { projectId: true, workDone: true, issues: true, activities: { select: { activity: true } } },
      });
      if (!report) return;
      const text = [report.workDone, report.issues, ...report.activities.map((row) => row.activity)]
        .filter(Boolean)
        .join('\n');
      await this.consider(actor, report.projectId, 'daily_report', reportId, text, false);
    } catch (error) {
      this.logger.warn({ err: error, reportId }, 'Scope-creep check on a daily report failed');
    }
  }

  async fromSiteMessage(actor: RequestUser, messageId: string): Promise<void> {
    try {
      const message = await this.tenantDb.clientFor(actor.tenantId).siteMessage.findFirst({
        where: { id: messageId },
        select: { projectId: true, body: true, author: { select: { role: true } } },
      });
      if (!message) return;
      await this.consider(actor, message.projectId, 'site_message', messageId, message.body, message.author.role === 'client');
    } catch (error) {
      this.logger.warn({ err: error, messageId }, 'Scope-creep check on a message failed');
    }
  }

  private async consider(
    actor: RequestUser,
    projectId: string,
    kind: SourceKind,
    sourceId: string,
    text: string,
    fromClient: boolean,
  ): Promise<void> {
    const hit = changeOrderScopeCreepMatch(text, { fromClient });
    if (!hit) return;
    const verdict = await this.reader.judge(actor.tenantId, hit.excerpt, text);
    if (verdict.extraWork === 'no') return;

    const notice = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      // One suggestion per report or message: a report re-submitted after an edit does not nag twice.
      const existing = await tx.changeOrderSuggestion.findUnique({
        where: { sourceKind_sourceId: { sourceKind: kind, sourceId } },
        select: { id: true },
      });
      if (existing) return null;
      const made = await tx.changeOrderSuggestion.create({
        data: {
          tenantId: actor.tenantId,
          projectId,
          sourceKind: kind,
          sourceId,
          excerpt: hit.excerpt,
          matched: hit.matched,
          detectedBy: verdict.extraWork === 'yes' ? 'ai' : 'rules',
          summary: verdict.summary,
        },
        select: { id: true, project: { select: { name: true } } },
      });
      return { id: made.id, projectName: made.project.name, recipients: await managersOf(tx, projectId) };
    });
    if (!notice) return;

    const recipients = notice.recipients.filter((id) => id !== actor.userId);
    if (recipients.length === 0) return;
    const title = 'Looks like extra work — raise a change order?';
    await this.notifications
      .notify({
        tenantId: actor.tenantId,
        userIds: recipients,
        projectId,
        type: 'change_order_suggestion',
        title,
        body: `“${verdict.summary ?? hit.excerpt}” · ${notice.projectName}`,
        payload: {
          title,
          project_name: notice.projectName,
          project_id: projectId,
          suggestion_id: notice.id,
          excerpt: hit.excerpt,
        },
      })
      .catch((error: unknown) => this.logger.warn({ err: error }, 'Scope-creep notice failed'));
  }

  // --- the managers' list ------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListChangeOrderSuggestionsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.changeOrderSuggestion.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          status: query.status ?? 'open',
          project: { deletedAt: null },
        },
        include: { project: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      // Where each came from, so the list can say "in Tuesday's report" and link to it.
      const reportIds = rows.filter((row) => row.sourceKind === 'daily_report').map((row) => row.sourceId);
      const messageIds = rows.filter((row) => row.sourceKind === 'site_message').map((row) => row.sourceId);
      const [reports, messages] = await Promise.all([
        reportIds.length
          ? tx.dailyReport.findMany({
              where: { id: { in: reportIds } },
              select: { id: true, reportDate: true, submitter: { select: { name: true } } },
            })
          : [],
        messageIds.length
          ? tx.siteMessage.findMany({
              where: { id: { in: messageIds } },
              select: { id: true, createdAt: true, author: { select: { name: true } } },
            })
          : [],
      ]);
      const sources = new Map<string, { date: string; author: string | null }>();
      for (const report of reports) {
        sources.set(report.id, {
          date: report.reportDate.toISOString().slice(0, 10),
          author: report.submitter?.name ?? null,
        });
      }
      for (const message of messages) {
        sources.set(message.id, { date: message.createdAt.toISOString(), author: message.author?.name ?? null });
      }
      return {
        items: rows.map((row) => ({
          id: row.id,
          project: row.project,
          source_kind: row.sourceKind,
          source_id: row.sourceId,
          source_date: sources.get(row.sourceId)?.date ?? null,
          source_author: sources.get(row.sourceId)?.author ?? null,
          excerpt: row.excerpt,
          summary: row.summary,
          matched: row.matched,
          detected_by: row.detectedBy,
          status: row.status,
          change_order_id: row.changeOrderId,
          created_at: row.createdAt.toISOString(),
        })),
      };
    });
  }

  /** Not extra work after all. Kept, dismissed, so the same sentence is never suggested again. */
  async dismiss(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await tx.changeOrderSuggestion.findUnique({ where: { id }, select: { projectId: true, status: true } });
      if (!row) throw ApiError.notFound('Suggestion');
      if (!actor.seesAllProjects && !actor.projectIds.includes(row.projectId)) {
        throw ApiError.projectNotAssigned(row.projectId);
      }
      if (row.status !== 'open') throw ApiError.conflict(`That suggestion was already ${row.status}`);
      await tx.changeOrderSuggestion.update({
        where: { id },
        data: { status: 'dismissed', decidedBy: actor.userId, decidedAt: new Date() },
      });
    });
  }
}
