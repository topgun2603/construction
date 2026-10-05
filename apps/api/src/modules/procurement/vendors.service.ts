import { Injectable } from '@nestjs/common';
import {
  taxRule,
  validTaxIdOrNull,
  type CreateVendorInput,
  type ListVendorsQuery,
  type UpdateVendorInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';

const SELECT = {
  id: true,
  name: true,
  contactName: true,
  phone: true,
  email: true,
  address: true,
  taxId: true,
  paymentTermsDays: true,
  notes: true,
  active: true,
  createdAt: true,
} as const;

type VendorRow = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  paymentTermsDays: number | null;
  notes: string | null;
  active: boolean;
  createdAt: Date;
};

export function vendorView(row: VendorRow) {
  return {
    id: row.id,
    name: row.name,
    contact_name: row.contactName,
    phone: row.phone,
    email: row.email,
    address: row.address,
    tax_id: row.taxId,
    payment_terms_days: row.paymentTermsDays,
    notes: row.notes,
    active: row.active,
    created_at: row.createdAt.toISOString(),
  };
}

export type VendorView = ReturnType<typeof vendorView>;

/**
 * Suppliers of materials (roadmap Phase 2, module 2).
 *
 * Company-wide rather than per site: the cement dealer supplies every job, and a supplier's tax
 * number and terms are one fact, not one per site.
 */
@Injectable()
export class VendorsService {
  constructor(private readonly tenantDb: TenantDb) {}

  async list(actor: RequestUser, query: ListVendorsQuery) {
    const rows = await this.tenantDb.clientFor(actor.tenantId).vendor.findMany({
      where: {
        ...(query.active === undefined ? {} : { active: query.active }),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' as const } },
                { contactName: { contains: query.q, mode: 'insensitive' as const } },
                { taxId: { contains: query.q.toUpperCase() } },
              ],
            }
          : {}),
      },
      select: SELECT,
      // Active first: an inactive supplier is history, not somebody to order from.
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(vendorView);
  }

  /** One supplier, with what has been ordered from them and what is still open. */
  async get(actor: RequestUser, id: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const vendor = await db.vendor.findUnique({ where: { id }, select: SELECT });
    if (!vendor) throw ApiError.notFound('Supplier');
    const orders = await db.purchaseOrder.findMany({
      where: { vendorId: id },
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        createdAt: true,
        project: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    let ordered = 0n;
    for (const order of orders) {
      if (order.status !== 'cancelled' && order.status !== 'draft') ordered += order.total;
    }
    return {
      ...vendorView(vendor),
      ordered_total: ordered.toString(),
      orders: orders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        total: order.total.toString(),
        created_at: order.createdAt.toISOString(),
        project_id: order.project.id,
        project_name: order.project.name,
      })),
    };
  }

  async create(actor: RequestUser, input: CreateVendorInput) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    await this.assertNameFree(actor, input.name);
    const row = await db.vendor.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        contactName: input.contact_name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        taxId: vendorTaxId(actor, input.tax_id),
        paymentTermsDays: input.payment_terms_days ?? null,
        notes: input.notes ?? null,
        active: input.active ?? true,
      },
      select: SELECT,
    });
    return vendorView(row);
  }

  async update(actor: RequestUser, id: string, input: UpdateVendorInput) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const current = await db.vendor.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!current) throw ApiError.notFound('Supplier');
    if (input.name !== undefined && input.name.toLowerCase() !== current.name.toLowerCase()) {
      await this.assertNameFree(actor, input.name);
    }
    const row = await db.vendor.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.contact_name === undefined ? {} : { contactName: input.contact_name }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.tax_id === undefined ? {} : { taxId: vendorTaxId(actor, input.tax_id) }),
        ...(input.payment_terms_days === undefined
          ? {}
          : { paymentTermsDays: input.payment_terms_days }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.active === undefined ? {} : { active: input.active }),
      },
      select: SELECT,
    });
    return vendorView(row);
  }

  /**
   * Deletes a supplier nothing was ever asked of. One with quotes, orders or invoices is refused:
   * those records name it, and the answer is to mark it inactive.
   */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const vendor = await tx.vendor.findUnique({ where: { id }, select: { id: true } });
      if (!vendor) throw ApiError.notFound('Supplier');
      const [quotes, orders, invoices] = await Promise.all([
        tx.purchaseQuote.count({ where: { vendorId: id } }),
        tx.purchaseOrder.count({ where: { vendorId: id } }),
        tx.purchaseInvoice.count({ where: { vendorId: id } }),
      ]);
      if (quotes + orders + invoices > 0) {
        throw ApiError.conflict(
          'This supplier has quotes, orders or invoices on record. Mark them inactive instead.',
          { quotes, orders, invoices },
        );
      }
      await tx.vendor.delete({ where: { id } });
    });
  }

  private async assertNameFree(actor: RequestUser, name: string): Promise<void> {
    const taken = await this.tenantDb.clientFor(actor.tenantId).vendor.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (taken) throw ApiError.conflict(`There is already a supplier called ${name}`);
  }
}

/**
 * A supplier's tax number in the regime's stored form. Refused, not stored, when it fails the
 * regime's check — the same rule as an expense's supplier number, and for the same reason: the
 * number ends up on a tax return. A company under no tax regime has no number to check, so none
 * is kept.
 */
function vendorTaxId(actor: RequestUser, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const rule = taxRule(actor.taxRegime);
  if (!rule.idLabel) {
    throw ApiError.validationFailed(
      { tax_id: 'no tax regime' },
      'Your company is not set up for tax, so there is no tax number to record',
    );
  }
  const id = validTaxIdOrNull(actor.taxRegime, raw);
  if (!id) {
    throw ApiError.validationFailed({ tax_id: 'invalid' }, `That is not a valid ${rule.idLabel}`);
  }
  return id;
}
