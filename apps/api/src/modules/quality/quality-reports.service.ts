import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  QUALITY_INSPECTION_RESULT_LABELS,
  QUALITY_TEST_TYPE_LABELS,
  SNAG_AGE_BUCKETS,
  SNAG_PRIORITY_LABELS,
  SNAG_STATUS_LABELS,
  daysBetweenInclusive,
  isoDateToUtcDate,
  qualitySpecLabel,
  snagAgeBucket,
  todayIn,
  utcDateToIsoDate,
  type QualityExportKind,
  type QualityInspectionResult,
  type QualityReportQuery,
  type QualitySummaryReport,
  type QualityTestType,
  type SnagPriority,
  type SnagStatus,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { QualityTestsService, TEST_INCLUDE } from './quality-tests.service';
import { snagOverdue } from './snags.service';

const BOM = String.fromCharCode(0xfeff);

/**
 * QA/QC reports (roadmap Phase 2, module 7): open snags by site, trade, assignee and age; the
 * inspection pass rate; test results with the failures listed; and the same as CSV.
 *
 * Counted in code over the rows rather than in SQL: a company's quality record is hundreds of rows,
 * not millions, and one place that decides what "overdue" means beats three GROUP BYs that each
 * decide it slightly differently.
 */
@Injectable()
export class QualityReportsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly tests: QualityTestsService,
  ) {}

  async summary(actor: RequestUser, query: QualityReportQuery): Promise<QualitySummaryReport> {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const today = todayIn(actor.timezone);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const scope = this.scope(actor, query);

    const [snags, inspections, tests] = await Promise.all([
      db.snag.findMany({
        where: { ...scope, ...this.createdBetween(actor, query), status: { not: 'draft' } },
        select: {
          status: true,
          trade: true,
          dueOn: true,
          createdAt: true,
          project: { select: { id: true, name: true } },
          assignedUser: { select: { name: true } },
          assignedContractor: { select: { name: true } },
        },
      }),
      db.qualityInspection.findMany({
        where: { ...scope, ...dateBetween('inspectionDate', query) },
        select: { status: true, result: true, title: true, project: { select: { id: true, name: true } } },
      }),
      db.qualityTest.findMany({
        where: { ...scope, ...dateBetweenTests(query) },
        include: TEST_INCLUDE,
        orderBy: [{ testedOn: 'desc' }, { number: 'desc' }],
      }),
    ]);

    // --- snags ---
    const open = snags.filter((snag) => snag.status === 'open');
    const fixed = snags.filter((snag) => snag.status === 'fixed');
    const overdue = snags.filter((snag) => snagOverdue(snag.status, snag.dueOn, today));
    const bySite = new Map<string, { project: { id: string; name: string }; open: number; fixed: number; overdue: number }>();
    const byTrade = new Map<string, { trade: string; open: number; fixed: number }>();
    const byAssignee = new Map<string, { name: string; kind: 'user' | 'contractor' | 'none'; open: number; overdue: number }>();
    const byAge = new Map<string, number>(SNAG_AGE_BUCKETS.map((bucket) => [bucket.key, 0]));

    for (const snag of snags) {
      if (snag.status === 'closed') continue;
      const site = bySite.get(snag.project.id) ?? { project: snag.project, open: 0, fixed: 0, overdue: 0 };
      const trade = byTrade.get(snag.trade ?? '—') ?? { trade: snag.trade ?? '—', open: 0, fixed: 0 };
      if (snag.status === 'open') {
        site.open += 1;
        trade.open += 1;
      } else {
        site.fixed += 1;
        trade.fixed += 1;
      }
      const late = snagOverdue(snag.status, snag.dueOn, today);
      if (late) site.overdue += 1;
      bySite.set(snag.project.id, site);
      byTrade.set(trade.trade, trade);

      if (snag.status === 'open') {
        const who = snag.assignedUser
          ? { name: snag.assignedUser.name, kind: 'user' as const }
          : snag.assignedContractor
            ? { name: snag.assignedContractor.name, kind: 'contractor' as const }
            : { name: 'Unassigned', kind: 'none' as const };
        const key = `${who.kind}:${who.name}`;
        const row = byAssignee.get(key) ?? { ...who, open: 0, overdue: 0 };
        row.open += 1;
        if (late) row.overdue += 1;
        byAssignee.set(key, row);

        const age = Math.max(0, daysBetweenInclusive(todayIn(actor.timezone, snag.createdAt), today) - 1);
        const bucket = snagAgeBucket(age);
        byAge.set(bucket, (byAge.get(bucket) ?? 0) + 1);
      }
    }

    // --- inspections ---
    const completed = inspections.filter((row) => row.status === 'completed');
    const passRate = (rows: Array<{ result: string | null }>) => {
      const done = rows.filter((row) => row.result !== null);
      return done.length === 0
        ? null
        : Math.round((done.filter((row) => row.result !== 'fail').length * 10_000) / done.length);
    };
    const group = <K extends string>(key: (row: (typeof completed)[number]) => K) => {
      const map = new Map<K, typeof completed>();
      for (const row of completed) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
      return map;
    };

    // --- tests ---
    const judged = tests.filter((row) => row.result !== null);
    const failures = tests.filter((row) => row.result === 'fail');
    const waiting = tests.filter((row) => row.result === null && row.testedOn === null);

    return {
      snags: {
        open: open.length,
        fixed: fixed.length,
        overdue: overdue.length,
        closed: snags.filter((snag) => snag.status === 'closed').length,
        by_site: [...bySite.values()].sort((a, b) => b.open - a.open),
        by_trade: [...byTrade.values()].sort((a, b) => b.open - a.open),
        by_assignee: [...byAssignee.values()].sort((a, b) => b.open - a.open),
        by_age: SNAG_AGE_BUCKETS.map((bucket) => ({
          bucket: bucket.key,
          label: bucket.label,
          count: byAge.get(bucket.key) ?? 0,
        })),
      },
      inspections: {
        completed: completed.length,
        passed: completed.filter((row) => row.result === 'pass').length,
        passed_with_comments: completed.filter((row) => row.result === 'pass_with_comments').length,
        failed: completed.filter((row) => row.result === 'fail').length,
        pass_rate_bp: passRate(completed),
        in_progress: inspections.length - completed.length,
        by_template: [...group((row) => row.title).entries()].map(([name, rows]) => ({
          name,
          completed: rows.length,
          failed: rows.filter((row) => row.result === 'fail').length,
          pass_rate_bp: passRate(rows),
        })),
        by_site: [...group((row) => row.project.id).values()].map((rows) => ({
          project: rows[0]!.project,
          completed: rows.length,
          failed: rows.filter((row) => row.result === 'fail').length,
          pass_rate_bp: passRate(rows),
        })),
      },
      tests: {
        total: tests.length,
        passed: judged.filter((row) => row.result === 'pass').length,
        failed: failures.length,
        pending: waiting.length,
        overdue: waiting.filter((row) => row.dueOn !== null && utcDateToIsoDate(row.dueOn) < today).length,
        failures: await Promise.all(failures.slice(0, 50).map((row) => this.tests.view(actor, row))),
      },
    };
  }

  /** CSV of one register, for a consultant's monthly report or the handover file. */
  async exportCsv(actor: RequestUser, kind: QualityExportKind, query: QualityReportQuery): Promise<string> {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const scope = this.scope(actor, query);
    const today = todayIn(actor.timezone);
    const lines: string[] = [];

    if (kind === 'snags') {
      lines.push(csvRow(['Number', 'Site', 'Title', 'Location', 'Trade', 'Priority', 'Status', 'Assigned to', 'Due', 'Overdue', 'Raised', 'Fixed', 'Closed', 'Reopened', 'Client visible', 'Source']));
      const rows = await db.snag.findMany({
        where: { ...scope, ...this.createdBetween(actor, query) },
        orderBy: { number: 'asc' },
        include: {
          project: { select: { name: true } },
          assignedUser: { select: { name: true } },
          assignedContractor: { select: { name: true } },
        },
      });
      for (const row of rows) {
        lines.push(
          csvRow([
            `SN-${row.number}`,
            row.project.name,
            row.title,
            row.location,
            row.trade,
            SNAG_PRIORITY_LABELS[row.priority as SnagPriority],
            SNAG_STATUS_LABELS[row.status as SnagStatus],
            [row.assignedUser?.name, row.assignedContractor?.name].filter(Boolean).join(' / '),
            row.dueOn ? utcDateToIsoDate(row.dueOn) : '',
            snagOverdue(row.status, row.dueOn, today) ? 'yes' : '',
            todayIn(actor.timezone, row.createdAt),
            row.fixedAt ? todayIn(actor.timezone, row.fixedAt) : '',
            row.closedAt ? todayIn(actor.timezone, row.closedAt) : '',
            String(row.reopenCount),
            row.clientVisible ? 'yes' : '',
            row.source,
          ]),
        );
      }
    } else if (kind === 'inspections') {
      lines.push(csvRow(['Number', 'Site', 'Checklist', 'Location', 'Date', 'Inspector', 'Status', 'Result', 'Lines', 'Failed lines', 'Snags', 'Signed by']));
      const rows = await db.qualityInspection.findMany({
        where: { ...scope, ...dateBetween('inspectionDate', query) },
        orderBy: { number: 'asc' },
        include: {
          project: { select: { name: true } },
          inspector: { select: { name: true } },
          items: { select: { outcome: true } },
          signoffs: { select: { party: true, signatureName: true } },
          _count: { select: { snags: true } },
        },
      });
      for (const row of rows) {
        lines.push(
          csvRow([
            `QI-${row.number}`,
            row.project.name,
            row.title,
            row.location,
            utcDateToIsoDate(row.inspectionDate),
            row.inspector?.name,
            row.status === 'completed' ? 'Completed' : 'In progress',
            row.result ? QUALITY_INSPECTION_RESULT_LABELS[row.result as QualityInspectionResult] : '',
            String(row.items.length),
            String(row.items.filter((item) => item.outcome === 'fail').length),
            String(row._count.snags),
            row.signoffs.map((signoff) => `${signoff.signatureName} (${signoff.party})`).join('; '),
          ]),
        );
      }
    } else {
      lines.push(csvRow(['Number', 'Site', 'Test', 'Sample', 'Location', 'Grade', 'Cast', 'Age (days)', 'Due', 'Tested', 'Specification', 'Result', 'Unit', 'Verdict', 'Lab']));
      const rows = await db.qualityTest.findMany({
        where: { ...scope, ...dateBetweenTests(query) },
        orderBy: { number: 'asc' },
        include: { project: { select: { name: true } } },
      });
      for (const row of rows) {
        const spec = { min: row.specMin?.toString() ?? null, max: row.specMax?.toString() ?? null };
        lines.push(
          csvRow([
            `QT-${row.number}`,
            row.project.name,
            row.title || QUALITY_TEST_TYPE_LABELS[row.testType as QualityTestType],
            row.sampleRef,
            row.location,
            row.grade,
            row.castOn ? utcDateToIsoDate(row.castOn) : '',
            row.ageDays === null ? '' : String(row.ageDays),
            row.dueOn ? utcDateToIsoDate(row.dueOn) : '',
            row.testedOn ? utcDateToIsoDate(row.testedOn) : '',
            qualitySpecLabel(spec),
            row.resultValue?.toString() ?? '',
            row.unit,
            row.result ?? (row.dueOn && utcDateToIsoDate(row.dueOn) < today && !row.testedOn ? 'overdue' : ''),
            row.labName,
          ]),
        );
      }
    }

    // A BOM so Excel reads Arabic and Tamil names as UTF-8, as the audit export does.
    return `${BOM}${lines.join('\r\n')}\r\n`;
  }

  private scope(actor: RequestUser, query: QualityReportQuery) {
    return {
      ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
      project: { deletedAt: null },
    };
  }

  /** A raised date on the company's calendar: "the 3rd" in Dubai starts four hours before UTC's. */
  private createdBetween(actor: RequestUser, query: QualityReportQuery): Prisma.SnagWhereInput {
    if (!query.from && !query.to) return {};
    return {
      createdAt: {
        ...(query.from ? { gte: startOfDay(query.from, actor.timezone) } : {}),
        ...(query.to ? { lt: startOfDay(query.to, actor.timezone, 1) } : {}),
      },
    };
  }
}

