import { Injectable, Logger } from '@nestjs/common';
import {
  addDays,
  changeOrderApplicableDelta,
  changeOrderLabel,
  formatMoney,
  utcDateToIsoDate,
  isoDateToUtcDate,
  type ChangeOrderClientDecisionInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookEvents } from '../webhooks/webhook-events.service';
import {
  CHANGE_ORDER_CLIENT_SELECT,
  agreedTotals,
  changeOrderClientView,
  managersOf,
  type ChangeOrderRecord,
} from './change-order-records';

/** What to tell people once a client decision has committed. */
export interface ChangeOrderDecisionNotice {
  changeOrderId: string;
  projectId: string;
  projectName: string;
  label: string;
  title: string;
  status: 'approved' | 'rejected';
  recipients: string[];
}

/**
 * Where change orders meet the client portal's approvals.
 *
 * The client approves a change order through the same `Approval` they approve a tile sample with —
 * one inbox, one record of who said yes, one rule that a decision is final. This service is the
 * only thing that knows an approval can be a change order: the portal calls it inside the
 * transaction that records the decision, so the client's yes and the budgets it moves commit
 * together or not at all.
 */
@Injectable()
export class ChangeOrderApprovalsService {
  private readonly logger = new Logger(ChangeOrderApprovalsService.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhookEvents,
  ) {}

  /** Put the change order in front of the client: one pending approval, with the price and days. */
  async sendToClient(tx: TenantTx, actor: RequestUser, row: ChangeOrderRecord): Promise<string> {
    const money = (minor: bigint) => formatMoney(minor, { currency: actor.currency, locale: actor.locale });
    const days =
      row.timeImpactDays === 0
        ? 'No change to the handover date'
        : row.timeImpactDays > 0
          ? `Adds ${row.timeImpactDays} day${row.timeImpactDays === 1 ? '' : 's'} to the handover date`
          : `Brings the handover forward by ${-row.timeImpactDays} day${row.timeImpactDays === -1 ? '' : 's'}`;
    // The body is plain text so the approval reads correctly anywhere it is shown — the portal's own
    // approvals list, a notification, a phone that has not been updated to know about change orders.
    const body = [
      row.description ?? '',
      `Price: ${money(row.clientPrice)}${row.taxAmount !== 0n ? ` + tax ${money(row.taxAmount)} = ${money(row.clientTotal)}` : ''}`,
      days,
    ]
      .filter(Boolean)
      .join('\n');
    const approval = await tx.approval.create({
      data: {
        tenantId: actor.tenantId,
        projectId: row.projectId,
        title: `Change order ${changeOrderLabel(row.number, row.revision)}: ${row.title}`.slice(0, 300),
        body,
        requestedBy: actor.userId,
      },
      select: { id: true },
    });
    return approval.id;
  }

  /**
   * The client's answer, recorded on the approval by the caller in this same transaction.
   *
   * Null when the approval is not a change order's. A yes applies the change order: budgets, the
   * handover date and the contract value move, each with a revision row.
   */
  async recordDecision(
    tx: TenantTx,
    actor: RequestUser,
    approvalId: string,
    input: ChangeOrderClientDecisionInput,
  ): Promise<ChangeOrderDecisionNotice | null> {
    const row = await tx.changeOrder.findUnique({
      where: { approvalId },
      include: { project: { select: { name: true } }, lines: true },
    });
    if (!row) return null;
    if (row.status !== 'sent') {
      throw ApiError.conflict(
        `${changeOrderLabel(row.number, row.revision)} is ${row.status}; it is not waiting on the client`,
      );
    }
    const now = new Date();
    if (input.status === 'approved') await this.apply(tx, actor, row);
    await tx.changeOrder.update({
      where: { id: row.id },
      data: {
        status: input.status,
        clientDecidedBy: actor.userId,
        clientDecidedAt: now,
        clientNote: input.note ?? null,
        ...(input.status === 'approved' ? { appliedAt: now } : {}),
      },
    });
    if (input.status === 'approved') await this.webhooks.changeOrderApproved(tx, actor.tenantId, row.id);
    const recipients = new Set(await managersOf(tx, row.projectId));
    recipients.add(row.raisedBy);
    if (row.approvedBy) recipients.add(row.approvedBy);
    recipients.delete(actor.userId);
    return {
      changeOrderId: row.id,
      projectId: row.projectId,
      projectName: row.project.name,
      label: changeOrderLabel(row.number, row.revision),
      title: row.title,
      status: input.status,
      recipients: [...recipients],
    };
  }

  /** After the commit, and never the reason a decision fails. */
  async notifyDecision(actor: RequestUser, notice: ChangeOrderDecisionNotice | null): Promise<void> {
    if (!notice || notice.recipients.length === 0) return;
    const title = `${notice.label} ${notice.status === 'approved' ? 'approved' : 'rejected'} by the client`;
    try {
      await this.notifications.notify({
        tenantId: actor.tenantId,
        userIds: notice.recipients,
        projectId: notice.projectId,
        type: `change_order_${notice.status}`,
        title,
        body: `${notice.title} · ${notice.projectName}`,
        payload: {
          title,
          project_name: notice.projectName,
          project_id: notice.projectId,
          change_order_id: notice.changeOrderId,
        },
      });
    } catch (error) {
      this.logger.warn({ err: error, changeOrderId: notice.changeOrderId }, 'Change order notice failed');
    }
  }

