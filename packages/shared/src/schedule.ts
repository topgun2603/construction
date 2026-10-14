import { csvCell } from './cost-codes';
import type { IsoDate } from './dates';

/**
 * Scheduling (roadmap Phase 2, module 6): the working calendar and the critical path method.
 *
 * Pure, so the API (which answers with the computed schedule) and the web (which previews an edit
 * before it is saved) can never disagree about when a task finishes.
 *
 * How time is counted. Every working day gets an integer index, and a task occupies the half-open
 * range `[start, finish)` of those indexes: a three-day task starting on index 10 has finish 13
 * and occupies 10, 11 and 12. The four link types then read as the textbook says, with no ±1
 * scattered through the passes:
 *
 *   FS  successor.start  ≥ predecessor.finish + lag
 *   SS  successor.start  ≥ predecessor.start  + lag
 *   FF  successor.finish ≥ predecessor.finish + lag
 *   SF  successor.finish ≥ predecessor.start  + lag
 *
 * The dates shown are the first and the last working day occupied. A milestone has no length; it
 * sits on a boundary and is shown on the working day that ends there — "slab cast" falls on the day
 * the slab's last pour does, not the morning after.
 */

// --- vocabulary ------------------------------------------------------------------------------------

export const SCHEDULE_LINK_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type ScheduleLinkType = (typeof SCHEDULE_LINK_TYPES)[number];

/** A summary task is not a kind: any task with subtasks is one, and rolls them up. */
export const SCHEDULE_TASK_KINDS = ['task', 'milestone'] as const;
export type ScheduleTaskKind = (typeof SCHEDULE_TASK_KINDS)[number];

/**
 * As soon as possible; start no earlier than (a permit date, a delivery); finish no later than (a
 * handover the contract fixes). The last is what produces negative float — the schedule says the
 * date cannot be met, which is the most useful thing a schedule ever says.
 */
export const SCHEDULE_CONSTRAINT_TYPES = ['asap', 'snet', 'fnlt'] as const;
export type ScheduleConstraintType = (typeof SCHEDULE_CONSTRAINT_TYPES)[number];

/** Weekdays as JavaScript numbers them: 0 is Sunday, 6 is Saturday. */
export const SCHEDULE_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/**
 * The weekend in each country a company can pick (locale.ts `COUNTRY_PRESETS`).
 *
 * The UAE moved to a Saturday–Sunday weekend in 2022; the rest of the Gulf keeps Friday–Saturday.
 * Indian sites work six days. Nepal rests on Saturday only. A company can change any of this — a
 * site that works Fridays in Riyadh is not unusual — this is only where a new calendar starts.
 */
const SCHEDULE_WEEKENDS: Readonly<Record<string, readonly number[]>> = Object.freeze({
  IN: [0],
  AE: [0, 6],
  SA: [5, 6],
  QA: [5, 6],
  KW: [5, 6],
  OM: [5, 6],
  BH: [5, 6],
  LK: [0, 6],
  BD: [5, 6],
  NP: [6],
});

/** Which weekdays are worked by default in a country. Unknown countries get a Monday–Friday week. */
export function scheduleDefaultWorkingDays(country: string): number[] {
  const weekend = SCHEDULE_WEEKENDS[country.toUpperCase()] ?? [0, 6];
  return SCHEDULE_WEEKDAYS.filter((day) => !weekend.includes(day));
}

// --- the working calendar --------------------------------------------------------------------------

export interface ScheduleCalendarSpec {
  /** Weekdays worked, 0 (Sunday) to 6 (Saturday). At least one. */
  working_days: readonly number[];
  /** Days off on top of the weekend: national holidays, Eid, Diwali, a site shutdown. */
  holidays: readonly IsoDate[];
}

const DAY_MS = 86_400_000;
/** Roughly two centuries of working days — far past any real job, short of an endless loop. */
const MAX_WORKDAYS = 50_000;

