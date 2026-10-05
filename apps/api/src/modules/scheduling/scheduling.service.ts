import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  isoDateToUtcDate,
  scheduleFindCycle,
  todayIn,
  utcDateToIsoDate,
  type CreateScheduleDependencyInput,
  type CreateScheduleTaskInput,
  type IsoDate,
  type ScheduleCalendarInput,
  type ScheduleProgressInput,
  type ScheduleQuery,
  type ScheduleResult,
  type UpdateScheduleDependencyInput,
  type UpdateScheduleTaskInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import {
  computeSchedule,
  dependencyView,
  linkedMilestone,
  loadSchedule,
  resolveCalendar,
  syncMilestonePlannedDates,
  taskView,
  type BaselineEntry,
  type ScheduleContext,
} from './schedule-context';

const date = (value: IsoDate | null | undefined) => (value ? isoDateToUtcDate(value) : null);

/**
 * A site's schedule (roadmap Phase 2, module 6): tasks in a breakdown, the links between them,
 * progress, the working calendar, and the site milestones it carries.
 *
 * Every write runs inside one transaction that ends by recomputing the whole schedule, so a write
 * the engine cannot schedule — a loop, a link to what has just become a summary — rolls back
 * rather than leaving a plan nobody can draw.
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
  ) {}

  // --- reading -----------------------------------------------------------------------------------

  async get(actor: RequestUser, projectId: string, query: ScheduleQuery) {
    await this.access.assertAccess(actor, projectId);
    const statusDate = query.status_date ?? todayIn(actor.timezone);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const ctx = await loadSchedule(tx, projectId, actor.country);
      const result = computeSchedule(ctx, statusDate);

      const [baselines, milestones, chosen] = await Promise.all([
        tx.scheduleBaseline.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
          include: { createdBy: { select: { id: true, name: true } } },
        }),
        tx.milestone.findMany({
          where: { projectId, deletedAt: null, scheduleTask: null },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true, plannedDate: true },
        }),
        query.baseline_id
          ? tx.scheduleBaseline.findFirst({
              where: { id: query.baseline_id, projectId },
              include: { tasks: true },
            })
          : null,
      ]);
      if (query.baseline_id && !chosen) throw ApiError.notFound('Baseline');

      const entries = new Map<string, BaselineEntry>(
        (chosen?.tasks ?? []).filter((row) => row.taskId).map((row) => [row.taskId!, row]),
      );
      const tasks = ctx.tasks.map((task) =>
        taskView(ctx, result, task, chosen ? (entries.get(task.id) ?? null) : undefined),
      );
      const finish = ctx.tasks.length ? result.finish_date : null;

      return {
        project: {
          id: ctx.project.id,
          name: ctx.project.name,
          start_date: ctx.project.startDate ? utcDateToIsoDate(ctx.project.startDate) : null,
          target_end_date: ctx.project.targetEndDate ? utcDateToIsoDate(ctx.project.targetEndDate) : null,
        },
        status_date: statusDate,
        project_start: result.project_start,
        finish_date: finish,
        calendar: ctx.calendar,
        tasks,
        dependencies: ctx.links.map(dependencyView),
        critical_path: result.critical_path,
        baselines: baselines.map(baselineSummary),
        baseline: chosen
          ? {
              id: chosen.id,
              name: chosen.name,
              finish_date: utcDateToIsoDate(chosen.finishDate),
              finish_variance: finish
                ? result.calendar.workdaysBetween(utcDateToIsoDate(chosen.finishDate), finish)
                : 0,
              slipped_count: tasks.filter((task) => !task.is_summary && task.baseline?.slipped).length,
            }
          : null,
        unlinked_milestones: milestones.map((row) => ({
          id: row.id,
          name: row.name,
          planned_date: row.plannedDate ? utcDateToIsoDate(row.plannedDate) : null,
        })),
        can: {
          manage: can(actor, 'schedule.manage'),
          progress: can(actor, 'schedule.progress') || can(actor, 'schedule.manage'),
        },
      };
    });
  }

  // --- tasks -------------------------------------------------------------------------------------

  async createTask(actor: RequestUser, projectId: string, input: CreateScheduleTaskInput) {
    return this.change(actor, projectId, async (tx) => {
      const kind = input.kind ?? 'task';
      if (input.parent_id) await assertParent(tx, projectId, input.parent_id);
      await assertReferences(tx, projectId, input, kind);
      const sortOrder = input.sort_order ?? (await nextSortOrder(tx, projectId, input.parent_id ?? null));
      const constraintType = input.constraint_type ?? 'asap';
      const made = await tx.scheduleTask.create({
        data: {
          tenantId: actor.tenantId,
          projectId,
          parentId: input.parent_id ?? null,
          name: input.name,
          kind,
          wbsCode: input.wbs_code ?? null,
          sortOrder,
          durationDays: kind === 'milestone' ? 0 : (input.duration_days ?? 1),
          constraintType,
          constraintDate: constraintType === 'asap' ? null : date(input.constraint_date),
          costCodeId: input.cost_code_id ?? null,
          responsibleUserId: input.responsible_user_id ?? null,
          contractorId: input.contractor_id ?? null,
          milestoneId: input.milestone_id ?? null,
          notes: input.notes ?? null,
        },
        select: { id: true },
      });
      return made.id;
    });
  }

  async updateTask(actor: RequestUser, projectId: string, taskId: string, input: UpdateScheduleTaskInput) {
    return this.change(actor, projectId, async (tx, before) => {
      const task = before.ctx.tasks.find((row) => row.id === taskId);
      if (!task) throw ApiError.notFound('Task');
      const summary = before.ctx.hasChildren.has(taskId);
      const kind = input.kind ?? task.kind;

      const planFields =
        input.duration_days !== undefined ||
        input.start_date !== undefined ||
        input.finish_date !== undefined ||
        input.constraint_type !== undefined ||
        input.constraint_date !== undefined;
      if (summary && planFields) {
        throw ApiError.validationFailed(
          null,
          'A summary task’s dates come from the tasks under it. Change those instead.',
        );
      }
      if (kind === 'milestone' && summary) {
        throw ApiError.validationFailed(null, 'A task with subtasks cannot be a milestone.');
      }
      if (input.parent_id !== undefined && input.parent_id !== task.parentId) {
        if (input.parent_id) {
          await assertParent(tx, projectId, input.parent_id);
          if (isWithin(before.ctx, input.parent_id, taskId)) {
            throw ApiError.validationFailed(null, 'A task cannot move under one of its own subtasks.');
          }
        }
      }
      await assertReferences(tx, projectId, input, kind, taskId);

      const data: Prisma.ScheduleTaskUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.wbs_code !== undefined) data.wbsCode = input.wbs_code;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.sort_order !== undefined) data.sortOrder = input.sort_order;
      if (input.cost_code_id !== undefined) data.costCodeId = input.cost_code_id;
      if (input.responsible_user_id !== undefined) data.responsibleUserId = input.responsible_user_id;
      if (input.contractor_id !== undefined) data.contractorId = input.contractor_id;
      if (input.milestone_id !== undefined) data.milestoneId = input.milestone_id;
      if (input.parent_id !== undefined && input.parent_id !== task.parentId) {
        data.parentId = input.parent_id;
        if (input.sort_order === undefined) data.sortOrder = await nextSortOrder(tx, projectId, input.parent_id);
      }
      if (input.kind !== undefined && input.kind !== task.kind) {
        data.kind = input.kind;
        if (input.kind === 'milestone') data.durationDays = 0;
        else {
          data.durationDays = input.duration_days ?? 1;
          // Only a milestone stands for a site milestone.
          data.milestoneId = null;
        }
      }
      if (input.duration_days !== undefined && kind === 'task') {
        if (input.duration_days < 1) {
          throw ApiError.validationFailed(null, 'A task lasts at least one working day; make it a milestone instead.');
        }
        data.durationDays = input.duration_days;
      }
      if (input.constraint_type !== undefined) {
        data.constraintType = input.constraint_type;
        data.constraintDate = input.constraint_type === 'asap' ? null : date(input.constraint_date);
      } else if (input.constraint_date !== undefined) {
        if (task.constraintType === 'asap') {
          throw ApiError.validationFailed(null, 'Choose whether the date is a start-no-earlier-than or a finish-no-later-than.');
        }
        data.constraintDate = date(input.constraint_date);
      }
      // Dragging the start pins it, as it does in every scheduling tool.
      if (input.start_date !== undefined) {
        data.constraintType = 'snet';
        data.constraintDate = isoDateToUtcDate(input.start_date);
      }
      if (input.finish_date !== undefined) {
        if (kind === 'milestone') {
          data.constraintType = 'snet';
          data.constraintDate = isoDateToUtcDate(input.finish_date);
        } else {
          const start = input.start_date ?? before.result.tasks[taskId]!.start;
          const days = before.result.calendar.workdaysInclusive(start, input.finish_date);
          if (days < 1) throw ApiError.validationFailed(null, 'It cannot finish before it starts.');
          data.durationDays = days;
        }
      }
      if (input.percent_complete !== undefined || input.actual_start !== undefined || input.actual_finish !== undefined) {
        await applyProgress(tx, actor, before, taskId, {
          percent_complete: input.percent_complete,
          actual_start: input.actual_start,
          actual_finish: input.actual_finish,
        });
      }
      if (Object.keys(data).length) await tx.scheduleTask.update({ where: { id: taskId }, data });
      return taskId;
    });
  }

  /**
   * Progress from site: percent complete and the actual dates. Needs `schedule.progress` (or
   * `manage`), and touches nothing else about the plan.
   */
  async recordProgress(actor: RequestUser, projectId: string, taskId: string, input: ScheduleProgressInput) {
    return this.change(actor, projectId, async (tx, before) => {
      await applyProgress(tx, actor, before, taskId, input);
      return taskId;
    });
  }

  async deleteTask(actor: RequestUser, projectId: string, taskId: string): Promise<void> {
    await this.change(actor, projectId, async (tx, before) => {
      if (!before.ctx.tasks.some((row) => row.id === taskId)) throw ApiError.notFound('Task');
      // Subtasks and links go with it (foreign keys cascade); baselines keep its dates by name.
      await tx.scheduleTask.delete({ where: { id: taskId } });
      return null;
    });
  }

  /** Puts every site milestone not yet on the schedule onto it, held to its planned date. */
  async addMilestones(actor: RequestUser, projectId: string) {
    let created = 0;
    await this.change(actor, projectId, async (tx) => {
      const milestones = await tx.milestone.findMany({
        where: { projectId, deletedAt: null, scheduleTask: null },
        orderBy: { sortOrder: 'asc' },
      });
      let order = await nextSortOrder(tx, projectId, null);
      for (const milestone of milestones) {
        await tx.scheduleTask.create({
          data: {
            tenantId: actor.tenantId,
            projectId,
            name: milestone.name,
            kind: 'milestone',
            durationDays: 0,
            sortOrder: order++,
            milestoneId: milestone.id,
            constraintType: milestone.plannedDate ? 'snet' : 'asap',
            constraintDate: milestone.plannedDate,
          },
        });
        created += 1;
      }
      return null;
    });
    return { created };
  }

  // --- links -------------------------------------------------------------------------------------

  async createDependency(actor: RequestUser, projectId: string, input: CreateScheduleDependencyInput) {
    let id = '';
    await this.change(actor, projectId, async (tx, before) => {
      const { ctx } = before;
      for (const end of [input.predecessor_id, input.successor_id]) {
        if (!ctx.tasks.some((row) => row.id === end)) throw ApiError.notFound('Task');
        if (ctx.hasChildren.has(end)) {
          throw ApiError.validationFailed(
            { task_id: end },
            'A summary task is scheduled by the tasks under it. Link those instead.',
          );
        }
      }
      if (ctx.links.some((link) => link.predecessorId === input.predecessor_id && link.successorId === input.successor_id)) {
        throw ApiError.conflict('Those two tasks are already linked.');
      }
      const leaves = ctx.tasks.filter((row) => !ctx.hasChildren.has(row.id)).map((row) => row.id);
      const loop = scheduleFindCycle(leaves, [
        ...ctx.links.map((link) => ({ predecessor_id: link.predecessorId, successor_id: link.successorId })),
        { predecessor_id: input.predecessor_id, successor_id: input.successor_id },
      ]);
      if (loop) {
        // Told from the task the new link would hold back, round to the one it waits on.
        const ring = loop.slice(0, -1);
        const at = Math.max(0, ring.indexOf(input.successor_id));
        loop.splice(0, loop.length, ...ring.slice(at), ...ring.slice(0, at), ring[at]!);
        const names = new Map(ctx.tasks.map((row) => [row.id, row.name]));
        throw ApiError.validationFailed(
          { cycle: loop },
          `That link would make a loop — these tasks would wait on each other forever: ${loop
            .map((taskId) => names.get(taskId) ?? taskId)
            .join(' → ')}`,
        );
      }
      const made = await tx.scheduleDependency.create({
        data: {
          tenantId: actor.tenantId,
          projectId,
          predecessorId: input.predecessor_id,
          successorId: input.successor_id,
          type: input.type,
          lagDays: input.lag_days,
        },
        select: { id: true },
      });
      id = made.id;
      return null;
    });
    return this.dependency(actor, projectId, id);
  }

  async updateDependency(
    actor: RequestUser,
    projectId: string,
    dependencyId: string,
    input: UpdateScheduleDependencyInput,
  ) {
    await this.change(actor, projectId, async (tx, before) => {
      if (!before.ctx.links.some((link) => link.id === dependencyId)) throw ApiError.notFound('Link');
      await tx.scheduleDependency.update({
        where: { id: dependencyId },
        data: {
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.lag_days === undefined ? {} : { lagDays: input.lag_days }),
        },
      });
      return null;
    });
    return this.dependency(actor, projectId, dependencyId);
  }

  async deleteDependency(actor: RequestUser, projectId: string, dependencyId: string): Promise<void> {
    await this.change(actor, projectId, async (tx, before) => {
      if (!before.ctx.links.some((link) => link.id === dependencyId)) throw ApiError.notFound('Link');
      await tx.scheduleDependency.delete({ where: { id: dependencyId } });
      return null;
    });
  }

  private async dependency(actor: RequestUser, projectId: string, id: string) {
    const row = await this.tenantDb
      .clientFor(actor.tenantId)
      .scheduleDependency.findFirst({ where: { id, projectId } });
    if (!row) throw ApiError.notFound('Link');
    return dependencyView(row);
  }

  // --- calendars ---------------------------------------------------------------------------------

  async siteCalendar(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    return this.tenantDb.transaction(actor.tenantId, (tx) => resolveCalendar(tx, projectId, actor.country));
  }

  async setSiteCalendar(actor: RequestUser, projectId: string, input: ScheduleCalendarInput) {
    await this.change(actor, projectId, async (tx, before) => {
      const data = {
        name: input.name ?? `${before.ctx.project.name} calendar`,
        workingDays: input.working_days,
        holidays: input.holidays.map((day) => isoDateToUtcDate(day)),
      };
      await tx.scheduleCalendar.upsert({
        where: { projectId },
        create: { tenantId: actor.tenantId, projectId, ...data },
        update: data,
      });
      return null;
    });
    return this.siteCalendar(actor, projectId);
  }

  /** Back to the company's calendar. */
  async clearSiteCalendar(actor: RequestUser, projectId: string): Promise<void> {
    await this.change(actor, projectId, async (tx) => {
      await tx.scheduleCalendar.deleteMany({ where: { projectId } });
      return null;
    });
  }

  async companyCalendar(actor: RequestUser) {
    return this.tenantDb.transaction(actor.tenantId, (tx) => resolveCalendar(tx, null, actor.country));
  }

  async setCompanyCalendar(actor: RequestUser, input: ScheduleCalendarInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const data = {
        name: input.name ?? 'Company calendar',
        workingDays: input.working_days,
        holidays: input.holidays.map((day) => isoDateToUtcDate(day)),
      };
      const existing = await tx.scheduleCalendar.findFirst({ where: { projectId: null }, select: { id: true } });
      if (existing) await tx.scheduleCalendar.update({ where: { id: existing.id }, data });
      else await tx.scheduleCalendar.create({ data: { tenantId: actor.tenantId, projectId: null, ...data } });
      return resolveCalendar(tx, null, actor.country);
    });
  }

  // --- the transaction every write shares --------------------------------------------------------

  /**
   * Runs a write, then recomputes the schedule in the same transaction. The recompute is the
   * check: if the engine refuses what the write left behind, the write rolls back. It also keeps
   * each linked site milestone's planned date on the schedule's date for it.
   *
   * Returns the task the write was about, as the schedule now has it, when the write names one.
   */
  private async change(
    actor: RequestUser,
    projectId: string,
    write: (tx: TenantTx, before: { ctx: ScheduleContext; result: ScheduleResult }) => Promise<string | null>,
  ) {
    await this.access.assertAccess(actor, projectId);
    const today = todayIn(actor.timezone);
    return this.tenantDb.transaction(
      actor.tenantId,
      async (tx) => {
        const ctx = await loadSchedule(tx, projectId, actor.country);
        const before = { ctx, result: computeSchedule(ctx, today) };
        const taskId = await write(tx, before);
        const after = await loadSchedule(tx, projectId, actor.country);
        const result = computeSchedule(after, today);
        await syncMilestonePlannedDates(tx, after, result);
        if (!taskId) return null;
        const task = after.tasks.find((row) => row.id === taskId);
        return task ? taskView(after, result, task) : null;
      },
      { timeout: 30_000 },
    );
  }
}

