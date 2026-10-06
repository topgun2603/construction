import { z } from 'zod';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CHARGE_BASES,
  EQUIPMENT_DOCUMENT_KINDS,
  EQUIPMENT_FUEL_SOURCES,
  EQUIPMENT_HIRE_BASES,
  EQUIPMENT_MAINTENANCE_KINDS,
  EQUIPMENT_METER_TYPES,
  EQUIPMENT_OWNERSHIPS,
  EQUIPMENT_STATUSES,
} from '../equipment';
import { clientIdSchema, isoDateSchema, positivePaiseSchema, uuidSchema } from './common';

/**
 * Equipment and plant (roadmap Phase 2, module 10). Hours and meter readings travel as decimal
 * strings with at most one decimal, litres with at most two, money as integer minor-unit strings.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Hours or a meter reading: `7.5`, `12450`. Numbers are accepted and written with one decimal. */
export const equipmentTenthsSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(1) : value.trim()))
  .pipe(z.string().regex(/^\d{1,8}(?:\.\d)?$/, 'expected a number with at most one decimal'));

/** Litres: `120.5`. */
export const equipmentLitresSchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
  .pipe(z.string().regex(/^\d{1,7}(?:\.\d{1,2})?$/, 'expected litres with at most two decimals'));

/** A file uploaded through `/uploads/presign` under the `equipment_photo` kind. */
const s3KeySchema = z.string().min(1).max(512);

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected a month like 2026-10');

// --- register --------------------------------------------------------------------------------------

const equipmentFields = {
  /** Left out, one is suggested from the category: `BH-004`. Unique in the company. */
  code: z.string().trim().min(1).max(40).optional(),
  name: text(120),
  category: z.enum(EQUIPMENT_CATEGORIES),
  make: optionalText(80),
  model: optionalText(80),
  registration_no: optionalText(40),
  serial_no: optionalText(80),
  year: z.number().int().min(1950).max(2100).nullable().optional(),
  /** Scaffolding sets, a lot of small tools: how many in this one entry. */
  quantity: z.number().int().min(1).max(100_000).default(1),
  ownership: z.enum(EQUIPMENT_OWNERSHIPS),
  /** Hired kit: who from. A supplier in procurement's vendor list. */
  vendor_id: uuidSchema.nullable().optional(),
  hire_basis: z.enum(EQUIPMENT_HIRE_BASES).nullable().optional(),
  /** Per hour, day or month, by `hire_basis`. */
  hire_rate: positivePaiseSchema.optional(),
  /**
   * Minimum hours: per day for hourly hire, the hours a monthly rate covers for monthly hire.
   * Ignored for a day rate.
   */
  min_hours: equipmentTenthsSchema.nullable().optional(),
  operator_included: z.boolean().default(true),
  /** Per working day, when the vendor charges for the operator separately. */
  operator_rate: positivePaiseSchema.optional(),
  fuel_included: z.boolean().default(false),
  mobilisation_charge: positivePaiseSchema.optional(),
  /** Owned kit: the internal rate charged to the site it works on. */
  charge_out_basis: z.enum(EQUIPMENT_CHARGE_BASES).nullable().optional(),
  charge_out_rate: positivePaiseSchema.optional(),
  meter_type: z.enum(EQUIPMENT_METER_TYPES).default('hours'),
  meter_reading: equipmentTenthsSchema.nullable().optional(),
  notes: optionalText(2000),
};

export const createEquipmentSchema = z
  .object(equipmentFields)
  .refine((value) => value.ownership !== 'hired' || Boolean(value.vendor_id), {
    message: 'a hired machine needs the vendor it is hired from',
    path: ['vendor_id'],
  })
  .refine((value) => value.ownership !== 'hired' || Boolean(value.hire_basis), {
    message: 'say whether it is hired by the hour, the day or the month',
    path: ['hire_basis'],
  });
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

export const updateEquipmentSchema = z
  .object({
    ...equipmentFields,
    quantity: z.number().int().min(1).max(100_000).optional(),
    operator_included: z.boolean().optional(),
    fuel_included: z.boolean().optional(),
    meter_type: z.enum(EQUIPMENT_METER_TYPES).optional(),
    status: z.enum(EQUIPMENT_STATUSES).optional(),
  })
  .partial();
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;