function dayNumber(date: IsoDate): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function dayIso(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 1970-01-01 was a Thursday. */
function weekdayOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/**
 * Working days, numbered.
 *
 * Index 0 is the first working day on or after `origin`; negative indexes count back before it.
 * Days are generated lazily in both directions, so a schedule five years long costs five years of
 * days and no more.
 */
export class ScheduleWorkCalendar {
  private readonly working: ReadonlySet<number>;
  private readonly holidays: ReadonlySet<number>;
  private readonly origin: number;
  /** forward[i] is working day i (i ≥ 0). */
  private readonly forward: number[] = [];
  /** backward[k] is working day −(k + 1). */
  private readonly backward: number[] = [];

  constructor(spec: ScheduleCalendarSpec, origin: IsoDate) {
    const working = spec.working_days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    if (working.length === 0) throw new Error('A working calendar needs at least one working weekday');
    this.working = new Set(working);
    this.holidays = new Set(spec.holidays.map(dayNumber));
    this.origin = dayNumber(origin);
  }

  isWorkday(date: IsoDate): boolean {
    return this.isWorkingDay(dayNumber(date));
  }

  /** The date of working day `index`. */
  dateAt(index: number): IsoDate {
    return dayIso(this.dayAt(index));
  }

  /** Index of the first working day on or after `date`. */
  indexOnOrAfter(date: IsoDate): number {
    const day = dayNumber(date);
    if (day >= this.origin) {
      this.growForwardPast(day);
      return lowerBound(this.forward, day);
    }
    // Before the origin: count back until the day is passed, then step forward to the first
    // working day at or after it.
    const k = this.growBackwardPast(day);
    // backward is descending; find the last k with backward[k] >= day.
    let at = -1;
    for (let i = 0; i <= k && i < this.backward.length; i += 1) {
      if (this.backward[i]! >= day) at = i;
      else break;
    }
    return at === -1 ? 0 : -(at + 1);
  }

  /** Index of the last working day on or before `date`. */
  indexOnOrBefore(date: IsoDate): number {
    const after = this.indexOnOrAfter(date);
    return this.dayAt(after) === dayNumber(date) ? after : after - 1;
  }

  /** Working days from `from` to `to`, both counted: Sunday to Thursday in Dubai is 5. */
  workdaysInclusive(from: IsoDate, to: IsoDate): number {
    return Math.max(0, this.indexOnOrBefore(to) - this.indexOnOrAfter(from) + 1);
  }

  /**
   * How many working days `to` lies after `from`, negative when before. Two dates in the same
   * weekend are zero apart, which is what a slip measured in working days should say.
   */
  workdaysBetween(from: IsoDate, to: IsoDate): number {
    return this.indexOnOrBefore(to) - this.indexOnOrBefore(from);
  }

  /** The last working day of a task of `duration` working days starting on `start`. */
  finishFor(start: IsoDate, duration: number): IsoDate {
    const first = this.indexOnOrAfter(start);
    return this.dateAt(first + Math.max(duration, 1) - 1);
  }

  private isWorkingDay(day: number): boolean {
    return this.working.has(weekdayOf(day)) && !this.holidays.has(day);
  }

  private dayAt(index: number): number {
    if (index >= 0) {
      while (this.forward.length <= index) this.stepForward();
      return this.forward[index]!;
    }
    const k = -index - 1;
    while (this.backward.length <= k) this.stepBackward();
    return this.backward[k]!;
  }

  private stepForward(): void {
    let day = this.forward.length === 0 ? this.origin : this.forward[this.forward.length - 1]! + 1;
    if (this.forward.length + this.backward.length > MAX_WORKDAYS) {
      throw new Error('The schedule runs past any sensible horizon');
    }
    // A calendar with a working weekday finds one within a week, holidays aside.
    while (!this.isWorkingDay(day)) day += 1;
    this.forward.push(day);
  }

  private stepBackward(): void {
    let day = this.backward.length === 0 ? this.origin - 1 : this.backward[this.backward.length - 1]! - 1;
    if (this.forward.length + this.backward.length > MAX_WORKDAYS) {
      throw new Error('The schedule runs past any sensible horizon');
    }
    while (!this.isWorkingDay(day)) day -= 1;
    this.backward.push(day);
  }

  private growForwardPast(day: number): void {
    while (this.forward.length === 0 || this.forward[this.forward.length - 1]! < day) {
      this.stepForward();
    }
  }

  /** Grows until a working day strictly before `day` exists; returns its position. */
  private growBackwardPast(day: number): number {
    while (this.backward.length === 0 || this.backward[this.backward.length - 1]! >= day) {
      this.stepBackward();
    }
    return this.backward.length - 1;
  }
}

/** First position in an ascending array whose value is ≥ `value`. */
function lowerBound(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid]! < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

// --- the engine ------------------------------------------------------------------------------------

export interface ScheduleEngineTask {
  id: string;
  parent_id: string | null;
  kind: ScheduleTaskKind;
  /** Working days. Ignored for a summary; zero for a milestone. */
  duration_days: number;
  constraint_type: ScheduleConstraintType;
  constraint_date: IsoDate | null;
  /** 0–100. */
  percent_complete: number;
  actual_start: IsoDate | null;
  actual_finish: IsoDate | null;
  /** For the cycle message only. */
  name?: string;
}

export interface ScheduleEngineLink {
  predecessor_id: string;
  successor_id: string;
  type: ScheduleLinkType;
  /** Working days; negative is a lead. */
  lag_days: number;
}

export interface ScheduleEngineInput {
  /** Nothing that has not started is scheduled before this. */
  project_start: IsoDate;
  /**
   * The day progress was reported to, usually today. When given, the work still to do on a started
   * task is not left in the past: a task half done that should have finished last week finishes
   * its remaining half from today. Without it, started tasks simply keep their planned length.
   */
  status_date?: IsoDate | null;
  calendar: ScheduleCalendarSpec;
  tasks: readonly ScheduleEngineTask[];
  links: readonly ScheduleEngineLink[];
}

export type ScheduleTaskStatus = 'not_started' | 'in_progress' | 'complete';

export interface ScheduleTaskResult {
  id: string;
  is_summary: boolean;
  /** First working day of the work — for a milestone, its date. */
  start: IsoDate;
  /** Last working day of the work — for a milestone, the same date as `start`. */
  finish: IsoDate;
  late_start: IsoDate;
  late_finish: IsoDate;
  /** Working days the task can slip without moving the end of the job. Negative: already late. */
  total_float: number;
  /** Working days it can slip without moving any successor. */
  free_float: number;
  critical: boolean;
  /** Working days the schedule gives it — longer than planned when remaining work was pushed out. */
  duration_days: number;
  /** Rolled up by duration for a summary. */
  percent_complete: number;
  status: ScheduleTaskStatus;
  /** Should have started, or finished, before the status date and has not. */
  behind: boolean;
}

export interface ScheduleResult {
  project_start: IsoDate;
  /** The last working day of the last task. */
  finish_date: IsoDate;
  tasks: Record<string, ScheduleTaskResult>;
  /** Critical leaf tasks and milestones, in the order they happen. */
  critical_path: string[];
  /** The calendar the dates were counted on, for working out variances against the same days. */
  calendar: ScheduleWorkCalendar;
}

/** Thrown when the links go round in a circle. `taskIds` is the circle, first task repeated last. */
export class ScheduleCycleError extends Error {
  constructor(
    readonly taskIds: string[],
    names: string[],
  ) {
    super(`These tasks wait on each other in a loop: ${names.join(' → ')}`);
    this.name = 'ScheduleCycleError';
  }
}

/** Thrown for input the API should never have let through: a link to a summary, an unknown id. */
export class ScheduleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleInputError';
  }
}

