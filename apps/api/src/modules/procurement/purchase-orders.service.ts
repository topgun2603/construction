import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  COMMITTED_PO_STATUSES,
  RECEIVABLE_PO_STATUSES,
  currencyMinorDigits,
  isoDateToUtcDate,
  minorToDecimal,
  orderTotals,
  outstandingCommitment,
  priceLine,
  quantityToThousandths,
  thousandthsToQuantity,
  utcDateToIsoDate,
  withinApprovalLimit,
  type CreatePurchaseOrderInput,
  type ListPurchaseOrdersQuery,
  type PurchaseOrderLineInput,
  type PurchaseOrderStatus,
  type ReceiveGoodsInput,
  type UpdatePurchaseOrderInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import {
  CostCommitmentsService,
  type CommitmentSource,
} from '../cost-codes/cost-commitments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalLimitsService } from './approval-limits.service';
import { WebhookEvents } from '../webhooks/webhook-events.service';

const LINE_SELECT = {
  id: true,
  materialId: true,
  description: true,
  unit: true,
  quantity: true,
  unitRate: true,
  taxRateBp: true,
  amount: true,
  taxAmount: true,
  receivedQuantity: true,
  position: true,
  costCode: { select: { id: true, code: true, name: true } },
  invoiceLines: {
    where: { invoice: { status: { not: 'rejected' as const } } },
    select: { quantity: true, amount: true, taxAmount: true, invoice: { select: { status: true } } },
  },
} as const;

const SELECT = {
  id: true,
  number: true,
  status: true,
  projectId: true,
  rfqId: true,
  indentId: true,
  notes: true,
  deliveryAddress: true,
  expectedOn: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  submittedAt: true,
  approvedAt: true,
  decisionNote: true,
  sentAt: true,
  closedAt: true,
  cancelledAt: true,
  createdAt: true,
  project: { select: { name: true, address: true } },
  vendor: {
    select: {
      id: true,
      name: true,
      taxId: true,
      phone: true,
      email: true,
      address: true,
      contactName: true,
      paymentTermsDays: true,
    },
  },
  creator: { select: { id: true, name: true } },
  approver: { select: { id: true, name: true } },
  lines: { select: LINE_SELECT, orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }] },
  receipts: {
    select: {
      id: true,
      receivedOn: true,
      ref: true,
      note: true,
      createdAt: true,
      receiver: { select: { id: true, name: true } },
      lines: { select: { purchaseOrderLineId: true, quantity: true } },
    },
    orderBy: [{ receivedOn: 'asc' as const }, { createdAt: 'asc' as const }],
  },
  invoices: {
    select: {
      id: true,
      invoiceNumber: true,
      invoiceDate: true,
      status: true,
      total: true,
    },
    orderBy: [{ invoiceDate: 'asc' as const }, { createdAt: 'asc' as const }],
  },
} satisfies Prisma.PurchaseOrderSelect;

type OrderRow = Prisma.PurchaseOrderGetPayload<{ select: typeof SELECT }>;

/**
 * Legal status moves. A map, as indents do it, so an illegal move — receiving a draft, approving a
 * cancelled order — is visibly absent rather than forgotten in a chain of ifs. Receiving moves an
 * order between `approved`/`sent` and the two received states by itself; those are not requests.
 */
const TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  draft: ['pending_approval', 'approved', 'cancelled'],
  pending_approval: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'cancelled', 'closed'],
  sent: ['cancelled', 'closed'],
  partially_received: ['closed'],
  received: ['closed'],
  closed: [],
  cancelled: [],
};

/**
 * Purchase orders: raising them, the approval limits, receiving goods against them, and what they
 * commit against the site's cost codes until they are billed (roadmap Phase 2, module 2).
 *
 * Registers itself as the `purchase_orders` commitment source, so the cost report's "committed"
 * column is this module's open, unbilled order value without the cost-codes module knowing the
 * tables.
 */
