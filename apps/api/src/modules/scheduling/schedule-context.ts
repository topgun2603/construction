import type { Prisma, ScheduleDependency } from '@prisma/client';
import {
  ScheduleCycleError,
  ScheduleInputError,
  scheduleCompute,
  scheduleDefaultWorkingDays,
  scheduleVarianceOf,
  utcDateToIsoDate,
  type IsoDate,
  type ScheduleEngineInput,
  type ScheduleResult,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import type { TenantTx } from '../../common/prisma/tenant-db.service';

/**
 * Loading a site's schedule and working it out — the part every scheduling route shares.
 *
 * Nothing computed is stored. The engine runs on every read, inside the same transaction as any
 * write, so a link that would close a loop is refused by the same code that draws the chart.
 */

export const TASK_INCLUDE = {
  costCode: { select: { id: true, code: true, name: true } },
  responsible: { select: { id: true, name: true } },
  contractor: { select: { id: true, name: true } },
  milestone: { select: { id: true, name: true, plannedDate: true, actualDate: true, deletedAt: true } },
} satisfies Prisma.ScheduleTaskInclude;

export type TaskRow = Prisma.ScheduleTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export interface CalendarView {
  id: string | null;
  scope: 'site' | 'company' | 'default';
  name: string;
  working_days: number[];
  holidays: IsoDate[];
}

export interface ScheduleContext {
  project: {
    id: string;
    name: string;
    startDate: Date | null;
    targetEndDate: Date | null;
    createdAt: Date;
  };
  calendar: CalendarView;
  /** Outline order: every parent before its subtasks, siblings by sort order. */
  tasks: TaskRow[];
  links: ScheduleDependency[];
  depth: Map<string, number>;
  wbs: Map<string, string>;
  hasChildren: Set<string>;
}

const iso = (value: Date | null | undefined): IsoDate | null => (value ? utcDateToIsoDate(value) : null);

/**
 * The calendar a site's dates are counted on: its own if it has one, the company's if not, and
 * otherwise the weekend of the company's country with no holidays.
 */
export async function resolveCalendar(
  tx: TenantTx,
  projectId: string | null,
  country: string,
): Promise<CalendarView> {
  const rows = await tx.scheduleCalendar.findMany({
    where: projectId ? { OR: [{ projectId }, { projectId: null }] } : { projectId: null },
    orderBy: { createdAt: 'asc' },
  });
  const own = projectId ? rows.find((row) => row.projectId === projectId) : undefined;
  const company = rows.find((row) => row.projectId === null);
  const chosen = own ?? company;
  if (!chosen) {
    return {
      id: null,
      scope: 'default',
      name: 'Standard week',
      working_days: scheduleDefaultWorkingDays(country),
      holidays: [],
    };
  }
  return {
    id: chosen.id,
    scope: own ? 'site' : 'company',
    name: chosen.name,
    working_days: [...chosen.workingDays].sort((a, b) => a - b),
    holidays: chosen.holidays.map((day) => utcDateToIsoDate(day)).sort(),
  };
}

export async function loadSchedule(tx: TenantTx, projectId: string, country: string): Promise<ScheduleContext> {
  const [project, rows, links, calendar] = await Promise.all([
    tx.project.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, name: true, startDate: true, targetEndDate: true, createdAt: true },
    }),
    tx.scheduleTask.findMany({
      where: { projectId },
      include: TASK_INCLUDE,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    }),
    tx.scheduleDependency.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
    resolveCalendar(tx, projectId, country),
  ]);
  if (!project) throw ApiError.notFound('Project');

  // The tree, walked depth first. A row whose parent has gone is treated as top level rather
  // than lost — the foreign key cascades, so this is belt and braces.
  const known = new Set(rows.map((row) => row.id));
  const children = new Map<string | null, TaskRow[]>();
  for (const row of rows) {
    const parent = row.parentId && known.has(row.parentId) ? row.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(row);
    children.set(parent, list);
  }
  const tasks: TaskRow[] = [];
  const depth = new Map<string, number>();
  const wbs = new Map<string, string>();
  const hasChildren = new Set<string>();
  const walk = (parent: string | null, level: number, prefix: string) => {
    (children.get(parent) ?? []).forEach((row, index) => {
      const outline = prefix ? `${prefix}.${index + 1}` : String(index + 1);
      tasks.push(row);
      depth.set(row.id, level);
      wbs.set(row.id, row.wbsCode ?? outline);
      if ((children.get(row.id)?.length ?? 0) > 0) hasChildren.add(row.id);
      walk(row.id, level + 1, outline);
    });
  };
  walk(null, 0, '');

  return { project, calendar, tasks, links, depth, wbs, hasChildren };
}

/**
 * Where the schedule counts from: the site's start date; failing that the earliest date any task
 * mentions; failing that the day the site was created — never "today", or an undated plan would
 * slide a day every morning.
 */
