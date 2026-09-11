import { Injectable } from '@nestjs/common';
import {
  APPROVER_ROLES,
  isoDateToUtcDate,
  utcDateToIsoDate,
  type CreateExpenseInput,
  type DecideExpenseInput,
  type ExpenseSummaryQuery,
  type ListExpensesQuery,
  type Page,
  type UpdateExpenseInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb } from '../../common/prisma/tenant-db.service';

const SELECT = {
  id: true,
  projectId: true,
  amount: true,
  category: true,
  spentOn: true,
  billS3Key: true,
  note: true,
  status: true,
  approvedAt: true,
  createdAt: true,
  clientId: true,
  project: { select: { name: true } },
  submitter: { select: { id: true, name: true } },
  approver: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  async list(actor: RequestUser, query: ListExpensesQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const rows = await this.tenantDb.clientFor(actor.tenantId).expense.findMany({
      where: {
        deletedAt: null,
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
        ...(query.status ? { status: query.status } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.from || query.to
          ? {
              spentOn: {
                ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
              },
            }
          : {}),
      },
      select: SELECT,
      // Pending first so the approval queue is the default view, then newest.
      orderBy: [{ status: 'asc' }, { spentOn: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    });
    return toPage(rows, query.limit, toView) as Page<ReturnType<typeof toView>>;
  }

  async get(actor: RequestUser, id: string) {
    const expense = await this.tenantDb
      .clientFor(actor.tenantId)
      .expense.findFirst({ where: { id, deletedAt: null }, select: SELECT });
    if (!expense) throw ApiError.notFound('Expense');
    await this.access.assertAccess(actor, expense.projectId);
    return toView(expense);
  }

  /**
   * Record a spend. Idempotent on `client_id`: a supervisor photographs a bill on
   * site with no signal, and a retried outbox entry must not book the cost twice.
   */
  async create(actor: RequestUser, input: CreateExpenseInput) {
    await this.access.assertAccess(actor, input.project_id);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.expense.findFirst({
          where: { clientId: input.client_id },
          select: SELECT,
        });
        if (existing) return toView(existing);
      }

      const expense = await tx.expense.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          amount: input.amount,
          category: input.category,
          spentOn: isoDateToUtcDate(input.spent_on),
          billS3Key: input.bill_s3_key,
          note: input.note,
          submittedBy: actor.userId,
          clientId: input.client_id,
        },
        select: SELECT,
      });

      return toView(expense);
    });
  }

  /** Only a pending expense is editable — a decided one is a settled record. */
  async update(actor: RequestUser, id: string, input: UpdateExpenseInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, projectId: true, status: true, submittedBy: true },
      });
      if (!expense) throw ApiError.notFound('Expense');
      await this.access.assertAccess(actor, expense.projectId);

      if (expense.status !== 'pending') {
        throw ApiError.conflict('An expense that has been decided can no longer be edited', {
          status: expense.status,
        });
      }
      // Anyone may correct their own; only an approver may correct someone else's.
      if (expense.submittedBy !== actor.userId && !APPROVER_ROLES.includes(actor.role)) {
        throw ApiError.forbidden('Only the person who recorded this can edit it');
      }

      const updated = await tx.expense.update({
        where: { id },
        data: {
          ...(input.amount === undefined ? {} : { amount: input.amount }),
          ...(input.category === undefined ? {} : { category: input.category }),
          ...(input.spent_on === undefined ? {} : { spentOn: isoDateToUtcDate(input.spent_on) }),
          ...(input.bill_s3_key === undefined ? {} : { billS3Key: input.bill_s3_key }),
          ...(input.note === undefined ? {} : { note: input.note }),
        },
        select: SELECT,
      });
      return toView(updated);
    });
  }

  /**
   * Approve or reject. Audited, and one-way: money already signed off should not
   * quietly change status later (spec §15, audit log on approvals).
   */
  async decide(actor: RequestUser, id: string, input: DecideExpenseInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const expense = await tx.expense.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, projectId: true, status: true, amount: true, submittedBy: true },
      });
      if (!expense) throw ApiError.notFound('Expense');
      await this.access.assertAccess(actor, expense.projectId);

      if (expense.status !== 'pending') {
        throw ApiError.conflict(`This expense is already ${expense.status}`, {
          status: expense.status,
        });
      }
      // Signing off your own spend is the oldest hole in petty cash.
      if (expense.submittedBy === actor.userId) {
        throw ApiError.forbidden('Somebody else has to approve an expense you recorded');
      }

      const updated = await tx.expense.update({
        where: { id },
        data: {
          status: input.status,
          approvedBy: actor.userId,
          approvedAt: new Date(),
          ...(input.note ? { note: input.note } : {}),
        },
        select: SELECT,
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: `expense.${input.status}`,
          entity: 'expenses',
          entityId: id,
          before: { status: expense.status },
          after: { status: input.status, amount: expense.amount.toString() },
        },
      });

      return toView(updated);
    });
  }

  async archive(actor: RequestUser, id: string): Promise<void> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const expense = await db.expense.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, status: true },
    });
    if (!expense) throw ApiError.notFound('Expense');
    await this.access.assertAccess(actor, expense.projectId);
    if (expense.status === 'approved') {
      throw ApiError.conflict('An approved expense cannot be deleted; reject it instead');
    }

    await db.expense.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Spend grouped by category or project (spec §3 item 11, expense summary).
   *
   * Pending rows count by default: the money has left regardless of whether the
   * paperwork has cleared, and an owner asking what a site cost does not mean
   * what accounts has finished processing. Rejected rows never count.
   */
  async summary(actor: RequestUser, query: ExpenseSummaryQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const rows = await this.tenantDb.clientFor(actor.tenantId).expense.findMany({
      where: {
        deletedAt: null,
        spentOn: { gte: isoDateToUtcDate(query.from), lte: isoDateToUtcDate(query.to) },
        ...(query.approved_only
          ? { status: 'approved' as const }
          : { status: { not: 'rejected' as const } }),
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
      },
      select: {
        amount: true,
        category: true,
        status: true,
        project: { select: { id: true, name: true } },
      },
    });

    const buckets = new Map<string, { key: string; label: string; amount: bigint; count: number }>();
    let total = 0n;
    let pending = 0n;

    for (const row of rows) {
      total += row.amount;
      if (row.status === 'pending') pending += row.amount;

      const { key, label } =
        query.group_by === 'project'
          ? { key: row.project.id, label: row.project.name }
          : { key: row.category, label: row.category };

      const bucket = buckets.get(key) ?? { key, label, amount: 0n, count: 0 };
      bucket.amount += row.amount;
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    return {
      from: query.from,
      to: query.to,
      group_by: query.group_by,
      total,
      pending,
      // Biggest first: the report exists to find where the money went.
      groups: [...buckets.values()].sort((a, b) =>
        b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0,
      ),
    };
  }
}

function toView(row: {
  id: string;
  projectId: string;
  amount: bigint;
  category: string;
  spentOn: Date;
  billS3Key: string | null;
  note: string | null;
  status: string;
  approvedAt: Date | null;
  createdAt: Date;
  clientId: string | null;
  project: { name: string };
  submitter: { id: string; name: string };
  approver: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    project_id: row.projectId,
    project_name: row.project.name,
    amount: row.amount,
    category: row.category,
    spent_on: utcDateToIsoDate(row.spentOn),
    bill_s3_key: row.billS3Key,
    note: row.note,
    status: row.status,
    submitted_by: { id: row.submitter.id, name: row.submitter.name },
    approved_by: row.approver ? { id: row.approver.id, name: row.approver.name } : null,
    approved_at: row.approvedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    client_id: row.clientId,
  };
}

export type ExpenseView = ReturnType<typeof toView>;
