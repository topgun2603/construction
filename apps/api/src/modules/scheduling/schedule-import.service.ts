import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  isoDateToUtcDate,
  scheduleFindCycle,
  todayIn,
  type ScheduleImportInput,
  type ScheduleImportPreviewInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ScheduleImportError, type ScheduleImportPlan } from './import/import-plan';
import { msProjectXml } from './import/msproject-export';
import { parseScheduleXml } from './import/schedule-xml';
import { computeSchedule, loadSchedule, syncMilestonePlannedDates } from './schedule-context';

/**
 * Bringing a programme in from Microsoft Project or Primavera P6, and handing one back out to
 * Microsoft Project.
 *
 * Preview and import parse the same way, so what the preview showed is what is imported. The file's
 * own dates are not copied: the tasks, their lengths, links, constraints and progress are, and the
 * schedule works the dates out on the site's calendar like any other plan.
 */
@Injectable()
export class ScheduleImportService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  async preview(actor: RequestUser, projectId: string, input: ScheduleImportPreviewInput) {
    await this.access.assertAccess(actor, projectId);
    const plan = this.parse(input.xml, input.format);
    const loop = findLoop(plan);
    const warnings = loop ? [...plan.warnings, loopMessage(plan, loop)] : plan.warnings;
    const leaves = plan.tasks.filter((task) => !task.is_summary);
    const starts = leaves.map((task) => task.start).filter((day): day is string => Boolean(day)).sort();
    const finishes = leaves.map((task) => task.finish).filter((day): day is string => Boolean(day)).sort();
    return {
      format: plan.format,
      project_name: plan.project_name,
      task_count: leaves.filter((task) => task.kind === 'task').length,
      summary_count: plan.tasks.length - leaves.length,
      milestone_count: leaves.filter((task) => task.kind === 'milestone').length,
      link_count: plan.links.length,
      calendar: plan.calendar,
      start: plan.start ?? starts[0] ?? null,
      finish: finishes[finishes.length - 1] ?? null,
      tasks: plan.tasks.map((task) => ({
        ref: task.ref,
        parent_ref: task.parent_ref,
        depth: task.depth,
        wbs: task.wbs,
        name: task.name,
        kind: task.kind,
        is_summary: task.is_summary,
        duration_days: task.duration_days,
        start: task.start,
        finish: task.finish,
        percent_complete: task.percent_complete,
      })),
      warnings,
    };
  }

  async import(actor: RequestUser, projectId: string, input: ScheduleImportInput) {
    await this.access.assertAccess(actor, projectId);
    const plan = this.parse(input.xml, input.format);
    const loop = findLoop(plan);
    if (loop) throw ApiError.validationFailed({ cycle: loop }, loopMessage(plan, loop));
    const warnings = [...plan.warnings];

    /*
     * A task with no predecessors would otherwise drop back to the start of the job. If the file had
     * it later — because somebody dragged it there, or the tool levelled it — it is held to that
     * date, so the imported plan looks like the one that was exported.
     */
    const hasPredecessor = new Set(plan.links.map((link) => link.successor_ref));
    let pinned = 0;
    for (const task of plan.tasks) {
      if (task.is_summary || hasPredecessor.has(task.ref) || task.constraint_type !== 'asap') continue;
      if (task.actual_start || task.actual_finish || !task.start || !plan.start) continue;
      if (task.start > plan.start) {
        task.constraint_type = 'snet';
        task.constraint_date = task.start;
        pinned += 1;
      }
    }
    if (pinned) warnings.push(`${pinned} task(s) with no predecessors were held to the dates the file gave them.`);

    const today = todayIn(actor.timezone);
    let futureActuals = 0;
    for (const task of plan.tasks) {
      // Progress reported ahead of today is a forecast the file wrote into the actual columns.
      if (task.actual_start && task.actual_start > today) {
        task.actual_start = null;
        futureActuals += 1;
      }
      if (task.actual_finish && task.actual_finish > today) {
        task.actual_finish = null;
        futureActuals += 1;
      }
      if (task.actual_start && task.actual_finish && task.actual_finish < task.actual_start) task.actual_finish = null;
    }
    if (futureActuals) warnings.push(`${futureActuals} actual date(s) after today were left out.`);

    const created = await this.tenantDb.transaction(
      actor.tenantId,
      async (tx) => {
        const project = await tx.project.findFirst({
          where: { id: projectId, deletedAt: null },
          select: { id: true, startDate: true },
        });
        if (!project) throw ApiError.notFound('Project');

        if (input.mode === 'replace') await tx.scheduleTask.deleteMany({ where: { projectId } });
        const base =
          input.mode === 'append'
            ? ((await tx.scheduleTask.aggregate({ where: { projectId, parentId: null }, _max: { sortOrder: true } }))
                ._max.sortOrder ?? -1) + 1
            : 0;

        // Ids made here so the tree and the links can be written in one statement each.
        const ids = new Map(plan.tasks.map((task) => [task.ref, randomUUID()]));
        const siblings = new Map<string | null, number>();
        await tx.scheduleTask.createMany({
          data: plan.tasks.map((task) => {
            const position = siblings.get(task.parent_ref) ?? 0;
            siblings.set(task.parent_ref, position + 1);
            const leafKind = task.is_summary ? 'task' : task.kind;
            return {
              id: ids.get(task.ref)!,
              tenantId: actor.tenantId,
              projectId,
              parentId: task.parent_ref ? ids.get(task.parent_ref)! : null,
              name: task.name.slice(0, 200),
              wbsCode: task.wbs ? task.wbs.slice(0, 40) : null,
              kind: leafKind,
              sortOrder: task.parent_ref ? position : base + position,
              durationDays: leafKind === 'milestone' ? 0 : Math.max(1, Math.min(task.duration_days, 3650)),
              constraintType: task.is_summary ? 'asap' : task.constraint_type,
              constraintDate:
                task.is_summary || task.constraint_type === 'asap' || !task.constraint_date
                  ? null
                  : isoDateToUtcDate(task.constraint_date),
              percentComplete: task.is_summary ? 0 : task.percent_complete,
              actualStart: task.is_summary || !task.actual_start ? null : isoDateToUtcDate(task.actual_start),
              actualFinish: task.is_summary || !task.actual_finish ? null : isoDateToUtcDate(task.actual_finish),
              notes: task.notes ? task.notes.slice(0, 2000) : null,
              externalId: task.ref,
            };
          }),
        });
        await tx.scheduleDependency.createMany({
          data: plan.links.map((link) => ({
            tenantId: actor.tenantId,
            projectId,
            predecessorId: ids.get(link.predecessor_ref)!,
            successorId: ids.get(link.successor_ref)!,
            type: link.type,
            lagDays: Math.max(-365, Math.min(365, link.lag_days)),
          })),
        });

        if (input.use_calendar && plan.calendar) {
          const data = {
            name: plan.calendar.name.slice(0, 80),
            workingDays: plan.calendar.working_days,
            holidays: plan.calendar.holidays.map((day) => isoDateToUtcDate(day)),
          };
          await tx.scheduleCalendar.upsert({
            where: { projectId },
            create: { tenantId: actor.tenantId, projectId, ...data },
            update: data,
          });
        }
        // A site with no start date takes the plan's; one that has a start date keeps it.
        if (!project.startDate && plan.start) {
          await tx.project.update({ where: { id: projectId }, data: { startDate: isoDateToUtcDate(plan.start) } });
        }

        const ctx = await loadSchedule(tx, projectId, actor.country);
        await syncMilestonePlannedDates(tx, ctx, computeSchedule(ctx, today));

        // One line in the audit log that says what happened, above the rows the trigger wrote.
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorId: actor.userId,
            action: 'schedule.imported',
            entity: 'projects',
            entityId: projectId,
            after: {
              format: plan.format,
              mode: input.mode,
              tasks: plan.tasks.length,
              links: plan.links.length,
              calendar: Boolean(input.use_calendar && plan.calendar),
            },
          },
        });
        return plan.tasks.length;
      },
      { timeout: 60_000 },
    );

    return { created, links: plan.links.length, warnings };
  }

  /** The schedule as Microsoft Project XML, dates as the schedule has them today. */
  async export(actor: RequestUser, projectId: string): Promise<{ filename: string; xml: string }> {
    await this.access.assertAccess(actor, projectId);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ctx = await loadSchedule(tx, projectId, actor.country);
      const result = computeSchedule(ctx, todayIn(actor.timezone));
      const safe = ctx.project.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'schedule';
      return { filename: `${safe}.xml`, xml: msProjectXml(ctx, result) };
    });
  }

  private parse(xml: string, format: ScheduleImportInput['format']): ScheduleImportPlan {
    try {
      return parseScheduleXml(xml, format);
    } catch (error) {
      if (error instanceof ScheduleImportError) throw ApiError.validationFailed(null, error.message);
      throw error;
    }
  }
}

function findLoop(plan: ScheduleImportPlan): string[] | null {
  const leaves = plan.tasks.filter((task) => !task.is_summary).map((task) => task.ref);
  return scheduleFindCycle(
    leaves,
    plan.links.map((link) => ({ predecessor_id: link.predecessor_ref, successor_id: link.successor_ref })),
  );
}

function loopMessage(plan: ScheduleImportPlan, loop: string[]): string {
  const names = new Map(plan.tasks.map((task) => [task.ref, task.name]));
  return `The file's links go round in a loop, so it cannot be scheduled: ${loop
    .map((ref) => names.get(ref) ?? ref)
    .join(' → ')}`;
}
