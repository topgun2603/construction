import { Injectable } from '@nestjs/common';
import {
  INDIA_LOCALE,
  ZERO_FIGURES,
  attendanceEarning,
  costCodeForecast,
  forecastSite,
  isoDateToUtcDate,
  orderCostCodeTree,
  rollUpCostCodes,
  todayIn,
  utcDateToIsoDate,
  type CostFigures,
  type ForecastInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { CostActualsService } from './cost-actuals.service';
import { CostCommitmentsService } from './cost-commitments.service';

/** Amounts as strings, the way money crosses the wire everywhere else. `variance` = budget − forecast. */
export interface FiguresView {
  budget: string;
  committed: string;
  actual: string;
  forecast: string;
  variance: string;
}

export interface CostReportLine {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  unit: string | null;
  depth: number;
  labour_default: boolean;
  has_children: boolean;
  /** This line's own figures. */
  own: FiguresView;
  /** Its own plus everything beneath it. */
  total: FiguresView;
}

export interface CostReport {
  project_id: string;
  project_name: string;
  as_of: string;
  /** The budget on the site itself, which the lines' budgets may or may not add up to. */
  project_budget: string | null;
  /** How the site-wide trend behind the forecasts was worked out — the forecast card's method. */
  method: string;
  /** The site forecast's own figure for the whole job, before it is spread over the lines. */
  site_forecast: string | null;
  /** What "committed" is drawn from; empty until purchase orders and subcontracts exist. */
  committed_sources: string[];
  lines: CostReportLine[];
  /** Spend and commitments with no code: shown, never dropped, so the totals match the ledger. */
  unallocated: FiguresView;
  totals: FiguresView;
}

/**
 * Budget against committed, actual and forecast, per cost code and rolled up the tree.
 *
 * Actual is what the forecast card calls spent: expenses that were not rejected, and labour earned
 * on the roll call — plus whatever registered with `CostActualsService` (certified subcontract
 * bills), which posts through its own record rather than as expense rows. Labour has no code of its own on a roll call, so it lands on the site's
 * labour line when one is chosen and in "Unallocated" otherwise — the report's totals always agree
 * with the forecast card's spend, which is the first thing an owner will check.
 *
 * The forecast reuses the site forecast rather than inventing a second method: `forecastSite` works
 * out what the whole job will cost from its own spend and progress, and the cost still to come is
 * spread over the lines in proportion to the budget each has left. A line that has used its budget
 * gets none of it — earthworks finished at a third of the way through are not projected to triple
 * — and no line is forecast below its budget or below what is spent and committed on it.
 */
@Injectable()
export class CostReportService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly commitments: CostCommitmentsService,
    private readonly actuals: CostActualsService,
  ) {}

  async report(actor: RequestUser, projectId: string): Promise<CostReport> {
    await this.access.assertAccess(actor, projectId);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: actor.tenantId },
        select: { timezone: true },
      });
      const today = todayIn(tenant?.timezone ?? INDIA_LOCALE.timezone);
      const upTo = isoDateToUtcDate(today);

      const [project, codes, expenses, attendance, milestones, committed, otherActuals] = await Promise.all([
        tx.project.findUniqueOrThrow({
          where: { id: projectId },
          select: { name: true, budgetAmount: true, startDate: true, targetEndDate: true },
        }),
        tx.costCode.findMany({ where: { projectId } }),
        // The same rule as the forecast and the dashboard: rejected never counts, pending does.
        tx.expense.findMany({
          where: {
            projectId,
            deletedAt: null,
            status: { not: 'rejected' },
            spentOn: { lte: upTo },
          },
          select: { costCodeId: true, spentOn: true, amount: true, category: true },
        }),
        tx.attendance.findMany({
          where: { projectId, attendanceDate: { lte: upTo } },
          select: {
            attendanceDate: true,
            status: true,
            overtimeHours: true,
            wageSnapshot: true,
            overtimeRateSnapshot: true,
          },
        }),
        tx.milestone.findMany({
          where: { projectId, deletedAt: null },
          select: { actualDate: true },
        }),
        this.commitments.committedByCostCode(tx, projectId),
        // Certified subcontract bills, and anything else that becomes cost through its own record.
        this.actuals.actualsFor(tx, projectId, today),
      ]);

      const codeIds = new Set(codes.map((code) => code.id));
      const labourCode = codes.find((code) => code.labourDefault)?.id ?? null;
      // An id that is not one of this site's codes is treated as uncoded rather than trusted.
      const bucket = (id: string | null) => (id && codeIds.has(id) ? id : null);

      const actual = new Map<string | null, bigint>();
      const add = (id: string | null, amount: bigint) =>
        actual.set(id, (actual.get(id) ?? 0n) + amount);
      const spend: ForecastInput['spend'][number][] = [];

      for (const row of expenses) {
        add(bucket(row.costCodeId), row.amount);
        spend.push({
          date: utcDateToIsoDate(row.spentOn),
          line: `Expense · ${row.category}`,
          amount: row.amount,
        });
      }
      for (const row of attendance) {
        const earned = attendanceEarning({
          status: row.status,
          overtimeHours: row.overtimeHours.toString(),
          wageSnapshot: row.wageSnapshot,
          overtimeRateSnapshot: row.overtimeRateSnapshot,
        }).totalPaise;
        if (earned === 0n) continue;
        add(labourCode, earned);
        spend.push({ date: utcDateToIsoDate(row.attendanceDate), line: 'Labour', amount: earned });
      }
      for (const row of otherActuals) {
        if (row.amount === 0n) continue;
        add(bucket(row.costCodeId), row.amount);
        spend.push({ date: row.date, line: row.line, amount: row.amount });
      }

      const committedFor = (id: string | null) => {
        let sum = 0n;
        for (const [key, amount] of committed) if (bucket(key) === id) sum += amount;
        return sum;
      };

      // --- the site-wide trend, exactly as the forecast card works it out --------------------
      const lineBudgets = codes.reduce((sum, code) => sum + code.budget, 0n);
      const site = forecastSite({
        today,
        budget: project.budgetAmount ?? (lineBudgets > 0n ? lineBudgets : null),
        startDate: project.startDate ? utcDateToIsoDate(project.startDate) : null,
        targetEndDate: project.targetEndDate ? utcDateToIsoDate(project.targetEndDate) : null,
        spend,
        milestones: {
          total: milestones.length,
          done: milestones.filter((milestone) => milestone.actualDate).length,
        },
        materials: [],
      });
      const toCome =
        site.forecast !== null && site.forecast > site.spent ? site.forecast - site.spent : 0n;

      // --- spread what is still to come over the budget each line has left -------------------
      const remaining = new Map<string, bigint>();
      for (const code of codes) {
        const left = code.budget - (actual.get(code.id) ?? 0n) - committedFor(code.id);
        if (left > 0n) remaining.set(code.id, left);
      }
      const remainingTotal = [...remaining.values()].reduce((sum, left) => sum + left, 0n);
      const share = (id: string) =>
        remainingTotal > 0n ? (toCome * (remaining.get(id) ?? 0n)) / remainingTotal : 0n;

      const own = new Map<string, CostFigures>();
      for (const code of codes) {
        const spent = actual.get(code.id) ?? 0n;
        const promised = committedFor(code.id);
        own.set(code.id, {
          budget: code.budget,
          committed: promised,
          actual: spent,
          forecast: costCodeForecast({
            budget: code.budget,
            committed: promised,
            actual: spent,
            projected: spent + share(code.id),
          }),
        });
      }

      // Uncoded spend carries its own exposure; with no budget left anywhere to spread over, the
      // cost still to come lands here too rather than vanishing from the total.
      const looseActual = actual.get(null) ?? 0n;
      const looseCommitted = committedFor(null);
      const unallocated: CostFigures = {
        budget: 0n,
        committed: looseCommitted,
        actual: looseActual,
        forecast: costCodeForecast({
          budget: 0n,
          committed: looseCommitted,
          actual: looseActual,
          projected: looseActual + (remainingTotal > 0n ? 0n : toCome),
        }),
      };

      const totals = rollUpCostCodes(
        codes.map((code) => ({ id: code.id, parentId: code.parentId, own: own.get(code.id)! })),
      );
      const parents = new Set(codes.map((code) => code.parentId).filter(Boolean));
      const ordered = orderCostCodeTree(codes);

      const grand = { ...unallocated };
      for (const line of ordered) {
        if (line.depth !== 0) continue;
        const figures = totals.get(line.id)!;
        grand.budget += figures.budget;
        grand.committed += figures.committed;
        grand.actual += figures.actual;
        grand.forecast += figures.forecast;
      }

      return {
        project_id: projectId,
        project_name: project.name,
        as_of: today,
        project_budget: project.budgetAmount?.toString() ?? null,
        method: site.method,
        site_forecast: site.forecast?.toString() ?? null,
        committed_sources: this.commitments.sourceNames(),
        lines: ordered.map((line) => ({
          id: line.id,
          code: line.code,
          name: line.name,
          parent_id: line.parentId,
          unit: line.unit,
          depth: line.depth,
          labour_default: line.labourDefault,
          has_children: parents.has(line.id),
          own: view(own.get(line.id) ?? ZERO_FIGURES),
          total: view(totals.get(line.id) ?? ZERO_FIGURES),
        })),
        unallocated: view(unallocated),
        totals: view(grand),
      };
    });
  }
}

function view(figures: CostFigures): FiguresView {
  return {
    budget: figures.budget.toString(),
    committed: figures.committed.toString(),
    actual: figures.actual.toString(),
    forecast: figures.forecast.toString(),
    variance: (figures.budget - figures.forecast).toString(),
  };
}
