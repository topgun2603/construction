import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  QUALITY_STANDARD_CHECKLISTS,
  type CreateQualityTemplateInput,
  type ListQualityTemplatesQuery,
  type QualityChecklistItemInput,
  type QualityItemKind,
  type QualityTemplateView,
  type UpdateQualityTemplateInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { dec } from './quality-common';

const TEMPLATE_INCLUDE = {
  items: { orderBy: { position: 'asc' } },
  _count: { select: { inspections: true } },
} as const satisfies Prisma.QualityChecklistTemplateInclude;

type TemplateRow = Prisma.QualityChecklistTemplateGetPayload<{ include: typeof TEMPLATE_INCLUDE }>;

/**
 * The company's checklist library (QA/QC, roadmap Phase 2, module 7).
 *
 * The standard checklists are code (`QUALITY_STANDARD_CHECKLISTS`) and are copied into a company's
 * library the first time anybody opens it — after that they are the company's own rows to rename,
 * reword and retire, and nothing in a later release rewrites them.
 */
@Injectable()
export class QualityTemplatesService {
  private readonly logger = new Logger(QualityTemplatesService.name);

  constructor(private readonly tenantDb: TenantDb) {}

  async list(actor: RequestUser, query: ListQualityTemplatesQuery): Promise<QualityTemplateView[]> {
    await this.ensureStandard(actor.tenantId);
    const rows = await this.tenantDb.clientFor(actor.tenantId).qualityChecklistTemplate.findMany({
      where: query.include_archived ? {} : { active: true },
      include: TEMPLATE_INCLUDE,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return rows.map(templateView);
  }

  async get(actor: RequestUser, id: string): Promise<QualityTemplateView> {
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .qualityChecklistTemplate.findFirst({ where: { id }, include: TEMPLATE_INCLUDE });
    if (!row) throw ApiError.notFound('Checklist');
    return templateView(row);
  }

  async create(actor: RequestUser, input: CreateQualityTemplateInput): Promise<QualityTemplateView> {
    await this.ensureStandard(actor.tenantId);
    const id = await this.tenantDb
      .transaction(actor.tenantId, async (tx) => {
        const made = await tx.qualityChecklistTemplate.create({
          data: {
            tenantId: actor.tenantId,
            name: input.name,
            trade: input.trade ?? null,
            description: input.description ?? null,
          },
          select: { id: true },
        });
        await writeItems(tx, actor.tenantId, made.id, input.items);
        return made.id;
      })
      .catch(nameTaken);
    return this.get(actor, id);
  }

  /** Lines are replaced wholesale: inspections hold their own copy, so nothing signed changes. */
  async update(actor: RequestUser, id: string, input: UpdateQualityTemplateInput): Promise<QualityTemplateView> {
    await this.tenantDb
      .transaction(actor.tenantId, async (tx) => {
        const existing = await tx.qualityChecklistTemplate.findFirst({ where: { id }, select: { id: true } });
        if (!existing) throw ApiError.notFound('Checklist');
        await tx.qualityChecklistTemplate.update({
          where: { id },
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.trade === undefined ? {} : { trade: input.trade }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.active === undefined ? {} : { active: input.active }),
          },
        });
        if (input.items) {
          await tx.qualityChecklistItem.deleteMany({ where: { templateId: id } });
          await writeItems(tx, actor.tenantId, id, input.items);
        }
      })
      .catch(nameTaken);
    return this.get(actor, id);
  }

  /**
   * Deleted if it was never used; archived if it was. An inspection keeps its own lines either way,
   * but "which checklist was this" should still have an answer a year later.
   */
  async remove(actor: RequestUser, id: string): Promise<{ archived: boolean }> {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await tx.qualityChecklistTemplate.findFirst({
        where: { id },
        select: { id: true, _count: { select: { inspections: true } } },
      });
      if (!row) throw ApiError.notFound('Checklist');
      if (row._count.inspections > 0) {
        await tx.qualityChecklistTemplate.update({ where: { id }, data: { active: false } });
        return { archived: true };
      }
      await tx.qualityChecklistTemplate.delete({ where: { id } });
      return { archived: false };
    });
  }

  /**
   * Copies the standard library in the first time a company has no checklists at all.
   *
   * "No rows" rather than a flag, because a company that has archived every checklist still has
   * rows and will not get them back unasked; one that deleted every unused one gets the standard
   * set again, which is the useful reading of an empty library. Two first visits at once race on
   * the unique name — the loser's copy fails and the winner's stands.
   */
  async ensureStandard(tenantId: string): Promise<void> {
    const db = this.tenantDb.clientFor(tenantId);
    if ((await db.qualityChecklistTemplate.count()) > 0) return;
    try {
      await this.tenantDb.transaction(tenantId, async (tx) => {
        for (const checklist of QUALITY_STANDARD_CHECKLISTS) {
          const made = await tx.qualityChecklistTemplate.create({
            data: {
              tenantId,
              name: checklist.name,
              trade: checklist.trade,
              description: checklist.description,
              standardKey: standardKey(checklist.name),
            },
            select: { id: true },
          });
          await writeItems(tx, tenantId, made.id, checklist.items);
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      this.logger.warn({ err: error, tenantId }, 'Could not copy the standard checklists');
      throw error;
    }
  }
}

function standardKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function writeItems(
  tx: TenantTx,
  tenantId: string,
  templateId: string,
  items: ReadonlyArray<QualityChecklistItemInput | (typeof QUALITY_STANDARD_CHECKLISTS)[number]['items'][number]>,
): Promise<void> {
  await tx.qualityChecklistItem.createMany({
    data: items.map((item, index) => ({
      tenantId,
      templateId,
      position: index + 1,
      label: item.label,
      kind: item.kind,
      required: item.required ?? true,
      // A photo line is a photo line; the flag only adds the requirement to the others.
      photoRequired: item.kind === 'photo' || (item.photo_required ?? false),
      unit: item.unit ?? null,
      targetValue: item.target_value ?? null,
      toleranceMinus: item.tolerance_minus ?? null,
      tolerancePlus: item.tolerance_plus ?? null,
      guidance: item.guidance ?? null,
    })),
  });
}

function nameTaken(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw ApiError.conflict('A checklist with that name already exists');
  }
  throw error;
}

function templateView(row: TemplateRow): QualityTemplateView {
  return {
    id: row.id,
    name: row.name,
    trade: row.trade,
    description: row.description,
    active: row.active,
    standard: row.standardKey !== null,
    item_count: row.items.length,
    items: row.items.map((item) => ({
      id: item.id,
      position: item.position,
      label: item.label,
      kind: item.kind as QualityItemKind,
      required: item.required,
      photo_required: item.photoRequired,
      unit: item.unit,
      target_value: dec(item.targetValue),
      tolerance_minus: dec(item.toleranceMinus),
      tolerance_plus: dec(item.tolerancePlus),
      guidance: item.guidance,
    })),
    inspection_count: row._count.inspections,
    updated_at: row.updatedAt.toISOString(),
  };
}
