import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  INVOICEABLE_PO_STATUSES,
  isoDateToUtcDate,
  orderLineAmount,
  matchInvoice,
  quantityToThousandths,
  thousandthsToQuantity,
  utcDateToIsoDate,
  type ApprovePurchaseInvoiceInput,
  type ListPurchaseInvoicesQuery,
  type MatchFlag,
  type RecordPurchaseInvoiceInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { ApprovalLimitsService } from './approval-limits.service';

const SELECT = {
  id: true,
  purchaseOrderId: true,
  projectId: true,
  invoiceNumber: true,
  invoiceDate: true,
  dueDate: true,
  subtotal: true,
  taxTotal: true,
  total: true,
  attachmentS3Key: true,
  status: true,
  flags: true,
  toleranceBp: true,
  note: true,
  approvedAt: true,
  decisionNote: true,
  createdAt: true,
  project: { select: { name: true } },
  vendor: { select: { id: true, name: true, taxId: true } },
  order: { select: { number: true, status: true } },
  recorder: { select: { id: true, name: true } },
  approver: { select: { id: true, name: true } },
  lines: {
    select: {
      id: true,
      purchaseOrderLineId: true,
      quantity: true,
      unitRate: true,
      amount: true,
      taxAmount: true,
      expenseId: true,
      orderLine: {
        select: {
          description: true,
          unit: true,
          quantity: true,
          unitRate: true,
          taxRateBp: true,
          receivedQuantity: true,
          costCode: { select: { id: true, code: true, name: true } },
        },
      },
    },
    orderBy: { orderLine: { position: 'asc' as const } },
  },
} satisfies Prisma.PurchaseInvoiceSelect;

type InvoiceRow = Prisma.PurchaseInvoiceGetPayload<{ select: typeof SELECT }>;

/**
 * Supplier invoices against purchase orders, and the three-way match.
 *
 * Recording an invoice matches it at once — against the order's rates and quantities, and against
 * what has actually been received — and keeps what it found. Approving it books the cost: one
 * expense per cost code on the invoice, already approved, carrying the invoice's tax and the
 * supplier's tax number, so actual cost and the tax report both see it. That same moment takes the
 * billed value out of the order's commitment, so the cost report never counts it twice.
 */
