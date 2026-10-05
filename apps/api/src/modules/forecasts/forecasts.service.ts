import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  attendanceEarning,
  explainForecast,
  forecastSite,
  INDIA_LOCALE,
  isoDateToUtcDate,
  quantityToThousandths,
  todayIn,
  utcDateToIsoDate,
  type ForecastDriver,
  type ForecastInput,
  type MoneyFormat,
  type SiteForecast,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { ForecastExplainer } from './forecast-explainer.service';

export interface ForecastView {
  project_id: string;
  project_name: string;
  as_of: string;
  method: string;
  spent: string;
  budget: string | null;
  forecast: string | null;
  overrun_pct: number | null;
  progress_pct: number | null;
  elapsed_pct: number | null;
  severity: string;
  drivers: unknown;
  explanation: string;
  explained_by: string;
}

/** Severities worth the cost of a reworded explanation. */
const EXPLAIN_WITH_AI = new Set(['warning', 'critical']);

/**
 * Overrun early warning (roadmap: AI agent 2).
 *
 * Gathers each active site's costs, progress and material use, runs the shared `forecastSite`
 * arithmetic, and keeps one row per site per day. Set-based: one query per kind of record for
 * all of a company's sites, not a loop of queries per site, because the nightly run covers every
 * company and the refresh button should answer while the owner waits.
 */
@Injectable()
export class ForecastsService {
  private readonly logger = new Logger(ForecastsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly explainer: ForecastExplainer,
  ) {}

  /** The nightly run for one company: every active site, on the company's own today. */
  async refreshTenant(tenantId: string): Promise<{ sites: number; flagged: number }> {
    const results = await this.compute(tenantId, null);
    await this.store(tenantId, results);
    return {
      sites: results.length,
      flagged: results.filter((result) => EXPLAIN_WITH_AI.has(result.forecast.severity)).length,
    };
  }

  /** "Refresh" on the site page. */
  async refreshProject(actor: RequestUser, projectId: string): Promise<ForecastView> {
    await this.access.assertAccess(actor, projectId);
    const results = await this.compute(actor.tenantId, projectId);
    if (results.length === 0) throw ApiError.notFound('Project');
    await this.store(actor.tenantId, results);
    return (await this.forProject(actor, projectId))!;
  }

  /** The latest forecast for each active site this person can see. */
  async latest(actor: RequestUser): Promise<ForecastView[]> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const rows = await db.siteForecast.findMany({
      where: {
        ...this.access.scopeFilterByProjectId(actor),
        project: { deletedAt: null, status: 'active' },
      },
      distinct: ['projectId'],
      orderBy: [{ projectId: 'asc' }, { asOf: 'desc' }],
      include: { project: { select: { name: true } } },
    });
    return rows.map(toView);
  }

  /** The latest forecast for one site, worked out now when it has never had one. */
  async forProject(actor: RequestUser, projectId: string): Promise<ForecastView | null> {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const row = await db.siteForecast.findFirst({
      where: { projectId },
      orderBy: { asOf: 'desc' },
      include: { project: { select: { name: true } } },
    });
    if (row) return toView(row);

    const results = await this.compute(actor.tenantId, projectId);
    if (results.length === 0) return null;
    await this.store(actor.tenantId, results);
    return this.forProject(actor, projectId);
  }

  // --- the work -----------------------------------------------------------------------------

  private async compute(
    tenantId: string,
    projectId: string | null,
  ): Promise<
    Array<{
      projectId: string;
      name: string;
      today: string;
      format: MoneyFormat;
      forecast: SiteForecast;
    }>
  > {
    return this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true, currency: true, locale: true },
      });
      const timezone = tenant?.timezone ?? INDIA_LOCALE.timezone;
      const format: MoneyFormat = {
        currency: tenant?.currency ?? INDIA_LOCALE.currency,
        locale: tenant?.locale ?? INDIA_LOCALE.locale,
      };
      const today = todayIn(timezone);

      const projects = await tx.project.findMany({
        where: projectId
          ? { id: projectId, deletedAt: null }
          : { deletedAt: null, status: 'active' },
        select: { id: true, name: true, budgetAmount: true, startDate: true, targetEndDate: true },
      });
      if (projects.length === 0) return [];
      const inputs = await gather(
        tx,
        projects.map((p) => p.id),
        today,
      );

      return projects.map((project) => {
        const gathered = inputs.get(project.id)!;
        const forecast = forecastSite({
          today,
          budget: project.budgetAmount,
          startDate: project.startDate ? utcDateToIsoDate(project.startDate) : null,
          targetEndDate: project.targetEndDate ? utcDateToIsoDate(project.targetEndDate) : null,
          ...gathered,
        });
        return { projectId: project.id, name: project.name, today, format, forecast };
      });
    });
  }

  private async store(
    tenantId: string,
    results: Awaited<ReturnType<ForecastsService['compute']>>,
  ): Promise<void> {
    // Worded outside the transaction: a model call must not hold a database connection open.
    const worded = await Promise.all(
      results.map(async (result) => {
        const template = explainForecast(result.forecast, result.format);
        const ai = EXPLAIN_WITH_AI.has(result.forecast.severity)
          ? await this.explainer.reword(result.name, template)
          : null;
        return { ...result, explanation: ai ?? template, explainedBy: ai ? 'ai' : 'template' };
      }),
    );

    await this.tenantDb.transaction(tenantId, async (tx) => {
      for (const result of worded) {
        const { forecast } = result;
        const data = {
          method: forecast.method,
          spent: forecast.spent,
          budget: forecast.budget,
          forecast: forecast.forecast,
          overrunPct: forecast.overrunPct,
          progressPct: forecast.progressPct,
          elapsedPct: forecast.elapsedPct,
          severity: forecast.severity,
          drivers: serialiseDrivers(forecast.drivers),
          explanation: result.explanation,
          explainedBy: result.explainedBy,
        };
        await tx.siteForecast.upsert({
          where: {
            projectId_asOf: { projectId: result.projectId, asOf: isoDateToUtcDate(result.today) },
          },
          create: {
            tenantId,
            projectId: result.projectId,
            asOf: isoDateToUtcDate(result.today),
            ...data,
          },
          update: data,
        });
      }
    });
    this.logger.log({ tenantId, sites: worded.length }, 'Forecasts stored');
  }
}

