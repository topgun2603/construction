import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RFI_DISCIPLINE_LABELS,
  RFI_PRIORITY_LABELS,
  RFI_STATUS_LABELS,
  changeOrderLabel,
  isoDateToUtcDate,
  rfiAverageDays,
  rfiCanMove,
  rfiDueDate,
  rfiIsOverdue,
  rfiLabel,
  rfiLinkMessage,
  taxRule,
  utcDateToIsoDate,
  type CreateRfiParsed,
  type ListRfisQuery,
  type RfiAttachmentsInput,
  type RfiDraftAiInput,
  type RfiNoteInput,
  type RfiResponseInput,
  type RfiSettingsInput,
  type RfiStatus,
  type RfiVoidInput,
  type UpdateRfiInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TokenService } from '../../common/auth/token.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { DocumentQaService } from '../ai/document-qa.service';
import { RfiReader } from '../ai/rfi-reader.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  FILE_SELECT,
  assertDocuments,
  assertMember,
  companyToday,
  csv,
  dialable,
  fileView,
  isoDay,
  namesFor,
  person,
  resolveFiles,
  responderLink,
  rfiSettingsFor,
  withNumberRetry,
  type Names,
} from './rfi-common';

const RFI_LIST_SELECT = {
  id: true,
  projectId: true,
  number: true,
  subject: true,
  discipline: true,
  priority: true,
  status: true,
  raisedBy: true,
  raisedOn: true,
  addressedToName: true,
  addressedToEmail: true,
  addressedToCompany: true,
  addressedToPhone: true,
  assigneeId: true,
  sentAt: true,
  dueOn: true,
  costImpact: true,
  scheduleImpact: true,
  answeredAt: true,
  closedAt: true,
  linkSentAt: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
  changeOrder: { select: { id: true, number: true, revision: true, status: true } },
  _count: { select: { responses: true } },
} as const;

type RfiListRow = Prisma.RfiGetPayload<{ select: typeof RFI_LIST_SELECT }>;

const RFI_DETAIL_INCLUDE = {
  project: { select: { id: true, name: true } },
  changeOrder: { select: { id: true, number: true, revision: true, status: true } },
  scheduleTask: { select: { id: true, name: true } },
  documents: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      document: { select: { id: true, title: true, version: true, category: true, s3Key: true, deletedAt: true } },
    },
  },
  attachments: { where: { responseId: null }, orderBy: { createdAt: 'asc' }, select: FILE_SELECT },
  responses: {
    orderBy: { createdAt: 'asc' },
    include: { attachments: { orderBy: { createdAt: 'asc' }, select: FILE_SELECT } },
  },
  _count: { select: { responses: true } },
} as const;

type RfiDetailRow = Prisma.RfiGetPayload<{ include: typeof RFI_DETAIL_INCLUDE }>;

/**
 * RFIs (roadmap Phase 2, module 9): raising a question to the designer, sending it, the thread of
 * answers, the official answer, closing it, and the change order an answer can turn into. The outside
 * party's own page is `RfiLinksService`; reminders are `RfiRemindersService`.
 */
@Injectable()
export class RfisService {
  private readonly logger = new Logger(RfisService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly tokens: TokenService,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
    private readonly documentQa: DocumentQaService,
    private readonly reader: RfiReader,
  ) {}

  // --- settings ----------------------------------------------------------------------------------

  async settings(actor: RequestUser) {
    const values = await this.tenantDb.transaction(actor.tenantId, (tx) => rfiSettingsFor(tx));
    // Both halves of "draft with AI" need the key; the web hides the button when this is false.
    return { ...values, ai_enabled: this.reader.enabled && this.documentQa.enabled };
  }

