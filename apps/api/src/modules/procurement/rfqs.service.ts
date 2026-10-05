import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  compareQuotes,
  isoDateToUtcDate,
  utcDateToIsoDate,
  type AwardRfqInput,
  type CreateRfqInput,
  type ListRfqsQuery,
  type UpsertQuoteInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { PurchaseOrdersService, nextNumber } from './purchase-orders.service';

const SELECT = {
  id: true,
  number: true,
  title: true,
  notes: true,
  status: true,
  projectId: true,
  indentId: true,
  requiredBy: true,
  awardedQuoteId: true,
  createdAt: true,
  project: { select: { name: true } },
  creator: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      materialId: true,
      description: true,
      unit: true,
      quantity: true,
      position: true,
      costCode: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ position: 'asc' as const }, { id: 'asc' as const }],
  },
  quotes: {
    select: {
      id: true,
      deliveryDays: true,
      validUntil: true,
      notes: true,
      createdAt: true,
      vendor: { select: { id: true, name: true, taxId: true } },
      lines: { select: { rfqItemId: true, unitRate: true, taxRateBp: true } },
    },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
  purchaseOrders: { select: { id: true, number: true, status: true } },
} satisfies Prisma.PurchaseRfqSelect;

type RfqRow = Prisma.PurchaseRfqGetPayload<{ select: typeof SELECT }>;

/**
 * Requests for quotation and the comparison of the quotes that answer them.
 *
 * Quotes are typed in by the buyer from whatever the supplier sent — a WhatsApp photo, an email, a
 * call. There is no supplier portal: the suppliers this product's customers buy from do not log in
 * to things, and a comparison that waits for them to would never be filled in.
 */