// --- rules -------------------------------------------------------------------------------------------

async function nextSortOrder(tx: TenantTx, projectId: string, parentId: string | null): Promise<number> {
  const last = await tx.scheduleTask.aggregate({
    where: { projectId, parentId },
    _max: { sortOrder: true },
  });
  return (last._max.sortOrder ?? -1) + 1;
}

/** A parent must be on this site, not a milestone, and have no links of its own — it is about to become a summary. */
async function assertParent(tx: TenantTx, projectId: string, parentId: string): Promise<void> {
  const parent = await tx.scheduleTask.findFirst({
    where: { id: parentId, projectId },
    select: { kind: true, name: true, _count: { select: { successors: true, predecessors: true } } },
  });
  if (!parent) throw ApiError.notFound('Parent task');
  if (parent.kind === 'milestone') {
    throw ApiError.validationFailed(null, `${parent.name} is a milestone; a milestone cannot have tasks under it.`);
  }
  if (parent._count.successors + parent._count.predecessors > 0) {
    throw ApiError.validationFailed(
      null,
      `${parent.name} has links of its own. Putting tasks under it makes it a summary, which is scheduled by its subtasks — remove its links first.`,
    );
  }
}

/** True when `candidate` is `ancestor` or sits somewhere beneath it. */
function isWithin(ctx: ScheduleContext, candidate: string, ancestor: string): boolean {
  const parentOf = new Map(ctx.tasks.map((row) => [row.id, row.parentId]));
  let at: string | null | undefined = candidate;
  while (at) {
    if (at === ancestor) return true;
    at = parentOf.get(at);
  }
  return false;
}

