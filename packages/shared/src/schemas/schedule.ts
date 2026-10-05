import { z } from 'zod';
import {
  SCHEDULE_CONSTRAINT_TYPES,
  SCHEDULE_LINK_TYPES,
  SCHEDULE_TASK_KINDS,
} from '../schedule';
import { isoDateSchema, uuidSchema } from './common';

/**
 * Scheduling (roadmap Phase 2, module 6): tasks, links, calendars, baselines and imports.
 *
 * Durations and lags are whole working days. A schedule measured in hours is a factory's; a site
 * plans in days, and every import is rounded to them.
 */

/** Ten years of working days: longer than any task anybody means. */
const MAX_DURATION_DAYS = 3650;

const weekdaySchema = z.number().int().min(0).max(6);

export const scheduleCalendarSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  /** Weekdays worked: 0 Sunday … 6 Saturday. */
  working_days: z
    .array(weekdaySchema)
    .min(1, 'at least one weekday must be worked')
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  holidays: z
    .array(isoDateSchema)
    .max(2000)
    .default([])
    .transform((days) => [...new Set(days)].sort()),
});
export type ScheduleCalendarInput = z.infer<typeof scheduleCalendarSchema>;

const constraintFields = {
  constraint_type: z.enum(SCHEDULE_CONSTRAINT_TYPES).optional(),
  constraint_date: isoDateSchema.nullable().optional(),
};

const taskFields = {
  name: z.string().trim().min(1).max(200),
  kind: z.enum(SCHEDULE_TASK_KINDS).optional(),
  /** The summary task this sits under. Null for the top level. */
  parent_id: uuidSchema.nullable().optional(),
  /** `1.2.3` from the plan it came from; left for the schedule to number when absent. */
  wbs_code: z.string().trim().min(1).max(40).nullable().optional(),
  duration_days: z.number().int().min(0).max(MAX_DURATION_DAYS).optional(),
  ...constraintFields,
  cost_code_id: uuidSchema.nullable().optional(),
  /** A person in the company who answers for it. */
  responsible_user_id: uuidSchema.nullable().optional(),
  /** Or a contractor who does. */
  contractor_id: uuidSchema.nullable().optional(),
  /** The site milestone this task is — its planned date follows the schedule from then on. */
  milestone_id: uuidSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  sort_order: z.number().int().min(0).max(1_000_000).optional(),
};

/** A dated constraint needs its date; ASAP has none. */
function constraintIsWhole(value: { constraint_type?: string; constraint_date?: string | null }) {
  if (value.constraint_type === undefined) return true;
  return value.constraint_type === 'asap' ? true : Boolean(value.constraint_date);
}

export const createScheduleTaskSchema = z
  .object(taskFields)
  .refine(constraintIsWhole, {
    message: 'a start-no-earlier-than or finish-no-later-than constraint needs its date',
    path: ['constraint_date'],
  })
  .refine((value) => value.kind !== 'milestone' || !value.duration_days, {
    message: 'a milestone has no duration',
    path: ['duration_days'],
  })
  .refine((value) => value.kind === 'milestone' || value.duration_days !== 0, {
    message: 'a task lasts at least one working day; make it a milestone instead',
    path: ['duration_days'],
  });
export type CreateScheduleTaskInput = z.infer<typeof createScheduleTaskSchema>;

export const updateScheduleTaskSchema = z
  .object({
    ...taskFields,
    name: taskFields.name.optional(),
    /**
     * Drag the start: pins the task to start no earlier than this date, as dragging a bar does in
     * every scheduling tool.
     */
    start_date: isoDateSchema.optional(),
    /** Drag the finish: changes the duration to the working days from its start to here. */
    finish_date: isoDateSchema.optional(),
    percent_complete: z.number().int().min(0).max(100).optional(),
    actual_start: isoDateSchema.nullable().optional(),
    actual_finish: isoDateSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' })
  .refine(constraintIsWhole, {
    message: 'a start-no-earlier-than or finish-no-later-than constraint needs its date',
    path: ['constraint_date'],
  });
export type UpdateScheduleTaskInput = z.infer<typeof updateScheduleTaskSchema>;

/**
 * What a supervisor reports from site: how far along, and when it really started and finished.
 * Nothing about the plan itself — that is `schedule.manage`.
 */
export const scheduleProgressSchema = z
  .object({
    percent_complete: z.number().int().min(0).max(100).optional(),
    actual_start: isoDateSchema.nullable().optional(),
    actual_finish: isoDateSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no progress to record' })
  .refine(
    (value) => !value.actual_start || !value.actual_finish || value.actual_finish >= value.actual_start,
    { message: 'it cannot finish before it started', path: ['actual_finish'] },
  );
export type ScheduleProgressInput = z.infer<typeof scheduleProgressSchema>;

const lagSchema = z.number().int().min(-365).max(365);

export const createScheduleDependencySchema = z
  .object({
    predecessor_id: uuidSchema,
    successor_id: uuidSchema,
    /** Finish-to-start unless said otherwise — what "after" means on a site. */
    type: z.enum(SCHEDULE_LINK_TYPES).default('FS'),
    /** Working days; negative is a lead. */
    lag_days: lagSchema.default(0),
  })
  .refine((value) => value.predecessor_id !== value.successor_id, {
    message: 'a task cannot wait on itself',
    path: ['successor_id'],
  });
export type CreateScheduleDependencyInput = z.infer<typeof createScheduleDependencySchema>;

export const updateScheduleDependencySchema = z
  .object({ type: z.enum(SCHEDULE_LINK_TYPES).optional(), lag_days: lagSchema.optional() })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateScheduleDependencyInput = z.infer<typeof updateScheduleDependencySchema>;

export const createScheduleBaselineSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateScheduleBaselineInput = z.infer<typeof createScheduleBaselineSchema>;

export const scheduleQuerySchema = z.object({
  /** Adds each task's baseline dates and how far it has moved since. */
  baseline_id: uuidSchema.optional(),
  /** Progress is counted to this day. Today, in the company's time zone, when absent. */
  status_date: isoDateSchema.optional(),
});
export type ScheduleQuery = z.infer<typeof scheduleQuerySchema>;

export const SCHEDULE_IMPORT_FORMATS = ['auto', 'msproject', 'p6'] as const;
export type ScheduleImportFormat = (typeof SCHEDULE_IMPORT_FORMATS)[number];

const importSource = {
  /** The file's text: Microsoft Project XML (MSPDI) or a Primavera P6 XML export. */
  xml: z.string().min(1).max(2_000_000),
  format: z.enum(SCHEDULE_IMPORT_FORMATS).default('auto'),
};

export const scheduleImportPreviewSchema = z.object(importSource);
export type ScheduleImportPreviewInput = z.infer<typeof scheduleImportPreviewSchema>;

export const scheduleImportSchema = z.object({
  ...importSource,
  /** Replace clears the site's tasks first; append adds the file's beneath them. */
  mode: z.enum(['replace', 'append']).default('replace'),
  /** Take the file's working week and holidays as the site's calendar. */
  use_calendar: z.boolean().default(true),
});
export type ScheduleImportInput = z.infer<typeof scheduleImportSchema>;

export const scheduleLookAheadQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  /** First day of the window; today when absent. */
  from: isoDateSchema.optional(),
  days: z.coerce.number().int().min(1).max(90).default(14),
  format: z.enum(['json', 'csv']).default('json'),
});
export type ScheduleLookAheadQuery = z.infer<typeof scheduleLookAheadQuerySchema>;
