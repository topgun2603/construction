import { Prisma } from '@prisma/client';
import {
  CHANGE_ORDER_AGREED,
  changeOrderLabel,
  utcDateToIsoDate,
  type ChangeOrderStatus,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Loading, naming and serialising change orders — shared by the service, the approval bridge the
 * portal calls, and the scope-creep catcher, so all three read a change order the same way.
 */

export const CHANGE_ORDER_INCLUDE = {
  project: { select: { id: true, name: true, deletedAt: true } },
  lines: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { costCode: { select: { id: true, code: true, name: true } } },
  },
  attachments: {
    orderBy: { createdAt: 'asc' },
    include: { document: { select: { id: true, title: true, s3Key: true, version: true } } },
  },
  budgetRevisions: {
    orderBy: { createdAt: 'asc' },
    include: { costCode: { select: { id: true, code: true, name: true } } },
  },
  siteRevision: true,
  approval: { select: { id: true, status: true, deletedAt: true } },
} satisfies Prisma.ChangeOrderInclude;

export type ChangeOrderRecord = Prisma.ChangeOrderGetPayload<{ include: typeof CHANGE_ORDER_INCLUDE }>;

/** A person named on a change order, with their role so "approved by … (owner)" reads honestly. */
export type People = Map<string, { id: string; name: string; role: string }>;

/**
 * The change order, after checking the caller may see its site. A site that is archived, or one the
 * caller is not on, answers the same as a change order that does not exist.
 */
export async function loadChangeOrder(tx: TenantTx, actor: RequestUser, id: string): Promise<ChangeOrderRecord> {
  const row = await tx.changeOrder.findUnique({ where: { id }, include: CHANGE_ORDER_INCLUDE });
  if (!row || row.project.deletedAt) throw ApiError.notFound('Change order');
  if (!actor.seesAllProjects && !actor.projectIds.includes(row.projectId)) {
    throw ApiError.projectNotAssigned(row.projectId);
  }
  return row;
}

export async function peopleFor(tx: TenantTx, rows: readonly ChangeOrderRecord[]): Promise<People> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const id of [
      row.raisedBy,
      row.submittedBy,
      row.approvedBy,
      row.clientDecidedBy,
      row.implementedBy,
      row.cancelledBy,
    ]) {
      if (id) ids.add(id);
    }
  }
  if (ids.size === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, role: true },
  });
  return new Map(users.map((user) => [user.id, user]));
}

const iso = (value: Date | null) => value?.toISOString() ?? null;
const day = (value: Date | null) => (value ? utcDateToIsoDate(value) : null);

/** The register row: enough to list, total and sort without the lines. */
export function changeOrderSummaryView(row: ChangeOrderRecord, people: People) {
  return {
    id: row.id,
    project: { id: row.project.id, name: row.project.name },
    number: row.number,
    revision: row.revision,
    label: changeOrderLabel(row.number, row.revision),
    title: row.title,
    reason: row.reason,
    status: row.status,
    raised_by: people.get(row.raisedBy) ?? null,
    raised_on: utcDateToIsoDate(row.raisedOn),
    cost_impact: row.costImpact.toString(),
    client_price: row.clientPrice.toString(),
    margin: (row.clientPrice - row.costImpact).toString(),
    tax: row.taxAmount.toString(),
    client_total: row.clientTotal.toString(),
    time_impact_days: row.timeImpactDays,
    sent_at: iso(row.sentAt),
    client_decided_at: iso(row.clientDecidedAt),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function changeOrderDetailView(
  row: ChangeOrderRecord,
  people: People,
  urls: Map<string, string | null>,
) {
  const site = row.siteRevision;
  return {
    ...changeOrderSummaryView(row, people),
    description: row.description,
    markup_bp: row.markupBp,
    entered_price: row.enteredPrice?.toString() ?? null,
    tax_rate_bp: row.taxRateBp,
    lines: row.lines.map((line) => ({
      id: line.id,
      cost_code: line.costCode,
      description: line.description,
      unit: line.unit,
      quantity: line.quantity?.toString() ?? null,
      rate: line.rate?.toString() ?? null,
      amount: line.amount.toString(),
    })),
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      document: attachment.document
        ? { id: attachment.document.id, title: attachment.document.title, version: attachment.document.version }
        : null,
      content_type: attachment.contentType,
      caption: attachment.caption,
      url: urls.get(attachment.id) ?? null,
    })),
    submitted_by: row.submittedBy ? (people.get(row.submittedBy) ?? null) : null,
    submitted_at: iso(row.submittedAt),
    approved_by: row.approvedBy ? (people.get(row.approvedBy) ?? null) : null,
    approved_at: iso(row.approvedAt),
    review_note: row.reviewNote,
    approval:
      row.approval && !row.approval.deletedAt ? { id: row.approval.id, status: row.approval.status } : null,
    client_decided_by: row.clientDecidedBy ? (people.get(row.clientDecidedBy) ?? null) : null,
    client_note: row.clientNote,
    applied_at: iso(row.appliedAt),
    implemented_by: row.implementedBy ? (people.get(row.implementedBy) ?? null) : null,
    implemented_at: iso(row.implementedAt),
    cancelled_by: row.cancelledBy ? (people.get(row.cancelledBy) ?? null) : null,
    cancelled_at: iso(row.cancelledAt),
    cancel_reason: row.cancelReason,
    budget_revisions: row.budgetRevisions.map((revision) => ({
      id: revision.id,
      cost_code: revision.costCode,
      requested: revision.requested.toString(),
      amount: revision.amount.toString(),
      budget_before: revision.budgetBefore.toString(),
      budget_after: revision.budgetAfter.toString(),
      created_at: revision.createdAt.toISOString(),
    })),
    site_revision: site
      ? {
          time_impact_days: site.timeImpactDays,
          handover_before: day(site.handoverBefore),
          handover_after: day(site.handoverAfter),
          contract_before: site.contractBefore?.toString() ?? null,
          contract_after: site.contractAfter?.toString() ?? null,
          site_budget_before: site.siteBudgetBefore?.toString() ?? null,
          site_budget_after: site.siteBudgetAfter?.toString() ?? null,
          created_at: site.createdAt.toISOString(),
        }
      : null,
  };
}

