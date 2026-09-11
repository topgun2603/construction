import { Injectable } from '@nestjs/common';
import {
  addDays,
  attendanceEarning,
  isoDateToUtcDate,
  todayInIst,
  utcDateToIsoDate,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  /**
   * The all-sites overview (design artboard 3a, spec §3 item 8).
   *
   * Everything is gathered in a handful of set-based queries rather than a loop
   * over projects: the screen has a 500 ms budget for 50 sites (spec §15), and a
   * per-project round trip would spend it on latency alone.
   */
  async overview(actor: RequestUser) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const today = todayInIst();
    const todayUtc = isoDateToUtcDate(today);
    const weekStart = isoDateToUtcDate(addDays(today, -6));
    const monthStart = isoDateToUtcDate(`${today.slice(0, 7)}-01`);

    const projects = await db.project.findMany({
      where: {
        deletedAt: null,
        status: { not: 'completed' },
        ...this.access.scopeFilter(actor),
      },
      select: {
        id: true,
        name: true,
        address: true,
        clientName: true,
        status: true,
        budgetAmount: true,
        startDate: true,
        targetEndDate: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    if (projects.length === 0) {
      return {
        date: today,
        headcount_series: Array.from({ length: 7 }, (_, index) => ({
          date: addDays(today, index - 6),
          count: 0,
        })),
        totals: {
          site_count: 0,
          dprs_in: 0,
          headcount_today: 0,
          labour_cost_month: 0n,
          labour_cost_week: 0n,
          pending_indents: 0,
          urgent_indents: 0,
          budget_committed: 0n,
          expenses_month: 0n,
          pending_expenses: 0,
          spend_month: 0n,
        },
        sites: [],
      };
    }

    const projectIds = projects.map((project) => project.id);

    const [todayReports, monthAttendance, indents, monthExpenses] = await Promise.all([
      db.dailyReport.findMany({
        where: { projectId: { in: projectIds }, reportDate: todayUtc, deletedAt: null },
        select: {
          projectId: true,
          status: true,
          submittedAt: true,
          issues: true,
          manpower: { select: { count: true } },
        },
      }),
      // One scan of the month covers today's headcount, the week's cost and the
      // month's cost — three tiles, one query.
      db.attendance.findMany({
        where: { projectId: { in: projectIds }, attendanceDate: { gte: monthStart } },
        select: {
          projectId: true,
          attendanceDate: true,
          status: true,
          overtimeHours: true,
          wageSnapshot: true,
          overtimeRateSnapshot: true,
        },
      }),
      db.materialIndent.findMany({
        where: {
          projectId: { in: projectIds },
          status: { in: ['requested', 'approved'] },
          deletedAt: null,
        },
        select: { projectId: true, status: true, urgency: true },
      }),
      // Rejected spend never counts; pending does, because the money has left
      // whether or not the paperwork has cleared.
      db.expense.findMany({
        where: {
          projectId: { in: projectIds },
          spentOn: { gte: monthStart },
          status: { not: 'rejected' },
          deletedAt: null,
        },
        select: { projectId: true, amount: true, status: true },
      }),
    ]);

    const reportByProject = new Map(todayReports.map((report) => [report.projectId, report]));

    const headcountToday = new Map<string, number>();
    const costWeek = new Map<string, bigint>();
    const costMonth = new Map<string, bigint>();
    // Headcount per day for the last week, keyed by ISO date. Built from the same
    // rows as the cost totals, so the trend chart costs no extra query.
    const headcountByDay = new Map<string, number>();
    let totalHeadcount = 0;
    let totalWeek = 0n;
    let totalMonth = 0n;

    for (const row of monthAttendance) {
      const earning = attendanceEarning({
        status: row.status,
        overtimeHours: row.overtimeHours.toString(),
        wageSnapshot: row.wageSnapshot,
        overtimeRateSnapshot: row.overtimeRateSnapshot,
      });

      costMonth.set(row.projectId, (costMonth.get(row.projectId) ?? 0n) + earning.totalPaise);
      totalMonth += earning.totalPaise;

      if (row.attendanceDate >= weekStart) {
        costWeek.set(row.projectId, (costWeek.get(row.projectId) ?? 0n) + earning.totalPaise);
        totalWeek += earning.totalPaise;
      }

      // Headcount counts bodies on site, so a half day still counts as one person.
      if (row.status !== 'absent') {
        if (row.attendanceDate.getTime() === todayUtc.getTime()) {
          headcountToday.set(row.projectId, (headcountToday.get(row.projectId) ?? 0) + 1);
          totalHeadcount += 1;
        }
        if (row.attendanceDate >= weekStart) {
          const day = utcDateToIsoDate(row.attendanceDate);
          headcountByDay.set(day, (headcountByDay.get(day) ?? 0) + 1);
        }
      }
    }

    const expenseMonth = new Map<string, bigint>();
    let totalExpenses = 0n;
    let pendingExpenseCount = 0;
    for (const expense of monthExpenses) {
      expenseMonth.set(expense.projectId, (expenseMonth.get(expense.projectId) ?? 0n) + expense.amount);
      totalExpenses += expense.amount;
      if (expense.status === 'pending') pendingExpenseCount += 1;
    }

    const pendingByProject = new Map<string, { pending: number; urgent: number }>();
    for (const indent of indents) {
      const entry = pendingByProject.get(indent.projectId) ?? { pending: 0, urgent: 0 };
      entry.pending += 1;
      if (indent.urgency === 'high') entry.urgent += 1;
      pendingByProject.set(indent.projectId, entry);
    }

    const sites = projects.map((project) => {
      const report = reportByProject.get(project.id);
      const pending = pendingByProject.get(project.id) ?? { pending: 0, urgent: 0 };
      return {
        id: project.id,
        name: project.name,
        address: project.address,
        client_name: project.clientName,
        status: project.status,
        budget_amount: project.budgetAmount,
        start_date: project.startDate ? utcDateToIsoDate(project.startDate) : null,
        target_end_date: project.targetEndDate ? utcDateToIsoDate(project.targetEndDate) : null,
        dpr_status: report?.status ?? 'missing',
        dpr_submitted_at: report?.submittedAt?.toISOString() ?? null,
        dpr_has_issues: Boolean(report?.issues && report.issues.trim().length > 0),
        headcount_today: headcountToday.get(project.id) ?? 0,
        labour_cost_week: costWeek.get(project.id) ?? 0n,
        labour_cost_month: costMonth.get(project.id) ?? 0n,
        expenses_month: expenseMonth.get(project.id) ?? 0n,
        // Labour plus materials and petty cash: the number the design's
        // "spend vs budget" meter is actually about.
        spend_month: (costMonth.get(project.id) ?? 0n) + (expenseMonth.get(project.id) ?? 0n),
        pending_indents: pending.pending,
        urgent_indents: pending.urgent,
      };
    });

    // Every day in the window, including the zeros — a gap in the chart should read
    // as "nobody worked", not as a missing bar.
    const headcountSeries = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(today, index - 6);
      return { date: day, count: headcountByDay.get(day) ?? 0 };
    });

    return {
      date: today,
      headcount_series: headcountSeries,
      totals: {
        site_count: projects.length,
        dprs_in: todayReports.filter((report) => report.status === 'submitted').length,
        headcount_today: totalHeadcount,
        labour_cost_month: totalMonth,
        labour_cost_week: totalWeek,
        pending_indents: indents.length,
        urgent_indents: indents.filter((indent) => indent.urgency === 'high').length,
        budget_committed: projects.reduce((sum, p) => sum + (p.budgetAmount ?? 0n), 0n),
        expenses_month: totalExpenses,
        pending_expenses: pendingExpenseCount,
        spend_month: totalMonth + totalExpenses,
      },
      sites,
    };
  }

  /** Today's DPR feed and the approvals waiting on the caller. */
  async today(actor: RequestUser) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const today = todayInIst();

    const [reports, indents, headcountRows] = await Promise.all([
      db.dailyReport.findMany({
        where: {
          reportDate: isoDateToUtcDate(today),
          deletedAt: null,
          ...this.access.scopeFilterByProjectId(actor),
        },
        select: {
          id: true,
          projectId: true,
          status: true,
          workDone: true,
          issues: true,
          submittedAt: true,
          project: { select: { name: true } },
          submitter: { select: { name: true } },
          manpower: { select: { trade: true, count: true } },
          photos: { select: { id: true } },
        },
        orderBy: { submittedAt: 'desc' },
      }),
      db.materialIndent.findMany({
        where: {
          status: 'requested',
          deletedAt: null,
          ...this.access.scopeFilterByProjectId(actor),
        },
        select: {
          id: true,
          urgency: true,
          createdAt: true,
          notes: true,
          project: { select: { id: true, name: true } },
          requester: { select: { name: true } },
          items: {
            select: { quantity: true, material: { select: { name: true, unit: true } } },
          },
        },
        orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
        take: 20,
      }),
      db.attendance.findMany({
        where: {
          attendanceDate: isoDateToUtcDate(today),
          status: { not: 'absent' },
          ...this.access.scopeFilterByProjectId(actor),
        },
        select: { projectId: true },
      }),
    ]);

    const headcount = new Map<string, number>();
    for (const row of headcountRows) {
      headcount.set(row.projectId, (headcount.get(row.projectId) ?? 0) + 1);
    }

    return {
      date: today,
      reports: reports.map((report) => ({
        id: report.id,
        project_id: report.projectId,
        project_name: report.project.name,
        status: report.status,
        work_done: report.workDone,
        issues: report.issues,
        submitted_at: report.submittedAt?.toISOString() ?? null,
        submitted_by: report.submitter.name,
        headcount: headcount.get(report.projectId) ?? 0,
        reported_manpower: report.manpower.reduce((sum, entry) => sum + entry.count, 0),
        photo_count: report.photos.length,
      })),
      approvals: indents.map((indent) => ({
        id: indent.id,
        project_id: indent.project.id,
        project_name: indent.project.name,
        urgency: indent.urgency,
        notes: indent.notes,
        requested_by: indent.requester.name,
        created_at: indent.createdAt.toISOString(),
        summary: indent.items
          .map((item) => `${item.material.name} · ${String(item.quantity)} ${item.material.unit}`)
          .join(', '),
      })),
    };
  }
}
