import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CHANGE_ORDER_AGREED,
  CHANGE_ORDER_PENDING,
  changeOrderCanMove,
  changeOrderFigures,
  changeOrderLabel,
  changeOrderLineCost,
  changeOrderRegisterCsv,
  currencyMinorDigits,
  isoDateToUtcDate,
  taxRule,
  todayIn,
  utcDateToIsoDate,
  type ChangeOrderAttachmentInput,
  type ChangeOrderClientDecisionInput,
  type ChangeOrderContractValueInput,
  type ChangeOrderLineInput,
  type ChangeOrderNoteInput,
  type ChangeOrderStatus,
  type CreateChangeOrderInput,
  type ListChangeOrdersQuery,
  type UpdateChangeOrderInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import { ChangeOrderApprovalsService } from './change-order-approvals.service';
import {
  CHANGE_ORDER_INCLUDE,
  agreedTotals,
  changeOrderDetailView,
  changeOrderSummaryView,
  clientsOf,
  loadChangeOrder,
  managersOf,
  peopleFor,
  type ChangeOrderRecord,
} from './change-order-records';

interface Notice {
  userIds: string[];
  projectId: string;
  type: string;
  title: string;
  body: string;
  payload: Record<string, string>;
}

/**
 * Change orders (roadmap Phase 2, module 4): raising and pricing them, the internal sign-off, the
 * hand-over to the client, and the register. What the client's answer does to the site is
 * `ChangeOrderApprovalsService`; extra work spotted in reports and messages is `ScopeCreepService`.
 */
@Injectable()
export class ChangeOrdersService {
  private readonly logger = new Logger(ChangeOrdersService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly bridge: ChangeOrderApprovalsService,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
  ) {}

