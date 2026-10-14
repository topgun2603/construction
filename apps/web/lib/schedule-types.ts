/**
 * Scheduling (roadmap Phase 2, module 6) — the API's shapes.
 *
 * In a file of its own like the other Phase 2 modules, so its changes do not collide with
 * `api-types.ts`. Dates are `YYYY-MM-DD`; durations, lags, float and variance are working days.
 */

export type ScheduleLinkType = 'FS' | 'SS' | 'FF' | 'SF';
export type ScheduleTaskKind = 'task' | 'milestone';
export type ScheduleConstraintType = 'asap' | 'snet' | 'fnlt';
export type ScheduleTaskStatus = 'not_started' | 'in_progress' | 'complete';

/** Where the working week came from: the site's own, the company's, or the country's default. */
export interface ScheduleCalendar {
  id: string | null;
  scope: 'site' | 'company' | 'default';
  name: string;
  /** 0 Sunday … 6 Saturday. */
  working_days: number[];
  holidays: string[];
}

export interface ScheduleTaskBaseline {
  start: string;
  finish: string;
  duration_days: number;
  /** Positive: later than the baseline. */
  start_variance: number;
  finish_variance: number;
  slipped: boolean;
}

export interface ScheduleTask {
  id: string;
  parent_id: string | null;
  /** 0 at the top level. */
  depth: number;
  /** The task's outline number: its own WBS code when it has one, else 1, 1.2, 1.2.3 by position. */
  wbs: string;
  wbs_code: string | null;
  name: string;
  kind: ScheduleTaskKind;
  /** Has subtasks: its dates, progress and float are rolled up and it cannot be linked. */
  is_summary: boolean;
  sort_order: number;
  /** As planned. A summary's is its span. */
  duration_days: number;
  constraint_type: ScheduleConstraintType;
  constraint_date: string | null;
  percent_complete: number;
  actual_start: string | null;
  actual_finish: string | null;
  // Worked out by the engine on every read
  start: string;
  finish: string;
  late_start: string;
  late_finish: string;
  total_float: number;
  free_float: number;
  critical: boolean;
  status: ScheduleTaskStatus;
  /** Should have started or finished by the status date and has not. */
  behind: boolean;
  cost_code: { id: string; code: string; name: string } | null;
  responsible: { id: string; name: string } | null;
  contractor: { id: string; name: string } | null;
  milestone: { id: string; name: string } | null;
  notes: string | null;
  /** Present when the schedule was read with `?baseline_id=`. Null for a task added since. */
  baseline: ScheduleTaskBaseline | null;
}

export interface ScheduleDependency {
  id: string;
  predecessor_id: string;
  successor_id: string;
  type: ScheduleLinkType;
  lag_days: number;
}

export interface ScheduleBaselineSummary {
  id: string;
  name: string;
  created_at: string;
  finish_date: string;
  created_by: { id: string; name: string } | null;
}

/** `GET /projects/:id/schedule`. Tasks are in outline order: each parent before its subtasks. */
export interface ScheduleView {
  project: { id: string; name: string; start_date: string | null; target_end_date: string | null };
  status_date: string;
  /** The first working day the schedule counts from. */
  project_start: string;
  /** Null when there are no tasks. */
  finish_date: string | null;
  calendar: ScheduleCalendar;
  tasks: ScheduleTask[];
  dependencies: ScheduleDependency[];
  /** Critical leaf tasks and milestones, in the order they happen. */
  critical_path: string[];
  baselines: ScheduleBaselineSummary[];
  /** The baseline being compared against, when `?baseline_id=` was given. */
  baseline: {
    id: string;
    name: string;
    finish_date: string;
    /** Working days the end of the job has moved since. */
    finish_variance: number;
    slipped_count: number;
  } | null;
  /** Site milestones not yet on the schedule. */
  unlinked_milestones: Array<{ id: string; name: string; planned_date: string | null }>;
  can: { manage: boolean; progress: boolean };
}

/** `GET /projects/:id/schedule/baselines/:baselineId`. */
export interface ScheduleVarianceReport {
  baseline: ScheduleBaselineSummary;
  current_finish: string | null;
  finish_variance: number;
  tasks: Array<{
    task_id: string | null;
    name: string;
    wbs: string | null;
    baseline_start: string;
    baseline_finish: string;
    /** Null when the task has since been deleted. */
    start: string | null;
    finish: string | null;
    start_variance: number | null;
    finish_variance: number | null;
    slipped: boolean;
  }>;
  /** Task ids that finish later than the baseline, worst first. */
  slipped: string[];
}

/** `POST /projects/:id/schedule/import/preview`. */
export interface ScheduleImportPreview {
  format: 'msproject' | 'p6';
  project_name: string | null;
  task_count: number;
  summary_count: number;
  milestone_count: number;
  link_count: number;
  calendar: { name: string; working_days: number[]; holidays: string[] } | null;
  start: string | null;
  finish: string | null;
  tasks: Array<{
    ref: string;
    parent_ref: string | null;
    depth: number;
    wbs: string | null;
    name: string;
    kind: ScheduleTaskKind;
    is_summary: boolean;
    duration_days: number;
    start: string | null;
    finish: string | null;
    percent_complete: number;
  }>;
  warnings: string[];
}

/** `POST /projects/:id/schedule/import`. */
export interface ScheduleImportResult {
  created: number;
  links: number;
  warnings: string[];
}

/** `GET /schedule/look-ahead`. */
export interface ScheduleLookAhead {
  from: string;
  to: string;
  items: Array<{
    project_id: string;
    site: string;
    task_id: string;
    wbs: string | null;
    task: string;
    start: string;
    finish: string;
    percent_complete: number;
    critical: boolean;
    responsible: string | null;
    event: 'starts' | 'finishes' | 'starts_and_finishes';
  }>;
}
