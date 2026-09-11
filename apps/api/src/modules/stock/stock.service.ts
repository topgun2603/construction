import { Injectable } from '@nestjs/common';
import {
  isoDateToUtcDate,
  quantityToThousandths,
  thousandthsToQuantity,
  utcDateToIsoDate,
  type ListStockMovementsQuery,
  type MaterialOverrunQuery,
  type RecordStockMovementInput,
  type SetMaterialEstimatesInput,
  type StockOnHandQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb, type TenantClient, type TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Materials stock: what arrived, what was used, and what that says against the estimate.
 *
 * Every sum here runs in integer thousandths rather than on the Decimal values directly. Stock is
 * the running total of a ledger, and the one thing it must never do is disagree with the rows it
 * was added up from.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  /**
   * Record material arriving or leaving.
   *
   * Going out is refused when the site does not have it. That is a real guard rather than
   * bookkeeping fussiness: a negative balance means either the issue is wrong or an inward
   * challan was never entered, and both want fixing at the moment somebody notices, not at
   * month end when the overrun report reads like nonsense.
   */
  async record(actor: RequestUser, input: RecordStockMovementInput) {
    await this.access.assertAccess(actor, input.project_id);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.stockMovement.findFirst({
          where: { clientId: input.client_id },
          select: SELECT,
        });
        if (existing) return toView(existing);
      }

      const material = await tx.material.findFirst({
        where: { id: input.material_id, deletedAt: null },
        select: { id: true, name: true, unit: true },
      });
      if (!material) throw ApiError.notFound('Material');

      if (input.type === 'out') {
        const onHand = await this.onHandFor(tx, input.project_id, input.material_id);
        const wanted = quantityToThousandths(input.quantity);
        if (wanted > onHand) {
          throw ApiError.conflict(
            `Only ${thousandthsToQuantity(onHand)} ${material.unit} of ${material.name} on site. Record what arrived first.`,
            {
              on_hand: thousandthsToQuantity(onHand),
              requested: input.quantity,
              unit: material.unit,
            },
          );
        }
      }

      const movement = await tx.stockMovement.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          materialId: input.material_id,
          type: input.type,
          quantity: input.quantity,
          movedOn: isoDateToUtcDate(input.moved_on),
          ref: input.ref ?? null,
          note: input.note ?? null,
          recordedBy: actor.userId,
          clientId: input.client_id ?? null,
        },
        select: SELECT,
      });
      return toView(movement);
    });
  }

  async list(actor: RequestUser, query: ListStockMovementsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const rows = await this.tenantDb.clientFor(actor.tenantId).stockMovement.findMany({
      where: {
        deletedAt: null,
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
        ...(query.material_id ? { materialId: query.material_id } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.from || query.to
          ? {
              movedOn: {
                ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
              },
            }
          : {}),
      },
      select: SELECT,
      // Newest first, and `id` breaks the tie so a page boundary cannot repeat or skip a row
      // when several movements share a date.
      orderBy: [{ movedOn: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    });

    return toPage(rows, query.limit, toView);
  }

  /**
   * What is on site now, per material.
   *
   * Grouped in the database rather than by walking the ledger in Node: a site a year into a
   * build has thousands of movements, and this is the screen a store keeper opens most.
   */
  async onHand(actor: RequestUser, query: StockOnHandQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const db = this.tenantDb.clientFor(actor.tenantId);

    const scope = {
      deletedAt: null,
      ...(query.project_id
        ? { projectId: query.project_id }
        : this.access.scopeFilterByProjectId(actor)),
    };

    const grouped = await db.stockMovement.groupBy({
      by: ['materialId', 'type'],
      where: scope,
      _sum: { quantity: true },
    });
    if (grouped.length === 0) return { items: [], totals: { material_count: 0 } };

    const materials = await db.material.findMany({
      where: { id: { in: [...new Set(grouped.map((row) => row.materialId))] } },
      select: { id: true, name: true, unit: true, category: true },
    });
    const byId = new Map(materials.map((material) => [material.id, material]));

    const totals = new Map<string, { received: bigint; used: bigint }>();
    for (const row of grouped) {
      const entry = totals.get(row.materialId) ?? { received: 0n, used: 0n };
      const amount = quantityToThousandths((row._sum.quantity ?? 0).toString());
      if (row.type === 'in') entry.received += amount;
      else entry.used += amount;
      totals.set(row.materialId, entry);
    }

    const items = [...totals.entries()]
      .map(([materialId, sums]) => {
        const material = byId.get(materialId);
        return {
          material_id: materialId,
          material_name: material?.name ?? 'Unknown material',
          unit: material?.unit ?? '',
          category: material?.category ?? null,
          received: thousandthsToQuantity(sums.received),
          used: thousandthsToQuantity(sums.used),
          on_hand: thousandthsToQuantity(sums.received - sums.used),
          /** True when the ledger says less than nothing is there, which needs investigating. */
          negative: sums.received - sums.used < 0n,
        };
      })
      .sort((a, b) => a.material_name.localeCompare(b.material_name));

    return { items, totals: { material_count: items.length } };
  }

  /** Balance for one material on one site, in thousandths. */
  private async onHandFor(
    tx: TenantTx,
    projectId: string,
    materialId: string,
  ): Promise<bigint> {
    const grouped = await tx.stockMovement.groupBy({
      by: ['type'],
      where: { projectId, materialId, deletedAt: null },
      _sum: { quantity: true },
    });

    let balance = 0n;
    for (const row of grouped) {
      const amount = quantityToThousandths((row._sum.quantity ?? 0).toString());
      balance += row.type === 'in' ? amount : -amount;
    }
    return balance;
  }

  /**
   * Set or replace the estimates for a site.
   *
   * Upserted per material rather than wiping and re-inserting: estimates are revised as drawings
   * change, and a replace-all would silently drop any material the caller happened not to send
   * this time.
   */
  async setEstimates(actor: RequestUser, projectId: string, input: SetMaterialEstimatesInput) {
    await this.access.assertAccess(actor, projectId);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ids = input.items.map((item) => item.material_id);
      const materials = await tx.material.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true },
      });
      if (materials.length !== new Set(ids).size) {
        throw ApiError.notFound('One of those materials');
      }

      for (const item of input.items) {
        await tx.materialEstimate.upsert({
          where: {
            projectId_materialId: { projectId, materialId: item.material_id },
          },
          create: {
            tenantId: actor.tenantId,
            projectId,
            materialId: item.material_id,
            estimatedQuantity: item.estimated_quantity,
            note: item.note ?? null,
          },
          update: {
            estimatedQuantity: item.estimated_quantity,
            ...(item.note === undefined ? {} : { note: item.note }),
          },
        });
      }

      return this.estimatesFor(tx, projectId);
    });
  }

  async listEstimates(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    return this.estimatesFor(this.tenantDb.clientFor(actor.tenantId), projectId);
  }

  async removeEstimate(actor: RequestUser, projectId: string, materialId: string): Promise<void> {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    const existing = await db.materialEstimate.findFirst({
      where: { projectId, materialId },
      select: { id: true },
    });
    if (!existing) throw ApiError.notFound('Estimate');

    // A hard delete: an estimate is a forecast, not a record of anything that happened. The
    // movements it was measured against are untouched.
    await db.materialEstimate.delete({ where: { id: existing.id } });
  }

  private async estimatesFor(db: TenantTx | TenantClient, projectId: string) {
    const rows = await db.materialEstimate.findMany({
      where: { projectId },
      select: {
        id: true,
        materialId: true,
        estimatedQuantity: true,
        note: true,
        material: { select: { name: true, unit: true, category: true } },
      },
      orderBy: { material: { name: 'asc' } },
    });

    return rows.map((row) => ({
      id: row.id,
      material_id: row.materialId,
      material_name: row.material.name,
      unit: row.material.unit,
      category: row.material.category,
      estimated_quantity: thousandthsToQuantity(
        quantityToThousandths(row.estimatedQuantity.toString()),
      ),
      note: row.note,
    }));
  }

  /**
   * Consumption against estimate — the material overrun report (spec §3 item 11).
   *
   * Measures *consumption*, not what was delivered. Material sitting in the store has been paid
   * for but not used, and counting it as consumed would flag an overrun on a site that simply
   * took delivery early.
   *
   * Materials with no estimate are excluded by default. They have nothing to exceed, and listing
   * them with a blank expected column turns a report you act on into an inventory you scroll.
   */
  async overrun(actor: RequestUser, query: MaterialOverrunQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const db = this.tenantDb.clientFor(actor.tenantId);

    const scope = query.project_id
      ? { projectId: query.project_id }
      : this.access.scopeFilterByProjectId(actor);

    const [estimates, grouped] = await Promise.all([
      db.materialEstimate.findMany({
        where: scope,
        select: {
          materialId: true,
          estimatedQuantity: true,
          material: { select: { name: true, unit: true } },
        },
      }),
      db.stockMovement.groupBy({
        by: ['materialId', 'type'],
        where: { deletedAt: null, ...scope },
        _sum: { quantity: true },
      }),
    ]);

    const estimated = new Map<string, { quantity: bigint; name: string; unit: string }>();
    for (const row of estimates) {
      const existing = estimated.get(row.materialId);
      const quantity = quantityToThousandths(row.estimatedQuantity.toString());
      // Summed across sites when no project is given: "how much cement did we plan for" is a
      // question about the whole business as well as about one slab.
      estimated.set(row.materialId, {
        quantity: (existing?.quantity ?? 0n) + quantity,
        name: row.material.name,
        unit: row.material.unit,
      });
    }

    const used = new Map<string, bigint>();
    const received = new Map<string, bigint>();
    for (const row of grouped) {
      const amount = quantityToThousandths((row._sum.quantity ?? 0).toString());
      const target = row.type === 'out' ? used : received;
      target.set(row.materialId, (target.get(row.materialId) ?? 0n) + amount);
    }

    const materialIds = query.estimated_only
      ? [...estimated.keys()]
      : [...new Set([...estimated.keys(), ...used.keys(), ...received.keys()])];

    const extraNames = query.estimated_only
      ? []
      : await db.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, name: true, unit: true },
        });
    const names = new Map(
      extraNames.map((material) => [material.id, { name: material.name, unit: material.unit }]),
    );

    const rows = materialIds
      .map((materialId) => {
        const plan = estimated.get(materialId);
        const label = plan ?? names.get(materialId);
        const expected = plan?.quantity ?? 0n;
        const consumed = used.get(materialId) ?? 0n;
        const variance = consumed - expected;

        return {
          material_id: materialId,
          material_name: label?.name ?? 'Unknown material',
          unit: label?.unit ?? '',
          estimated: thousandthsToQuantity(expected),
          received: thousandthsToQuantity(received.get(materialId) ?? 0n),
          consumed: thousandthsToQuantity(consumed),
          /** Positive means over the estimate. */
          variance: thousandthsToQuantity(variance),
          variance_thousandths: variance.toString(),
          over: variance > 0n,
          /**
           * Null rather than zero when nothing was estimated: "0% used" reads as on budget, which
           * is a different statement from "nobody said what this should take".
           */
          percent_used: expected > 0n ? Number((consumed * 100n) / expected) : null,
        };
      })
      // Worst overrun first. The report exists to surface the problem, not to list the shelf.
      .sort((a, b) => Number(BigInt(b.variance_thousandths) - BigInt(a.variance_thousandths)));

    return {
      items: rows.map(({ variance_thousandths: _ignored, ...row }) => row),
      totals: {
        material_count: rows.length,
        over_estimate: rows.filter((row) => row.over).length,
      },
    };
  }
}

const SELECT = {
  id: true,
  projectId: true,
  materialId: true,
  type: true,
  quantity: true,
  movedOn: true,
  indentId: true,
  ref: true,
  note: true,
  project: { select: { name: true } },
  material: { select: { name: true, unit: true } },
  recorder: { select: { id: true, name: true } },
} as const;

function toView(row: {
  id: string;
  projectId: string;
  materialId: string;
  type: string;
  quantity: { toString(): string };
  movedOn: Date;
  indentId: string | null;
  ref: string | null;
  note: string | null;
  project: { name: string };
  material: { name: string; unit: string };
  recorder: { id: string; name: string };
}) {
  return {
    id: row.id,
    project_id: row.projectId,
    project_name: row.project.name,
    material_id: row.materialId,
    material_name: row.material.name,
    unit: row.material.unit,
    type: row.type,
    quantity: thousandthsToQuantity(quantityToThousandths(row.quantity.toString())),
    moved_on: utcDateToIsoDate(row.movedOn),
    /** Set when this row came from receiving an indent, so a GRN traces back to its order. */
    indent_id: row.indentId,
    ref: row.ref,
    note: row.note,
    recorded_by: { id: row.recorder.id, name: row.recorder.name },
  };
}