  // --- reading -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListChangeOrdersQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.changeOrder.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...(query.status ? { status: query.status } : {}),
          project: { deletedAt: null },
        },
        include: CHANGE_ORDER_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });
      const people = await peopleFor(tx, rows);
      const sum = (statuses: readonly ChangeOrderStatus[], pick: (row: ChangeOrderRecord) => bigint) =>
        rows.filter((row) => statuses.includes(row.status)).reduce((total, row) => total + pick(row), 0n).toString();
      return {
        items: rows.map((row) => changeOrderSummaryView(row, people)),
        totals: {
          count: rows.length,
          approved_count: rows.filter((row) => CHANGE_ORDER_AGREED.includes(row.status)).length,
          approved_cost: sum(CHANGE_ORDER_AGREED, (row) => row.costImpact),
          approved_price: sum(CHANGE_ORDER_AGREED, (row) => row.clientPrice),
          approved_days: rows
            .filter((row) => CHANGE_ORDER_AGREED.includes(row.status))
            .reduce((total, row) => total + row.timeImpactDays, 0),
          pending_count: rows.filter((row) => CHANGE_ORDER_PENDING.includes(row.status)).length,
          pending_price: sum(CHANGE_ORDER_PENDING, (row) => row.clientPrice),
          awaiting_client: rows.filter((row) => row.status === 'sent').length,
          awaiting_approval: rows.filter((row) => row.status === 'submitted').length,
        },
      };
    });
  }

  async exportCsv(actor: RequestUser, query: ListChangeOrdersQuery): Promise<string> {
    const { items } = await this.list(actor, query);
    return changeOrderRegisterCsv(
      items.map((row) => ({
        number: row.number,
        revision: row.revision,
        site: row.project.name,
        title: row.title,
        reason: row.reason,
        status: row.status,
        raised_on: row.raised_on,
        cost_impact: row.cost_impact,
        client_price: row.client_price,
        tax: row.tax,
        client_total: row.client_total,
        time_impact_days: row.time_impact_days,
        decided_at: row.client_decided_at?.slice(0, 10) ?? null,
      })),
      currencyMinorDigits(actor.currency),
    );
  }

  async get(actor: RequestUser, id: string) {
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const found = await loadChangeOrder(tx, actor, id);
      return { found, people: await peopleFor(tx, [found]) };
    });
    // Signed after the transaction: signing is local HMAC, but there is no reason to hold a
    // connection open for it.
    const urls = new Map<string, string | null>();
    for (const attachment of row.found.attachments) {
      const key = attachment.document?.s3Key ?? attachment.s3Key;
      urls.set(attachment.id, key ? await this.uploads.signedViewUrl(actor, key) : null);
    }
    return changeOrderDetailView(row.found, row.people, urls);
  }

  /**
   * The site's contract and handover as change orders have moved them: as signed, what has been
   * agreed since, and where that leaves them — plus the history, one row per approved change order.
   */
  async siteSummary(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [project, agreed, revisions, pending] = await Promise.all([
        tx.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { id: true, name: true, contractValue: true, targetEndDate: true, budgetAmount: true },
        }),
        agreedTotals(tx, projectId),
        tx.changeOrderSiteRevision.findMany({
          where: { projectId },
          orderBy: { createdAt: 'asc' },
          include: { changeOrder: { select: { id: true, number: true, revision: true, title: true } } },
        }),
        tx.changeOrder.aggregate({
          where: { projectId, status: { in: ['submitted', 'sent'] } },
          _sum: { clientPrice: true, timeImpactDays: true },
          _count: { _all: true },
        }),
      ]);
      const first = revisions[0];
      const originalHandover = first ? first.handoverBefore : project.targetEndDate;
      const day = (value: Date | null) => (value ? utcDateToIsoDate(value) : null);
      return {
        project_id: project.id,
        project_name: project.name,
        contract_value: project.contractValue?.toString() ?? null,
        approved_changes: agreed.price.toString(),
        approved_cost: agreed.cost.toString(),
        approved_count: agreed.count,
        revised_contract_value:
          project.contractValue === null ? null : (project.contractValue + agreed.price).toString(),
        original_handover: day(originalHandover),
        handover: day(project.targetEndDate),
        extension_days: agreed.days,
        awaiting_count: pending._count._all,
        awaiting_price: (pending._sum.clientPrice ?? 0n).toString(),
        awaiting_days: pending._sum.timeImpactDays ?? 0,
        history: revisions.map((revision) => ({
          change_order: {
            id: revision.changeOrder.id,
            label: changeOrderLabel(revision.changeOrder.number, revision.changeOrder.revision),
            title: revision.changeOrder.title,
          },
          time_impact_days: revision.timeImpactDays,
          handover_before: day(revision.handoverBefore),
          handover_after: day(revision.handoverAfter),
          contract_before: revision.contractBefore?.toString() ?? null,
          contract_after: revision.contractAfter?.toString() ?? null,
          site_budget_before: revision.siteBudgetBefore?.toString() ?? null,
          site_budget_after: revision.siteBudgetAfter?.toString() ?? null,
          at: revision.createdAt.toISOString(),
        })),
      };
    });
  }

  /**
   * The contract as signed. Editable at any time — it is the baseline, and the revised value is
   * always worked out from it rather than stored, so correcting a typo does not orphan history.
   */
  async setContractValue(actor: RequestUser, projectId: string, input: ChangeOrderContractValueInput) {
    await this.access.assertAccess(actor, projectId);
    await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.project.update({ where: { id: projectId }, data: { contractValue: input.contract_value } }),
    );
    return this.siteSummary(actor, projectId);
  }

  // --- raising and editing -----------------------------------------------------------------------

  async create(actor: RequestUser, input: CreateChangeOrderInput) {
    await this.access.assertAccess(actor, input.project_id);
    const id = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.changeOrder.findFirst({ where: { clientId: input.client_id }, select: { id: true } });
        if (existing) return existing.id;
      }
      const suggestion = input.suggestion_id
        ? await tx.changeOrderSuggestion.findFirst({ where: { id: input.suggestion_id } })
        : null;
      if (input.suggestion_id) {
        if (!suggestion || suggestion.projectId !== input.project_id) throw ApiError.notFound('Suggestion');
        if (suggestion.status !== 'open') {
          throw ApiError.conflict(`That suggestion was already ${suggestion.status}`);
        }
      }
      const last = await tx.changeOrder.aggregate({ where: { projectId: input.project_id }, _max: { number: true } });
      const markupBp = input.markup_bp ?? 0;
      const taxRateBp = input.tax_rate_bp ?? taxRule(actor.taxRegime).standardRateBp ?? 0;
      const made = await tx.changeOrder.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          number: (last._max.number ?? 0) + 1,
          title: input.title,
          description: input.description ?? null,
          reason: input.reason,
          raisedBy: actor.userId,
          raisedOn: isoDateToUtcDate(input.raised_on ?? todayIn(actor.timezone)),
          markupBp,
          enteredPrice: input.client_price ?? null,
          taxRateBp,
          timeImpactDays: input.time_impact_days ?? 0,
          clientId: input.client_id ?? null,
        },
        select: { id: true },
      });
      await replaceLines(tx, actor.tenantId, made.id, input.project_id, input.lines ?? []);
      await refigure(tx, made.id);

      if (suggestion) {
        await tx.changeOrderSuggestion.update({
          where: { id: suggestion.id },
          data: { status: 'converted', changeOrderId: made.id, decidedBy: actor.userId, decidedAt: new Date() },
        });
        await copySourcePhotos(tx, actor.tenantId, made.id, suggestion.sourceKind, suggestion.sourceId);
      }
      return made.id;
    });
    return this.get(actor, id);
  }

  /** Only a draft: once submitted, its figures are what somebody is approving. */
  async update(actor: RequestUser, id: string, input: UpdateChangeOrderInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      assertDraft(row);
      await tx.changeOrder.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
          ...(input.raised_on === undefined ? {} : { raisedOn: isoDateToUtcDate(input.raised_on) }),
          ...(input.markup_bp === undefined ? {} : { markupBp: input.markup_bp }),
          ...(input.client_price === undefined ? {} : { enteredPrice: input.client_price }),
          ...(input.tax_rate_bp === undefined ? {} : { taxRateBp: input.tax_rate_bp }),
          ...(input.time_impact_days === undefined ? {} : { timeImpactDays: input.time_impact_days }),
        },
      });
      if (input.lines) await replaceLines(tx, actor.tenantId, id, row.projectId, input.lines);
      await refigure(tx, id);
    });
    return this.get(actor, id);
  }

  /** A first draft nobody has seen. Anything submitted, or a revision, is cancelled instead. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      if (row.status !== 'draft' || row.revision > 0 || row.submittedAt) {
        throw ApiError.conflict('Only a first draft that was never submitted can be deleted. Cancel this one instead.');
      }
      // A suggestion it was raised from goes back on the list rather than pointing at nothing.
      await tx.changeOrderSuggestion.updateMany({
        where: { changeOrderId: id },
        data: { status: 'open', changeOrderId: null, decidedBy: null, decidedAt: null },
      });
      await tx.changeOrder.delete({ where: { id } });
    });
  }

  // --- attachments -------------------------------------------------------------------------------

  async addAttachment(actor: RequestUser, id: string, input: ChangeOrderAttachmentInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      if (row.status === 'cancelled') throw ApiError.conflict('This change order is cancelled');
      if (input.document_id) {
        const document = await tx.document.findFirst({
          where: { id: input.document_id, deletedAt: null },
          select: { projectId: true, contentType: true },
        });
        if (!document) throw ApiError.notFound('Document');
        // A company-wide document (no site) may be attached anywhere; another site's may not.
        if (document.projectId && document.projectId !== row.projectId) {
          throw ApiError.validationFailed({ document_id: input.document_id }, 'That document belongs to another site');
        }
        await tx.changeOrderAttachment.create({
          data: {
            tenantId: actor.tenantId,
            changeOrderId: id,
            documentId: input.document_id,
            contentType: document.contentType,
            caption: input.caption ?? null,
          },
        });
      } else {
        // A key is a string somebody could have made up; knowing one must not be enough to attach it.
        if (!input.s3_key!.startsWith(`${actor.tenantId}/`) || input.s3_key!.includes('..')) {
          throw ApiError.forbidden('That file does not belong to this account');
        }
        await tx.changeOrderAttachment.create({
          data: {
            tenantId: actor.tenantId,
            changeOrderId: id,
            s3Key: input.s3_key!,
            contentType: input.content_type ?? null,
            caption: input.caption ?? null,
          },
        });
      }
    });
    return this.get(actor, id);
  }

  async removeAttachment(actor: RequestUser, id: string, attachmentId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      if (!row.attachments.some((attachment) => attachment.id === attachmentId)) throw ApiError.notFound('Attachment');
      // What the client was shown stays with what they approved.
      if (row.status !== 'draft') {
        throw ApiError.conflict('Attachments are fixed once a change order is submitted');
      }
      await tx.changeOrderAttachment.delete({ where: { id: attachmentId } });
    });
    return this.get(actor, id);
  }

  // --- the workflow ------------------------------------------------------------------------------

  /** Ask for the internal sign-off. */
  async submit(actor: RequestUser, id: string) {
    const notice = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      assertMove(row, 'submitted');
      if (row.lines.length === 0) throw ApiError.conflict('Add at least one line before submitting');
      await tx.changeOrder.update({
        where: { id },
        data: { status: 'submitted', submittedBy: actor.userId, submittedAt: new Date(), reviewNote: null },
      });
      return this.notice(row, {
        userIds: await managersOf(tx, row.projectId),
        type: 'change_order_submitted',
        title: `${changeOrderLabel(row.number, row.revision)} is waiting for approval`,
      });
    });
    await this.send(actor, notice);
    return this.get(actor, id);
  }

  /** Back to the person who raised it, with the reason. */
  async returnToDraft(actor: RequestUser, id: string, input: ChangeOrderNoteInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      if (row.status !== 'submitted') {
        throw ApiError.conflict(`${changeOrderLabel(row.number, row.revision)} is ${row.status}; only a submitted one can be returned`);
      }
      await tx.changeOrder.update({ where: { id }, data: { status: 'draft', reviewNote: input.note ?? null } });
    });
    return this.get(actor, id);
  }

  /**
   * The internal sign-off, which puts it in front of the client as a portal approval.
   *
   * Nobody approves a change order they submitted themselves, except an owner — an owner-run company
   * has nobody else to ask, and the audit log records that they did both.
   */
  async approve(actor: RequestUser, id: string, input: ChangeOrderNoteInput) {
    const notice = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      assertMove(row, 'sent');
      if (row.submittedBy === actor.userId && actor.role !== 'owner') {
        throw ApiError.forbidden('Somebody else has to approve a change order you submitted');
      }
      const approvalId = await this.bridge.sendToClient(tx, actor, row);
      const now = new Date();
      await tx.changeOrder.update({
        where: { id },
        data: {
          status: 'sent',
          approvedBy: actor.userId,
          approvedAt: now,
          reviewNote: input.note ?? null,
          sentAt: now,
          approvalId,
        },
      });
      const people = new Set(await clientsOf(tx, row.projectId));
      people.add(row.raisedBy);
      return this.notice(row, {
        userIds: [...people],
        type: 'change_order_sent',
        title: `Change order ${changeOrderLabel(row.number, row.revision)} needs your decision`,
      });
    });
    await this.send(actor, notice);
    return this.get(actor, id);
  }

  /**
   * The client's answer, recorded from the change order rather than the approvals list — for an
   * owner taking the decision over the phone. The same approval row and the same rule apply: whoever
   * records it is named on it, with their role, and it is final.
   */
  async clientDecision(actor: RequestUser, id: string, input: ChangeOrderClientDecisionInput) {
    // The route needs `approvals.decide`; this side of it also shows cost, so it needs `view` too.
    // A client answers from their approvals list instead.
    if (!can(actor, 'change_orders.view')) {
      throw ApiError.forbidden('Answer from the approvals list');
    }
    const notice = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      if (row.status !== 'sent' || !row.approval || row.approval.deletedAt) {
        throw ApiError.conflict(`${changeOrderLabel(row.number, row.revision)} is not waiting on the client`);
      }
      if (row.approval.status !== 'pending') throw ApiError.conflict('That has already been decided');
      await tx.approval.update({
        where: { id: row.approval.id },
        data: { status: input.status, decidedBy: actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null },
      });
      return this.bridge.recordDecision(tx, actor, row.approval.id, input);
    });
    await this.bridge.notifyDecision(actor, notice);
    return this.get(actor, id);
  }

  /** A rejected change order, reworked: back to draft as the next revision, for a fresh approval. */
  async revise(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      if (row.status !== 'rejected') {
        throw ApiError.conflict(`${changeOrderLabel(row.number, row.revision)} is ${row.status}; only a rejected one is revised`);
      }
      await tx.changeOrder.update({
        where: { id },
        data: {
          status: 'draft',
          revision: row.revision + 1,
          // The rejected approval stays in the approvals list as the record of the "no"; the next
          // revision gets a new one when it is approved again.
          approvalId: null,
          submittedBy: null,
          submittedAt: null,
          approvedBy: null,
          approvedAt: null,
          sentAt: null,
        },
      });
    });
    return this.get(actor, id);
  }

  async implement(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      assertMove(row, 'implemented');
      await tx.changeOrder.update({
        where: { id },
        data: { status: 'implemented', implementedBy: actor.userId, implementedAt: new Date() },
      });
    });
    return this.get(actor, id);
  }

  /**
   * Drop it. Not once the client has approved it — by then it has moved budgets and the contract,
   * and undoing that is another change order. A pending client approval is withdrawn with it.
   */
  async cancel(actor: RequestUser, id: string, input: ChangeOrderNoteInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await loadChangeOrder(tx, actor, id);
      if (!changeOrderCanMove(row.status, 'cancelled')) {
        throw ApiError.conflict(
          row.status === 'approved' || row.status === 'implemented'
            ? 'The client has approved this one. Raise another change order to undo it.'
            : `${changeOrderLabel(row.number, row.revision)} is already ${row.status}`,
        );
      }
      if (row.approval && row.approval.status === 'pending' && !row.approval.deletedAt) {
        await tx.approval.update({ where: { id: row.approval.id }, data: { deletedAt: new Date() } });
      }
      await tx.changeOrder.update({
        where: { id },
        data: { status: 'cancelled', cancelledBy: actor.userId, cancelledAt: new Date(), cancelReason: input.note ?? null },
      });
    });
    return this.get(actor, id);
  }

  // --- helpers -----------------------------------------------------------------------------------

  private notice(row: ChangeOrderRecord, what: { userIds: string[]; type: string; title: string }): Notice {
    return {
      userIds: what.userIds,
      projectId: row.projectId,
      type: what.type,
      title: what.title,
      body: `${row.title} · ${row.project.name}`,
      payload: {
        title: what.title,
        project_name: row.project.name,
        project_id: row.projectId,
        change_order_id: row.id,
      },
    };
  }

  /** After the commit, and never the reason the step fails: it happened either way. */
  private async send(actor: RequestUser, notice: Notice): Promise<void> {
    const userIds = notice.userIds.filter((userId) => userId !== actor.userId);
    if (userIds.length === 0) return;
    try {
      await this.notifications.notify({
        tenantId: actor.tenantId,
        userIds,
        projectId: notice.projectId,
        type: notice.type,
        title: notice.title,
        body: notice.body,
        payload: notice.payload,
      });
    } catch (error) {
      this.logger.warn({ err: error, type: notice.type }, 'Change order notification failed');
    }
  }
}