export function scheduleStartOf(ctx: ScheduleContext): IsoDate {
  if (ctx.project.startDate) return utcDateToIsoDate(ctx.project.startDate);
  const dates = ctx.tasks
    .flatMap((task) => [task.constraintDate, task.actualStart, task.actualFinish])
    .filter((date): date is Date => date !== null)
    .map((date) => utcDateToIsoDate(date))
    .sort();
  return dates[0] ?? utcDateToIsoDate(ctx.project.createdAt);
}

/**
 * The milestone a task stands for decides whether it has been reached. Marking it complete on the
 * site timeline marks it complete on the schedule, and the other way round, with one stored date.
 */
export function linkedMilestone(task: TaskRow) {
  return task.milestone && task.milestone.deletedAt === null ? task.milestone : null;
}

export function engineInput(ctx: ScheduleContext, statusDate: IsoDate | null): ScheduleEngineInput {
  return {
    project_start: scheduleStartOf(ctx),
    status_date: statusDate,
    calendar: { working_days: ctx.calendar.working_days, holidays: ctx.calendar.holidays },
    tasks: ctx.tasks.map((task) => {
      const milestone = linkedMilestone(task);
      return {
        id: task.id,
        name: task.name,
        parent_id: task.parentId,
        kind: task.kind,
        duration_days: task.durationDays,
        constraint_type: task.constraintType,
        constraint_date: iso(task.constraintDate),
        percent_complete: task.percentComplete,
        actual_start: iso(task.actualStart),
        actual_finish: milestone ? iso(milestone.actualDate) : iso(task.actualFinish),
      };
    }),
    links: ctx.links.map((link) => ({
      predecessor_id: link.predecessorId,
      successor_id: link.successorId,
      type: link.type,
      lag_days: link.lagDays,
    })),
  };
}

/** Runs the engine, turning its refusals into answers a client can show. */
export function computeSchedule(ctx: ScheduleContext, statusDate: IsoDate | null): ScheduleResult {
  try {
    return scheduleCompute(engineInput(ctx, statusDate));
  } catch (error) {
    if (error instanceof ScheduleCycleError) {
      throw ApiError.validationFailed({ cycle: error.taskIds }, error.message);
    }
    if (error instanceof ScheduleInputError) throw ApiError.validationFailed(null, error.message);
    throw error;
  }
}

/**
 * Keeps each linked site milestone's planned date on the schedule's date for it. Only rows that
 * differ are written, so an edit that moves nothing writes nothing to the audit log either.
 */
export async function syncMilestonePlannedDates(
  tx: TenantTx,
  ctx: ScheduleContext,
  result: ScheduleResult,
): Promise<void> {
  for (const task of ctx.tasks) {
    const milestone = linkedMilestone(task);
    const computed = result.tasks[task.id];
    if (!milestone || !computed) continue;
    if (iso(milestone.plannedDate) === computed.finish) continue;
    await tx.milestone.update({
      where: { id: milestone.id },
      data: { plannedDate: new Date(`${computed.finish}T00:00:00.000Z`) },
    });
  }
}

export interface BaselineEntry {
  startDate: Date;
  finishDate: Date;
  durationDays: number;
}

export function taskView(
  ctx: ScheduleContext,
  result: ScheduleResult,
  task: TaskRow,
  baseline?: BaselineEntry | null,
) {
  const computed = result.tasks[task.id]!;
  const milestone = linkedMilestone(task);
  return {
    id: task.id,
    parent_id: task.parentId,
    depth: ctx.depth.get(task.id) ?? 0,
    wbs: ctx.wbs.get(task.id) ?? '',
    wbs_code: task.wbsCode,
    name: task.name,
    kind: task.kind,
    is_summary: computed.is_summary,
    sort_order: task.sortOrder,
    duration_days: computed.is_summary ? computed.duration_days : task.durationDays,
    constraint_type: task.constraintType,
    constraint_date: iso(task.constraintDate),
    percent_complete: computed.percent_complete,
    actual_start: iso(task.actualStart),
    actual_finish: milestone ? iso(milestone.actualDate) : iso(task.actualFinish),
    start: computed.start,
    finish: computed.finish,
    late_start: computed.late_start,
    late_finish: computed.late_finish,
    total_float: computed.total_float,
    free_float: computed.free_float,
    critical: computed.critical,
    status: computed.status,
    behind: computed.behind,
    cost_code: task.costCode,
    responsible: task.responsible,
    contractor: task.contractor,
    milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
    notes: task.notes,
    baseline:
      baseline === undefined || baseline === null
        ? null
        : (() => {
            const base = {
              start: utcDateToIsoDate(baseline.startDate),
              finish: utcDateToIsoDate(baseline.finishDate),
            };
            return {
              ...base,
              duration_days: baseline.durationDays,
              ...scheduleVarianceOf(result.calendar, base, { start: computed.start, finish: computed.finish }),
            };
          })(),
  };
}

export type TaskView = ReturnType<typeof taskView>;

export function dependencyView(link: ScheduleDependency) {
  return {
    id: link.id,
    predecessor_id: link.predecessorId,
    successor_id: link.successorId,
    type: link.type,
    lag_days: link.lagDays,
  };
}
