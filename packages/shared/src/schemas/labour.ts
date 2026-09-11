import { z } from 'zod';
import {
  ATTENDANCE_STATUSES,
  LABOUR_PAYMENT_TYPES,
  PAYMENT_MODES,
  PAYMENT_TERMS,
  SKILL_LEVELS,
  WORKER_STATUSES,
} from '../enums';
import { daysBetweenInclusive } from '../dates';
import {
  clientIdSchema,
  isoDateSchema,
  oneDecimalSchema,
  phoneSchema,
  positivePaiseSchema,
  uuidSchema,
} from './common';

// --- contractors -----------------------------------------------------------

export const createContractorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  trade: z.string().trim().min(1).max(80).optional(),
  phone: phoneSchema.optional(),
  payment_terms: z.enum(PAYMENT_TERMS).default('weekly'),
});
export type CreateContractorInput = z.infer<typeof createContractorSchema>;

export const updateContractorSchema = createContractorSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type UpdateContractorInput = z.infer<typeof updateContractorSchema>;

// --- workers ---------------------------------------------------------------

export const createWorkerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: phoneSchema.optional(),
  trade: z.string().trim().min(1).max(80).optional(),
  contractor_id: uuidSchema.nullable().optional(),
  skill_level: z.enum(SKILL_LEVELS).default('unskilled'),
  daily_wage: positivePaiseSchema,
  overtime_rate_per_hour: positivePaiseSchema.default(0n),
  id_proof_s3_key: z.string().max(512).optional(),
  photo_s3_key: z.string().max(512).optional(),
  /** Device-generated id when the supervisor added this worker offline. */
  client_id: clientIdSchema.optional(),
  /** Optional first site assignment, so the roll call sees them immediately. */
  project_id: uuidSchema.optional(),
  from_date: isoDateSchema.optional(),
});
export type CreateWorkerInput = z.infer<typeof createWorkerSchema>;

export const updateWorkerSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    phone: phoneSchema.optional(),
    trade: z.string().trim().min(1).max(80).optional(),
    contractor_id: uuidSchema.nullable().optional(),
    skill_level: z.enum(SKILL_LEVELS).optional(),
    daily_wage: positivePaiseSchema.optional(),
    overtime_rate_per_hour: positivePaiseSchema.optional(),
    status: z.enum(WORKER_STATUSES).optional(),
    id_proof_s3_key: z.string().max(512).nullable().optional(),
    photo_s3_key: z.string().max(512).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no fields to update' });
export type UpdateWorkerInput = z.infer<typeof updateWorkerSchema>;

export const assignWorkerSchema = z.object({
  project_id: uuidSchema,
  from_date: isoDateSchema,
  to_date: isoDateSchema.nullable().optional(),
});
export type AssignWorkerInput = z.infer<typeof assignWorkerSchema>;

export const listWorkersQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  contractor_id: uuidSchema.optional(),
  status: z.enum(WORKER_STATUSES).optional(),
  /** Restrict to workers on `project_id` on this date — the roll call view. */
  on_date: isoDateSchema.optional(),
  q: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ListWorkersQuery = z.infer<typeof listWorkersQuerySchema>;

// --- attendance ------------------------------------------------------------

export const attendanceRowSchema = z.object({
  worker_id: uuidSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  overtime_hours: oneDecimalSchema.default('0'),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  client_id: clientIdSchema.optional(),
});
export type AttendanceRowInput = z.infer<typeof attendanceRowSchema>;

/** `POST /attendance` — the whole roll call for one site on one day. */
export const bulkAttendanceSchema = z.object({
  project_id: uuidSchema,
  attendance_date: isoDateSchema,
  rows: z.array(attendanceRowSchema).min(1).max(1000),
});
export type BulkAttendanceInput = z.infer<typeof bulkAttendanceSchema>;

export const attendanceQuerySchema = z.object({
  project_id: uuidSchema,
  date: isoDateSchema,
});
export type AttendanceQuery = z.infer<typeof attendanceQuerySchema>;

export const attendanceSummaryQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  contractor_id: uuidSchema.optional(),
  from: isoDateSchema,
  to: isoDateSchema,
});
export type AttendanceSummaryQuery = z.infer<typeof attendanceSummaryQuerySchema>;

// --- wage periods ----------------------------------------------------------