async function assertReferences(
  tx: TenantTx,
  projectId: string,
  input: {
    cost_code_id?: string | null;
    responsible_user_id?: string | null;
    contractor_id?: string | null;
    milestone_id?: string | null;
  },
  kind: 'task' | 'milestone',
  taskId?: string,
): Promise<void> {
  if (input.cost_code_id) {
    const code = await tx.costCode.findFirst({ where: { id: input.cost_code_id, projectId }, select: { id: true } });
    if (!code) throw ApiError.notFound('Cost code on this site');
  }
  if (input.responsible_user_id) {
    const user = await tx.user.findFirst({
      where: { id: input.responsible_user_id, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw ApiError.notFound('Person');
  }
  if (input.contractor_id) {
    const contractor = await tx.contractor.findFirst({
      where: { id: input.contractor_id, deletedAt: null },
      select: { id: true },
    });
    if (!contractor) throw ApiError.notFound('Contractor');
  }
  if (input.milestone_id) {
    if (kind !== 'milestone') {
      throw ApiError.validationFailed(null, 'Only a milestone on the schedule can stand for a site milestone.');
    }
    const milestone = await tx.milestone.findFirst({
      where: { id: input.milestone_id, projectId, deletedAt: null },
      select: { id: true, scheduleTask: { select: { id: true } } },
    });
    if (!milestone) throw ApiError.notFound('Milestone on this site');
    if (milestone.scheduleTask && milestone.scheduleTask.id !== taskId) {
      throw ApiError.conflict('That milestone is already on the schedule.');
    }
  }
}

/**
 * Progress, filled in the way a site reports it. Saying a task is under way without saying when it
 * started takes the day it was due to (or today, if that is still ahead); saying it is done takes
 * today, or the day it was due to finish if that has passed. Actual dates in the future are
 * refused — they are not actual yet.
 *
 * A milestone that stands for a site milestone keeps its reached date on the milestone itself, so
 * the timeline and the schedule cannot disagree about it.
 */
async function applyProgress(
  tx: TenantTx,
  actor: RequestUser,
  before: { ctx: ScheduleContext; result: ScheduleResult },
  taskId: string,
  input: { percent_complete?: number; actual_start?: IsoDate | null; actual_finish?: IsoDate | null },
): Promise<void> {
  const task = before.ctx.tasks.find((row) => row.id === taskId);
  if (!task) throw ApiError.notFound('Task');
  if (before.ctx.hasChildren.has(taskId)) {
    throw ApiError.validationFailed(null, 'A summary task’s progress comes from the tasks under it.');
  }
  const today = todayIn(actor.timezone);
  for (const value of [input.actual_start, input.actual_finish]) {
    if (value && value > today) throw ApiError.validationFailed(null, 'An actual date cannot be in the future.');
  }
  const computed = before.result.tasks[taskId]!;
  const current = {
    percent: task.percentComplete,
    start: task.actualStart ? utcDateToIsoDate(task.actualStart) : null,
    finish: task.actualFinish ? utcDateToIsoDate(task.actualFinish) : null,
  };
  const milestone = linkedMilestone(task);
  if (milestone) current.finish = milestone.actualDate ? utcDateToIsoDate(milestone.actualDate) : null;

  let percent = input.percent_complete ?? current.percent;
  let start = input.actual_start === undefined ? current.start : input.actual_start;
  let finish = input.actual_finish === undefined ? current.finish : input.actual_finish;
  const earlier = (a: IsoDate, b: IsoDate) => (a < b ? a : b);

  if (task.kind === 'milestone') {
    // A milestone is reached or it is not.
    if (input.percent_complete !== undefined && input.actual_finish === undefined) {
      finish = input.percent_complete >= 100 ? (finish ?? earlier(computed.finish, today)) : null;
    }
    percent = finish ? 100 : 0;
    start = null;
  } else {
    if (input.actual_finish) percent = 100;
    if (input.actual_finish === null && input.percent_complete === undefined && percent === 100) percent = 0;
    if (percent > 0 && !start) start = earlier(computed.start, finish ?? today);
    if (percent >= 100 && !finish) finish = earlier(computed.finish, today);
    if (percent < 100 && input.actual_finish === undefined && input.percent_complete !== undefined) finish = null;
    if (percent === 0 && input.actual_start === undefined && input.percent_complete !== undefined) start = null;
    if (start && finish && finish < start) {
      throw ApiError.validationFailed(null, 'It cannot finish before it started.');
    }
  }

  await tx.scheduleTask.update({
    where: { id: taskId },
    data: {
      percentComplete: percent,
      actualStart: date(start),
      // A linked milestone's date lives on the site milestone.
      actualFinish: milestone ? null : date(finish),
    },
  });
  if (milestone) {
    await tx.milestone.update({ where: { id: milestone.id }, data: { actualDate: date(finish) } });
  }
}

function baselineSummary(row: {
  id: string;
  name: string;
  createdAt: Date;
  finishDate: Date;
  createdBy: { id: string; name: string } | null;
}) {
  return {
    id: row.id,
    name: row.name,
    created_at: row.createdAt.toISOString(),
    finish_date: utcDateToIsoDate(row.finishDate),
    created_by: row.createdBy,
  };
}

export { baselineSummary };
