import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  PUBLIC_API_MAX_ATTENDANCE_DAYS,
  isoDateToUtcDate,
  permissionsForSystemRole,
  type PublicApiAttendanceQuery,
  type PublicApiExpenseCreateInput,
  type PublicApiExpenseQuery,
  type PublicApiListQuery,
  type PublicApiProjectScopedQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { CostReportService, type FiguresView } from '../cost-codes/cost-report.service';
import { ExpensesService } from '../expenses/expenses.service';
import type { ApiKeyPrincipal } from './api-key.guard';
import {
  PUBLIC_ATTENDANCE_SELECT,
  PUBLIC_CHANGE_ORDER_SELECT,
  PUBLIC_DAILY_REPORT_SELECT,
  PUBLIC_EXPENSE_SELECT,
  PUBLIC_PROJECT_SELECT,
  PUBLIC_PURCHASE_ORDER_LINE_SELECT,
  PUBLIC_PURCHASE_ORDER_SELECT,
  PUBLIC_RFI_SELECT,
  PUBLIC_WORKER_SELECT,
  publicAttendanceView,
  publicChangeOrderView,
  publicDailyReportView,
  publicExpenseView,
  publicProjectView,
  publicPurchaseOrderView,
  publicRfiView,
  publicWorkerView,
} from './public-api.views';

/** One page of a list: the records, and how to get the next page if there is one. */
export interface PublicPage<T> {
  data: T[];
  has_more: boolean;
  /** Pass as `cursor` for the next page; null on the last. */
  next_cursor: string | null;
}

type Keyset = Array<{
  updatedAt?: { gte: Date } | { gt: Date } | Date;
  OR?: Array<{ updatedAt: { gt: Date } } | { updatedAt: Date; id: { gt: string } }>;
}>;

/**
 * The public API's reads and its one write, as the company's service principal.
 *
 * Reads are its own queries rather than the internal services': those are shaped for the app's
 * screens (and for a person's project assignments), and a public contract must not change shape
 * when a screen does. Every list is ordered by `(updated_at, id)` — the order a sync needs — and
 * paged by a keyset cursor over exactly that, so a page boundary never skips or repeats a record
 * that was not itself changed in between. `updated_since` starts from a moment instead.
 *
 * The write reuses `ExpensesService.create`, so a key's expense goes through every rule a person's
 * does — the cost code must be the site's, the tax number must suit the company's regime, the
 * `expense.created` webhook fires — acting as an owner-equivalent of the company (a key never
 * exceeds what an owner could do; its scopes decide which of that it can reach at all).
 */
