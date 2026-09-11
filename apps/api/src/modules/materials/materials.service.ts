import { Injectable } from '@nestjs/common';
import type { CreateMaterialInput, ListMaterialsQuery, Page } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb } from '../../common/prisma/tenant-db.service';

export interface MaterialView {
  id: string;
  name: string;
  unit: string;
  category: string | null;
}

const SELECT = { id: true, name: true, unit: true, category: true } as const;

@Injectable()
export class MaterialsService {
  constructor(private readonly tenantDb: TenantDb) {}

  async list(actor: RequestUser, query: ListMaterialsQuery): Promise<Page<MaterialView>> {
    const rows = await this.tenantDb.clientFor(actor.tenantId).material.findMany({
      where: {
        deletedAt: null,
        ...(query.category ? { category: query.category } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      },
      select: SELECT,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      ...cursorArgs(query),
    });
    return toPage(rows, query.limit, toView);
  }

  /**
   * Adding a material that already exists is not an error — a supervisor raising an
   * indent should never be blocked because someone typed "Cement" first. The unique
   * index on (tenant, name) makes the upsert a no-op that returns the existing row.
   */
  async create(actor: RequestUser, input: CreateMaterialInput): Promise<MaterialView> {
    const material = await this.tenantDb.clientFor(actor.tenantId).material.upsert({
      where: { tenantId_name: { tenantId: actor.tenantId, name: input.name } },
      create: {
        tenantId: actor.tenantId,
        name: input.name,
        unit: input.unit,
        category: input.category,
      },
      update: { deletedAt: null },
      select: SELECT,
    });
    return toView(material);
  }

  async archive(actor: RequestUser, id: string): Promise<void> {
    const found = await this.tenantDb
      .clientFor(actor.tenantId)
      .material.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!found) throw ApiError.notFound('Material');

    await this.tenantDb
      .clientFor(actor.tenantId)
      .material.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

function toView(row: {
  id: string;
  name: string;
  unit: string;
  category: string | null;
}): MaterialView {
  return { id: row.id, name: row.name, unit: row.unit, category: row.category };
}