@Injectable()
export class PurchaseOrdersService implements CommitmentSource {
  readonly name = 'purchase_orders';
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly limits: ApprovalLimitsService,
    private readonly notifications: NotificationsService,
    private readonly webhooks: WebhookEvents,
    commitments: CostCommitmentsService,
  ) {
    commitments.register(this);
  }

  // --- the commitment source -------------------------------------------------------------------

  /**
   * The approved orders' value on this site not yet billed, per cost code. Billed means an approved
   * invoice: that is the moment an expense is written, so the money moves from committed to actual
   * in the same transaction and is never in both.
   */
  async outstanding(
    tx: TenantTx,
    projectId: string,
  ): Promise<ReadonlyArray<{ costCodeId: string | null; amount: bigint }>> {
    const lines = await tx.purchaseOrderLine.findMany({
      where: {
        order: { projectId, status: { in: [...COMMITTED_PO_STATUSES] } },
      },
      select: {
        costCodeId: true,
        quantity: true,
        receivedQuantity: true,
        unitRate: true,
        taxRateBp: true,
        order: { select: { status: true } },
        invoiceLines: {
          where: { invoice: { status: 'approved' } },
          select: { amount: true, taxAmount: true },
        },
      },
    });
    const byCode = new Map<string | null, bigint>();
    for (const line of lines) {
      const billed = line.invoiceLines.reduce((sum, row) => sum + row.amount + row.taxAmount, 0n);
      const amount = outstandingCommitment({
        status: line.order.status,
        quantity: line.quantity.toString(),
        received_quantity: line.receivedQuantity.toString(),
        unit_rate: line.unitRate,
        tax_rate_bp: line.taxRateBp,
        billed_total: billed,
      });
      if (amount > 0n) byCode.set(line.costCodeId, (byCode.get(line.costCodeId) ?? 0n) + amount);
    }
    return [...byCode.entries()].map(([costCodeId, amount]) => ({ costCodeId, amount }));
  }

  // --- reading ---------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListPurchaseOrdersQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      let maxTotal: bigint | null | undefined;
      if (query.awaiting_me) {
        if (!can(actor, 'procurement.approve')) return [];
        maxTotal = await this.limits.limitFor(tx, { userId: actor.userId, role: actor.role });
      }
      const rows = await tx.purchaseOrder.findMany({
        where: {
          ...(query.project_id
            ? { projectId: query.project_id }
            : this.access.scopeFilterByProjectId(actor)),
          ...(query.vendor_id ? { vendorId: query.vendor_id } : {}),
          ...(query.awaiting_me
            ? {
                status: 'pending_approval' as const,
                ...(maxTotal === null ? {} : { total: { lte: maxTotal } }),
              }
            : query.status
              ? { status: query.status }
              : {}),
        },
        select: {
          id: true,
          number: true,
          status: true,
          projectId: true,
          total: true,
          subtotal: true,
          taxTotal: true,
          expectedOn: true,
          createdAt: true,
          approvedAt: true,
          project: { select: { name: true } },
          vendor: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true } },
          approver: { select: { id: true, name: true } },
          _count: { select: { lines: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });
      const money = can(actor, 'procurement.view');
      return rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        project_id: row.projectId,
        project_name: row.project.name,
        vendor_id: row.vendor.id,
        vendor_name: row.vendor.name,
        subtotal: money ? row.subtotal.toString() : null,
        tax_total: money ? row.taxTotal.toString() : null,
        total: money ? row.total.toString() : null,
        expected_on: row.expectedOn ? utcDateToIsoDate(row.expectedOn) : null,
        created_at: row.createdAt.toISOString(),
        approved_at: row.approvedAt?.toISOString() ?? null,
        created_by: row.creator,
        approved_by: row.approver,
        line_count: row._count.lines,
      }));
    });
  }

  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const myLimit = can(actor, 'procurement.approve')
        ? await this.limits.limitFor(tx, { userId: actor.userId, role: actor.role })
        : 0n;
      const approvers =
        row.status === 'pending_approval'
          ? await this.limits.approversFor(tx, actor.tenantId, row.projectId, row.total)
          : [];
      return {
        ...orderView(row, can(actor, 'procurement.view')),
        approval: {
          my_limit: can(actor, 'procurement.approve') ? (myLimit?.toString() ?? null) : '0',
          can_approve:
            can(actor, 'procurement.approve') && withinApprovalLimit(row.total, myLimit),
          approvers,
        },
      };
    });
  }

  /** Every order the caller can see, as CSV — the list a buyer reconciles against the supplier's. */
  async exportCsv(actor: RequestUser, query: ListPurchaseOrdersQuery): Promise<string> {
    const rows = await this.list(actor, query);
    const digits = currencyMinorDigits(actor.currency);
    const money = (value: string | null) => (value === null ? '' : minorToDecimal(BigInt(value), digits));
    const header = [
      'PO number',
      'Site',
      'Supplier',
      'Status',
      'Raised on',
      'Raised by',
      'Approved by',
      'Approved at',
      'Expected on',
      `Subtotal (${actor.currency})`,
      `Tax (${actor.currency})`,
      `Total (${actor.currency})`,
    ];
    const lines = rows.map((row) =>
      [
        row.number,
        row.project_name,
        row.vendor_name,
        row.status,
        row.created_at.slice(0, 10),
        row.created_by.name,
        row.approved_by?.name ?? '',
        row.approved_at ?? '',
        row.expected_on ?? '',
        money(row.subtotal),
        money(row.tax_total),
        money(row.total),
      ]
        .map(csvCell)
        .join(','),
    );
    return [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
  }

  // --- raising and editing ---------------------------------------------------------------------

  async create(actor: RequestUser, input: CreatePurchaseOrderInput) {
    await this.access.assertAccess(actor, input.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const id = await this.createDraft(tx, actor, {
        projectId: input.project_id,
        vendorId: input.vendor_id,
        notes: input.notes ?? null,
        deliveryAddress: input.delivery_address ?? null,
        expectedOn: input.expected_on ?? null,
        indentId: input.indent_id ?? null,
        rfqId: null,
        lines: input.lines,
      });
      return orderView(await this.load(tx, actor, id), true);
    });
  }

  /**
   * Writes a draft order. Shared by "raise an order" and "award the RFQ", so an order from a quote
   * is checked exactly as one typed in.
   */
  async createDraft(
    tx: TenantTx,
    actor: RequestUser,
    input: {
      projectId: string;
      vendorId: string;
      notes: string | null;
      deliveryAddress: string | null;
      expectedOn: string | null;
      indentId: string | null;
      rfqId: string | null;
      lines: readonly PurchaseOrderLineInput[];
    },
  ): Promise<string> {
    await activeVendor(tx, input.vendorId);
    if (input.indentId) {
      const indent = await tx.materialIndent.findFirst({
        where: { id: input.indentId, projectId: input.projectId, deletedAt: null },
        select: { status: true },
      });
      if (!indent) throw ApiError.notFound('Indent');
      if (indent.status !== 'approved' && indent.status !== 'ordered') {
        throw ApiError.conflict(`This indent is ${indent.status}; only an approved indent is ordered.`);
      }
    }
    const lines = await buildLines(tx, input.projectId, input.lines);
    const totals = orderTotals(lines.map(toPriced));
    const number = await nextNumber(tx, actor.tenantId, 'PO', 5);
    const order = await tx.purchaseOrder.create({
      data: {
        tenantId: actor.tenantId,
        projectId: input.projectId,
        vendorId: input.vendorId,
        number,
        status: 'draft',
        rfqId: input.rfqId,
        indentId: input.indentId,
        notes: input.notes,
        deliveryAddress: input.deliveryAddress,
        expectedOn: input.expectedOn ? isoDateToUtcDate(input.expectedOn) : null,
        subtotal: totals.subtotal,
        taxTotal: totals.tax,
        total: totals.total,
        createdBy: actor.userId,
        lines: { create: lines.map((line) => ({ ...line, tenantId: actor.tenantId })) },
      },
      select: { id: true },
    });
    return order.id;
  }

  /** Only a draft is edited. Lines given replace the order's lines, and the totals follow them. */
  async update(actor: RequestUser, id: string, input: UpdatePurchaseOrderInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const order = await this.loadBare(tx, actor, id);
      if (order.status !== 'draft') {
        throw ApiError.conflict(
          `This order is ${label(order.status)}. Only a draft can be edited — send it back first.`,
          { status: order.status },
        );
      }
      if (input.vendor_id) await activeVendor(tx, input.vendor_id);
      let totals: { subtotal: bigint; tax: bigint; total: bigint } | null = null;
      if (input.lines) {
        const lines = await buildLines(tx, order.projectId, input.lines);
        totals = orderTotals(lines.map(toPriced));
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((line) => ({ ...line, tenantId: actor.tenantId, purchaseOrderId: id })),
        });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(input.vendor_id === undefined ? {} : { vendorId: input.vendor_id }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.delivery_address === undefined ? {} : { deliveryAddress: input.delivery_address }),
          ...(input.expected_on === undefined
            ? {}
            : { expectedOn: input.expected_on ? isoDateToUtcDate(input.expected_on) : null }),
          ...(totals ? { subtotal: totals.subtotal, taxTotal: totals.tax, total: totals.total } : {}),
        },
      });
      return orderView(await this.load(tx, actor, id), true);
    });
  }

  // --- the approval flow -----------------------------------------------------------------------

  /**
   * Ask for approval. Within the requester's own limit, the order is approved there and then —
   * that is what a limit is for, and making a manager wait on the owner for a ₹2,000 order teaches
   * everybody to split orders. Above it, the order waits for somebody whose limit covers it, and
   * they are told.
   */
  async submit(actor: RequestUser, id: string) {
    const { view, notify } = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const order = await this.loadBare(tx, actor, id);
      assertTransition(order.status, 'pending_approval');
      const lineCount = await tx.purchaseOrderLine.count({ where: { purchaseOrderId: id } });
      if (lineCount === 0) throw ApiError.conflict('An order needs at least one line');

      const limit = can(actor, 'procurement.approve')
        ? await this.limits.limitFor(tx, { userId: actor.userId, role: actor.role })
        : 0n;
      const selfApproved = can(actor, 'procurement.approve') && withinApprovalLimit(order.total, limit);

      await tx.purchaseOrder.update({
        where: { id },
        data: selfApproved
          ? {
              status: 'approved',
              submittedAt: new Date(),
              approvedBy: actor.userId,
              approvedAt: new Date(),
              decisionNote: 'Within the requester’s approval limit',
            }
          : { status: 'pending_approval', submittedAt: new Date(), decisionNote: null },
      });
      if (selfApproved) {
        await this.onApproved(tx, order.indentId);
        await this.webhooks.purchaseOrderApproved(tx, actor.tenantId, id);
      }

      const approvers = selfApproved
        ? []
        : await this.limits.approversFor(tx, actor.tenantId, order.projectId, order.total);
      return {
        view: orderView(await this.load(tx, actor, id), true),
        notify: approvers.filter((user) => user.id !== actor.userId).map((user) => user.id),
      };
    });

    if (notify.length > 0) {
      await this.safeNotify({
        tenantId: actor.tenantId,
        userIds: notify,
        projectId: view.project_id,
        type: 'purchase_order.approval_needed',
        title: `Purchase order ${view.number} needs approval`,
        body: `${view.vendor.name} · ${view.project_name}`,
        payload: { purchase_order_id: view.id, number: view.number, total: view.total },
      });
    }
    return view;
  }

  /**
   * Approve an order waiting for it. Refused — with who could approve it instead — when the order is
   * above the approver's limit: a limit that can be ignored by clicking anyway is not a limit.
   */
  async approve(actor: RequestUser, id: string, note: string | undefined) {
    const view = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const order = await this.loadBare(tx, actor, id);
      if (order.status !== 'pending_approval') {
        throw ApiError.conflict(`This order is ${label(order.status)}, not waiting for approval.`, {
          status: order.status,
        });
      }
      const limit = await this.limits.limitFor(tx, { userId: actor.userId, role: actor.role });
      if (!withinApprovalLimit(order.total, limit)) {
        const approvers = await this.limits.approversFor(
          tx,
          actor.tenantId,
          order.projectId,
          order.total,
        );
        throw ApiError.forbidden(
          `This order is above your approval limit. ${
            approvers.length > 0
              ? `${approvers.map((user) => user.name).join(', ')} can approve it.`
              : 'Only the owner can approve it.'
          }`,
        );
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'approved',
          approvedBy: actor.userId,
          approvedAt: new Date(),
          decisionNote: note ?? null,
        },
      });
      await this.onApproved(tx, order.indentId);
      await this.webhooks.purchaseOrderApproved(tx, actor.tenantId, id);
      return orderView(await this.load(tx, actor, id), true);
    });
    await this.safeNotify({
      tenantId: actor.tenantId,
      userIds: [view.created_by.id],
      exceptUserId: actor.userId,
      projectId: view.project_id,
      type: 'purchase_order.approved',
      title: `Purchase order ${view.number} approved`,
      body: `${view.vendor.name} · ${view.project_name}`,
      payload: { purchase_order_id: view.id, number: view.number },
    });
    return view;
  }

  /** Send it back to draft with the reason, so whoever raised it can fix it and ask again. */
  async reject(actor: RequestUser, id: string, note: string) {
    const view = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const order = await this.loadBare(tx, actor, id);
      if (order.status !== 'pending_approval') {
        throw ApiError.conflict(`This order is ${label(order.status)}, not waiting for approval.`);
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'draft', decisionNote: note, approvedBy: null, approvedAt: null },
      });
      return orderView(await this.load(tx, actor, id), true);
    });
    await this.safeNotify({
      tenantId: actor.tenantId,
      userIds: [view.created_by.id],
      exceptUserId: actor.userId,
      projectId: view.project_id,
      type: 'purchase_order.rejected',
      title: `Purchase order ${view.number} sent back`,
      body: note,
      payload: { purchase_order_id: view.id, number: view.number },
    });
    return view;
  }

  /** Mark it sent to the supplier. The print view is what is sent; this records that it was. */
  async send(actor: RequestUser, id: string) {
    return this.move(actor, id, 'sent', { sentAt: new Date() });
  }

  /**
   * Cancel an order nothing has arrived against. Once goods have been received the order is real
   * history; it is closed instead, which keeps what came and stops waiting for the rest.
   */
  async cancel(actor: RequestUser, id: string) {
    return this.move(actor, id, 'cancelled', { cancelledAt: new Date() });
  }

  /** Nothing more is coming. What was received and not yet billed stays committed. */
  async close(actor: RequestUser, id: string) {
    return this.move(actor, id, 'closed', { closedAt: new Date() });
  }

  private async move(
    actor: RequestUser,
    id: string,
    to: PurchaseOrderStatus,
    data: Prisma.PurchaseOrderUpdateInput,
  ) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const order = await this.loadBare(tx, actor, id);
      assertTransition(order.status, to);
      await tx.purchaseOrder.update({ where: { id }, data: { status: to, ...data } });
      return orderView(await this.load(tx, actor, id), can(actor, 'procurement.view'));
    });
  }

  /** An order placed against an indent moves the indent on, so nobody orders it a second time. */
  private async onApproved(tx: TenantTx, indentId: string | null): Promise<void> {
    if (!indentId) return;
    await tx.materialIndent.updateMany({
      where: { id: indentId, status: 'approved' },
      data: { status: 'ordered' },
    });
  }

  // --- goods received --------------------------------------------------------------------------

  /**
   * Sign for a delivery against the order: a goods receipt note, and a stock movement in for every
   * line with a catalogue material — the same ledger row an indent receipt writes, so the store's
   * balance and the overrun report see the delivery whichever way it was ordered.
   *
   * Partial deliveries are the normal case: each receipt adds to what the line has received. More
   * than is still outstanding is refused — a delivery bigger than the order is either a counting
   * mistake or goods nobody ordered, and both are for the buyer to sort out, not the gate.
   *
   * The movement is not linked to the indent even when the order came from one. An indent's own
   * receipt rewrites its movements wholesale on correction, and it would take these with it.
   */
  async receive(actor: RequestUser, id: string, input: ReceiveGoodsInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const order = await this.loadBare(tx, actor, id);
      if (!RECEIVABLE_PO_STATUSES.includes(order.status)) {
        throw ApiError.conflict(
          order.status === 'received'
            ? 'Everything on this order has already been received.'
            : `This order is ${label(order.status)}; goods are received only against an approved order.`,
          { status: order.status },
        );
      }
      const lines = await tx.purchaseOrderLine.findMany({
        where: { purchaseOrderId: id },
        select: { id: true, materialId: true, quantity: true, receivedQuantity: true, description: true, unit: true },
      });
      const byId = new Map(lines.map((line) => [line.id, line]));
      // Received so far per line, in thousandths, updated as this receipt is written.
      const receivedSoFar = new Map(
        lines.map((line) => [line.id, quantityToThousandths(line.receivedQuantity.toString())]),
      );
      const seen = new Set<string>();
      for (const row of input.lines) {
        const line = byId.get(row.po_line_id);
        if (!line) {
          throw ApiError.validationFailed({ po_line_id: row.po_line_id }, 'That line is not on this order');
        }
        if (seen.has(row.po_line_id)) {
          throw ApiError.validationFailed({ po_line_id: row.po_line_id }, 'A line appears twice');
        }
        seen.add(row.po_line_id);
        const left =
          quantityToThousandths(line.quantity.toString()) -
          quantityToThousandths(line.receivedQuantity.toString());
        if (quantityToThousandths(row.quantity) > left) {
          throw ApiError.conflict(
            `Only ${thousandthsToQuantity(left)} ${line.unit} of ${line.description} is still to come on this order.`,
            { po_line_id: line.id, outstanding: thousandthsToQuantity(left), received: row.quantity },
          );
        }
      }

      const receipt = await tx.goodsReceipt.create({
        data: {
          tenantId: actor.tenantId,
          purchaseOrderId: id,
          projectId: order.projectId,
          receivedOn: isoDateToUtcDate(input.received_on),
          ref: input.ref ?? null,
          note: input.note ?? null,
          receivedBy: actor.userId,
        },
        select: { id: true },
      });

      for (const row of input.lines) {
        const line = byId.get(row.po_line_id)!;
        const movement = line.materialId
          ? await tx.stockMovement.create({
              data: {
                tenantId: actor.tenantId,
                projectId: order.projectId,
                materialId: line.materialId,
                type: 'in',
                quantity: row.quantity,
                movedOn: isoDateToUtcDate(input.received_on),
                ref: input.ref ?? order.number,
                note: `${order.number} · goods received`,
                recordedBy: actor.userId,
              },
              select: { id: true },
            })
          : null;
        await tx.goodsReceiptLine.create({
          data: {
            tenantId: actor.tenantId,
            receiptId: receipt.id,
            purchaseOrderLineId: line.id,
            quantity: row.quantity,
            stockMovementId: movement?.id ?? null,
          },
        });
        const received = receivedSoFar.get(line.id)! + quantityToThousandths(row.quantity);
        receivedSoFar.set(line.id, received);
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQuantity: thousandthsToQuantity(received) },
        });
      }

      const complete = lines.every(
        (line) => receivedSoFar.get(line.id)! >= quantityToThousandths(line.quantity.toString()),
      );
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: complete ? 'received' : 'partially_received' },
      });
      if (complete && order.indentId) await this.markIndentReceived(tx, order.indentId, id);

      return orderView(await this.load(tx, actor, id), can(actor, 'procurement.view'));
    });
  }

  /**
   * The indent behind a fully received order reads as received too, with the counts the order
   * received — written straight onto its lines, not through the indent's own receipt, which would
   * post the stock a second time.
   */
  private async markIndentReceived(tx: TenantTx, indentId: string, orderId: string): Promise<void> {
    const lines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: orderId, materialId: { not: null } },
      select: { materialId: true, receivedQuantity: true },
    });
    for (const line of lines) {
      await tx.indentItem.updateMany({
        where: { indentId, materialId: line.materialId! },
        data: { receivedQuantity: line.receivedQuantity },
      });
    }
    await tx.materialIndent.updateMany({
      where: { id: indentId, status: { in: ['approved', 'ordered'] } },
      data: { status: 'received' },
    });
  }

  // --- helpers ---------------------------------------------------------------------------------

  private async loadBare(tx: TenantTx, actor: RequestUser, id: string) {
    const order = await tx.purchaseOrder.findUnique({
      where: { id },
      select: { id: true, status: true, projectId: true, total: true, indentId: true, number: true },
    });
    if (!order) throw ApiError.notFound('Purchase order');
    await this.access.assertAccess(actor, order.projectId);
    return order;
  }

  private async load(tx: TenantTx, actor: RequestUser, id: string): Promise<OrderRow> {
    const order = await tx.purchaseOrder.findUnique({ where: { id }, select: SELECT });
    if (!order) throw ApiError.notFound('Purchase order');
    await this.access.assertAccess(actor, order.projectId);
    return order;
  }

  /** A notification failing must never undo the order it is about. */
  private async safeNotify(input: Parameters<NotificationsService['notify']>[0]): Promise<void> {
    try {
      await this.notifications.notify(input);
    } catch (error) {
      this.logger.warn({ err: error, type: input.type }, 'Procurement notification failed');
    }
  }
}

