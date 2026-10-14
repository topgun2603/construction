import { Injectable } from '@nestjs/common';
import {
  COMPANY_GROUP_COUNT_KEYS,
  COMPANY_GROUP_MONEY_KEYS,
  attendanceEarning,
  consolidateCompanyGroup,
  currencyMinorDigits,
  isoDateToUtcDate,
  minorToDecimal,
  todayIn,
  utcDateToIsoDate,
  type CompanyGroupCountKey,
  type CompanyGroupMoneyKey,
  type CompanyGroupRate,
  type CompanyGroupRateUsed,
  type CompanyGroupReportQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { CostActualsService } from '../cost-codes/cost-actuals.service';
import { CostCommitmentsService } from '../cost-codes/cost-commitments.service';
import { CompanyGroupsService } from './company-groups.service';

/** Money as strings of minor units, the way it crosses the wire everywhere else. */
type MoneyView = Record<CompanyGroupMoneyKey, string>;
type CountView = Record<CompanyGroupCountKey, number>;

export interface CompanyGroupReportCompany {
  tenant_id: string;
  name: string;
  currency: string;
  locale: string;
  status: string;
  money: MoneyView;
  counts: CountView;
}

export interface CompanyGroupReport {
  group: { id: string; name: string; base_currency: string };
  /** The period labour cost and expenses cover. Everything else is to date. */
  period: { from: string; to: string };
  /** The date the exchange rates were picked for — the period's end. */
  rates_as_of: string;
  companies: CompanyGroupReportCompany[];
  total: {
    currency: string;
    money: MoneyView;
    counts: CountView;
    rates_used: CompanyGroupRateUsed[];
    /** Currencies with no rate on `rates_as_of`; their companies are not in `money`. */
    missing_currencies: string[];
    complete: boolean;
  };
}

interface CompanyFigures {
  tenantId: string;
  name: string;
  currency: string;
  locale: string;
  status: string;
  money: Record<CompanyGroupMoneyKey, bigint>;
  counts: CountView;
}

/**
 * The consolidated report — the only read in the product that spans companies.
 *
 * HOW IT STAYS SAFE. It never disables or widens row-level security. It first proves, inside the
 * caller's own company's transaction, that the caller holds `group.view_reports` in the group that
 * company belongs to and reads that group's member list. Then it opens one ordinary tenant-scoped
 * transaction *per member company*, so every row it reads passes that company's
 * `tenant_isolation` policy exactly as a request from inside it would. A company id from the
 * request is only ever a filter on that member list: a company outside the group is refused,
 * never read.
 *
 * Each company is reported in its own currency. The group total is converted at the group's own
 * manual rates (`companyGroupRateOn`) on the period's last day, and the rates used are returned
 * with it.
 */
@Injectable()
export class CompanyGroupReportService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly groups: CompanyGroupsService,
    private readonly commitments: CostCommitmentsService,
    private readonly actuals: CostActualsService,
  ) {}

  async report(actor: RequestUser, query: CompanyGroupReportQuery): Promise<CompanyGroupReport> {
    const today = todayIn(actor.timezone);
    const to = query.to ?? today;
    const from = query.from ?? `${to.slice(0, 7)}-01`;
    if (from > to) throw ApiError.validationFailed({ from, to }, 'from must not be after to');

    const scope = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const groupId = await this.groups.requireGroup(tx, actor.tenantId);
      await this.groups.requireGrant(tx, actor, groupId, 'group.view_reports');
      const [group, members, rates] = await Promise.all([
        tx.companyGroup.findUniqueOrThrow({
          where: { id: groupId },
          select: { id: true, name: true, baseCurrency: true },
        }),
        tx.companyGroupMember.findMany({
          where: { groupId },
          select: { tenantId: true },
          orderBy: { joinedAt: 'asc' },
        }),
        tx.companyGroupExchangeRate.findMany({
          where: { groupId },
          select: { currency: true, rate: true, effectiveFrom: true },
        }),
      ]);
      return { group, memberIds: members.map((member) => member.tenantId), rates };
    });

    let tenantIds = scope.memberIds;
    if (query.tenant_id) {
      if (!tenantIds.includes(query.tenant_id)) {
        throw ApiError.forbidden('That company is not in your group');
      }
      tenantIds = [query.tenant_id];
    }

    // One company at a time, each in its own tenant transaction. Sequential on purpose: a group is
    // a handful of companies, and this keeps the report to one pooled connection at a time.
    const companies: CompanyFigures[] = [];
    for (const tenantId of tenantIds) {
      const figures = await this.figuresFor(tenantId, from, to);
      if (figures) companies.push(figures);
    }

    const rates: CompanyGroupRate[] = scope.rates.map((row) => ({
      currency: row.currency,
      rate: row.rate.toFixed(),
      effective_from: utcDateToIsoDate(row.effectiveFrom),
    }));
    const consolidated = consolidateCompanyGroup({
      baseCurrency: scope.group.baseCurrency,
      asOf: to,
      rates,
      keys: COMPANY_GROUP_MONEY_KEYS,
      companies: companies.map((company) => ({ currency: company.currency, money: company.money })),
    });

    const counts = Object.fromEntries(COMPANY_GROUP_COUNT_KEYS.map((key) => [key, 0])) as CountView;
    for (const company of companies) {
      for (const key of COMPANY_GROUP_COUNT_KEYS) counts[key] += company.counts[key];
    }

    return {
      group: {
        id: scope.group.id,
        name: scope.group.name,
        base_currency: scope.group.baseCurrency,
      },
      period: { from, to },
      rates_as_of: to,
      companies: companies.map((company) => ({
        tenant_id: company.tenantId,
        name: company.name,
        currency: company.currency,
        locale: company.locale,
        status: company.status,
        money: moneyView(company.money),
        counts: company.counts,
      })),
      total: {
        currency: scope.group.baseCurrency,
        money: moneyView(consolidated.totals),
        counts,
        rates_used: consolidated.rates_used,
        missing_currencies: consolidated.missing_currencies,
        complete: consolidated.complete,
      },
    };
  }

  /** The same report as CSV: one row per company in its own currency, then the converted total. */
  async reportCsv(actor: RequestUser, query: CompanyGroupReportQuery): Promise<string> {
    const report = await this.report(actor, query);
    const header = [
      'company',
      'currency',
      ...COMPANY_GROUP_MONEY_KEYS,
      ...COMPANY_GROUP_COUNT_KEYS,
      'rate_to_group_currency',
      'rate_effective_from',
    ];
    const decimal = (minor: string, currency: string) =>
      minorToDecimal(BigInt(minor), currencyMinorDigits(currency));
    const rateOf = (currency: string) =>
      report.total.rates_used.find((rate) => rate.currency === currency);

    const rows: Array<Array<string | number>> = [header];
    for (const company of report.companies) {
      const rate = rateOf(company.currency);
      rows.push([
        company.name,
        company.currency,
        ...COMPANY_GROUP_MONEY_KEYS.map((key) => decimal(company.money[key], company.currency)),
        ...COMPANY_GROUP_COUNT_KEYS.map((key) => company.counts[key]),
        rate?.rate ?? 'no rate',
        rate?.effective_from ?? '',
      ]);
    }
    rows.push([
      report.total.complete
        ? `Group total (${report.group.name})`
        : `Group total (${report.group.name}) — excludes ${report.total.missing_currencies.join(', ')}: no rate`,
      report.total.currency,
      ...COMPANY_GROUP_MONEY_KEYS.map((key) => decimal(report.total.money[key], report.total.currency)),
      ...COMPANY_GROUP_COUNT_KEYS.map((key) => report.total.counts[key]),
      '',
      '',
    ]);
    rows.push([`Period ${report.period.from} to ${report.period.to}; rates as of ${report.rates_as_of}`]);
    // A BOM so Excel reads Arabic and Tamil company names as UTF-8.
    return `${BOM}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
  }

  /**
   * One company's figures, read entirely inside that company's own tenant transaction.
   *
   * The rules are the ones the rest of the product uses, so a company's line here matches its own
   * screens: rejected expenses never count, pending ones do; labour is earned on the roll call;
   * committed is what purchase orders and subcontracts still owe; actual is labour + expenses +
   * certified subcontract bills to date; receivables are raised instalments not yet received.
   * Budget, committed and actual cover live sites (not completed, not deleted).
   */
  private async figuresFor(tenantId: string, from: string, to: string): Promise<CompanyFigures | null> {
    return this.tenantDb.transaction(
      tenantId,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, currency: true, locale: true, timezone: true, status: true },
        });
        if (!tenant) return null;

        const today = todayIn(tenant.timezone);
        const todayUtc = isoDateToUtcDate(today);
        const fromUtc = isoDateToUtcDate(from);
        const toUtc = isoDateToUtcDate(to);

        const projects = await tx.project.findMany({
          where: { deletedAt: null, status: { not: 'completed' } },
          select: { id: true, status: true, budgetAmount: true },
        });
        const liveIds = projects.map((project) => project.id);

        const [labourPeriod, expensesPeriod, labourToDate, expensesToDate, stages, headcount, incidents, snags] =
          await Promise.all([
            this.labourCost(tx, { attendanceDate: { gte: fromUtc, lte: toUtc }, project: { deletedAt: null } }),
            tx.expense.aggregate({
              where: {
                spentOn: { gte: fromUtc, lte: toUtc },
                status: { not: 'rejected' },
                deletedAt: null,
                project: { deletedAt: null },
              },
              _sum: { amount: true },
            }),
            this.labourCost(tx, { projectId: { in: liveIds }, attendanceDate: { lte: todayUtc } }),
            tx.expense.aggregate({
              where: {
                projectId: { in: liveIds },
                spentOn: { lte: todayUtc },
                status: { not: 'rejected' },
                deletedAt: null,
              },
              _sum: { amount: true },
            }),
            tx.paymentStage.findMany({
              where: { deletedAt: null, raisedAt: { not: null }, project: { deletedAt: null } },
              select: {
                amount: true,
                taxAmount: true,
                receipts: { where: { deletedAt: null }, select: { amount: true } },
              },
            }),
            tx.attendance.count({
              where: { attendanceDate: todayUtc, status: { not: 'absent' }, project: { deletedAt: null } },
            }),
            tx.safetyIncident.count({ where: { status: { not: 'closed' } } }),
            tx.snag.count({ where: { status: { in: ['open', 'fixed'] } } }),
          ]);

        // Committed and the extra actual-cost sources are per site by design (each source knows its
        // own tables); a company has tens of live sites, not thousands.
        let committed = 0n;
        let otherActual = 0n;
        for (const projectId of liveIds) {
          for (const amount of (await this.commitments.committedByCostCode(tx, projectId)).values()) {
            committed += amount;
          }
          for (const row of await this.actuals.actualsFor(tx, projectId, today)) {
            otherActual += row.amount;
          }
        }

        let receivables = 0n;
        for (const stage of stages) {
          const due = stage.amount + stage.taxAmount;
          const paid = stage.receipts.reduce((sum, receipt) => sum + receipt.amount, 0n);
          // Never negative: an overpayment on one instalment is not a debt on another.
          if (due > paid) receivables += due - paid;
        }

        return {
          tenantId,
          name: tenant.name,
          currency: tenant.currency,
          locale: tenant.locale,
          status: tenant.status,
          money: {
            labour_cost: labourPeriod,
            expenses: expensesPeriod._sum.amount ?? 0n,
            committed,
            budget: projects.reduce((sum, project) => sum + (project.budgetAmount ?? 0n), 0n),
            actual: labourToDate + (expensesToDate._sum.amount ?? 0n) + otherActual,
            receivables,
          },
          counts: {
            sites_active: projects.filter((project) => project.status === 'active').length,
            headcount_today: headcount,
            open_incidents: incidents,
            open_snags: snags,
          },
        };
      },
      // A company's whole history is summed here; give it longer than an ordinary request.
      { timeout: 30_000 },
    );
  }

  /**
   * Labour earned on the roll call, without fetching every attendance row: rows that would earn
   * the same (same status, wage, overtime rate and hours) are grouped and counted in the database,
   * and each group is priced once with the same `attendanceEarning` every other screen uses.
   */
  private async labourCost(
    tx: TenantTx,
    where: NonNullable<Parameters<TenantTx['attendance']['groupBy']>[0]>['where'],
  ): Promise<bigint> {
    const groups = await tx.attendance.groupBy({
      by: ['status', 'wageSnapshot', 'overtimeRateSnapshot', 'overtimeHours'],
      where,
      _count: { _all: true },
    });
    let total = 0n;
    for (const group of groups) {
      const earning = attendanceEarning({
        status: group.status,
        overtimeHours: group.overtimeHours.toString(),
        wageSnapshot: group.wageSnapshot,
        overtimeRateSnapshot: group.overtimeRateSnapshot,
      });
      total += earning.totalPaise * BigInt(group._count._all);
    }
    return total;
  }
}

/** Written as an escape: a literal byte-order mark in source is invisible and easy to lose. */
const BOM = '﻿';

function moneyView(money: Record<CompanyGroupMoneyKey, bigint>): MoneyView {
  return Object.fromEntries(
    COMPANY_GROUP_MONEY_KEYS.map((key) => [key, money[key].toString()]),
  ) as MoneyView;
}

/**
 * Quote a CSV cell, and defuse a leading formula character in text — a company name is not code
 * to run. A plain number (a negative amount included) is left alone so it stays a number.
 */
function csvCell(value: string | number): string {
  const text = String(value);
  const numeric = typeof value === 'number' || /^-?\d+(\.\d+)?$/.test(text);
  const safe = !numeric && /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