  /**
   * A change order's approval is withdrawn by cancelling the change order, never on its own: an
   * approval withdrawn behind its back would leave the change order waiting on nobody.
   */
  async assertWithdrawable(tx: TenantTx, approvalId: string): Promise<void> {
    const row = await tx.changeOrder.findUnique({
      where: { approvalId },
      select: { number: true, revision: true },
    });
    if (row) {
      throw ApiError.conflict(
        `This is the approval for change order ${changeOrderLabel(row.number, row.revision)}. Cancel the change order instead.`,
      );
    }
  }

  /** The client-safe change order behind each approval that is one, for the approvals list. */
  async clientViews(
    tx: TenantTx,
    approvalIds: readonly string[],
  ): Promise<Map<string, ReturnType<typeof changeOrderClientView>>> {
    if (approvalIds.length === 0) return new Map();
    const rows = await tx.changeOrder.findMany({
      where: { approvalId: { in: [...approvalIds] } },
      select: { ...CHANGE_ORDER_CLIENT_SELECT, approvalId: true },
    });
    return new Map(rows.map((row) => [row.approvalId!, changeOrderClientView(row)]));
  }

  /**
   * Move the site's figures by an approved change order. Locks what it changes first, so two change
   * orders approved at the same moment both land rather than one overwriting the other.
   */
  private async apply(
    tx: TenantTx,
    actor: RequestUser,
    row: { id: string; projectId: string; costImpact: bigint; clientPrice: bigint; timeImpactDays: number; lines: ReadonlyArray<{ costCodeId: string | null; amount: bigint }> },
  ): Promise<void> {
    // Budgets: one revision per cost code the lines touch.
    const byCode = new Map<string, bigint>();
    for (const line of row.lines) {
      if (!line.costCodeId) continue;
      byCode.set(line.costCodeId, (byCode.get(line.costCodeId) ?? 0n) + line.amount);
    }
    for (const [costCodeId, requested] of [...byCode].sort(([a], [b]) => a.localeCompare(b))) {
      if (requested === 0n) continue;
      const [locked] = await tx.$queryRaw<Array<{ budget: bigint }>>`
        SELECT budget FROM cost_codes WHERE id = ${costCodeId}::uuid FOR UPDATE`;
      if (!locked) continue;
      const amount = changeOrderApplicableDelta(locked.budget, requested);
      const after = locked.budget + amount;
      await tx.costCode.update({ where: { id: costCodeId }, data: { budget: after } });
      await tx.changeOrderBudgetRevision.create({
        data: {
          tenantId: actor.tenantId,
          projectId: row.projectId,
          changeOrderId: row.id,
          costCodeId,
          requested,
          amount,
          budgetBefore: locked.budget,
          budgetAfter: after,
          createdBy: actor.userId,
        },
      });
    }

    // The site: handover date, contract value, site budget — before and after, in one row.
    const [project] = await tx.$queryRaw<
      Array<{ target_end_date: Date | null; contract_value: bigint | null; budget_amount: bigint | null }>
    >`SELECT target_end_date, contract_value, budget_amount FROM projects WHERE id = ${row.projectId}::uuid FOR UPDATE`;
    if (!project) throw ApiError.notFound('Project');
    const handoverBefore = project.target_end_date;
    const handoverAfter =
      handoverBefore && row.timeImpactDays !== 0
        ? isoDateToUtcDate(addDays(utcDateToIsoDate(handoverBefore), row.timeImpactDays))
        : handoverBefore;
    // The contract as revised so far: as signed, plus every change order agreed before this one.
    const before = await agreedTotals(tx, row.projectId, row.id);
    const contractBefore = project.contract_value === null ? null : project.contract_value + before.price;
    const contractAfter = contractBefore === null ? null : contractBefore + row.clientPrice;
    const siteBudgetBefore = project.budget_amount;
    const siteBudgetAfter =
      siteBudgetBefore === null
        ? null
        : siteBudgetBefore + changeOrderApplicableDelta(siteBudgetBefore, row.costImpact);

    await tx.project.update({
      where: { id: row.projectId },
      data: {
        ...(handoverAfter && handoverAfter !== handoverBefore ? { targetEndDate: handoverAfter } : {}),
        ...(siteBudgetAfter !== null && siteBudgetAfter !== siteBudgetBefore ? { budgetAmount: siteBudgetAfter } : {}),
      },
    });
    await tx.changeOrderSiteRevision.create({
      data: {
        tenantId: actor.tenantId,
        projectId: row.projectId,
        changeOrderId: row.id,
        timeImpactDays: row.timeImpactDays,
        handoverBefore,
        handoverAfter,
        contractBefore,
        contractAfter,
        siteBudgetBefore,
        siteBudgetAfter,
        createdBy: actor.userId,
      },
    });
  }
}