type Gathered = Pick<ForecastInput, 'spend' | 'milestones' | 'materials'>;

/** Every site's spend lines, milestone counts and material use, in five queries. */
async function gather(
  tx: TenantTx,
  projectIds: string[],
  today: string,
): Promise<Map<string, Gathered>> {
  const upTo = isoDateToUtcDate(today);
  const [attendance, expenses, milestones, estimates, consumed] = await Promise.all([
    tx.attendance.findMany({
      where: { projectId: { in: projectIds }, attendanceDate: { lte: upTo } },
      select: {
        projectId: true,
        attendanceDate: true,
        status: true,
        overtimeHours: true,
        wageSnapshot: true,
        overtimeRateSnapshot: true,
        worker: { select: { trade: true } },
      },
    }),
    // Rejected spend never counts; pending does, as on the dashboard — the money has left.
    tx.expense.findMany({
      where: {
        projectId: { in: projectIds },
        deletedAt: null,
        status: { not: 'rejected' },
        spentOn: { lte: upTo },
      },
      select: { projectId: true, spentOn: true, amount: true, category: true },
    }),
    tx.milestone.findMany({
      where: { projectId: { in: projectIds }, deletedAt: null },
      select: { projectId: true, actualDate: true },
    }),
    tx.materialEstimate.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        projectId: true,
        materialId: true,
        estimatedQuantity: true,
        material: { select: { name: true, unit: true } },
      },
    }),
    tx.stockMovement.groupBy({
      by: ['projectId', 'materialId'],
      where: { projectId: { in: projectIds }, deletedAt: null, type: 'out' },
      _sum: { quantity: true },
    }),
  ]);

  const out = new Map<string, Gathered>(
    projectIds.map((id) => [id, { spend: [], milestones: { total: 0, done: 0 }, materials: [] }]),
  );
  const site = (id: string) => out.get(id)!;

  for (const row of attendance) {
    const earned = attendanceEarning({
      status: row.status,
      overtimeHours: row.overtimeHours.toString(),
      wageSnapshot: row.wageSnapshot,
      overtimeRateSnapshot: row.overtimeRateSnapshot,
    }).totalPaise;
    if (earned === 0n) continue;
    (site(row.projectId).spend as ForecastInput['spend'][number][]).push({
      date: utcDateToIsoDate(row.attendanceDate),
      line: `Labour · ${label(row.worker?.trade ?? 'general')}`,
      amount: earned,
    });
  }
  for (const row of expenses) {
    (site(row.projectId).spend as ForecastInput['spend'][number][]).push({
      date: utcDateToIsoDate(row.spentOn),
      line: `Expense · ${label(row.category)}`,
      amount: row.amount,
    });
  }
  for (const row of milestones) {
    const counts = site(row.projectId).milestones;
    counts.total += 1;
    if (row.actualDate) counts.done += 1;
  }
  const used = new Map(
    consumed.map((row) => [
      `${row.projectId}:${row.materialId}`,
      quantityToThousandths((row._sum.quantity ?? 0).toString()),
    ]),
  );
  for (const row of estimates) {
    (site(row.projectId).materials as ForecastInput['materials'][number][]).push({
      name: row.material.name,
      unit: row.material.unit,
      estimated: quantityToThousandths(row.estimatedQuantity.toString()),
      consumed: used.get(`${row.projectId}:${row.materialId}`) ?? 0n,
    });
  }
  return out;
}

/** `ready_mix` → `Ready mix`. */
function label(value: string): string {
  const text = value.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** JSON cannot hold a bigint; amounts are stored as strings, as they cross the wire everywhere else. */
function serialiseDrivers(drivers: ForecastDriver[]): Prisma.InputJsonValue {
  return drivers.map((driver) =>
    driver.kind === 'spend_trend'
      ? { ...driver, recent: driver.recent.toString(), previous: driver.previous.toString() }
      : driver,
  ) as Prisma.InputJsonValue;
}

function toView(row: {
  projectId: string;
  project: { name: string };
  asOf: Date;
  method: string;
  spent: bigint;
  budget: bigint | null;
  forecast: bigint | null;
  overrunPct: number | null;
  progressPct: number | null;
  elapsedPct: number | null;
  severity: string;
  drivers: Prisma.JsonValue;
  explanation: string;
  explainedBy: string;
}): ForecastView {
  return {
    project_id: row.projectId,
    project_name: row.project.name,
    as_of: utcDateToIsoDate(row.asOf),
    method: row.method,
    spent: row.spent.toString(),
    budget: row.budget?.toString() ?? null,
    forecast: row.forecast?.toString() ?? null,
    overrun_pct: row.overrunPct,
    progress_pct: row.progressPct,
    elapsed_pct: row.elapsedPct,
    severity: row.severity,
    drivers: row.drivers,
    explanation: row.explanation,
    explained_by: row.explainedBy,
  };
}
