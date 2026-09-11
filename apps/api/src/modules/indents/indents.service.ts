import { Injectable } from '@nestjs/common';
import {
  APPROVER_ROLES,
  isoDateToUtcDate,
  utcDateToIsoDate,
  type AmendReceiptInput,
  type CreateIndentInput,
  type ListIndentsQuery,
  type Page,
  type UpdateIndentStatusInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { JobQueueService } from '../../jobs/job-queue.service';

const SELECT = {
  id: true,
  projectId: true,
  status: true,
  urgency: true,
  notes: true,
  requiredBy: true,
  approvedAt: true,
  createdAt: true,
  clientId: true,
  project: { select: { name: true } },
  requester: { select: { id: true, name: true } },
  approver: { select: { id: true, name: true } },
  items: {
    select: {
      id: true,
      quantity: true,
      receivedQuantity: true,
      material: { select: { id: true, name: true, unit: true } },
    },
  },
} as const;

/**
 * Legal status transitions (spec §3: "supervisor requests → PM approves → mark
 * received"). Encoding them as a map rather than a chain of ifs makes the illegal
 * moves — reviving a rejected indent, receiving something never ordered — visible.
 */
const TRANSITIONS: Record<string, readonly string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['ordered', 'received', 'rejected'],
  ordered: ['received'],
  rejected: [],
  received: [],
};

