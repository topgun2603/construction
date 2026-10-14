import { Injectable } from '@nestjs/common';
import {
  addDays,
  isoDateToUtcDate,
  scheduleLookAheadCsv,
  scheduleLookAheadEvent,
  scheduleVarianceOf,
  todayIn,
  utcDateToIsoDate,
  type CreateScheduleBaselineInput,
  type ScheduleLookAheadQuery,
  type ScheduleLookAheadRow,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { computeSchedule, loadSchedule } from './schedule-context';
import { baselineSummary } from './scheduling.service';

/**
 * Baselines — the plan's dates saved so slippage can be measured against them — and the
 * two-week look-ahead a site meeting runs from.
 */
@Injectable()
export class ScheduleBaselinesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  async list(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    const rows = await this.tenantDb.clientFor(actor.tenantId).scheduleBaseline.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return rows.map(baselineSummary);
  }

  /** Saves every task's current dates — summaries too, so a phase's slip can be read at a glance. */
  async create(actor: RequestUser, projectId: string, input: CreateScheduleBaselineInput) {
    await this.access.assertAccess(actor, projectId);
    const id = await this.tenantDb.transaction(
      actor.tenantId,
      async (tx) => {
        const ctx = await loadSchedule(tx, projectId, actor.country);
        if (ctx.tasks.length === 0) throw ApiError.conflict('There is nothing on the schedule to save yet.');
        const result = computeSchedule(ctx, todayIn(actor.timezone));
        const baseline = await tx.scheduleBaseline.create({
          data: {
            tenantId: actor.tenantId,
            projectId,
            name: input.name,
            finishDate: isoDateToUtcDate(result.finish_date),
            createdById: actor.userId,
          },
          select: { id: true },
        });
        await tx.scheduleBaselineTask.createMany({
          data: ctx.tasks.map((task) => {
            const computed = result.tasks[task.id]!;
            return {
              tenantId: actor.tenantId,
              baselineId: baseline.id,
              taskId: task.id,
              name: task.name,
              startDate: isoDateToUtcDate(computed.start),
              finishDate: isoDateToUtcDate(computed.finish),
              durationDays: computed.duration_days,
            };
          }),
        });
        return baseline.id;
      },
      { timeout: 30_000 },
    );
    const row = await this.tenantDb.clientFor(actor.tenantId).scheduleBaseline.findFirstOrThrow({
      where: { id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    return baselineSummary(row);
  }

  async remove(actor: RequestUser, projectId: string, baselineId: string): Promise<void> {
    await this.access.assertAccess(actor, projectId);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const found = await tx.scheduleBaseline.findFirst({ where: { id: baselineId, projectId }, select: { id: true } });
      if (!found) throw ApiError.notFound('Baseline');
      await tx.scheduleBaseline.delete({ where: { id: baselineId } });
    });
  }

  /** Every task against the baseline, and the ones that now finish later than it said, worst first. */
  async variance(actor: RequestUser, projectId: string, baselineId: string) {
    await this.access.assertAccess(actor, projectId);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const baseline = await tx.scheduleBaseline.findFirst({
        where: { id: baselineId, projectId },
        include: { tasks: true, createdBy: { select: { id: true, name: true } } },
      });
      if (!baseline) throw ApiError.notFound('Baseline');
      const ctx = await loadSchedule(tx, projectId, actor.country);
      const result = computeSchedule(ctx, todayIn(actor.timezone));
      const live = new Map(ctx.tasks.map((task) => [task.id, task]));

      const tasks = baseline.tasks
        .map((row) => {
          const task = row.taskId ? live.get(row.taskId) : undefined;
          const base = { start: utcDateToIsoDate(row.startDate), finish: utcDateToIsoDate(row.finishDate) };
          const computed = task ? result.tasks[task.id]! : null;
          const variance = computed
            ? scheduleVarianceOf(result.calendar, base, { start: computed.start, finish: computed.finish })
            : null;
          return {
            task_id: task ? task.id : null,
            name: task?.name ?? row.name,
            wbs: task ? (ctx.wbs.get(task.id) ?? null) : null,
            baseline_start: base.start,
            baseline_finish: base.finish,
            start: computed?.start ?? null,
            finish: computed?.finish ?? null,
            start_variance: variance?.start_variance ?? null,
            finish_variance: variance?.finish_variance ?? null,
            slipped: variance?.slipped ?? false,
            summary: computed?.is_summary ?? false,
            order: task ? ctx.tasks.indexOf(task) : Number.MAX_SAFE_INTEGER,
          };
        })
        .sort((a, b) => a.order - b.order);

      const finish = ctx.tasks.length ? result.finish_date : null;
      return {
        baseline: baselineSummary(baseline),
        current_finish: finish,
        finish_variance: finish
          ? result.calendar.workdaysBetween(utcDateToIsoDate(baseline.finishDate), finish)
          : 0,
        tasks: tasks.map(({ order: _order, summary: _summary, ...row }) => row),
        slipped: tasks
          .filter((row) => row.slipped && !row.summary && row.task_id)
          .sort((a, b) => (b.finish_variance ?? 0) - (a.finish_variance ?? 0))
          .map((row) => row.task_id!),
      };
    });
  }

  /**
   * What starts or finishes in the next fortnight (or `days`), on one site or every site the person
   * can see. Finished work is left out: a look-ahead is for what is coming.
   */
  async lookAhead(actor: RequestUser, query: ScheduleLookAheadQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const from = query.from ?? todayIn(actor.timezone);
    const to = addDays(from, query.days - 1);
    const statusDate = todayIn(actor.timezone);

    const rows: Array<ScheduleLookAheadRow & { project_id: string; task_id: string }> = [];
    await this.tenantDb.transaction(
      actor.tenantId,
      async (tx) => {
        const projects = await tx.project.findMany({
          where: {
            deletedAt: null,
            ...(query.project_id ? { id: query.project_id } : this.access.scopeFilter(actor)),
            scheduleTasks: { some: {} },
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        for (const project of projects) {
          const ctx = await loadSchedule(tx, project.id, actor.country);
          const result = computeSchedule(ctx, statusDate);
          for (const task of ctx.tasks) {
            const computed = result.tasks[task.id]!;
            if (computed.is_summary || computed.status === 'complete') continue;
            const event = scheduleLookAheadEvent(computed, from, to);
            if (!event) continue;
            rows.push({
              project_id: project.id,
              task_id: task.id,
              site: project.name,
              wbs: ctx.wbs.get(task.id) ?? null,
              task: task.name,
              start: computed.start,
              finish: computed.finish,
              percent_complete: computed.percent_complete,
              critical: computed.critical,
              responsible: task.responsible?.name ?? task.contractor?.name ?? null,
              event,
            });
          }
        }
      },
      { timeout: 30_000 },
    );
    rows.sort((a, b) => a.start.localeCompare(b.start) || a.site.localeCompare(b.site));
    return { from, to, items: rows };
  }

  async lookAheadCsv(actor: RequestUser, query: ScheduleLookAheadQuery): Promise<string> {
    return scheduleLookAheadCsv((await this.lookAhead(actor, query)).items);
  }
}