@Injectable()
export class PurchaseInvoicesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly limits: ApprovalLimitsService,
  ) {}

  async list(actor: RequestUser, query: ListPurchaseInvoicesQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const rows = await this.tenantDb.clientFor(actor.tenantId).purchaseInvoice.findMany({
      where: {
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
        ...(query.purchase_order_id ? { purchaseOrderId: query.purchase_order_id } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      select: SELECT,
      // The ones waiting for somebody first, then newest.
      orderBy: [{ status: 'asc' }, { invoiceDate: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return rows.map(invoiceView);
  }

  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => invoiceView(await this.load(tx, actor, id)));
  }

  /** Record a supplier's invoice against an order, and match it. */
  async record(actor: RequestUser, orderId: string, input: RecordPurchaseInvoiceInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        select: { id: true, projectId: true, vendorId: true, status: true, number: true },
      });
      if (!order) throw ApiError.notFound('Purchase order');
      await this.access.assertAccess(actor, order.projectId);
      if (!INVOICEABLE_PO_STATUSES.includes(order.status)) {
        throw ApiError.conflict(
          `This order is ${order.status.replace(/_/g, ' ')}; an invoice is recorded against an approved order.`,
          { status: order.status },
        );
      }
      const duplicate = await tx.purchaseInvoice.findFirst({
        where: { vendorId: order.vendorId, invoiceNumber: input.invoice_number },
        select: { id: true },
      });
      if (duplicate) {
        throw ApiError.conflict(
          `Invoice ${input.invoice_number} from this supplier is already recorded.`,
          { purchase_invoice_id: duplicate.id },
        );
      }

      const orderLines = await this.orderLinesForMatch(tx, orderId, null);
      const known = new Set(orderLines.map((line) => line.id));
      const seen = new Set<string>();
      for (const line of input.lines) {
        if (!known.has(line.po_line_id)) {
          throw ApiError.validationFailed({ po_line_id: line.po_line_id }, 'That line is not on this order');
        }
        if (seen.has(line.po_line_id)) {
          throw ApiError.validationFailed({ po_line_id: line.po_line_id }, 'A line appears twice');
        }
        seen.add(line.po_line_id);
      }

      const tolerance = await this.limits.tolerance(tx, actor.tenantId);
      const flags = matchInvoice(
        orderLines,
        input.lines.map((line) => ({
          po_line_id: line.po_line_id,
          quantity: line.quantity,
          unit_rate: line.unit_rate,
          tax_amount: line.tax_amount,
        })),
        tolerance,
      );

      const lines = input.lines.map((line) => ({
        purchaseOrderLineId: line.po_line_id,
        quantity: line.quantity,
        unitRate: line.unit_rate,
        amount: orderLineAmount(line.quantity, line.unit_rate),
        taxAmount: line.tax_amount,
      }));
      const subtotal = lines.reduce((sum, line) => sum + line.amount, 0n);
      const tax = lines.reduce((sum, line) => sum + line.taxAmount, 0n);

      const invoice = await tx.purchaseInvoice.create({
        data: {
          tenantId: actor.tenantId,
          purchaseOrderId: orderId,
          projectId: order.projectId,
          vendorId: order.vendorId,
          invoiceNumber: input.invoice_number,
          invoiceDate: isoDateToUtcDate(input.invoice_date),
          dueDate: input.due_date ? isoDateToUtcDate(input.due_date) : null,
          subtotal,
          taxTotal: tax,
          total: subtotal + tax,
          attachmentS3Key: input.attachment_s3_key ?? null,
          status: flags.length === 0 ? 'matched' : 'mismatch',
          flags: flags as unknown as Prisma.InputJsonValue,
          toleranceBp: tolerance,
          note: input.note ?? null,
          recordedBy: actor.userId,
          lines: { create: lines.map((line) => ({ ...line, tenantId: actor.tenantId })) },
        },
        select: { id: true },
      });
      return invoiceView(await this.load(tx, actor, invoice.id));
    });
  }

  /**
   * Approve an invoice, booking it as expenses.
   *
   * A matched invoice is approved by whoever records invoices. One the match flagged needs somebody
   * who approves orders to accept the difference, with a reason — it is a decision to pay more, or
   * for less, than was agreed. It is matched again first: goods may have arrived since it was
   * recorded, and an invoice that was ahead of the delivery should not need an override once the
   * delivery has caught up.
   */
  async approve(actor: RequestUser, id: string, input: ApprovePurchaseInvoiceInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const invoice = await this.load(tx, actor, id);
      if (invoice.status === 'approved' || invoice.status === 'rejected') {
        throw ApiError.conflict(`This invoice is already ${invoice.status}.`, { status: invoice.status });
      }

      const orderLines = await this.orderLinesForMatch(tx, invoice.purchaseOrderId, id);
      const flags = matchInvoice(
        orderLines,
        invoice.lines.map((line) => ({
          po_line_id: line.purchaseOrderLineId,
          quantity: line.quantity.toString(),
          unit_rate: line.unitRate,
          tax_amount: line.taxAmount,
        })),
        invoice.toleranceBp,
      );
      if (flags.length > 0) {
        if (!input.accept_variance) {
          throw ApiError.conflict(
            'This invoice does not match the order and what was received. Accept the difference with a reason, or reject it.',
            { flags },
          );
        }
        if (!can(actor, 'procurement.approve')) {
          throw ApiError.forbidden('Accepting a difference needs somebody who approves purchase orders.');
        }
      }

      const vendor = await tx.vendor.findUniqueOrThrow({
        where: { id: invoice.vendor.id },
        select: { name: true, taxId: true },
      });

      // One expense per cost code: the cost report books by code, and an expense has one.
      const groups = new Map<string | null, { amount: bigint; tax: bigint; lineIds: string[] }>();
      for (const line of invoice.lines) {
        const code = line.orderLine.costCode?.id ?? null;
        const group = groups.get(code) ?? { amount: 0n, tax: 0n, lineIds: [] };
        group.amount += line.amount + line.taxAmount;
        group.tax += line.taxAmount;
        group.lineIds.push(line.id);
        groups.set(code, group);
      }
      const now = new Date();
      for (const [costCodeId, group] of groups) {
        const expense = await tx.expense.create({
          data: {
            tenantId: actor.tenantId,
            projectId: invoice.projectId,
            amount: group.amount,
            taxAmount: group.tax,
            category: 'materials',
            spentOn: invoice.invoiceDate,
            billS3Key: invoice.attachmentS3Key,
            supplierTaxId: vendor.taxId,
            costCodeId,
            note: `${vendor.name} invoice ${invoice.invoiceNumber} · ${invoice.order.number}`,
            // Approved with the invoice: the decision to pay it was this one, and an expense that
            // waited for a second sign-off would leave the money in neither committed nor actual.
            status: 'approved',
            submittedBy: invoice.recorder.id,
            approvedBy: actor.userId,
            approvedAt: now,
          },
          select: { id: true },
        });
        await tx.purchaseInvoiceLine.updateMany({
          where: { id: { in: group.lineIds } },
          data: { expenseId: expense.id },
        });
      }

      await tx.purchaseInvoice.update({
        where: { id },
        data: {
          status: 'approved',
          flags: flags as unknown as Prisma.InputJsonValue,
          approvedBy: actor.userId,
          approvedAt: now,
          decisionNote: input.note ?? null,
        },
      });
      return invoiceView(await this.load(tx, actor, id));
    });
  }

  async reject(actor: RequestUser, id: string, note: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const invoice = await this.load(tx, actor, id);
      if (invoice.status === 'approved' || invoice.status === 'rejected') {
        throw ApiError.conflict(`This invoice is already ${invoice.status}.`);
      }
      await tx.purchaseInvoice.update({
        where: { id },
        data: { status: 'rejected', decisionNote: note, approvedBy: actor.userId, approvedAt: new Date() },
      });
      return invoiceView(await this.load(tx, actor, id));
    });
  }

  /**
   * Delete an invoice recorded in error. An approved one has become expenses and is refused;
   * deleting a rejected one frees its number for the supplier's corrected invoice.
   */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const invoice = await this.load(tx, actor, id);
      if (invoice.status === 'approved') {
        throw ApiError.conflict('An approved invoice is booked as expenses and cannot be deleted.');
      }
      await tx.purchaseInvoice.delete({ where: { id } });
    });
  }

  /**
   * The order's lines as the match sees them: ordered, received, and billed on every other invoice
   * that still stands. `exceptInvoiceId` leaves out the invoice being re-matched.
   */
  private async orderLinesForMatch(tx: TenantTx, orderId: string, exceptInvoiceId: string | null) {
    const lines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: orderId },
      select: {
        id: true,
        quantity: true,
        unitRate: true,
        taxRateBp: true,
        receivedQuantity: true,
        invoiceLines: {
          where: {
            invoice: { status: { not: 'rejected' } },
            ...(exceptInvoiceId ? { invoiceId: { not: exceptInvoiceId } } : {}),
          },
          select: { quantity: true },
        },
      },
    });
    return lines.map((line) => ({
      id: line.id,
      quantity: line.quantity.toString(),
      unit_rate: line.unitRate,
      tax_rate_bp: line.taxRateBp,
      received_quantity: line.receivedQuantity.toString(),
      previously_billed_quantity: thousandthsToQuantity(
        line.invoiceLines.reduce((sum, row) => sum + quantityToThousandths(row.quantity.toString()), 0n),
      ),
    }));
  }

  private async load(tx: TenantTx, actor: RequestUser, id: string): Promise<InvoiceRow> {
    const invoice = await tx.purchaseInvoice.findUnique({ where: { id }, select: SELECT });
    if (!invoice) throw ApiError.notFound('Invoice');
    await this.access.assertAccess(actor, invoice.projectId);
    return invoice;
  }
}