// --- free functions --------------------------------------------------------------------------------

function assertTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw ApiError.conflict(`An order cannot go from ${label(from)} to ${label(to)}.`, {
      from,
      to,
      allowed: TRANSITIONS[from],
    });
  }
}

function label(status: string): string {
  return status.replace(/_/g, ' ');
}

async function activeVendor(tx: TenantTx, vendorId: string): Promise<void> {
  const vendor = await tx.vendor.findUnique({ where: { id: vendorId }, select: { active: true } });
  if (!vendor) throw ApiError.notFound('Supplier');
  if (!vendor.active) throw ApiError.conflict('That supplier is marked inactive. Reactivate them first.');
}

/**
 * The order's lines as rows, checked: materials exist, cost codes are this site's own, and every
 * line without a material says what it is.
 */
export async function buildLines(
  tx: TenantTx,
  projectId: string,
  inputs: readonly PurchaseOrderLineInput[],
) {
  const materialIds = [...new Set(inputs.flatMap((line) => (line.material_id ? [line.material_id] : [])))];
  const materials = await tx.material.findMany({
    where: { id: { in: materialIds }, deletedAt: null },
    select: { id: true, name: true, unit: true },
  });
  const material = new Map(materials.map((row) => [row.id, row]));
  if (materials.length !== materialIds.length) {
    throw ApiError.validationFailed(
      { unknown_material_ids: materialIds.filter((id) => !material.has(id)) },
      'Unknown materials',
    );
  }
  const codeIds = [...new Set(inputs.flatMap((line) => (line.cost_code_id ? [line.cost_code_id] : [])))];
  const codes = await tx.costCode.count({ where: { id: { in: codeIds }, projectId } });
  if (codes !== codeIds.length) {
    throw ApiError.validationFailed(
      { cost_code_id: 'not a cost code on this site' },
      'A cost code on this order is not one of this site’s',
    );
  }

  return inputs.map((line, position) => {
    const from = line.material_id ? material.get(line.material_id) : undefined;
    const description = line.description || from?.name;
    const unit = line.unit || from?.unit;
    if (!description || !unit) {
      throw ApiError.validationFailed(
        { lines: position },
        'A line without a catalogue material needs a description and a unit',
      );
    }
    const priced = priceLine(line);
    return {
      materialId: line.material_id ?? null,
      description,
      unit,
      quantity: line.quantity,
      unitRate: line.unit_rate,
      taxRateBp: line.tax_rate_bp,
      amount: priced.amount,
      taxAmount: priced.tax,
      costCodeId: line.cost_code_id ?? null,
      position,
    };
  });
}