// --- free functions, all inside a tenant transaction ---------------------------------------------

function assertDraft(row: ChangeOrderRecord): void {
  if (row.status !== 'draft') {
    throw ApiError.conflict(
      row.status === 'rejected'
        ? 'The client rejected this one. Revise it to make changes.'
        : `${changeOrderLabel(row.number, row.revision)} is ${row.status}; only a draft can be edited`,
    );
  }
}

function assertMove(row: ChangeOrderRecord, to: ChangeOrderStatus): void {
  if (!changeOrderCanMove(row.status, to)) {
    throw ApiError.conflict(`${changeOrderLabel(row.number, row.revision)} is ${row.status} and cannot become ${to}`, {
      from: row.status,
      to,
    });
  }
}

async function replaceLines(
  tx: TenantTx,
  tenantId: string,
  changeOrderId: string,
  projectId: string,
  lines: readonly ChangeOrderLineInput[],
): Promise<void> {
  const codes = [...new Set(lines.map((line) => line.cost_code_id).filter(Boolean))] as string[];
  if (codes.length > 0) {
    const found = await tx.costCode.findMany({ where: { id: { in: codes }, projectId }, select: { id: true } });
    const missing = codes.find((code) => !found.some((row) => row.id === code));
    if (missing) {
      throw ApiError.validationFailed({ cost_code_id: missing }, 'That cost code is not on this site');
    }
  }
  await tx.changeOrderLine.deleteMany({ where: { changeOrderId } });
  if (lines.length === 0) return;
  await tx.changeOrderLine.createMany({
    data: lines.map((line, index) => ({
      tenantId,
      changeOrderId,
      costCodeId: line.cost_code_id ?? null,
      sortOrder: index + 1,
      description: line.description,
      unit: line.unit ?? null,
      quantity: line.quantity == null ? null : new Prisma.Decimal(line.quantity),
      rate: line.quantity == null ? null : (line.rate ?? null),
      amount: changeOrderLineCost(line) ?? 0n,
    })),
  });
}