function dateBetween(field: 'inspectionDate', query: QualityReportQuery) {
  if (!query.from && !query.to) return {};
  return {
    [field]: {
      ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
      ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
    },
  };
}

/** A test belongs to the day it was tested, or the day it is due while it waits. */
function dateBetweenTests(query: QualityReportQuery): Prisma.QualityTestWhereInput {
  if (!query.from && !query.to) return {};
  const range = {
    ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
    ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
  };
  return { OR: [{ testedOn: range }, { testedOn: null, dueOn: range }] };
}

/** Midnight at the start of `date` (+ `plusDays`) in `timeZone`, as an instant. */
function startOfDay(date: string, timeZone: string, plusDays = 0): Date {
  const utcMidnight = isoDateToUtcDate(date).getTime() + plusDays * 86_400_000;
  // The zone's offset at that moment: format the instant in the zone and read the difference back.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(utcMidnight));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(utcMidnight - (local - utcMidnight));
}

/**
 * One CSV line. Quoted always, and a cell a spreadsheet would read as a formula is prefixed with an
 * apostrophe (CSV injection), exactly as the audit export does.
 */
function csvRow(cells: ReadonlyArray<string | null | undefined>): string {
  return cells
    .map((cell) => {
      let text = cell ?? '';
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    })
    .join(',');
}