function invoiceView(row: InvoiceRow) {
  return {
    id: row.id,
    purchase_order_id: row.purchaseOrderId,
    purchase_order_number: row.order.number,
    project_id: row.projectId,
    project_name: row.project.name,
    vendor: { id: row.vendor.id, name: row.vendor.name, tax_id: row.vendor.taxId },
    invoice_number: row.invoiceNumber,
    invoice_date: utcDateToIsoDate(row.invoiceDate),
    due_date: row.dueDate ? utcDateToIsoDate(row.dueDate) : null,
    subtotal: row.subtotal.toString(),
    tax_total: row.taxTotal.toString(),
    total: row.total.toString(),
    attachment_s3_key: row.attachmentS3Key,
    status: row.status,
    flags: (row.flags ?? []) as unknown as MatchFlag[],
    tolerance_bp: row.toleranceBp,
    note: row.note,
    recorded_by: row.recorder,
    approved_by: row.approver,
    approved_at: row.approvedAt?.toISOString() ?? null,
    decision_note: row.decisionNote,
    created_at: row.createdAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      po_line_id: line.purchaseOrderLineId,
      description: line.orderLine.description,
      unit: line.orderLine.unit,
      quantity: line.quantity.toString(),
      unit_rate: line.unitRate.toString(),
      amount: line.amount.toString(),
      tax_amount: line.taxAmount.toString(),
      ordered_quantity: line.orderLine.quantity.toString(),
      ordered_unit_rate: line.orderLine.unitRate.toString(),
      ordered_tax_rate_bp: line.orderLine.taxRateBp,
      received_quantity: line.orderLine.receivedQuantity.toString(),
      cost_code: line.orderLine.costCode,
      expense_id: line.expenseId,
    })),
  };
}

export type PurchaseInvoiceView = ReturnType<typeof invoiceView>;