@Injectable()
export class RfqsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly orders: PurchaseOrdersService,
  ) {}

  async list(actor: RequestUser, query: ListRfqsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const rows = await this.tenantDb.clientFor(actor.tenantId).purchaseRfq.findMany({
      where: {
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
        ...(query.status ? { status: query.status } : {}),
      },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        projectId: true,
        requiredBy: true,
        createdAt: true,
        project: { select: { name: true } },
        _count: { select: { items: true, quotes: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      title: row.title,
      status: row.status,
      project_id: row.projectId,
      project_name: row.project.name,
      required_by: row.requiredBy ? utcDateToIsoDate(row.requiredBy) : null,
      created_at: row.createdAt.toISOString(),
      item_count: row._count.items,
      quote_count: row._count.quotes,
    }));
  }

  /** The RFQ, its quotes, and the side-by-side comparison worked out from them. */
  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => rfqView(await this.load(tx, actor, id)));
  }

  /**
   * Start an RFQ — from scratch, or from an approved indent, whose lines become the items. The
   * indent stays approved: it is ordered when an order is actually placed, not when prices are
   * asked for.
   */
  async create(actor: RequestUser, input: CreateRfqInput) {
    await this.access.assertAccess(actor, input.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      let items = input.items ?? [];
      if (input.indent_id) {
        const indent = await tx.materialIndent.findFirst({
          where: { id: input.indent_id, projectId: input.project_id, deletedAt: null },
          select: {
            status: true,
            items: { select: { materialId: true, quantity: true } },
          },
        });
        if (!indent) throw ApiError.notFound('Indent');
        if (indent.status !== 'approved') {
          throw ApiError.conflict(
            `This indent is ${indent.status}. Quotes are asked for an approved indent.`,
            { status: indent.status },
          );
        }
        if (items.length === 0) {
          items = indent.items.map((item) => ({
            material_id: item.materialId,
            quantity: item.quantity.toString(),
          }));
        }
      }

      const materialIds = [...new Set(items.flatMap((item) => (item.material_id ? [item.material_id] : [])))];
      const materials = new Map(
        (
          await tx.material.findMany({
            where: { id: { in: materialIds }, deletedAt: null },
            select: { id: true, name: true, unit: true },
          })
        ).map((row) => [row.id, row]),
      );
      if (materials.size !== materialIds.length) throw ApiError.validationFailed({}, 'Unknown materials');
      const codeIds = [...new Set(items.flatMap((item) => (item.cost_code_id ? [item.cost_code_id] : [])))];
      if ((await tx.costCode.count({ where: { id: { in: codeIds }, projectId: input.project_id } })) !== codeIds.length) {
        throw ApiError.validationFailed({ cost_code_id: 'not on this site' }, 'A cost code is not one of this site’s');
      }

      const number = await nextNumber(tx, actor.tenantId, 'RFQ', 4);
      const rfq = await tx.purchaseRfq.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          number,
          title: input.title,
          notes: input.notes ?? null,
          indentId: input.indent_id ?? null,
          requiredBy: input.required_by ? isoDateToUtcDate(input.required_by) : null,
          createdBy: actor.userId,
          items: {
            create: items.map((item, position) => {
              const material = item.material_id ? materials.get(item.material_id) : undefined;
              const description = item.description || material?.name;
              const unit = item.unit || material?.unit;
              if (!description || !unit) {
                throw ApiError.validationFailed(
                  { items: position },
                  'An item without a catalogue material needs a description and a unit',
                );
              }
              return {
                tenantId: actor.tenantId,
                materialId: item.material_id ?? null,
                description,
                unit,
                quantity: item.quantity,
                costCodeId: item.cost_code_id ?? null,
                position,
              };
            }),
          },
        },
        select: { id: true },
      });
      return rfqView(await this.load(tx, actor, rfq.id));
    });
  }

  /** Enter or replace one supplier's quote. Prices from one supplier, one quote per RFQ. */
  async upsertQuote(actor: RequestUser, id: string, input: UpsertQuoteInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rfq = await this.load(tx, actor, id);
      assertOpen(rfq.status);
      const vendor = await tx.vendor.findUnique({ where: { id: input.vendor_id }, select: { active: true } });
      if (!vendor) throw ApiError.notFound('Supplier');
      if (!vendor.active) throw ApiError.conflict('That supplier is marked inactive.');
      const itemIds = new Set(rfq.items.map((item) => item.id));
      const seen = new Set<string>();
      for (const line of input.lines) {
        if (!itemIds.has(line.rfq_item_id)) {
          throw ApiError.validationFailed({ rfq_item_id: line.rfq_item_id }, 'That item is not on this RFQ');
        }
        if (seen.has(line.rfq_item_id)) {
          throw ApiError.validationFailed({ rfq_item_id: line.rfq_item_id }, 'An item is priced twice');
        }
        seen.add(line.rfq_item_id);
      }
      const data = {
        deliveryDays: input.delivery_days ?? null,
        validUntil: input.valid_until ? isoDateToUtcDate(input.valid_until) : null,
        notes: input.notes ?? null,
      };
      const quote = await tx.purchaseQuote.upsert({
        where: { rfqId_vendorId: { rfqId: id, vendorId: input.vendor_id } },
        create: { tenantId: actor.tenantId, rfqId: id, vendorId: input.vendor_id, ...data },
        update: data,
        select: { id: true },
      });
      await tx.purchaseQuoteLine.deleteMany({ where: { quoteId: quote.id } });
      await tx.purchaseQuoteLine.createMany({
        data: input.lines.map((line) => ({
          tenantId: actor.tenantId,
          quoteId: quote.id,
          rfqItemId: line.rfq_item_id,
          unitRate: line.unit_rate,
          taxRateBp: line.tax_rate_bp,
        })),
      });
      return rfqView(await this.load(tx, actor, id));
    });
  }

  async removeQuote(actor: RequestUser, id: string, quoteId: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rfq = await this.load(tx, actor, id);
      assertOpen(rfq.status);
      const deleted = await tx.purchaseQuote.deleteMany({ where: { id: quoteId, rfqId: id } });
      if (deleted.count === 0) throw ApiError.notFound('Quote');
      return rfqView(await this.load(tx, actor, id));
    });
  }

  /**
   * Pick the winner: a draft purchase order to that supplier, for the items they priced, at their
   * prices, each line keeping the RFQ item's cost code. The order then goes through approval like
   * any other — choosing the cheapest quote is not the same decision as agreeing to spend it.
   */
  async award(actor: RequestUser, id: string, input: AwardRfqInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rfq = await this.load(tx, actor, id);
      assertOpen(rfq.status);
      const quote = rfq.quotes.find((row) => row.id === input.quote_id);
      if (!quote) throw ApiError.notFound('Quote');
      const priced = new Map(quote.lines.map((line) => [line.rfqItemId, line]));
      const lines = rfq.items.flatMap((item) => {
        const line = priced.get(item.id);
        if (!line) return [];
        return [
          {
            material_id: item.materialId,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity.toString(),
            unit_rate: line.unitRate,
            tax_rate_bp: line.taxRateBp,
            cost_code_id: item.costCode?.id ?? null,
          },
        ];
      });
      if (lines.length === 0) throw ApiError.conflict('That quote prices none of the items.');

      const orderId = await this.orders.createDraft(tx, actor, {
        projectId: rfq.projectId,
        vendorId: quote.vendor.id,
        notes: input.notes ?? rfq.notes ?? null,
        deliveryAddress: null,
        expectedOn: input.expected_on ?? null,
        indentId: rfq.indentId,
        rfqId: rfq.id,
        lines,
      });
      await tx.purchaseRfq.update({
        where: { id },
        data: { status: 'awarded', awardedQuoteId: quote.id },
      });
      return { purchase_order_id: orderId, rfq: rfqView(await this.load(tx, actor, id)) };
    });
  }

  async cancel(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rfq = await this.load(tx, actor, id);
      assertOpen(rfq.status);
      await tx.purchaseRfq.update({ where: { id }, data: { status: 'cancelled' } });
      return rfqView(await this.load(tx, actor, id));
    });
  }

  private async load(tx: TenantTx, actor: RequestUser, id: string): Promise<RfqRow> {
    const rfq = await tx.purchaseRfq.findUnique({ where: { id }, select: SELECT });
    if (!rfq) throw ApiError.notFound('Request for quotation');
    await this.access.assertAccess(actor, rfq.projectId);
    return rfq;
  }
}