@Injectable()
export class PublicApiService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly expenses: ExpensesService,
    private readonly costReports: CostReportService,
  ) {}

  // --- projects ------------------------------------------------------------------------------------

  async listProjects(key: ApiKeyPrincipal, query: PublicApiListQuery) {
    const rows = await this.db(key).project.findMany({
      where: { deletedAt: null, AND: keyset(query) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_PROJECT_SELECT,
    });
    return page(rows, query.limit, (row) => publicProjectView(row, key.tenant.currency));
  }

  async getProject(key: ApiKeyPrincipal, id: string) {
    const row = await this.db(key).project.findFirst({ where: { id, deletedAt: null }, select: PUBLIC_PROJECT_SELECT });
    if (!row) throw ApiError.notFound('Project');
    return publicProjectView(row, key.tenant.currency);
  }

  async costReport(key: ApiKeyPrincipal, projectId: string) {
    const report = await this.costReports.report(serviceActor(key, key.createdByUserId), projectId);
    const figures = (view: FiguresView) => ({
      budget: Number(view.budget),
      committed: Number(view.committed),
      actual: Number(view.actual),
      forecast: Number(view.forecast),
      variance: Number(view.variance),
    });
    return {
      project_id: report.project_id,
      project_name: report.project_name,
      as_of: report.as_of,
      currency: key.tenant.currency,
      project_budget: report.project_budget === null ? null : Number(report.project_budget),
      approved_changes: Number(report.approved_changes),
      lines: report.lines.map((line) => ({
        id: line.id,
        code: line.code,
        name: line.name,
        parent_id: line.parent_id,
        depth: line.depth,
        unit: line.unit,
        has_children: line.has_children,
        own: figures(line.own),
        total: figures(line.total),
      })),
      unallocated: figures(report.unallocated),
      totals: figures(report.totals),
    };
  }

  // --- workers and attendance ----------------------------------------------------------------------

  async listWorkers(key: ApiKeyPrincipal, query: PublicApiListQuery) {
    const rows = await this.db(key).worker.findMany({
      where: { deletedAt: null, AND: keyset(query) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_WORKER_SELECT,
    });
    return page(rows, query.limit, (row) => publicWorkerView(row, key.tenant.currency));
  }

  async getWorker(key: ApiKeyPrincipal, id: string) {
    const row = await this.db(key).worker.findFirst({ where: { id, deletedAt: null }, select: PUBLIC_WORKER_SELECT });
    if (!row) throw ApiError.notFound('Worker');
    return publicWorkerView(row, key.tenant.currency);
  }

  async listAttendance(key: ApiKeyPrincipal, query: PublicApiAttendanceQuery) {
    const from = isoDateToUtcDate(query.from);
    const to = isoDateToUtcDate(query.to);
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days < 1 || days > PUBLIC_API_MAX_ATTENDANCE_DAYS) {
      throw ApiError.validationFailed(
        { from: query.from, to: query.to },
        `from must be on or before to, and the range at most ${PUBLIC_API_MAX_ATTENDANCE_DAYS} days.`,
      );
    }
    const rows = await this.db(key).attendance.findMany({
      where: {
        attendanceDate: { gte: from, lte: to },
        ...(query.project_id ? { projectId: query.project_id } : {}),
        // A deleted site's roll call goes with it, as everywhere else.
        project: { deletedAt: null },
        AND: keyset(query),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_ATTENDANCE_SELECT,
    });
    return page(rows, query.limit, (row) => publicAttendanceView(row, key.tenant.currency));
  }

  // --- expenses ------------------------------------------------------------------------------------

  async listExpenses(key: ApiKeyPrincipal, query: PublicApiExpenseQuery) {
    const rows = await this.db(key).expense.findMany({
      where: {
        deletedAt: null,
        ...(query.project_id ? { projectId: query.project_id } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              spentOn: {
                ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
              },
            }
          : {}),
        AND: keyset(query),
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_EXPENSE_SELECT,
    });
    return page(rows, query.limit, (row) => publicExpenseView(row, key.tenant.currency));
  }

  async getExpense(key: ApiKeyPrincipal, id: string) {
    const row = await this.db(key).expense.findFirst({ where: { id, deletedAt: null }, select: PUBLIC_EXPENSE_SELECT });
    if (!row) throw ApiError.notFound('Expense');
    return publicExpenseView(row, key.tenant.currency);
  }

  async createExpense(key: ApiKeyPrincipal, input: PublicApiExpenseCreateInput) {
    if (input.currency && input.currency !== key.tenant.currency) {
      throw ApiError.validationFailed(
        { currency: input.currency },
        `This company keeps its books in ${key.tenant.currency}; amounts are not converted.`,
      );
    }

    // Filed under a real person in the company: the one named, or the owner who made the key.
    const submitterId = input.submitted_by ?? key.createdByUserId;
    const submitter = await this.db(key).user.findFirst({
      where: { id: submitterId, deletedAt: null, status: 'active' },
      select: { id: true },
    });
    if (!submitter) {
      if (input.submitted_by) {
        throw ApiError.validationFailed({ submitted_by: 'not an active member' }, 'submitted_by is not an active member of this company.');
      }
      throw new ApiError(
        HttpStatus.CONFLICT,
        ERROR_CODES.CONFLICT,
        'The owner who made this API key is no longer active. Name the person the expense is for in submitted_by, or use a new key.',
      );
    }

    const created = await this.expenses.create(serviceActor(key, submitter.id), {
      project_id: input.project_id,
      amount: input.amount,
      category: input.category,
      spent_on: input.spent_on,
      note: input.note,
      tax_amount: input.tax_amount,
      supplier_tax_id: input.supplier_tax_id,
      cost_code_id: input.cost_code_id,
    });
    return this.getExpense(key, created.id);
  }

  // --- purchase orders -----------------------------------------------------------------------------

  async listPurchaseOrders(key: ApiKeyPrincipal, query: PublicApiProjectScopedQuery) {
    const rows = await this.db(key).purchaseOrder.findMany({
      where: { ...(query.project_id ? { projectId: query.project_id } : {}), AND: keyset(query) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_PURCHASE_ORDER_SELECT,
    });
    return page(rows, query.limit, (row) => publicPurchaseOrderView(row, key.tenant.currency));
  }

  async getPurchaseOrder(key: ApiKeyPrincipal, id: string) {
    const row = await this.db(key).purchaseOrder.findFirst({
      where: { id },
      select: { ...PUBLIC_PURCHASE_ORDER_SELECT, lines: { orderBy: { position: 'asc' }, select: PUBLIC_PURCHASE_ORDER_LINE_SELECT } },
    });
    if (!row) throw ApiError.notFound('Purchase order');
    return publicPurchaseOrderView(row, key.tenant.currency, row.lines);
  }

  // --- daily reports, change orders, RFIs ----------------------------------------------------------

  async listDailyReports(key: ApiKeyPrincipal, query: PublicApiProjectScopedQuery) {
    const rows = await this.db(key).dailyReport.findMany({
      where: { deletedAt: null, ...(query.project_id ? { projectId: query.project_id } : {}), AND: keyset(query) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_DAILY_REPORT_SELECT,
    });
    return page(rows, query.limit, publicDailyReportView);
  }

  async listChangeOrders(key: ApiKeyPrincipal, query: PublicApiProjectScopedQuery) {
    const rows = await this.db(key).changeOrder.findMany({
      where: { ...(query.project_id ? { projectId: query.project_id } : {}), AND: keyset(query) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_CHANGE_ORDER_SELECT,
    });
    return page(rows, query.limit, (row) => publicChangeOrderView(row, key.tenant.currency));
  }

  async listRfis(key: ApiKeyPrincipal, query: PublicApiProjectScopedQuery) {
    const rows = await this.db(key).rfi.findMany({
      where: { ...(query.project_id ? { projectId: query.project_id } : {}), AND: keyset(query) },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: PUBLIC_RFI_SELECT,
    });
    return page(rows, query.limit, publicRfiView);
  }

  private db(key: ApiKeyPrincipal) {
    return this.tenantDb.clientFor(key.tenantId);
  }
}

/**
 * The key as an owner-equivalent of its company, for the internal services the public API reuses.
 * `userId` is the person a write is filed under (a table like `expenses` insists on one); the audit
 * log still records the key, from the request (see `currentAuditActor`).
 */
function serviceActor(key: ApiKeyPrincipal, userId: string): RequestUser {
  return {
    userId,
    tenantId: key.tenantId,
    role: 'owner',
    roleName: `API key: ${key.name}`,
    permissions: permissionsForSystemRole('owner'),
    projectIds: [],
    seesAllProjects: true,
    plan: key.tenant.plan,
    enabledModules: key.tenant.enabledModules,
    timezone: key.tenant.timezone,
    currency: key.tenant.currency,
    locale: key.tenant.locale,
    taxRegime: key.tenant.taxRegime,
    country: key.tenant.country,
  };
}

// --- cursor pagination ---------------------------------------------------------------------------

/**
 * The cursor is the last record's `(updated_at, id)`, base64url-encoded JSON. Opaque to callers —
 * the docs say so — and checked on the way in, so a hand-edited one is a 422, not a 500.
 */
export function encodeCursor(row: { updatedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.updatedAt.toISOString(), row.id]), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      const updatedAt = new Date(parsed[0]);
      if (!Number.isNaN(updatedAt.getTime()) && /^[0-9a-f-]{36}$/i.test(parsed[1])) {
        return { updatedAt, id: parsed[1] };
      }
    }
  } catch {
    // fall through
  }
  throw ApiError.validationFailed({ cursor: 'invalid' }, 'That cursor is not one this API gave out. Start again without it.');
}

function keyset(query: { cursor?: string; updated_since?: string }): Keyset {
  const conditions: Keyset = [];
  if (query.updated_since) conditions.push({ updatedAt: { gte: new Date(query.updated_since) } });
  if (query.cursor) {
    const after = decodeCursor(query.cursor);
    conditions.push({
      OR: [{ updatedAt: { gt: after.updatedAt } }, { updatedAt: after.updatedAt, id: { gt: after.id } }],
    });
  }
  return conditions;
}

function page<Row extends { updatedAt: Date; id: string }, View>(
  rows: Row[],
  limit: number,
  view: (row: Row) => View,
): PublicPage<View> {
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  const last = kept[kept.length - 1];
  return {
    data: kept.map(view),
    has_more: hasMore,
    next_cursor: hasMore && last ? encodeCursor(last) : null,
  };
}
