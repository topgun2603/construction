import { Injectable } from '@nestjs/common';
import type {
  CreatePaymentStageInput,
  RecordClientPaymentInput,
  ReorderPaymentStagesInput,
  UpdatePaymentStageInput,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { ProjectAccess } from '../../common/auth/project-access.service';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantDb } from '../../common/prisma/tenant-db.service';

const STAGE_SELECT = {
  id: true,
  projectId: true,
  milestoneId: true,
  label: true,
  amount: true,
  dueDate: true,
  sortOrder: true,
  raisedAt: true,
  createdAt: true,
  milestone: { select: { id: true, name: true, actualDate: true } },
  receipts: {
    where: { deletedAt: null },
    select: { id: true, amount: true, receivedOn: true },
  },
} as const;

const RECEIPT_SELECT = {
  id: true,
  projectId: true,
  stageId: true,
  amount: true,
  receivedOn: true,
  mode: true,
  reference: true,
  note: true,
  createdAt: true,
  recorder: { select: { id: true, name: true } },
  stage: { select: { id: true, label: true } },
} as const;

/**
 * What the client owes, and what has arrived.
 *
 * Every figure on this screen is derived from two facts: the instalments somebody wrote down, and
 * the receipts somebody recorded. There is no stored "status" and no stored "balance" — a status
 * column is a second opinion about the money, and the day it disagrees with the receipts is the day
 * a builder asks a client for something they already paid.
 *
 * Nothing here touches `expenses` or `labour_payments`. Those are money going out, and the gap
 * between the two is the margin on the job.
 */