/**
 * What the client is shown with the approval: the price, tax and days, and what the work is — never
 * the cost or the margin, which are the builder's business. Line descriptions only, for the same
 * reason: a line's amount is its cost.
 */
export function changeOrderClientView(row: {
  id: string;
  number: number;
  revision: number;
  title: string;
  description: string | null;
  reason: string;
  status: string;
  clientPrice: bigint;
  taxAmount: bigint;
  clientTotal: bigint;
  timeImpactDays: number;
  lines: ReadonlyArray<{ description: string; unit: string | null; quantity: Prisma.Decimal | null }>;
}) {
  return {
    id: row.id,
    label: changeOrderLabel(row.number, row.revision),
    title: row.title,
    description: row.description,
    reason: row.reason,
    status: row.status,
    client_price: row.clientPrice.toString(),
    tax: row.taxAmount.toString(),
    client_total: row.clientTotal.toString(),
    time_impact_days: row.timeImpactDays,
    items: row.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity?.toString() ?? null,
      unit: line.unit,
    })),
  };
}

export const CHANGE_ORDER_CLIENT_SELECT = {
  id: true,
  number: true,
  revision: true,
  title: true,
  description: true,
  reason: true,
  status: true,
  clientPrice: true,
  taxAmount: true,
  clientTotal: true,
  timeImpactDays: true,
  lines: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { description: true, unit: true, quantity: true },
  },
} satisfies Prisma.ChangeOrderSelect;

/** Approved and implemented change orders' client prices on a site — what the contract has grown by. */
export async function agreedTotals(
  tx: TenantTx,
  projectId: string,
  exceptId?: string,
): Promise<{ price: bigint; cost: bigint; days: number; count: number }> {
  const sum = await tx.changeOrder.aggregate({
    where: {
      projectId,
      status: { in: [...CHANGE_ORDER_AGREED] as ChangeOrderStatus[] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    _sum: { clientPrice: true, costImpact: true, timeImpactDays: true },
    _count: { _all: true },
  });
  return {
    price: sum._sum.clientPrice ?? 0n,
    cost: sum._sum.costImpact ?? 0n,
    days: sum._sum.timeImpactDays ?? 0,
    count: sum._count._all,
  };
}

/**
 * Who hears about a change order on a site: every owner, and the project managers on that site.
 * Owners are not members of the sites they see, so a role fan-out narrowed by membership alone
 * would miss exactly the people who sign off on money.
 */
export async function managersOf(tx: TenantTx, projectId: string): Promise<string[]> {
  const users = await tx.user.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      OR: [
        { role: 'owner' },
        { role: 'project_manager', projectMemberships: { some: { projectId } } },
      ],
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/** The client accounts on a site — the people a change order sent for approval is waiting on. */
export async function clientsOf(tx: TenantTx, projectId: string): Promise<string[]> {
  const users = await tx.user.findMany({
    where: {
      status: 'active',
      deletedAt: null,
      role: 'client',
      projectMemberships: { some: { projectId } },
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}