/**
 * Finds a loop in the links, or returns null.
 *
 * Kahn's algorithm strips every task that can be ordered; whatever is left sits on or behind a
 * cycle, and walking predecessors from any of it must come back round. The loop is returned with
 * its first task repeated at the end, so it reads as a sentence: A → B → C → A.
 */
export function scheduleFindCycle(
  taskIds: readonly string[],
  links: ReadonlyArray<Pick<ScheduleEngineLink, 'predecessor_id' | 'successor_id'>>,
): string[] | null {
  const order = topologicalOrder(taskIds, links);
  if (order.length === new Set(taskIds).size) return null;
  const ordered = new Set(order);
  const predecessors = new Map<string, string[]>();
  for (const link of links) {
    if (ordered.has(link.successor_id) || ordered.has(link.predecessor_id)) continue;
    const list = predecessors.get(link.successor_id) ?? [];
    list.push(link.predecessor_id);
    predecessors.set(link.successor_id, list);
  }
  // Every leftover node has a leftover predecessor, so this walk never stops until it repeats.
  let at = taskIds.find((id) => !ordered.has(id) && predecessors.has(id))!;
  const seen = new Map<string, number>();
  const path: string[] = [];
  while (!seen.has(at)) {
    seen.set(at, path.length);
    path.push(at);
    at = predecessors.get(at)![0]!;
  }
  // `path` is walked backwards along the links; turn the loop round to read forwards.
  const loop = path.slice(seen.get(at)!).reverse();
  return [...loop, loop[0]!];
}