/** Store the figures `changeOrderFigures` gives for the lines and pricing as they now stand. */
async function refigure(tx: TenantTx, id: string): Promise<void> {
  const row = await tx.changeOrder.findUniqueOrThrow({
    where: { id },
    select: { markupBp: true, enteredPrice: true, taxRateBp: true, lines: { select: { amount: true } } },
  });
  const figures = changeOrderFigures({
    lineCosts: row.lines.map((line) => line.amount),
    markupBp: row.markupBp,
    enteredPrice: row.enteredPrice,
    taxRateBp: row.taxRateBp,
  });
  await tx.changeOrder.update({
    where: { id },
    data: {
      costImpact: figures.cost,
      clientPrice: figures.price,
      taxAmount: figures.tax,
      clientTotal: figures.total,
    },
  });
}

/**
 * The photos from the report or message a suggestion came from, carried onto the change order —
 * the evidence for the extra work is usually exactly the picture the supervisor already took.
 */
async function copySourcePhotos(
  tx: TenantTx,
  tenantId: string,
  changeOrderId: string,
  kind: 'daily_report' | 'site_message',
  sourceId: string,
): Promise<void> {
  const photos =
    kind === 'daily_report'
      ? (
          await tx.dprPhoto.findMany({ where: { dailyReportId: sourceId }, select: { s3Key: true, caption: true } })
        ).map((photo) => ({ s3Key: photo.s3Key, contentType: 'image/jpeg', caption: photo.caption }))
      : (
          await tx.siteMessageAttachment.findMany({
            where: { messageId: sourceId },
            select: { s3Key: true, contentType: true, caption: true },
          })
        ).map((file) => ({ s3Key: file.s3Key, contentType: file.contentType, caption: file.caption }));
  if (photos.length === 0) return;
  await tx.changeOrderAttachment.createMany({
    data: photos.slice(0, 20).map((photo) => ({
      tenantId,
      changeOrderId,
      s3Key: photo.s3Key,
      contentType: photo.contentType,
      caption: photo.caption ?? null,
    })),
  });
}