  async updateSettings(actor: RequestUser, input: RfiSettingsInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const data = {
        rfiDueDays: input.rfi_due_days,
        submittalReviewDays: input.submittal_review_days,
        reminderDaysBefore: input.reminder_days_before,
        updatedBy: actor.userId,
      };
      await tx.rfiSettings.upsert({
        where: { tenantId: actor.tenantId },
        create: { tenantId: actor.tenantId, ...data },
        update: data,
      });
    });
    return this.settings(actor);
  }

  // --- reading -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListRfisQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const today = companyToday(actor);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.rfi.findMany({
        where: this.where(actor, query, today),
        select: RFI_LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }],
        take: query.limit,
      });
      const names = await namesFor(tx, rows.flatMap((row) => [row.raisedBy, row.assigneeId]));
      // The figures cover the same filter as the list, without its limit, so "12 overdue" is true.
      const all = await tx.rfi.findMany({
        where: this.where(actor, query, today),
        select: { status: true, dueOn: true, sentAt: true, answeredAt: true },
      });
      return {
        items: rows.map((row) => this.summary(row, names, today)),
        stats: {
          total: all.length,
          draft: all.filter((row) => row.status === 'draft').length,
          open: all.filter((row) => row.status === 'open').length,
          overdue: all.filter((row) => rfiIsOverdue(row.status, isoDay(row.dueOn), today)).length,
          answered: all.filter((row) => row.status === 'answered').length,
          closed: all.filter((row) => row.status === 'closed').length,
          avg_response_days: rfiAverageDays(all.map((row) => ({ from: row.sentAt, to: row.answeredAt }))),
        },
      };
    });
  }

  async exportCsv(actor: RequestUser, query: ListRfisQuery): Promise<string> {
    const { items } = await this.list(actor, { ...query, limit: 500 });
    return csv([
      [
        'Number',
        'Site',
        'Subject',
        'Discipline',
        'Priority',
        'Status',
        'Overdue',
        'Addressed to',
        'Company',
        'Raised by',
        'Raised on',
        'Sent',
        'Due',
        'Answered',
        'Closed',
        'Days to answer',
        'Cost impact',
        'Schedule impact',
        'Change order',
      ],
      ...items.map((row) => [
        row.label,
        row.project.name,
        row.subject,
        RFI_DISCIPLINE_LABELS[row.discipline],
        RFI_PRIORITY_LABELS[row.priority],
        RFI_STATUS_LABELS[row.status],
        row.overdue ? 'Yes' : '',
        row.addressed_to.name,
        row.addressed_to.company,
        row.raised_by?.name ?? '',
        row.raised_on,
        row.sent_at?.slice(0, 10) ?? '',
        row.due_on,
        row.answered_at?.slice(0, 10) ?? '',
        row.closed_at?.slice(0, 10) ?? '',
        row.response_days,
        row.cost_impact ? 'Yes' : '',
        row.schedule_impact ? 'Yes' : '',
        row.change_order?.label ?? '',
      ]),
    ]);
  }

  async get(actor: RequestUser, id: string) {
    const row = await this.tenantDb.transaction(actor.tenantId, (tx) => this.load(tx, actor, id));
    return this.detail(actor, row);
  }

  // --- raising and editing -----------------------------------------------------------------------

  async create(actor: RequestUser, input: CreateRfiParsed) {
    await this.access.assertAccess(actor, input.project_id);
    const id = await withNumberRetry(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        if (input.client_id) {
          const existing = await tx.rfi.findFirst({ where: { clientId: input.client_id }, select: { id: true } });
          if (existing) return existing.id;
        }
        await assertMember(tx, input.assignee_id, 'assignee_id');
        await this.assertTask(tx, input.project_id, input.schedule_task_id);
        const documentIds = await assertDocuments(tx, input.project_id, input.document_ids ?? []);
        const files = await resolveFiles(tx, actor, input.project_id, input.attachments);
        const today = companyToday(actor);
        const settings = await rfiSettingsFor(tx);
        const last = await tx.rfi.aggregate({ where: { projectId: input.project_id }, _max: { number: true } });
        const made = await tx.rfi.create({
          data: {
            tenantId: actor.tenantId,
            projectId: input.project_id,
            number: (last._max.number ?? 0) + 1,
            subject: input.subject,
            question: input.question,
            discipline: input.discipline,
            priority: input.priority,
            location: input.location ?? null,
            raisedBy: actor.userId,
            raisedOn: isoDateToUtcDate(today),
            addressedToName: input.addressed_to_name ?? null,
            addressedToEmail: input.addressed_to_email ?? null,
            addressedToCompany: input.addressed_to_company ?? null,
            addressedToPhone: dialable(input.addressed_to_phone) ?? null,
            assigneeId: input.assignee_id ?? null,
            costImpact: input.cost_impact ?? false,
            scheduleImpact: input.schedule_impact ?? false,
            scheduleTaskId: input.schedule_task_id ?? null,
            clientId: input.client_id ?? null,
            ...(input.open
              ? {
                  status: 'open' as const,
                  sentAt: new Date(),
                  dueOn: isoDateToUtcDate(input.due_on ?? rfiDueDate(today, settings.rfi_due_days)),
                }
              : { dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null }),
          },
          select: { id: true },
        });
        if (documentIds.length > 0) {
          await tx.rfiDocument.createMany({
            data: documentIds.map((documentId) => ({ tenantId: actor.tenantId, rfiId: made.id, documentId })),
          });
        }
        await this.addFiles(tx, actor, made.id, null, files);
        return made.id;
      }),
    );
    return this.get(actor, id);
  }

  /** Anything but a closed or void RFI: those are the record of what was asked. */
  async update(actor: RequestUser, id: string, input: UpdateRfiInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      if (row.status === 'closed' || row.status === 'void') {
        throw ApiError.conflict(`${rfiLabel(row.number)} is ${row.status}; it can no longer be changed`);
      }
      if (input.assignee_id !== undefined) await assertMember(tx, input.assignee_id, 'assignee_id');
      if (input.schedule_task_id !== undefined) await this.assertTask(tx, row.projectId, input.schedule_task_id);
      const dueChanged = input.due_on !== undefined && input.due_on !== isoDay(row.dueOn);
      await tx.rfi.update({
        where: { id },
        data: {
          ...(input.subject === undefined ? {} : { subject: input.subject }),
          ...(input.question === undefined ? {} : { question: input.question }),
          ...(input.discipline === undefined ? {} : { discipline: input.discipline }),
          ...(input.priority === undefined ? {} : { priority: input.priority }),
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.addressed_to_name === undefined ? {} : { addressedToName: input.addressed_to_name }),
          ...(input.addressed_to_email === undefined ? {} : { addressedToEmail: input.addressed_to_email ?? null }),
          ...(input.addressed_to_company === undefined ? {} : { addressedToCompany: input.addressed_to_company }),
          ...(input.addressed_to_phone === undefined ? {} : { addressedToPhone: dialable(input.addressed_to_phone) }),
          ...(input.assignee_id === undefined ? {} : { assigneeId: input.assignee_id }),
          ...(input.cost_impact === undefined ? {} : { costImpact: input.cost_impact }),
          ...(input.schedule_impact === undefined ? {} : { scheduleImpact: input.schedule_impact }),
          ...(input.schedule_task_id === undefined ? {} : { scheduleTaskId: input.schedule_task_id }),
          // A new due date is a new deadline: its reminders go out again.
          ...(dueChanged
            ? {
                dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null,
                dueSoonRemindedAt: null,
                overdueRemindedAt: null,
              }
            : {}),
        },
      });
      if (input.document_ids) {
        const ids = await assertDocuments(tx, row.projectId, input.document_ids);
        await tx.rfiDocument.deleteMany({ where: { rfiId: id, documentId: { notIn: ids } } });
        const have = new Set(row.documents.map((link) => link.document.id));
        const add = ids.filter((documentId) => !have.has(documentId));
        if (add.length > 0) {
          await tx.rfiDocument.createMany({
            data: add.map((documentId) => ({ tenantId: actor.tenantId, rfiId: id, documentId })),
          });
        }
      }
    });
    return this.get(actor, id);
  }

  /** Only a draft that never went anywhere. Anything sent is voided instead, and stays on the log. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      if (row.status !== 'draft' || row.sentAt) {
        throw ApiError.conflict('Only a draft that was never sent can be deleted. Void this one instead.');
      }
      await tx.rfi.delete({ where: { id } });
    });
  }

  async addAttachments(actor: RequestUser, id: string, input: RfiAttachmentsInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      this.assertLive(row);
      await this.addFiles(tx, actor, id, null, await resolveFiles(tx, actor, row.projectId, input.attachments));
    });
    return this.get(actor, id);
  }

  async removeAttachment(actor: RequestUser, id: string, attachmentId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      this.assertLive(row);
      // Files on a response are part of what somebody answered, and stay with the answer.
      if (!row.attachments.some((attachment) => attachment.id === attachmentId)) throw ApiError.notFound('Attachment');
      await tx.rfiAttachment.delete({ where: { id: attachmentId } });
    });
    return this.get(actor, id);
  }

  // --- the workflow ------------------------------------------------------------------------------

  /** Draft → open: it is now waiting on the designer, and the due date runs from today. */
  async open(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, (tx) => this.openIn(tx, actor, id));
    return this.get(actor, id);
  }

  /**
   * A link the outside party answers through, with a message ready to send by WhatsApp or email.
   * Sending a draft opens it — a question somebody has been sent is not a draft any more.
   */
  async sendLink(actor: RequestUser, id: string) {
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await this.load(tx, actor, id);
      if (current.status === 'draft') await this.openIn(tx, actor, id);
      else if (current.status !== 'open' && current.status !== 'answered') {
        throw ApiError.conflict(`${rfiLabel(current.number)} is ${current.status}; there is nothing to answer`);
      }
      await tx.rfi.update({ where: { id }, data: { linkSentAt: new Date() } });
      return this.load(tx, actor, id);
    });
    const token = this.tokens.signRfiLink({
      tenantId: actor.tenantId,
      kind: 'rfi',
      recordId: row.id,
      version: row.linkVersion,
    });
    const link = responderLink(token);
    const company = await this.tenantDb
      .clientFor(actor.tenantId)
      .tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
    const message = rfiLinkMessage({
      recipientName: row.addressedToName,
      companyName: company?.name ?? '',
      siteName: row.project.name,
      label: rfiLabel(row.number),
      subject: row.subject,
      dueOn: isoDay(row.dueOn),
      url: '{url}',
      kind: 'rfi',
    });
    return {
      ...link,
      expires_at: new Date(Date.now() + this.tokens.rfiLinkTtlSeconds * 1000).toISOString(),
      /** `{url}` marks where the link goes, so the web can put its own origin in front of a bare path. */
      message,
      phone: row.addressedToPhone,
      email: row.addressedToEmail,
      subject: `${rfiLabel(row.number)}: ${row.subject}`,
      rfi: await this.detail(actor, row),
    };
  }

  /** Withdraw every link sent so far — a link forwarded to the wrong person, say. */
  async revokeLinks(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.load(tx, actor, id);
      await tx.rfi.update({ where: { id }, data: { linkVersion: { increment: 1 }, linkSentAt: null } });
    });
    return this.get(actor, id);
  }

  /**
   * An answer recorded by the team — one that came by email, a call or a site meeting — or a reply
   * in the thread. Marked official, it is the answer the RFI is closed on.
   */
  async respond(actor: RequestUser, id: string, input: RfiResponseInput) {
    const notice = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      if (row.status !== 'open' && row.status !== 'answered') {
        throw ApiError.conflict(
          row.status === 'draft'
            ? `Open ${rfiLabel(row.number)} before answering it`
            : `${rfiLabel(row.number)} is ${row.status}`,
        );
      }
      const me = await tx.user.findFirst({ where: { id: actor.userId }, select: { name: true } });
      const files = await resolveFiles(tx, actor, row.projectId, input.attachments);
      if (input.official) await tx.rfiResponse.updateMany({ where: { rfiId: id }, data: { isOfficial: false } });
      const response = await tx.rfiResponse.create({
        data: {
          tenantId: actor.tenantId,
          rfiId: id,
          body: input.body,
          authorUserId: actor.userId,
          // Recording what the consultant said on the phone: their name on it, ours as the author.
          authorName: input.on_behalf_of ? `${input.on_behalf_of} (recorded by ${me?.name ?? 'a team member'})` : (me?.name ?? 'Team'),
          isOfficial: input.official ?? false,
        },
        select: { id: true },
      });
      await this.addFiles(tx, actor, id, response.id, files);
      if (input.official && row.status === 'open') {
        await tx.rfi.update({ where: { id }, data: { status: 'answered', answeredAt: new Date() } });
      }
      const recipients = new Set([row.raisedBy, row.assigneeId].filter((who): who is string => Boolean(who)));
      recipients.delete(actor.userId);
      return { row, recipients: [...recipients], official: input.official ?? false };
    });
    await this.notify(actor.tenantId, notice.row, notice.recipients, notice.official ? 'rfi.answered' : 'rfi.response');
    return this.get(actor, id);
  }

  /** Make an existing response the official answer. */
  async markOfficial(actor: RequestUser, id: string, responseId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      if (row.status !== 'open' && row.status !== 'answered') {
        throw ApiError.conflict(`${rfiLabel(row.number)} is ${row.status}`);
      }
      if (!row.responses.some((response) => response.id === responseId)) throw ApiError.notFound('Response');
      await tx.rfiResponse.updateMany({ where: { rfiId: id }, data: { isOfficial: false } });
      await tx.rfiResponse.update({ where: { id: responseId }, data: { isOfficial: true } });
      if (row.status === 'open') {
        await tx.rfi.update({ where: { id }, data: { status: 'answered', answeredAt: new Date() } });
      }
    });
    return this.get(actor, id);
  }

  /** The answer was not one: back to waiting, with the clock for the response time restarted. */
  async reopen(actor: RequestUser, id: string, input: RfiNoteInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      this.assertMove(row, 'open');
      await tx.rfiResponse.updateMany({ where: { rfiId: id }, data: { isOfficial: false } });
      await tx.rfi.update({
        where: { id },
        data: { status: 'open', answeredAt: null, closeNote: input.note ?? null },
      });
    });
    return this.get(actor, id);
  }

  async close(actor: RequestUser, id: string, input: RfiNoteInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      this.assertMove(row, 'closed');
      if (!row.responses.some((response) => response.isOfficial)) {
        throw ApiError.conflict('Mark the official answer before closing the RFI');
      }
      await tx.rfi.update({
        where: { id },
        data: { status: 'closed', closedBy: actor.userId, closedAt: new Date(), closeNote: input.note ?? null },
      });
    });
    return this.get(actor, id);
  }

  async void(actor: RequestUser, id: string, input: RfiVoidInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      this.assertMove(row, 'void');
      await tx.rfi.update({ where: { id }, data: { status: 'void', voidReason: input.reason } });
    });
    return this.get(actor, id);
  }

  /**
   * "Raise a change order from this RFI": a draft change order with the question and the answer as
   * its description and the RFI's drawings attached, priced afterwards on the change order itself.
   *
   * Written here in the same transaction that links it, rather than through the change orders
   * service, so an RFI can never point at a change order that failed to save, or the other way round.
   */
  async raiseChangeOrder(actor: RequestUser, id: string) {
    if (!can(actor, 'change_orders.manage')) {
      throw ApiError.forbidden('Raising a change order needs permission to manage change orders');
    }
    const made = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      if (row.status === 'void') throw ApiError.conflict(`${rfiLabel(row.number)} is void`);
      if (row.changeOrder && row.changeOrder.status !== 'cancelled') {
        throw ApiError.conflict(
          `${rfiLabel(row.number)} already has ${changeOrderLabel(row.changeOrder.number, row.changeOrder.revision)}`,
        );
      }
      const official = row.responses.find((response) => response.isOfficial);
      const description = [
        `From ${rfiLabel(row.number)}: ${row.subject}`,
        '',
        `Question: ${row.question}`,
        ...(official ? ['', `Answer (${official.authorName}): ${official.body}`] : []),
      ]
        .join('\n')
        .slice(0, 4000);
      const last = await tx.changeOrder.aggregate({ where: { projectId: row.projectId }, _max: { number: true } });
      const changeOrder = await tx.changeOrder.create({
        data: {
          tenantId: actor.tenantId,
          projectId: row.projectId,
          number: (last._max.number ?? 0) + 1,
          title: `${rfiLabel(row.number)}: ${row.subject}`.slice(0, 160),
          description,
          reason: 'design_change',
          raisedBy: actor.userId,
          raisedOn: isoDateToUtcDate(companyToday(actor)),
          // The same default as a change order raised by hand: the regime's standard rate.
          taxRateBp: taxRule(actor.taxRegime).standardRateBp ?? 0,
        },
        select: { id: true, number: true, revision: true },
      });
      const documentIds = row.documents.map((link) => link.document.id);
      if (documentIds.length > 0) {
        await tx.changeOrderAttachment.createMany({
          data: row.documents.map((link) => ({
            tenantId: actor.tenantId,
            changeOrderId: changeOrder.id,
            documentId: link.document.id,
            caption: `Referenced by ${rfiLabel(row.number)}`,
          })),
        });
      }
      await tx.rfi.update({ where: { id }, data: { changeOrderId: changeOrder.id, costImpact: true } });
      return changeOrder;
    });
    return {
      change_order: { id: made.id, label: changeOrderLabel(made.number, made.revision) },
      rfi: await this.get(actor, id),
    };
  }

  // --- the drawing brain -------------------------------------------------------------------------

  /**
   * "Draft with AI": first ask the site's documents whether the question is already answered there
   * (and on which page), then tidy the rough question into a clear RFI. Off without a key.
   */
  async draftWithAi(actor: RequestUser, input: RfiDraftAiInput) {
    await this.access.assertAccess(actor, input.project_id);
    if (!this.reader.enabled || !this.documentQa.enabled) {
      throw ApiError.conflict('Drafting RFIs with AI is not configured on this deployment');
    }
    let check: Awaited<ReturnType<DocumentQaService['ask']>> | null = null;
    try {
      check = await this.documentQa.ask(actor, { question: input.question.slice(0, 400), project_id: input.project_id });
    } catch (error) {
      // The check is a courtesy; a failure there must not stop the draft.
      this.logger.warn({ err: error }, 'Checking the documents for an RFI failed');
    }
    const draft = await this.reader.tidy(input.question, input.subject);
    return { check, draft };
  }

  // --- helpers -----------------------------------------------------------------------------------

  private where(actor: RequestUser, query: ListRfisQuery, today: string): Prisma.RfiWhereInput {
    const party = query.party
      ? {
          OR: [
            { addressedToName: { contains: query.party, mode: 'insensitive' as const } },
            { addressedToCompany: { contains: query.party, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const text = query.q
      ? {
          OR: [
            { subject: { contains: query.q, mode: 'insensitive' as const } },
            { question: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    return {
      project: { deletedAt: null },
      ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
      ...(query.status ? { status: query.status } : {}),
      ...(query.discipline ? { discipline: query.discipline } : {}),
      ...(query.overdue ? { status: 'open' as const, dueOn: { lt: isoDateToUtcDate(today) } } : {}),
      AND: [party, text],
    };
  }

  private async load(tx: TenantTx, actor: RequestUser, id: string): Promise<RfiDetailRow> {
    const row = await tx.rfi.findFirst({ where: { id, project: { deletedAt: null } }, include: RFI_DETAIL_INCLUDE });
    if (!row) throw ApiError.notFound('RFI');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  private async openIn(tx: TenantTx, actor: RequestUser, id: string): Promise<void> {
    const row = await this.load(tx, actor, id);
    this.assertMove(row, 'open');
    if (row.status !== 'draft') return;
    const settings = await rfiSettingsFor(tx);
    const today = companyToday(actor);
    await tx.rfi.update({
      where: { id },
      data: {
        status: 'open',
        sentAt: new Date(),
        dueOn: row.dueOn ?? isoDateToUtcDate(rfiDueDate(today, settings.rfi_due_days)),
      },
    });
  }

  private assertMove(row: { number: number; status: RfiStatus }, to: RfiStatus): void {
    if (!rfiCanMove(row.status, to)) {
      throw ApiError.conflict(`${rfiLabel(row.number)} is ${row.status}; it cannot be moved to ${to}`);
    }
  }

  private assertLive(row: { number: number; status: RfiStatus }): void {
    if (row.status === 'closed' || row.status === 'void') {
      throw ApiError.conflict(`${rfiLabel(row.number)} is ${row.status}`);
    }
  }

  private async assertTask(tx: TenantTx, projectId: string, taskId: string | null | undefined): Promise<void> {
    if (!taskId) return;
    const task = await tx.scheduleTask.findFirst({ where: { id: taskId, projectId }, select: { id: true } });
    if (!task) throw ApiError.validationFailed({ schedule_task_id: taskId }, 'That task is not on this site');
  }

  private async addFiles(
    tx: TenantTx,
    actor: RequestUser,
    rfiId: string,
    responseId: string | null,
    files: Awaited<ReturnType<typeof resolveFiles>>,
  ): Promise<void> {
    if (files.length === 0) return;
    await tx.rfiAttachment.createMany({
      data: files.map((file) => ({
        tenantId: actor.tenantId,
        rfiId,
        responseId,
        ...file,
        uploadedBy: actor.userId,
      })),
    });
  }

  private async notify(
    tenantId: string,
    row: { id: string; number: number; subject: string; projectId: string; project: { name: string } },
    userIds: string[],
    type: string,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const title =
      type === 'rfi.answered' ? `${rfiLabel(row.number)} answered` : `New reply on ${rfiLabel(row.number)}`;
    try {
      await this.notifications.notify({
        tenantId,
        userIds,
        projectId: row.projectId,
        type,
        title,
        body: `${row.subject} · ${row.project.name}`,
        payload: { title, project_name: row.project.name, project_id: row.projectId, rfi_id: row.id },
      });
    } catch (error) {
      this.logger.warn({ err: error, rfiId: row.id }, 'RFI notice failed');
    }
  }

  summary(row: RfiListRow | RfiDetailRow, names: Names, today: string) {
    const due = isoDay(row.dueOn);
    return {
      id: row.id,
      number: row.number,
      label: rfiLabel(row.number),
      project: row.project,
      subject: row.subject,
      discipline: row.discipline,
      priority: row.priority,
      status: row.status,
      overdue: rfiIsOverdue(row.status, due, today),
      due_on: due,
      raised_on: utcDateToIsoDate(row.raisedOn),
      sent_at: row.sentAt?.toISOString() ?? null,
      answered_at: row.answeredAt?.toISOString() ?? null,
      closed_at: row.closedAt?.toISOString() ?? null,
      response_days:
        row.sentAt && row.answeredAt
          ? Math.round(((row.answeredAt.getTime() - row.sentAt.getTime()) / 86_400_000) * 10) / 10
          : null,
      addressed_to: {
        name: row.addressedToName,
        email: row.addressedToEmail,
        company: row.addressedToCompany,
        phone: row.addressedToPhone,
      },
      assignee: person(names, row.assigneeId),
      raised_by: person(names, row.raisedBy),
      cost_impact: row.costImpact,
      schedule_impact: row.scheduleImpact,
      change_order: row.changeOrder
        ? {
            id: row.changeOrder.id,
            label: changeOrderLabel(row.changeOrder.number, row.changeOrder.revision),
            status: row.changeOrder.status,
          }
        : null,
      response_count: row._count.responses,
      link_sent_at: row.linkSentAt?.toISOString() ?? null,
    };
  }

  async detail(actor: RequestUser, row: RfiDetailRow) {
    const names = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      namesFor(tx, [row.raisedBy, row.assigneeId, row.closedBy, ...row.responses.map((r) => r.authorUserId)]),
    );
    const sign = (key: string) => this.uploads.signedViewUrl(actor, key);
    return {
      ...this.summary(row, names, companyToday(actor)),
      question: row.question,
      location: row.location,
      schedule_task: row.scheduleTask,
      close_note: row.closeNote,
      void_reason: row.voidReason,
      closed_by: person(names, row.closedBy),
      link_version: row.linkVersion,
      documents: await Promise.all(
        row.documents
          .filter((link) => !link.document.deletedAt)
          .map(async (link) => ({
            id: link.document.id,
            title: link.document.title,
            version: link.document.version,
            category: link.document.category,
            url: await sign(link.document.s3Key),
          })),
      ),
      attachments: await Promise.all(row.attachments.map((file) => fileView(file, sign))),
      responses: await Promise.all(
        row.responses.map(async (response) => ({
          id: response.id,
          body: response.body,
          author: {
            name: response.authorName,
            email: response.authorEmail,
            user: person(names, response.authorUserId),
          },
          external: response.external,
          is_official: response.isOfficial,
          created_at: response.createdAt.toISOString(),
          attachments: await Promise.all(response.attachments.map((file) => fileView(file, sign))),
        })),
      ),
    };
  }
}