function toPriced(line: { quantity: string; unitRate: bigint; taxRateBp: number }) {
  return { quantity: line.quantity, unit_rate: line.unitRate, tax_rate_bp: line.taxRateBp };
}

/**
 * The next document number in a company's series: `PO-00001`, `RFQ-0001`.
 *
 * A transaction-scoped advisory lock on the series makes two orders raised in the same instant
 * queue for the number instead of colliding on the unique index; it is released at commit.
 */
export async function nextNumber(
  tx: TenantTx,
  tenantId: string,
  prefix: 'PO' | 'RFQ',
  width: number,
): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:${prefix}`}))`;
  const rows =
    prefix === 'PO'
      ? await tx.purchaseOrder.findMany({ select: { number: true } })
      : await tx.purchaseRfq.findMany({ select: { number: true } });
  let max = 0;
  for (const row of rows) {
    const match = /-(\d+)$/.exec(row.number);
    if (match) max = Math.max(max, Number.parseInt(match[1]!, 10));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

function csvCell(value: string): string {
  // A leading = + - @ is a formula to a spreadsheet; a supplier name is not code to run.
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function orderView(row: OrderRow, money: boolean) {
  const hide = (value: bigint) => (money ? value.toString() : null);
  let billed = 0n;
  const lines = row.lines.map((line) => {
    const billedQty = line.invoiceLines.reduce(
      (sum, inv) => sum + quantityToThousandths(inv.quantity.toString()),
      0n,
    );
    for (const inv of line.invoiceLines) {
      if (inv.invoice.status === 'approved') billed += inv.amount + inv.taxAmount;
    }
    return {
      id: line.id,
      material_id: line.materialId,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity.toString(),
      unit_rate: hide(line.unitRate),
      tax_rate_bp: line.taxRateBp,
      amount: hide(line.amount),
      tax_amount: hide(line.taxAmount),
      total: hide(line.amount + line.taxAmount),
      cost_code: line.costCode,
      received_quantity: line.receivedQuantity.toString(),
      billed_quantity: thousandthsToQuantity(billedQty),
    };
  });
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    project_id: row.projectId,
    project_name: row.project.name,
    project_address: row.project.address,
    vendor: {
      id: row.vendor.id,
      name: row.vendor.name,
      tax_id: row.vendor.taxId,
      phone: row.vendor.phone,
      email: row.vendor.email,
      address: row.vendor.address,
      contact_name: row.vendor.contactName,
      payment_terms_days: row.vendor.paymentTermsDays,
    },
    rfq_id: row.rfqId,
    indent_id: row.indentId,
    notes: row.notes,
    delivery_address: row.deliveryAddress,
    expected_on: row.expectedOn ? utcDateToIsoDate(row.expectedOn) : null,
    subtotal: hide(row.subtotal),
    tax_total: hide(row.taxTotal),
    total: hide(row.total),
    billed_total: hide(billed),
    created_by: row.creator,
    created_at: row.createdAt.toISOString(),
    submitted_at: row.submittedAt?.toISOString() ?? null,
    approved_by: row.approver,
    approved_at: row.approvedAt?.toISOString() ?? null,
    decision_note: row.decisionNote,
    sent_at: row.sentAt?.toISOString() ?? null,
    closed_at: row.closedAt?.toISOString() ?? null,
    cancelled_at: row.cancelledAt?.toISOString() ?? null,
    lines,
    receipts: row.receipts.map((receipt) => ({
      id: receipt.id,
      received_on: utcDateToIsoDate(receipt.receivedOn),
      ref: receipt.ref,
      note: receipt.note,
      received_by: receipt.receiver,
      created_at: receipt.createdAt.toISOString(),
      lines: receipt.lines.map((line) => ({
        po_line_id: line.purchaseOrderLineId,
        quantity: line.quantity.toString(),
      })),
    })),
    invoices: money
      ? row.invoices.map((invoice) => ({
          id: invoice.id,
          invoice_number: invoice.invoiceNumber,
          invoice_date: utcDateToIsoDate(invoice.invoiceDate),
          status: invoice.status,
          total: invoice.total.toString(),
        }))
      : [],
  };
}

export type PurchaseOrderView = ReturnType<typeof orderView>;