function topologicalOrder(
  taskIds: readonly string[],
  links: ReadonlyArray<Pick<ScheduleEngineLink, 'predecessor_id' | 'successor_id'>>,
): string[] {
  const ids = [...new Set(taskIds)];
  const known = new Set(ids);
  const indegree = new Map(ids.map((id) => [id, 0]));
  const successors = new Map<string, string[]>();
  for (const link of links) {
    if (!known.has(link.predecessor_id) || !known.has(link.successor_id)) continue;
    indegree.set(link.successor_id, indegree.get(link.successor_id)! + 1);
    const list = successors.get(link.predecessor_id) ?? [];
    list.push(link.successor_id);
    successors.set(link.predecessor_id, list);
  }
  // Seeded in input order, so tasks with no links between them come out as they were listed.
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    order.push(id);
    for (const next of successors.get(id) ?? []) {
      const remaining = indegree.get(next)! - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return order;
}

interface Pass {
  es: number;
  ef: number;
  ls: number;
  lf: number;
  status: ScheduleTaskStatus;
}

/**
 * The critical path method: a forward pass for the earliest each task can start and finish, a
 * backward pass from the end of the job for the latest it may, and the difference between the two
 * is float. Zero float (or less) is the critical path.
 *
 * Progress overrides logic, as in every scheduling tool: a task that has started started when it
 * did, whatever its predecessors say, and a finished one finished when it did.
 */
export function scheduleCompute(input: ScheduleEngineInput): ScheduleResult {
  const byId = new Map(input.tasks.map((task) => [task.id, task]));
  const children = new Map<string, string[]>();
  for (const task of input.tasks) {
    if (task.parent_id && byId.has(task.parent_id)) {
      const list = children.get(task.parent_id) ?? [];
      list.push(task.id);
      children.set(task.parent_id, list);
    }
  }
  const isSummary = (id: string) => (children.get(id)?.length ?? 0) > 0;
  const leaves = input.tasks.filter((task) => !isSummary(task.id));

  for (const link of input.links) {
    for (const end of [link.predecessor_id, link.successor_id]) {
      if (!byId.has(end)) throw new ScheduleInputError(`A link refers to a task that is not in the schedule: ${end}`);
      if (isSummary(end)) {
        throw new ScheduleInputError(`A link refers to a summary task, which is scheduled by its subtasks: ${end}`);
      }
    }
    if (link.predecessor_id === link.successor_id) {
      throw new ScheduleCycleError([link.predecessor_id, link.predecessor_id], [
        byId.get(link.predecessor_id)?.name ?? link.predecessor_id,
        byId.get(link.predecessor_id)?.name ?? link.predecessor_id,
      ]);
    }
  }

  const leafIds = leaves.map((task) => task.id);
  const order = topologicalOrder(leafIds, input.links);
  if (order.length !== leafIds.length) {
    const loop = scheduleFindCycle(leafIds, input.links)!;
    throw new ScheduleCycleError(loop, loop.map((id) => byId.get(id)?.name ?? id));
  }

  // Count from comfortably before anything the schedule mentions, so no index is needed before it.
  const mentioned = [input.project_start];
  for (const task of input.tasks) {
    for (const date of [task.constraint_date, task.actual_start, task.actual_finish]) {
      if (date) mentioned.push(date);
    }
  }
  const earliest = mentioned.reduce((a, b) => (a < b ? a : b));
  const calendar = new ScheduleWorkCalendar(input.calendar, earliest);
  const floor = calendar.indexOnOrAfter(input.project_start);
  const statusIndex = input.status_date ? calendar.indexOnOrAfter(input.status_date) : null;

  const incoming = groupBy(input.links, (link) => link.successor_id);
  const outgoing = groupBy(input.links, (link) => link.predecessor_id);

  const pass = new Map<string, Pass>();
  const plannedLength = (task: ScheduleEngineTask) =>
    task.kind === 'milestone' ? 0 : Math.max(1, Math.round(task.duration_days));

  // --- forward pass: as early as the logic allows -----------------------------------------------
  for (const id of order) {
    const task = byId.get(id)!;
    const length = plannedLength(task);
    const milestone = task.kind === 'milestone';

    let es = floor;
    for (const link of incoming.get(id) ?? []) {
      const before = pass.get(link.predecessor_id)!;
      const lag = Math.round(link.lag_days);
      switch (link.type) {
        case 'FS':
          es = Math.max(es, before.ef + lag);
          break;
        case 'SS':
          es = Math.max(es, before.es + lag);
          break;
        case 'FF':
          es = Math.max(es, before.ef + lag - length);
          break;
        case 'SF':
          es = Math.max(es, before.es + lag - length);
          break;
      }
    }
    if (task.constraint_type === 'snet' && task.constraint_date) {
      // A milestone dated the 10th sits at the end of the 10th.
      es = Math.max(
        es,
        milestone
          ? calendar.indexOnOrBefore(task.constraint_date) + 1
          : calendar.indexOnOrAfter(task.constraint_date),
      );
    }
    let ef = es + length;
    let status: ScheduleTaskStatus = 'not_started';

    if (task.actual_finish) {
      ef = calendar.indexOnOrBefore(task.actual_finish) + 1;
      es = milestone
        ? ef
        : task.actual_start
          ? Math.min(calendar.indexOnOrAfter(task.actual_start), ef - 1)
          : ef - length;
      status = 'complete';
    } else if (task.actual_start || task.percent_complete > 0) {
      if (task.actual_start) {
        es = milestone
          ? calendar.indexOnOrBefore(task.actual_start) + 1
          : calendar.indexOnOrAfter(task.actual_start);
      }
      ef = es + length;
      if (task.percent_complete >= 100) {
        status = 'complete';
      } else {
        status = 'in_progress';
        if (statusIndex !== null) {
          // What is left cannot be done in the past.
          const remaining = Math.ceil((length * (100 - task.percent_complete)) / 100);
          ef = Math.max(ef, statusIndex + remaining);
        }
      }
    }
    pass.set(id, { es, ef, ls: 0, lf: 0, status });
  }

  const projectFinish = Math.max(floor, ...order.map((id) => pass.get(id)!.ef));

  // --- backward pass: as late as the end of the job allows ---------------------------------------
  for (const id of [...order].reverse()) {
    const task = byId.get(id)!;
    const own = pass.get(id)!;
    const length = own.ef - own.es;
    let lf = projectFinish;
    for (const link of outgoing.get(id) ?? []) {
      const after = pass.get(link.successor_id)!;
      const lag = Math.round(link.lag_days);
      switch (link.type) {
        case 'FS':
          lf = Math.min(lf, after.ls - lag);
          break;
        case 'SS':
          lf = Math.min(lf, after.ls - lag + length);
          break;
        case 'FF':
          lf = Math.min(lf, after.lf - lag);
          break;
        case 'SF':
          lf = Math.min(lf, after.lf - lag + length);
          break;
      }
    }
    if (task.constraint_type === 'fnlt' && task.constraint_date) {
      lf = Math.min(lf, calendar.indexOnOrBefore(task.constraint_date) + 1);
    }
    own.lf = lf;
    own.ls = lf - length;
  }

  // --- results for leaves ------------------------------------------------------------------------
  const results: Record<string, ScheduleTaskResult> = {};
  const milestoneDate = (boundary: number) => calendar.dateAt(Math.max(boundary - 1, floor));
  for (const id of order) {
    const task = byId.get(id)!;
    const own = pass.get(id)!;
    const milestone = task.kind === 'milestone';
    let freeFloat = projectFinish - own.ef;
    for (const link of outgoing.get(id) ?? []) {
      const after = pass.get(link.successor_id)!;
      const lag = Math.round(link.lag_days);
      const slack =
        link.type === 'FS'
          ? after.es - lag - own.ef
          : link.type === 'SS'
            ? after.es - lag - own.es
            : link.type === 'FF'
              ? after.ef - lag - own.ef
              : after.ef - lag - own.es;
      freeFloat = Math.min(freeFloat, slack);
    }
    const totalFloat = own.lf - own.ef;
    const complete = own.status === 'complete';
    const behind =
      statusIndex !== null &&
      !complete &&
      ((own.status === 'not_started' && own.es < statusIndex) || own.ef <= statusIndex);
    // A milestone that already happened is shown on the day it did, even before the project start.
    const actualMilestone = milestone && task.actual_finish;
    const start = milestone
      ? actualMilestone
        ? calendar.dateAt(own.ef - 1)
        : milestoneDate(own.es)
      : calendar.dateAt(own.es);
    const finish = milestone ? start : calendar.dateAt(own.ef - 1);
    results[id] = {
      id,
      is_summary: false,
      start,
      finish,
      late_start: milestone ? milestoneDate(own.ls) : calendar.dateAt(own.ls),
      late_finish: milestone ? milestoneDate(own.lf) : calendar.dateAt(own.lf - 1),
      total_float: totalFloat,
      free_float: Math.max(0, freeFloat),
      // A finished task cannot delay anything any more; calling it critical sends people to it.
      critical: !complete && totalFloat <= 0,
      duration_days: own.ef - own.es,
      percent_complete: complete ? 100 : milestone ? 0 : clampPercent(task.percent_complete),
      status: own.status,
      behind,
    };
  }

  // --- summaries roll up their subtasks, deepest first -----------------------------------------------
  const summaryOrder: string[] = [];
  const visit = (id: string) => {
    for (const child of children.get(id) ?? []) visit(child);
    if (isSummary(id)) summaryOrder.push(id);
  };
  for (const task of input.tasks) if (!task.parent_id || !byId.has(task.parent_id)) visit(task.id);

  const span = new Map<string, { es: number; ef: number; ls: number; lf: number }>();
  for (const id of order) {
    const own = pass.get(id)!;
    span.set(id, { es: own.es, ef: own.ef, ls: own.ls, lf: own.lf });
  }
  for (const id of summaryOrder) {
    const kids = children.get(id)!.map((child) => ({ child, s: span.get(child)!, r: results[child]! }));
    const es = Math.min(...kids.map((k) => k.s.es));
    const ef = Math.max(...kids.map((k) => k.s.ef));
    const ls = Math.min(...kids.map((k) => k.s.ls));
    const lf = Math.max(...kids.map((k) => k.s.lf));
    span.set(id, { es, ef, ls, lf });
    const weight = kids.reduce((sum, k) => sum + k.r.duration_days, 0);
    const percent =
      weight > 0
        ? Math.round(kids.reduce((sum, k) => sum + k.r.duration_days * k.r.percent_complete, 0) / weight)
        : Math.round(kids.reduce((sum, k) => sum + k.r.percent_complete, 0) / kids.length);
    const allDone = kids.every((k) => k.r.status === 'complete');
    const anyStarted = kids.some((k) => k.r.status !== 'not_started');
    const starts = kids.map((k) => k.r.start).sort();
    const finishes = kids.map((k) => k.r.finish).sort();
    results[id] = {
      id,
      is_summary: true,
      start: starts[0]!,
      finish: finishes[finishes.length - 1]!,
      late_start: calendar.dateAt(ls),
      late_finish: calendar.dateAt(Math.max(lf - 1, ls)),
      total_float: Math.min(...kids.map((k) => k.r.total_float)),
      free_float: Math.min(...kids.map((k) => k.r.free_float)),
      critical: kids.some((k) => k.r.critical),
      duration_days: Math.max(0, ef - es),
      percent_complete: allDone ? 100 : percent,
      status: allDone ? 'complete' : anyStarted ? 'in_progress' : 'not_started',
      behind: kids.some((k) => k.r.behind),
    };
  }

  const criticalPath = order
    .filter((id) => results[id]!.critical)
    .sort((a, b) => pass.get(a)!.es - pass.get(b)!.es || pass.get(a)!.ef - pass.get(b)!.ef);

  const finishes = order.map((id) => results[id]!.finish);
  return {
    project_start: calendar.dateAt(floor),
    finish_date: finishes.length ? finishes.reduce((a, b) => (a > b ? a : b)) : calendar.dateAt(floor),
    tasks: results,
    critical_path: criticalPath,
    calendar,
  };
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list) list.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

// --- baselines -------------------------------------------------------------------------------------

export interface ScheduleVariance {
  /** Working days the start has moved since the baseline; positive is later. */
  start_variance: number;
  /** Working days the finish has moved; positive is a slip. */
  finish_variance: number;
  slipped: boolean;
}

/** How far a task has moved from its baseline, counted on the schedule's own working days. */
export function scheduleVarianceOf(
  calendar: ScheduleWorkCalendar,
  baseline: { start: IsoDate; finish: IsoDate },
  current: { start: IsoDate; finish: IsoDate },
): ScheduleVariance {
  const start = calendar.workdaysBetween(baseline.start, current.start);
  const finish = calendar.workdaysBetween(baseline.finish, current.finish);
  return { start_variance: start, finish_variance: finish, slipped: finish > 0 };
}

// --- look-ahead ------------------------------------------------------------------------------------

export interface ScheduleLookAheadRow {
  site: string;
  wbs: string | null;
  task: string;
  start: IsoDate;
  finish: IsoDate;
  percent_complete: number;
  critical: boolean;
  responsible: string | null;
  /** Which edge of the window it falls in: starting, finishing, or both. */
  event: 'starts' | 'finishes' | 'starts_and_finishes';
}

/** Does this task start or finish within `[from, to]`? Null when it does neither. */
export function scheduleLookAheadEvent(
  task: { start: IsoDate; finish: IsoDate },
  from: IsoDate,
  to: IsoDate,
): ScheduleLookAheadRow['event'] | null {
  const starts = task.start >= from && task.start <= to;
  const finishes = task.finish >= from && task.finish <= to;
  if (starts && finishes) return 'starts_and_finishes';
  if (starts) return 'starts';
  if (finishes) return 'finishes';
  return null;
}

const LOOK_AHEAD_EVENT_LABEL: Record<ScheduleLookAheadRow['event'], string> = {
  starts: 'Starts',
  finishes: 'Finishes',
  starts_and_finishes: 'Starts and finishes',
};

/** The look-ahead as a sheet: one row per task, dates as `YYYY-MM-DD` so a spreadsheet sorts them. */
export function scheduleLookAheadCsv(rows: readonly ScheduleLookAheadRow[]): string {
  const header = ['Site', 'WBS', 'Task', 'Start', 'Finish', 'Percent complete', 'Critical', 'Responsible', 'In window'];
  const body = rows.map((row) => [
    row.site,
    row.wbs ?? '',
    row.task,
    row.start,
    row.finish,
    String(row.percent_complete),
    row.critical ? 'Yes' : 'No',
    row.responsible ?? '',
    LOOK_AHEAD_EVENT_LABEL[row.event],
  ]);
  return [header, ...body].map((line) => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
