import { Injectable } from '@nestjs/common';
import type {
  CreateContractorInput,
  Page,
  UpdateContractorInput,
  CursorPagination,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb } from '../../common/prisma/tenant-db.service';

export interface ContractorView {
  id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  payment_terms: string;
  worker_count: number;
}

const SELECT = {
  id: true,
  name: true,
  trade: true,
  phone: true,
  paymentTerms: true,
  _count: { select: { workers: { where: { deletedAt: null } } } },
} as const;

@Injectable()
export class ContractorsService {
  constructor(private readonly tenantDb: TenantDb) {}

  async list(actor: RequestUser, query: CursorPagination): Promise<Page<ContractorView>> {
    const rows = await this.tenantDb.clientFor(actor.tenantId).contractor.findMany({
      where: { deletedAt: null },
      select: SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...cursorArgs(query),
    });
    return toPage(rows, query.limit, toView);
  }

  async create(actor: RequestUser, input: CreateContractorInput): Promise<ContractorView> {
    const contractor = await this.tenantDb.clientFor(actor.tenantId).contractor.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        trade: input.trade,
        phone: input.phone,
        paymentTerms: input.payment_terms,
      },
      select: SELECT,
    });
    return toView(contractor);
  }

  async update(
    actor: RequestUser,
    id: string,
    input: UpdateContractorInput,
  ): Promise<ContractorView> {
    await this.assertExists(actor, id);
    const contractor = await this.tenantDb.clientFor(actor.tenantId).contractor.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.trade === undefined ? {} : { trade: input.trade }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.payment_terms === undefined ? {} : { paymentTerms: input.payment_terms }),
      },
      select: SELECT,
    });
    return toView(contractor);
  }

  /**
   * Soft delete. A contractor with wage history must never vanish — past wage lines
   * stay attached to them (spec §8A, "worker moves contractor mid-period").
   */
  async archive(actor: RequestUser, id: string): Promise<void> {
    await this.assertExists(actor, id);
    await this.tenantDb
      .clientFor(actor.tenantId)
      .contractor.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async assertExists(actor: RequestUser, id: string): Promise<void> {
    const found = await this.tenantDb
      .clientFor(actor.tenantId)
      .contractor.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!found) throw ApiError.notFound('Contractor');
  }
}

function toView(row: {
  id: string;
  name: string;
  trade: string | null;
  phone: string | null;
  paymentTerms: string;
  _count: { workers: number };
}): ContractorView {
  return {
    id: row.id,
    name: row.name,
    trade: row.trade,
    phone: row.phone,
    payment_terms: row.paymentTerms,
    worker_count: row._count.workers,
  };
}