export const generateWagePeriodSchema = z
  .object({
    /** Null means direct labour — workers with no contractor. */
    contractor_id: uuidSchema.nullable().default(null),
    period_start: isoDateSchema,
    period_end: isoDateSchema,
  })
  .refine((v) => v.period_start <= v.period_end, {
    message: 'period_end cannot be before period_start',
    path: ['period_end'],
  });
export type GenerateWagePeriodInput = z.infer<typeof generateWagePeriodSchema>;

export const payWagePeriodSchema = z.object({
  paid_on: isoDateSchema,
  mode: z.enum(PAYMENT_MODES).default('cash'),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  /** Omit to settle every line in full. */
  lines: z
    .array(z.object({ worker_id: uuidSchema, amount: positivePaiseSchema }))
    .min(1)
    .max(1000)
    .optional(),
});
export type PayWagePeriodInput = z.infer<typeof payWagePeriodSchema>;

export const listWagePeriodsQuerySchema = z.object({
  contractor_id: uuidSchema.optional(),
  status: z.enum(['open', 'finalised', 'paid']).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListWagePeriodsQuery = z.infer<typeof listWagePeriodsQuerySchema>;

// --- labour payments -------------------------------------------------------

export const createLabourPaymentSchema = z
  .object({
    type: z.enum(LABOUR_PAYMENT_TYPES),
    amount: positivePaiseSchema,
    paid_on: isoDateSchema,
    mode: z.enum(PAYMENT_MODES).default('cash'),
    worker_id: uuidSchema.nullable().optional(),
    contractor_id: uuidSchema.nullable().optional(),
    project_id: uuidSchema.nullable().optional(),
    wage_period_id: uuidSchema.nullable().optional(),
    reference: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
    client_id: clientIdSchema.optional(),
  })
  .refine((v) => Boolean(v.worker_id) || Boolean(v.contractor_id), {
    message: 'a payment must name either a worker or a contractor',
    path: ['worker_id'],
  });
export type CreateLabourPaymentInput = z.infer<typeof createLabourPaymentSchema>;

export const listLabourPaymentsQuerySchema = z.object({
  worker_id: uuidSchema.optional(),
  contractor_id: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  type: z.enum(LABOUR_PAYMENT_TYPES).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListLabourPaymentsQuery = z.infer<typeof listLabourPaymentsQuerySchema>;

// --- reports ---------------------------------------------------------------

export const labourCostQuerySchema = z.object({
  group_by: z.enum(['project', 'contractor', 'worker']).default('project'),
  from: isoDateSchema,
  to: isoDateSchema,
  project_id: uuidSchema.optional(),
});
export type LabourCostQuery = z.infer<typeof labourCostQuerySchema>;

/** The register's hard limit: a calendar month is the longest sheet anyone reads. */
export const ATTENDANCE_REGISTER_MAX_DAYS = 31;

/**
 * The attendance register — the muster roll for a period.
 *
 * Capped at a month because the response is a grid: every worker carries one cell per
 * day, so at 31 columns a row is already at the edge of what fits a laptop screen
 * without the name column scrolling away. Longer ranges do not fail gracefully — they
 * produce a sheet nobody can read and a payload that grows with every worker.
 *
 * A month is also the unit this is checked against in practice: wage cycles here run
 * weekly, fortnightly or monthly, and all three fit inside it.
 */
export const attendanceRegisterQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    project_id: uuidSchema.optional(),
    contractor_id: uuidSchema.optional(),
  })
  .refine((value) => value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  })
  .refine(
    (value) => daysBetweenInclusive(value.from, value.to) <= ATTENDANCE_REGISTER_MAX_DAYS,
    {
      message: `the register covers at most ${ATTENDANCE_REGISTER_MAX_DAYS} days at a time`,
      path: ['to'],
    },
  );
export type AttendanceRegisterQuery = z.infer<typeof attendanceRegisterQuerySchema>;

/**
 * Per-person money accountability for a period (supervisors, PMs, owners).
 *
 * A worker's sheet is earnings against payments — that is `/workers/:id/ledger`. For
 * the people who *run* a site the equivalent question is different: what did they
 * commit on the company's behalf? Expenses recorded, indents raised, labour booked
 * through their roll calls.
 */
export const personLedgerQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    project_id: uuidSchema.optional(),
  })
  .refine((value) => value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  });
export type PersonLedgerQuery = z.infer<typeof personLedgerQuerySchema>;