@Injectable()
export class ClientBillingService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  /** The schedule, its receipts, and the arithmetic joining them. */
  async schedule(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    const [stages, unallocated, project] = await Promise.all([
      db.paymentStage.findMany({
        where: { projectId, deletedAt: null },
        select: STAGE_SELECT,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      // Money that arrived against no particular instalment still counts against the total.
      db.clientPayment.findMany({
        where: { projectId, stageId: null, deletedAt: null },
        select: { amount: true },
      }),
      db.project.findFirst({
        where: { id: projectId },
        select: { budgetAmount: true, name: true },
      }),
    ]);

    const items = stages.map((stage) => view(stage));
    const scheduled = stages.reduce((sum, stage) => sum + stage.amount, 0n);
    const allocated = stages.reduce(
      (sum, stage) => sum + stage.receipts.reduce((paid, r) => paid + r.amount, 0n),
      0n,
    );
    const loose = unallocated.reduce((sum, row) => sum + row.amount, 0n);
    const received = allocated + loose;

    return {
      items,
      project_name: project?.name ?? null,
      totals: {
        /** What the schedule adds up to. */
        scheduled: scheduled.toString(),
        received: received.toString(),
        /** Never negative: an overpayment is money in hand, not a debt the builder owes back. */
        outstanding: (scheduled > received ? scheduled - received : 0n).toString(),
        /** Receipts nobody has filed against an instalment yet. */
        unallocated: loose.toString(),
        /*
         * The contract figure, for the one comparison that matters to a builder: a schedule that
         * does not add up to the budget is a schedule with an instalment missing from it.
         */
        budget: project?.budgetAmount?.toString() ?? null,
      },
    };
  }

  async createStage(actor: RequestUser, projectId: string, input: CreatePaymentStageInput) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    if (input.client_id) {
      const existing = await db.paymentStage.findFirst({
        where: { clientId: input.client_id },
        select: STAGE_SELECT,
      });
      if (existing) return view(existing);
    }

    if (input.milestone_id) await this.assertMilestoneOnProject(actor, projectId, input.milestone_id);

    const last = await db.paymentStage.aggregate({
      where: { projectId, deletedAt: null },
      _max: { sortOrder: true },
    });

    const stage = await db.paymentStage.create({
      data: {
        tenantId: actor.tenantId,
        projectId,
        milestoneId: input.milestone_id ?? null,
        label: input.label,
        amount: input.amount,
        dueDate: input.due_date ? new Date(input.due_date) : null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        clientId: input.client_id ?? null,
      },
      select: STAGE_SELECT,
    });
    return view(stage);
  }

  async updateStage(actor: RequestUser, stageId: string, input: UpdatePaymentStageInput) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.paymentStage.findFirst({
      where: { id: stageId, deletedAt: null },
      select: { id: true, projectId: true, raisedAt: true },
    });
    if (!existing) throw ApiError.notFound('That instalment');
    await this.access.assertAccess(actor, existing.projectId);

    if (input.milestone_id) {
      await this.assertMilestoneOnProject(actor, existing.projectId, input.milestone_id);
    }

    const stage = await db.paymentStage.update({
      where: { id: stageId },
      data: {
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.amount === undefined ? {} : { amount: input.amount }),
        ...(input.milestone_id === undefined ? {} : { milestoneId: input.milestone_id }),
        ...(input.due_date === undefined
          ? {}
          : { dueDate: input.due_date ? new Date(input.due_date) : null }),
        /*
         * The server stamps the time, and raising twice does not move it.
         *
         * "Asked for on the 3rd" is a fact about a demand somebody made; letting the caller send
         * it, or re-send it, would let a demand be backdated after the argument started.
         */
        ...(input.raised === undefined
          ? {}
          : { raisedAt: input.raised ? (existing.raisedAt ?? new Date()) : null }),
      },
      select: STAGE_SELECT,
    });
    return view(stage);
  }

  /**
   * Remove an instalment.
   *
   * Refused once money has been filed against it — deleting it would orphan a receipt and quietly
   * change what the client is recorded as owing.
   */
  async removeStage(actor: RequestUser, stageId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const stage = await db.paymentStage.findFirst({
      where: { id: stageId, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        _count: { select: { receipts: { where: { deletedAt: null } } } },
      },
    });
    if (!stage) throw ApiError.notFound('That instalment');
    await this.access.assertAccess(actor, stage.projectId);

    if (stage._count.receipts > 0) {
      throw ApiError.conflict(
        'Money has already been received against this instalment. Remove the receipts first.',
      );
    }

    await db.paymentStage.update({ where: { id: stageId }, data: { deletedAt: new Date() } });
  }

  async reorderStages(actor: RequestUser, projectId: string, input: ReorderPaymentStagesInput) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      for (const [index, id] of input.ids.entries()) {
        // Scoped to the project, so an id from another site cannot be dragged into this order.
        await tx.paymentStage.updateMany({
          where: { id, projectId, deletedAt: null },
          data: { sortOrder: index },
        });
      }
    });

    const stages = await db.paymentStage.findMany({
      where: { projectId, deletedAt: null },
      select: STAGE_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: stages.map((stage) => view(stage)) };
  }

  async receipts(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const rows = await db.clientPayment.findMany({
      where: { projectId, deletedAt: null },
      select: RECEIPT_SELECT,
      orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return { items: rows.map((row) => receiptView(row)) };
  }

  async recordPayment(actor: RequestUser, projectId: string, input: RecordClientPaymentInput) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    if (input.client_id) {
      const existing = await db.clientPayment.findFirst({
        where: { clientId: input.client_id },
        select: RECEIPT_SELECT,
      });
      if (existing) return receiptView(existing);
    }

    if (input.stage_id) {
      // A receipt filed against another site's instalment would move money between two clients'
      // balances at once.
      const stage = await db.paymentStage.findFirst({
        where: { id: input.stage_id, projectId, deletedAt: null },
        select: { id: true },
      });
      if (!stage) throw ApiError.notFound('That instalment');
    }

    const receipt = await db.clientPayment.create({
      data: {
        tenantId: actor.tenantId,
        projectId,
        stageId: input.stage_id ?? null,
        amount: input.amount,
        receivedOn: new Date(input.received_on),
        mode: input.mode,
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedBy: actor.userId,
        clientId: input.client_id ?? null,
      },
      select: RECEIPT_SELECT,
    });
    return receiptView(receipt);
  }

  /**
   * Soft delete a receipt.
   *
   * Soft, because a receipt is a record of money somebody says arrived, and a balance that can be
   * silently rewritten is not a balance either side can rely on.
   */
  async removePayment(actor: RequestUser, paymentId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const receipt = await db.clientPayment.findFirst({
      where: { id: paymentId, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!receipt) throw ApiError.notFound('That receipt');
    await this.access.assertAccess(actor, receipt.projectId);

    await db.clientPayment.update({ where: { id: paymentId }, data: { deletedAt: new Date() } });
  }

  private async assertMilestoneOnProject(
    actor: RequestUser,
    projectId: string,
    milestoneId: string,
  ) {
    const milestone = await this.tenantDb
      .clientFor(actor.tenantId)
      .milestone.findFirst({
        where: { id: milestoneId, projectId, deletedAt: null },
        select: { id: true },
      });
    if (!milestone) throw ApiError.notFound('That milestone');
  }
}

/** One instalment, with what has been paid against it worked out rather than stored. */
function view(stage: {
  id: string;
  projectId: string;
  milestoneId: string | null;
  label: string;
  amount: bigint;
  dueDate: Date | null;
  sortOrder: number;
  raisedAt: Date | null;
  createdAt: Date;
  milestone: { id: string; name: string; actualDate: Date | null } | null;
  receipts: Array<{ id: string; amount: bigint; receivedOn: Date }>;
}) {
  const paid = stage.receipts.reduce((sum, receipt) => sum + receipt.amount, 0n);
  const outstanding = stage.amount > paid ? stage.amount - paid : 0n;

  return {
    id: stage.id,
    project_id: stage.projectId,
    label: stage.label,
    amount: stage.amount.toString(),
    paid: paid.toString(),
    outstanding: outstanding.toString(),
    due_date: stage.dueDate ? stage.dueDate.toISOString().slice(0, 10) : null,
    sort_order: stage.sortOrder,
    raised_at: stage.raisedAt?.toISOString() ?? null,
    milestone: stage.milestone
      ? {
          id: stage.milestone.id,
          name: stage.milestone.name,
          reached: stage.milestone.actualDate !== null,
        }
      : null,
    /*
     * Derived, never stored.
     *
     * `paid` wins over `overdue` deliberately: an instalment settled after its due date is settled,
     * and a screen that keeps shouting about it is a screen people stop reading.
     */
    status: settled(stage, paid),
    created_at: stage.createdAt.toISOString(),
  };
}

type StageStatus = 'paid' | 'part_paid' | 'overdue' | 'due' | 'upcoming';

function settled(
  stage: { amount: bigint; dueDate: Date | null; raisedAt: Date | null },
  paid: bigint,
): StageStatus {
  if (paid >= stage.amount) return 'paid';
  const overdue = stage.dueDate !== null && stage.dueDate < startOfToday();
  if (paid > 0n) return overdue ? 'overdue' : 'part_paid';
  if (overdue) return 'overdue';
  return stage.raisedAt ? 'due' : 'upcoming';
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function receiptView(row: {
  id: string;
  projectId: string;
  stageId: string | null;
  amount: bigint;
  receivedOn: Date;
  mode: string;
  reference: string | null;
  note: string | null;
  createdAt: Date;
  recorder: { id: string; name: string };
  stage: { id: string; label: string } | null;
}) {
  return {
    id: row.id,
    project_id: row.projectId,
    stage_id: row.stageId,
    stage_label: row.stage?.label ?? null,
    amount: row.amount.toString(),
    received_on: row.receivedOn.toISOString().slice(0, 10),
    mode: row.mode,
    reference: row.reference,
    note: row.note,
    recorded_by: row.recorder,
    created_at: row.createdAt.toISOString(),
  };
}
