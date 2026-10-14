import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  INDIA_LOCALE,
  addDays,
  siteTimeToday,
  QUALITY_CUBE_DEFAULT_AGES,
  QUALITY_TEST_DEFAULT_UNITS,
  QUALITY_TEST_TYPE_LABELS,
  isoDateToUtcDate,
  qualityCubeTarget,
  qualitySpecLabel,
  qualityTestDueOn,
  qualityTestOutcome,
  qualityTestState,
  todayIn,
  utcDateToIsoDate,
  type CreateQualityTestInput,
  type ListQualityTestsQuery,
  type QualityTestResult,
  type QualityTestType,
  type QualityTestView,
  type RecordQualityTestResultInput,
  type SnagStatus,
  type UpdateQualityTestInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { siteToday } from '../../common/site-clock';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  REPORT_KINDS,
  assertOwnKeys,
  assertSiteCostCode,
  costCodeView,
  dec,
  isoOrNull,
  nextNumber,
  person,
  retryOnNumberClash,
} from './quality-common';
import { raiseSnag } from './snags.service';

export const TEST_INCLUDE = {
  project: { select: { id: true, name: true } },
  costCode: { select: { id: true, code: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
  snags: { select: { id: true, number: true, status: true }, orderBy: { createdAt: 'desc' }, take: 1 },
} as const satisfies Prisma.QualityTestInclude;

export type TestRow = Prisma.QualityTestGetPayload<{ include: typeof TEST_INCLUDE }>;

/**
 * Material and lab tests (QA/QC, roadmap Phase 2, module 7): cubes, slump, steel, compaction.
 *
 * A cube set is created as one row per crushing age, each due on the cast date plus its age, so
 * "which cubes are due today" is a plain query — and the morning reminder, on the company's own
 * clock, is what stops a 28-day cube being crushed on day 31 because nobody remembered.
 *
 * Pass or fail is worked out from the specification, never typed: a lab figure is a fact, and a
 * result somebody chose is an opinion.
 */
@Injectable()
export class QualityTestsService {
  private readonly logger = new Logger(QualityTestsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(actor: RequestUser, query: ListQualityTestsQuery): Promise<{ items: QualityTestView[] }> {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const today = isoDateToUtcDate(todayIn(actor.timezone));
    const waiting = { result: null, testedOn: null } as const;
    const state: Prisma.QualityTestWhereInput =
      query.state === 'pending'
        ? waiting
        : query.state === 'due'
          ? { ...waiting, dueOn: today }
          : query.state === 'overdue'
            ? { ...waiting, dueOn: { lt: today } }
            : query.state
              ? { result: query.state }
              : {};
    const rows = await this.tenantDb.clientFor(actor.tenantId).qualityTest.findMany({
      where: {
        ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
        ...(query.test_type ? { testType: query.test_type } : {}),
        ...(query.sample_ref ? { sampleRef: query.sample_ref } : {}),
        ...state,
        project: { deletedAt: null },
      },
      include: TEST_INCLUDE,
      orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { number: 'asc' }],
      take: query.limit,
    });
    return { items: await Promise.all(rows.map((row) => this.view(actor, row))) };
  }

  async get(actor: RequestUser, id: string): Promise<QualityTestView> {
    return this.view(actor, await this.find(actor, id));
  }

  /** One test, or a cube set: one row per age, all on the same sample reference. */
  async create(actor: RequestUser, input: CreateQualityTestInput): Promise<{ items: QualityTestView[] }> {
    await this.access.assertAccess(actor, input.project_id);
    const ids = await retryOnNumberClash(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        await assertSiteCostCode(tx, input.project_id, input.cost_code_id);
        const unit = input.unit ?? (QUALITY_TEST_DEFAULT_UNITS[input.test_type] || null);
        const cube = input.test_type === 'concrete_cube';
        const ages: Array<number | null> = cube
          ? [...new Set(input.ages ?? QUALITY_CUBE_DEFAULT_AGES)].sort((a, b) => a - b)
          : [null];

        const made: string[] = [];
        let number = await nextNumber(tx, 'qualityTest');
        for (const age of ages) {
          const row = await tx.qualityTest.create({
            data: {
              tenantId: actor.tenantId,
              projectId: input.project_id,
              number: number++,
              testType: input.test_type,
              title: input.title ?? null,
              sampleRef: input.sample_ref,
              location: input.location ?? null,
              costCodeId: input.cost_code_id ?? null,
              grade: input.grade ?? null,
              castOn: input.cast_on ? isoDateToUtcDate(input.cast_on) : null,
              ageDays: age,
              dueOn:
                age !== null && input.cast_on
                  ? isoDateToUtcDate(qualityTestDueOn(input.cast_on, age))
                  : input.due_on
                    ? isoDateToUtcDate(input.due_on)
                    : null,
              // A cube set's minimum is the 28-day figure; the early ages get their usual share.
              specMin:
                input.spec_min == null ? null : age !== null ? qualityCubeTarget(input.spec_min, age) : input.spec_min,
              specMax: input.spec_max ?? null,
              unit,
              labName: input.lab_name ?? null,
              notes: input.notes ?? null,
              recordedById: actor.userId,
            },
            select: { id: true },
          });
          made.push(row.id);
        }
        return made;
      }),
    );
    return { items: await Promise.all(ids.map((id) => this.get(actor, id))) };
  }

  async update(actor: RequestUser, id: string, input: UpdateQualityTestInput): Promise<QualityTestView> {
    const row = await this.find(actor, id);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await assertSiteCostCode(tx, row.projectId, input.cost_code_id);
      const specMin = input.spec_min === undefined ? dec(row.specMin) : input.spec_min;
      const specMax = input.spec_max === undefined ? dec(row.specMax) : input.spec_max;
      // A changed specification re-judges a result already recorded, rather than leaving a stale verdict.
      const resultValue = dec(row.resultValue);
      const result = resultValue === null ? null : qualityTestOutcome(resultValue, { min: specMin, max: specMax });
      await tx.qualityTest.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.sample_ref === undefined ? {} : { sampleRef: input.sample_ref }),
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.cost_code_id === undefined ? {} : { costCodeId: input.cost_code_id }),
          ...(input.grade === undefined ? {} : { grade: input.grade }),
          ...(input.due_on === undefined
            ? {}
            : { dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null, remindedAt: null }),
          ...(input.unit === undefined ? {} : { unit: input.unit }),
          ...(input.lab_name === undefined ? {} : { labName: input.lab_name }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          specMin,
          specMax,
          result,
        },
      });
    });
    return this.get(actor, id);
  }

  /**
   * The lab's figure. Judged against the specification; a failure raises a high-priority snag on
   * the site (once per test) and tells the site's managers, because a failed 28-day cube is a
   * structural question somebody has to answer this week.
   */
  async recordResult(actor: RequestUser, id: string, input: RecordQualityTestResultInput): Promise<QualityTestView> {
    if (input.report_s3_key) assertOwnKeys(actor, [input.report_s3_key], REPORT_KINDS);
    const row = await this.find(actor, id);
    const spec = { min: dec(row.specMin), max: dec(row.specMax) };
    const result = qualityTestOutcome(input.result_value, spec);
    const label = testLabel(row);

    const raisedSnag = await retryOnNumberClash(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        await tx.qualityTest.update({
          where: { id },
          data: {
            resultValue: input.result_value,
            result,
            testedOn: isoDateToUtcDate(
              input.tested_on ?? (await siteToday(tx, actor, row.projectId)),
            ),
            ...(input.lab_name === undefined ? {} : { labName: input.lab_name }),
            ...(input.report_s3_key === undefined ? {} : { reportS3Key: input.report_s3_key }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
          },
        });
        if (result !== 'fail' || input.raise_snag === false || row.snags.length > 0) return false;
        const unit = row.unit ? ` ${row.unit}` : '';
        await raiseSnag(tx, {
          tenantId: actor.tenantId,
          projectId: row.projectId,
          title: `${label} failed — sample ${row.sampleRef}`,
          description: `Result ${input.result_value}${unit} against ${qualitySpecLabel(spec, row.unit)}.`,
          location: row.location,
          trade: row.testType.startsWith('concrete') ? 'Concrete' : null,
          priority: 'high',
          source: 'test',
          costCodeId: row.costCodeId,
          testId: id,
          raisedById: actor.userId,
          eventNote: `Failed test QT-${row.number}`,
        });
        return true;
      }),
    );

    if (result === 'fail') {
      await this.notifications
        .notify({
          tenantId: actor.tenantId,
          roles: ['owner', 'project_manager'],
          projectId: row.projectId,
          exceptUserId: actor.userId,
          type: 'quality.test_failed',
          title: `Test failed: ${label}`,
          body: `QT-${row.number} · sample ${row.sampleRef} · ${input.result_value}${row.unit ? ` ${row.unit}` : ''}${raisedSnag ? ' · snag raised' : ''}`,
          payload: { test_id: id, project_id: row.projectId },
        })
        .catch((error: unknown) => this.logger.warn({ err: error }, 'Could not send the failed-test notice'));
    }
    return this.get(actor, id);
  }

  /** Only while it has no result: a recorded lab figure is evidence. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    const row = await this.find(actor, id);
    if (row.resultValue !== null) throw ApiError.conflict('A test with a recorded result cannot be deleted');
    await this.tenantDb.transaction(actor.tenantId, (tx) => tx.qualityTest.delete({ where: { id } }));
  }

  /**
   * The morning reminder: tests due today (or already late) with no result, on the company's own
   * calendar, each reminded once. Scheduled like workers' document expiry — the worker's 15-minute
   * tick asks which companies' clocks just reached `QUALITY_TEST_DUE_CRON` (tenant-clock.ts) and
   * runs this for each, so a Dubai site is reminded at 8 in Dubai.
   *
   * One notice per site, to its managers and supervisors and whoever logged the samples — the
   * people who will actually take the cubes to the lab.
   */
  async remindTenant(tenantId: string): Promise<{ reminded: number }> {
    const due = await this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
      const company = { timezone: tenant?.timezone ?? INDIA_LOCALE.timezone };
      const today = todayIn(company.timezone);
      /*
       * Due "today" means today at the site (a separate time zone per site). A site can be a day
       * ahead of the company, so the query reaches a day further and each row is then held to its
       * own site's date.
       */
      const candidates = await tx.qualityTest.findMany({
        where: {
          result: null,
          testedOn: null,
          remindedAt: null,
          dueOn: { lte: isoDateToUtcDate(addDays(today, 1)) },
          project: { deletedAt: null },
        },
        orderBy: [{ dueOn: 'asc' }, { number: 'asc' }],
        select: {
          id: true,
          number: true,
          projectId: true,
          testType: true,
          title: true,
          sampleRef: true,
          ageDays: true,
          dueOn: true,
          recordedById: true,
          project: { select: { name: true, timeZone: true } },
        },
      });
      const rows = candidates.filter(
        (row) => utcDateToIsoDate(row.dueOn!) <= siteTimeToday(row.project, company),
      );
      if (rows.length > 0) {
        await tx.qualityTest.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { remindedAt: new Date() },
        });
      }
      return { rows, company };
    });
    if (due.rows.length === 0) return { reminded: 0 };

    const bySite = new Map<string, typeof due.rows>();
    for (const row of due.rows) bySite.set(row.projectId, [...(bySite.get(row.projectId) ?? []), row]);

    for (const [projectId, rows] of bySite) {
      const lines = rows.slice(0, 5).map((row) => {
        const age = row.ageDays ? `${row.ageDays}-day ` : '';
        const siteToday = siteTimeToday(row.project, due.company);
        const late = utcDateToIsoDate(row.dueOn!) < siteToday ? ` (due ${utcDateToIsoDate(row.dueOn!)})` : '';
        return `${age}${testLabel(row)} · sample ${row.sampleRef}${late}`;
      });
      await this.notifications.notify({
        tenantId,
        roles: ['project_manager', 'site_supervisor'],
        projectId,
        userIds: [...new Set(rows.map((row) => row.recordedById).filter((id): id is string => Boolean(id)))],
        type: 'quality.tests_due',
        title:
          rows.length === 1
            ? `A test is due today at ${rows[0]!.project.name}`
            : `${rows.length} tests are due at ${rows[0]!.project.name}`,
        body: lines.join('\n') + (rows.length > 5 ? `\n…and ${rows.length - 5} more` : ''),
        payload: { project_id: projectId, test_ids: rows.map((row) => row.id) },
      });
    }
    this.logger.log({ tenantId, reminded: due.rows.length }, 'Test due reminders sent');
    return { reminded: due.rows.length };
  }

  private async find(actor: RequestUser, id: string): Promise<TestRow> {
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .qualityTest.findFirst({ where: { id }, include: TEST_INCLUDE });
    if (!row) throw ApiError.notFound('Test');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  async view(actor: RequestUser, row: TestRow): Promise<QualityTestView> {
    const result = row.result as QualityTestResult | null;
    const dueOn = isoOrNull(row.dueOn);
    const testedOn = isoOrNull(row.testedOn);
    const snag = row.snags[0];
    return {
      id: row.id,
      number: row.number,
      project: { id: row.project.id, name: row.project.name },
      test_type: row.testType as QualityTestType,
      title: row.title,
      sample_ref: row.sampleRef,
      location: row.location,
      cost_code: costCodeView(row.costCode),
      grade: row.grade,
      cast_on: isoOrNull(row.castOn),
      age_days: row.ageDays,
      due_on: dueOn,
      tested_on: testedOn,
      spec_min: dec(row.specMin),
      spec_max: dec(row.specMax),
      unit: row.unit,
      result_value: dec(row.resultValue),
      result,
      state: qualityTestState({ dueOn, result, testedOn }, todayIn(actor.timezone)),
      lab_name: row.labName,
      report: row.reportS3Key
        ? { s3_key: row.reportS3Key, url: await this.uploads.signedViewUrl(actor, row.reportS3Key) }
        : null,
      notes: row.notes,
      snag: snag ? { id: snag.id, number: snag.number, status: snag.status as SnagStatus } : null,
      recorded_by: person(row.recordedBy),
      created_at: row.createdAt.toISOString(),
    };
  }
}

function testLabel(row: { testType: string; title: string | null }): string {
  return row.title || QUALITY_TEST_TYPE_LABELS[row.testType as QualityTestType] || row.testType;
}