@Injectable()
export class IndentsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly jobs: JobQueueService,
  ) {}

  async list(actor: RequestUser, query: ListIndentsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const rows = await this.tenantDb.clientFor(actor.tenantId).materialIndent.findMany({
      where: {
        deletedAt: null,
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
        ...(query.status ? { status: query.status } : {}),
        ...(query.urgency ? { urgency: query.urgency } : {}),
      },
      select: SELECT,
      // Urgent first, then oldest — the order a PM should work the queue.
      orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
      ...cursorArgs(query),
    });
    return toPage(rows, query.limit, toView) as Page<ReturnType<typeof toView>>;
  }

  async get(actor: RequestUser, id: string) {
    const indent = await this.tenantDb
      .clientFor(actor.tenantId)
      .materialIndent.findFirst({ where: { id, deletedAt: null }, select: SELECT });
    if (!indent) throw ApiError.notFound('Indent');
    await this.access.assertAccess(actor, indent.projectId);
    return toView(indent);
  }

  async create(actor: RequestUser, input: CreateIndentInput) {
    await this.access.assertAccess(actor, input.project_id);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.materialIndent.findFirst({
          where: { clientId: input.client_id },
          select: SELECT,
        });
        if (existing) return toView(existing);
      }

      const materialIds = [...new Set(input.items.map((item) => item.material_id))];
      const materials = await tx.material.findMany({
        where: { id: { in: materialIds }, deletedAt: null },
        select: { id: true },
      });
      if (materials.length !== materialIds.length) {
        const known = new Set(materials.map((m) => m.id));
        throw ApiError.validationFailed(
          { unknown_material_ids: materialIds.filter((id) => !known.has(id)) },
          'Unknown materials',
        );
      }

      const indent = await tx.materialIndent.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          requestedBy: actor.userId,
          status: 'requested',
          urgency: input.urgency,
          notes: input.notes,
          requiredBy: input.required_by ? isoDateToUtcDate(input.required_by) : null,
          clientId: input.client_id,
          items: {
            create: input.items.map((item) => ({
              tenantId: actor.tenantId,
              materialId: item.material_id,
              quantity: item.quantity,
            })),
          },
        },
        select: SELECT,
      });

      return toView(indent);
    });
  }

  /**
   * Move an indent along the workflow. Approval is an audited event: it commits
   * the builder's money, and the owner needs to be able to ask who cleared it
   * (spec §15).
   */
  /**
   * Correct what a delivery actually contained.
   *
   * The status stays `received`; only the counts change. Signing for 40 bags at the gate and the
   * store finding 37 is ordinary, and before this there was no way to say so — `received` is a
   * terminal status, so the status endpoint refused a second call.
   */
  async amendReceipt(actor: RequestUser, id: string, input: AmendReceiptInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const indent = await tx.materialIndent.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, projectId: true, status: true },
      });
      if (!indent) throw ApiError.notFound('Indent');
      await this.access.assertAccess(actor, indent.projectId);

      if (indent.status !== 'received') {
        throw ApiError.conflict(
          `This indent is ${indent.status}, so there is no delivery to correct yet.`,
          { status: indent.status },
        );
      }

      await this.recordGoodsReceived(tx, actor, {
        indentId: id,
        projectId: indent.projectId,
        items: input.items,
        ref: input.ref ?? input.note ?? null,
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'indent.receipt_amended',
          entity: 'material_indents',
          entityId: id,
          after: { items: input.items },
        },
      });

      const updated = await tx.materialIndent.findUniqueOrThrow({
        where: { id },
        select: SELECT,
      });
      return toView(updated);
    });
  }

  /**
   * Write the received quantities onto the indent and onto the site's stock ledger.
   *
   * Prior GRN rows for this indent are soft-deleted and rewritten rather than topped up with a
   * difference. Correcting 40 bags to 37 is a correction, and posting the −3 as an `out` movement
   * would read as three bags having been used on site — inventing consumption that never happened.
   * Soft delete keeps the earlier row for anyone asking what changed, while the balance only ever
   * counts the current GRN.
   *
   * Written even when the tenant has no `stock` module. It costs nothing, and a builder who
   * upgrades later should find their delivery history already there rather than an empty store.
   */
  private async recordGoodsReceived(
    tx: TenantTx,
    actor: RequestUser,
    input: {
      indentId: string;
      projectId: string;
      items: ReadonlyArray<{ material_id: string; received_quantity: string }>;
      ref: string | null;
    },
  ): Promise<void> {
    for (const line of input.items) {
      await tx.indentItem.updateMany({
        where: { indentId: input.indentId, materialId: line.material_id },
        data: { receivedQuantity: line.received_quantity },
      });
    }

    await tx.stockMovement.updateMany({
      where: { indentId: input.indentId, type: 'in', deletedAt: null },
      data: { deletedAt: new Date() },
    });

    for (const line of input.items) {
      // Zero is a real answer — "this line did not turn up" — but it is not a movement.
      if (Number.parseFloat(line.received_quantity) <= 0) continue;
      await tx.stockMovement.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.projectId,
          materialId: line.material_id,
          type: 'in',
          quantity: line.received_quantity,
          movedOn: new Date(),
          indentId: input.indentId,
          ref: input.ref,
          recordedBy: actor.userId,
        },
      });
    }
  }

  /**
   * Soft delete a material indent — only while nobody has acted on it.
   *
   * Once an indent is approved it has become a commitment: someone has agreed to the
   * spend, a supplier may already have been called, and a received indent is the only
   * record of what arrived on site. Withdrawing an unanswered request is different —
   * that is just a request nobody needed.
   */
  async archive(actor: RequestUser, id: string): Promise<void> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const indent = await db.materialIndent.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, status: true, requestedBy: true },
    });
    if (!indent) throw ApiError.notFound('Indent');
    await this.access.assertAccess(actor, indent.projectId);

    if (indent.status !== 'requested') {
      throw ApiError.conflict(
        `This indent is already ${indent.status} and cannot be deleted. Reject it instead.`,
      );
    }
    if (indent.requestedBy !== actor.userId && !['owner', 'project_manager'].includes(actor.role)) {
      throw ApiError.forbidden('Only the person who raised this indent can withdraw it');
    }

    await db.materialIndent.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async updateStatus(actor: RequestUser, id: string, input: UpdateIndentStatusInput) {
    const result = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const indent = await tx.materialIndent.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, projectId: true, status: true },
      });
      if (!indent) throw ApiError.notFound('Indent');
      await this.access.assertAccess(actor, indent.projectId);

      const allowed = TRANSITIONS[indent.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw ApiError.conflict(`An indent cannot go from ${indent.status} to ${input.status}`, {
          from: indent.status,
          allowed,
        });
      }

      const isApproval = input.status === 'approved' || input.status === 'rejected';
      if (isApproval && !APPROVER_ROLES.includes(actor.role)) {
        throw ApiError.forbidden('Only an owner or project manager can approve an indent');
      }

      if (input.received) {
        await this.recordGoodsReceived(tx, actor, {
          indentId: id,
          projectId: indent.projectId,
          items: input.received,
          ref: input.note ?? null,
        });
      }

      const updated = await tx.materialIndent.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.note ? { notes: input.note } : {}),
          ...(isApproval ? { approvedBy: actor.userId, approvedAt: new Date() } : {}),
        },
        select: SELECT,
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: `indent.${input.status}`,
          entity: 'material_indents',
          entityId: id,
          before: { status: indent.status },
          after: { status: input.status, note: input.note ?? null },
        },
      });

      return toView(updated);
    });

    // Enqueued only once the transaction has committed. Queueing inside it would
    // push "steel approved" to the site for a write that then rolled back.
    await this.jobs.indentStatusChanged({
      tenantId: actor.tenantId,
      indentId: id,
      status: input.status,
      actorId: actor.userId,
    });

    return result;
  }
}

function toView(row: {
  id: string;
  projectId: string;
  status: string;
  urgency: string;
  notes: string | null;
  requiredBy: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
  clientId: string | null;
  project: { name: string };
  requester: { id: string; name: string };
  approver: { id: string; name: string } | null;
  items: Array<{
    id: string;
    quantity: unknown;
    receivedQuantity: unknown;
    material: { id: string; name: string; unit: string };
  }>;
}) {
  return {
    id: row.id,
    project_id: row.projectId,
    project_name: row.project.name,
    status: row.status,
    urgency: row.urgency,
    notes: row.notes,
    required_by: row.requiredBy ? utcDateToIsoDate(row.requiredBy) : null,
    requested_by: { id: row.requester.id, name: row.requester.name },
    approved_by: row.approver ? { id: row.approver.id, name: row.approver.name } : null,
    approved_at: row.approvedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    client_id: row.clientId,
    items: row.items.map((item) => ({
      id: item.id,
      material_id: item.material.id,
      material_name: item.material.name,
      unit: item.material.unit,
      quantity: String(item.quantity),
      received_quantity: String(item.receivedQuantity),
    })),
  };
}

export type IndentView = ReturnType<typeof toView>;