export const listEquipmentQuerySchema = z.object({
  status: z.enum(EQUIPMENT_STATUSES).optional(),
  ownership: z.enum(EQUIPMENT_OWNERSHIPS).optional(),
  category: z.enum(EQUIPMENT_CATEGORIES).optional(),
  /** Machines on this site today. */
  project_id: uuidSchema.optional(),
  vendor_id: uuidSchema.optional(),
  q: z.string().trim().max(80).optional(),
  archived: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema>;

// --- allocation ------------------------------------------------------------------------------------

export const allocateEquipmentSchema = z.object({
  project_id: uuidSchema,
  /** Moving it from another site closes that allocation the day before. */
  from_date: isoDateSchema,
  /** Where its cost lands on the site's breakdown. Logs default to it. */
  cost_code_id: uuidSchema.nullable().optional(),
  note: optionalText(500),
});
export type AllocateEquipmentInput = z.infer<typeof allocateEquipmentSchema>;

export const releaseEquipmentSchema = z.object({
  /** The last day it was on the site. */
  to_date: isoDateSchema,
  /** Owned kit goes back to the yard; hired kit is usually sent back to the vendor. */
  status: z.enum(['available', 'off_hire']).optional(),
});
export type ReleaseEquipmentInput = z.infer<typeof releaseEquipmentSchema>;

export const updateEquipmentAllocationSchema = z
  .object({
    from_date: isoDateSchema,
    to_date: isoDateSchema.nullable(),
    cost_code_id: uuidSchema.nullable(),
    note: optionalText(500),
  })
  .partial();
export type UpdateEquipmentAllocationInput = z.infer<typeof updateEquipmentAllocationSchema>;

// --- fuel ------------------------------------------------------------------------------------------

const fuelFields = {
  litres: equipmentLitresSchema,
  /** What the fuel cost. Zero for fuel the vendor supplies. */
  amount: positivePaiseSchema.optional(),
  source: z.enum(EQUIPMENT_FUEL_SOURCES).default('direct'),
  /** `stock`: the material that is the site's diesel. The issue is booked out of stock. */
  material_id: uuidSchema.nullable().optional(),
  /** `expense`: an expense already recorded for this fuel. */
  expense_id: uuidSchema.nullable().optional(),
  /** `expense`: record the fuel bill as a new expense now, linked to this entry. */
  create_expense: z.boolean().optional(),
  bill_s3_key: s3KeySchema.nullable().optional(),
  note: optionalText(500),
};

export const equipmentFuelInLogSchema = z.object(fuelFields);
export type EquipmentFuelInLogInput = z.infer<typeof equipmentFuelInLogSchema>;

export const createEquipmentFuelSchema = z.object({
  equipment_id: uuidSchema,
  issued_on: isoDateSchema,
  /** Defaults to the site the machine was on that day. */
  project_id: uuidSchema.optional(),
  meter_reading: equipmentTenthsSchema.nullable().optional(),
  ...fuelFields,
  client_id: clientIdSchema.optional(),
});
export type CreateEquipmentFuelInput = z.infer<typeof createEquipmentFuelSchema>;

// --- daily logs ------------------------------------------------------------------------------------

const logFields = {
  log_date: isoDateSchema,
  opening_meter: equipmentTenthsSchema.nullable().optional(),
  closing_meter: equipmentTenthsSchema.nullable().optional(),
  /** Typed for a km meter or no meter; worked out from the readings for an hour meter. */
  hours_worked: equipmentTenthsSchema.nullable().optional(),
  idle_hours: equipmentTenthsSchema.optional(),
  breakdown_hours: equipmentTenthsSchema.optional(),
  /** A worker on the roster, or a name typed for somebody who is not (a vendor's operator). */
  operator_worker_id: uuidSchema.nullable().optional(),
  operator_name: optionalText(120),
  work_done: optionalText(1000),
  meter_photo_key: s3KeySchema.nullable().optional(),
  cost_code_id: uuidSchema.nullable().optional(),
};

export const createEquipmentLogSchema = z.object({
  equipment_id: uuidSchema,
  /** Defaults to the site the machine is allocated to that day; any other site is refused. */
  project_id: uuidSchema.optional(),
  ...logFields,
  /** Fuel issued the same day, saved with the log. */
  fuel: equipmentFuelInLogSchema.optional(),
  client_id: clientIdSchema.optional(),
});
export type CreateEquipmentLogInput = z.infer<typeof createEquipmentLogSchema>;

export const updateEquipmentLogSchema = z.object(logFields).partial();
export type UpdateEquipmentLogInput = z.infer<typeof updateEquipmentLogSchema>;

export const listEquipmentLogsQuerySchema = z.object({
  equipment_id: uuidSchema.optional(),
  project_id: uuidSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
});
export type ListEquipmentLogsQuery = z.infer<typeof listEquipmentLogsQuerySchema>;

// --- maintenance -----------------------------------------------------------------------------------

export const createEquipmentServicePlanSchema = z
  .object({
    name: text(120),
    /** Every so many hours or km, by the machine's meter. */
    interval_meter: equipmentTenthsSchema.nullable().optional(),
    interval_days: z.number().int().min(1).max(3650).nullable().optional(),
    /** When it was last done; left out, the plan counts from the machine's reading and today. */
    last_done_meter: equipmentTenthsSchema.nullable().optional(),
    last_done_on: isoDateSchema.nullable().optional(),
  })
  .refine((value) => Boolean(value.interval_meter) || Boolean(value.interval_days), {
    message: 'set an interval in hours, km or days',
    path: ['interval_meter'],
  });
export type CreateEquipmentServicePlanInput = z.infer<typeof createEquipmentServicePlanSchema>;

export const updateEquipmentServicePlanSchema = z
  .object({
    name: text(120),
    interval_meter: equipmentTenthsSchema.nullable(),
    interval_days: z.number().int().min(1).max(3650).nullable(),
    last_done_meter: equipmentTenthsSchema.nullable(),
    last_done_on: isoDateSchema.nullable(),
    active: z.boolean(),
  })
  .partial();
export type UpdateEquipmentServicePlanInput = z.infer<typeof updateEquipmentServicePlanSchema>;

export const createEquipmentMaintenanceSchema = z.object({
  done_on: isoDateSchema,
  kind: z.enum(EQUIPMENT_MAINTENANCE_KINDS),
  description: text(500),
  parts: optionalText(1000),
  cost: positivePaiseSchema.default(0n),
  meter_reading: equipmentTenthsSchema.nullable().optional(),
  /** Hours the machine was out of action. */
  downtime_hours: equipmentTenthsSchema.nullable().optional(),
  /** The service plan this carries out; doing it resets the plan's count. */
  plan_id: uuidSchema.nullable().optional(),
  /**
   * The site that bears the cost. Left out, the site the machine was on that day; null, the yard —
   * the machine's cost, but no site's.
   */
  project_id: uuidSchema.nullable().optional(),
  cost_code_id: uuidSchema.nullable().optional(),
  vendor_name: optionalText(120),
  /** An expense already recorded for this work. */
  expense_id: uuidSchema.nullable().optional(),
  /** Record the cost as a new expense on the site now (category repairs). */
  create_expense: z.boolean().optional(),
  bill_s3_key: s3KeySchema.nullable().optional(),
});
export type CreateEquipmentMaintenanceInput = z.infer<typeof createEquipmentMaintenanceSchema>;

// --- documents -------------------------------------------------------------------------------------

export const createEquipmentDocumentSchema = z.object({
  kind: z.enum(EQUIPMENT_DOCUMENT_KINDS),
  number: optionalText(80),
  issued_on: isoDateSchema.nullable().optional(),
  expires_on: isoDateSchema.nullable().optional(),
  s3_key: s3KeySchema.nullable().optional(),
  note: optionalText(500),
});
export type CreateEquipmentDocumentInput = z.infer<typeof createEquipmentDocumentSchema>;

export const updateEquipmentDocumentSchema = createEquipmentDocumentSchema.partial();
export type UpdateEquipmentDocumentInput = z.infer<typeof updateEquipmentDocumentSchema>;

// --- photos ----------------------------------------------------------------------------------------

/** Read a meter or a fuel bill from a photo. Writes nothing: the person confirms what it read. */
export const equipmentScanSchema = z.object({ s3_key: s3KeySchema });
export type EquipmentScanInput = z.infer<typeof equipmentScanSchema>;

export interface EquipmentMeterScanResult {
  /** The reading as digits with at most one decimal, or null when it could not be read. */
  reading: string | null;
  unit: 'hours' | 'km' | null;
}

export interface EquipmentFuelBillScanResult {
  litres: string | null;
  /** Minor units, as a string. */
  amount: string | null;
  issued_on: string | null;
  vendor: string | null;
  /** Fields that could not be read, for the form to mark. */
  unread: string[];
}

// --- reports ---------------------------------------------------------------------------------------

export const equipmentReportQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  project_id: uuidSchema.optional(),
  equipment_id: uuidSchema.optional(),
});
export type EquipmentReportQuery = z.infer<typeof equipmentReportQuerySchema>;

export const EQUIPMENT_EXPORT_KINDS = ['register', 'logs', 'costs', 'utilisation', 'fuel', 'maintenance'] as const;
export type EquipmentExportKind = (typeof EQUIPMENT_EXPORT_KINDS)[number];

export const equipmentExportQuerySchema = equipmentReportQuerySchema.extend({
  kind: z.enum(EQUIPMENT_EXPORT_KINDS),
});
export type EquipmentExportQuery = z.infer<typeof equipmentExportQuerySchema>;

export const equipmentHireStatementQuerySchema = z.object({
  vendor_id: uuidSchema,
  month: monthSchema,
});
export type EquipmentHireStatementQuery = z.infer<typeof equipmentHireStatementQuerySchema>;

/**
 * The vendor's invoice for a month has been checked against the statement: book it. Each site's
 * share becomes an expense (category equipment hire), and from then on that month's hire on that
 * site is the expense's — the cost report never counts it twice.
 */
export const bookEquipmentHireSchema = z.object({
  vendor_id: uuidSchema,
  month: monthSchema,
  invoice_ref: optionalText(80),
  bill_s3_key: s3KeySchema.nullable().optional(),
});
export type BookEquipmentHireInput = z.infer<typeof bookEquipmentHireSchema>;
