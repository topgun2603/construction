import { Injectable } from '@nestjs/common';
import type { CreatePlanInput, PlanView, UpdatePlanInput } from '@sitebook/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';

/**
 * The plan catalogue.
 *
 * Rows rather than an enum, because what a term costs and what it is called are commercial
 * decisions — the sort made on a phone call — and holding them in code meant a deploy to change a
 * price.
 *
 * Read through the ordinary Prisma client and not through `TenantDb`: `plans` has no `tenant_id`
 * and no RLS. The catalogue is the same for every builder, which is the whole point of it being
 * one list.
 */
@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What a builder may buy, in the order an operator arranged them.
   *
   * Retired plans are left out. A tenant sitting on one still sees their own — `forCode` answers
   * that — but nobody is offered a term that is no longer sold.
   */
  async listActive(): Promise<PlanView[]> {
    const rows = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toView);
  }

  /** Everything, including what has been retired. The console's view. */
  async listAll(): Promise<PlanView[]> {
    const rows = await this.prisma.plan.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toView);
  }

  /**
   * One plan by the code a tenant row holds.
   *
   * Null rather than throwing when it has gone. `tenants.plan` is deliberately not a foreign key —
   * a plan deleted by mistake must not take its customers' accounts down — so every reader has to
   * cope with the row being absent, and the ones that matter fall back to showing the code.
   */
  async forCode(code: string): Promise<PlanView | null> {
    const row = await this.prisma.plan.findUnique({ where: { code } });
    return row ? toView(row) : null;
  }

  /** How long a term runs, for working out when it ends. Null for a plan that never expires. */
  async monthsFor(code: string): Promise<number | null> {
    const row = await this.prisma.plan.findUnique({
      where: { code },
      select: { months: true },
    });
    return row?.months ?? null;
  }

  async create(input: CreatePlanInput): Promise<PlanView> {
    const clash = await this.prisma.plan.findUnique({
      where: { code: input.code },
      select: { id: true },
    });
    if (clash) throw ApiError.conflict('A plan with that code already exists');

    const row = await this.prisma.plan.create({
      data: {
        code: input.code,
        name: input.name,
        months: input.months,
        pricePaise: BigInt(input.price),
        description: input.description ?? null,
        badge: input.badge ?? null,
        highlights: input.highlights,
        isActive: input.is_active,
        sortOrder: input.sort_order,
      },
    });
    return toView(row);
  }

  async update(id: string, input: UpdatePlanInput): Promise<PlanView> {
    const existing = await this.prisma.plan.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw ApiError.notFound('Plan');

    const row = await this.prisma.plan.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.months === undefined ? {} : { months: input.months }),
        ...(input.price === undefined ? {} : { pricePaise: BigInt(input.price) }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.badge === undefined ? {} : { badge: input.badge }),
        ...(input.highlights === undefined ? {} : { highlights: input.highlights }),
        ...(input.is_active === undefined ? {} : { isActive: input.is_active }),
        ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      },
    });
    return toView(row);
  }

  /**
   * Removes a plan nobody is on.
   *
   * `countOnPlan` is handed in rather than run here, and that is not ceremony: `tenants` is behind
   * FORCE ROW LEVEL SECURITY and this service reads on the tenant-facing connection, which sees no
   * tenant rows at all outside a tenant context. Counting here would answer "nobody is on it" for
   * every plan in the catalogue and delete the lot out from under paying accounts. Only the console
   * holds a connection that can see across tenants, so only the console can answer the question.
   *
   * A plan with customers is refused rather than cascaded. Deleting it would leave those accounts
   * pointing at a code that resolves to nothing — their plan page would go blank and the console
   * would not be able to say what they had bought. Retiring it with `is_active: false` is the
   * operation an operator actually wants: it stops being sold and keeps meaning something.
   */
  async remove(id: string, countOnPlan: (code: string) => Promise<number>): Promise<void> {
    const plan = await this.prisma.plan.findUnique({ where: { id }, select: { code: true } });
    if (!plan) throw ApiError.notFound('Plan');

    const inUse = await countOnPlan(plan.code);
    if (inUse > 0) {
      throw ApiError.conflict(
        `${inUse} ${inUse === 1 ? 'account is' : 'accounts are'} on this plan. Retire it instead of deleting it.`,
      );
    }

    await this.prisma.plan.delete({ where: { id } });
  }
}

function toView(row: {
  id: string;
  code: string;
  name: string;
  months: number | null;
  pricePaise: bigint;
  description: string | null;
  badge: string | null;
  highlights: string[];
  isActive: boolean;
  sortOrder: number;
}): PlanView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    months: row.months,
    // Paise as a string, like every other amount on the wire. A JSON number loses precision above
    // 2^53, and a price is money.
    price: row.pricePaise.toString(),
    description: row.description,
    badge: row.badge,
    highlights: row.highlights,
    is_active: row.isActive,
    sort_order: row.sortOrder,
  };
}