function assertOpen(status: string): void {
  if (status !== 'open') {
    throw ApiError.conflict(`This request for quotation is ${status}.`, { status });
  }
}

function rfqView(row: RfqRow) {
  const comparison = compareQuotes(
    row.items.map((item) => ({ id: item.id, quantity: item.quantity.toString() })),
    row.quotes.map((quote) => ({
      id: quote.id,
      vendor_id: quote.vendor.id,
      delivery_days: quote.deliveryDays,
      lines: quote.lines.map((line) => ({
        rfq_item_id: line.rfqItemId,
        unit_rate: line.unitRate,
        tax_rate_bp: line.taxRateBp,
      })),
    })),
  );
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    notes: row.notes,
    status: row.status,
    project_id: row.projectId,
    project_name: row.project.name,
    indent_id: row.indentId,
    required_by: row.requiredBy ? utcDateToIsoDate(row.requiredBy) : null,
    awarded_quote_id: row.awardedQuoteId,
    created_by: row.creator,
    created_at: row.createdAt.toISOString(),
    purchase_orders: row.purchaseOrders,
    items: row.items.map((item) => ({
      id: item.id,
      material_id: item.materialId,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity.toString(),
      cost_code: item.costCode,
    })),
    quotes: row.quotes.map((quote) => ({
      id: quote.id,
      vendor: { id: quote.vendor.id, name: quote.vendor.name, tax_id: quote.vendor.taxId },
      delivery_days: quote.deliveryDays,
      valid_until: quote.validUntil ? utcDateToIsoDate(quote.validUntil) : null,
      notes: quote.notes,
      lines: quote.lines.map((line) => ({
        rfq_item_id: line.rfqItemId,
        unit_rate: line.unitRate.toString(),
        tax_rate_bp: line.taxRateBp,
      })),
    })),
    comparison: {
      lowest_quote_id: comparison.lowest_quote_id,
      best_split_total: comparison.best_split_total?.toString() ?? null,
      quotes: comparison.quotes.map((quote) => ({
        ...quote,
        subtotal: quote.subtotal.toString(),
        tax: quote.tax.toString(),
        total: quote.total.toString(),
      })),
      items: comparison.items.map((item) => ({
        rfq_item_id: item.rfq_item_id,
        lowest_quote_id: item.lowest_quote_id,
        cells: item.cells.map((cell) => ({
          quote_id: cell.quote_id,
          amount: cell.amount.toString(),
          tax: cell.tax.toString(),
          total: cell.total.toString(),
        })),
      })),
    },
  };
}

export type RfqView = ReturnType<typeof rfqView>;
