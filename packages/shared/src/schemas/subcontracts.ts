import { z } from 'zod';
import { PAYMENT_MODES } from '../enums';
import {
  SUBCONTRACT_DEDUCTION_KINDS,
  SUBCONTRACT_STATUSES,
} from '../subcontracts';
import { clientIdSchema, isoDateSchema, paiseSchema, positivePaiseSchema, uuidSchema } from './common';

/**
 * Subcontracts and progress (RA) billing (roadmap Phase 2, module 3).
 *
 * Percentages travel as basis points (500 = 5%) so nothing on the wire is a float; quantities as
 * strings with at most three decimals, like stock.
 */

/** A quantity of work: up to three decimals, zero allowed (nothing done yet on a line). */
export const workQuantitySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(
    z
      .string()
      .regex(/^\d{1,11}(?:\.\d{1,3})?$/, 'expected a quantity with at most three decimals'),
  );

/** A contract quantity: as above, but more than zero — a line for nothing is not a line. */
const contractQuantitySchema = workQuantitySchema.refine(
  (value) => Number.parseFloat(value) > 0,
  'quantity must be more than zero',
);

/** Basis points, 0–`max`. */
const bpSchema = (max: number) => z.number().int().min(0).max(max);

export const subcontractLineSchema = z.object({
  /** The site's cost code this work is booked to. Null leaves it under "Unallocated". */
  cost_code_id: uuidSchema.nullable().optional(),
  /** The item number in the subcontractor's schedule: `2.4`, `B-12`. */
  item_code: z.string().trim().min(1).max(30).optional(),
  description: z.string().trim().min(1).max(500),
  unit: z.string().trim().min(1).max(20),
  quantity: contractQuantitySchema,
  /** Minor units per unit. */
  rate: positivePaiseSchema,
});
export type SubcontractLineInput = z.infer<typeof subcontractLineSchema>;

export const updateSubcontractLineSchema = subcontractLineSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateSubcontractLineInput = z.infer<typeof updateSubcontractLineSchema>;

const subcontractTerms = {
  title: z.string().trim().min(1).max(160),
  scope: z.string().trim().max(4000).optional(),
  start_date: isoDateSchema.nullable().optional(),
  end_date: isoDateSchema.nullable().optional(),
  /** Held back from every bill: 5% is 500. At most 20%, above which it is not retention. */
  retention_bp: bpSchema(2000).optional(),
  /** The share of retention released at completion; the rest after the defects period. */
  retention_release_at_completion_bp: bpSchema(10_000).optional(),
  defects_liability_months: z.number().int().min(0).max(120).optional(),
  /** Mobilisation advance agreed, minor units. Paid when it is recorded as a payment. */
  advance_amount: positivePaiseSchema.optional(),
  /** Recovered from each bill as this share of the work certified, until it is all back. */
  advance_recovery_bp: bpSchema(10_000).optional(),
  /**
   * The subcontractor's GST or VAT on their bills. Defaults to the regime's standard rate where it
   * has one (5% VAT in the UAE); India's GST depends on the work, so it must be given there.
   */
  tax_rate_bp: bpSchema(5000).optional(),
  payment_terms: z.string().trim().max(200).optional(),
};

export const createSubcontractSchema = z
  .object({
    project_id: uuidSchema,
    contractor_id: uuidSchema,
    /** `SC-007`. Numbered for you when left out. */
    number: z.string().trim().min(1).max(40).optional(),
    ...subcontractTerms,
    lines: z.array(subcontractLineSchema).max(500).optional(),
  })
  .refine((value) => !value.start_date || !value.end_date || value.start_date <= value.end_date, {
    message: 'the end date cannot be before the start',
    path: ['end_date'],
  });
export type CreateSubcontractInput = z.infer<typeof createSubcontractSchema>;

export const updateSubcontractSchema = z
  .object({
    contractor_id: uuidSchema.optional(),
    number: z.string().trim().min(1).max(40).optional(),
    ...subcontractTerms,
    title: subcontractTerms.title.optional(),
    scope: z.string().trim().max(4000).nullable().optional(),
    payment_terms: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateSubcontractInput = z.infer<typeof updateSubcontractSchema>;

export const subcontractStatusSchema = z.object({
  status: z.enum(SUBCONTRACT_STATUSES),
  /** When the work finished; today when left out. Only for `completed`. */
  completed_on: isoDateSchema.optional(),
});
export type SubcontractStatusInput = z.infer<typeof subcontractStatusSchema>;

export const listSubcontractsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  contractor_id: uuidSchema.optional(),
  status: z.enum(SUBCONTRACT_STATUSES).optional(),
});
export type ListSubcontractsQuery = z.infer<typeof listSubcontractsQuerySchema>;

// --- variations ----------------------------------------------------------------------------------

export const createVariationSchema = z.object({
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().max(2000).optional(),
  lines: z.array(subcontractLineSchema).min(1).max(200),
});
export type CreateVariationInput = z.infer<typeof createVariationSchema>;

export const decideVariationSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});
export type DecideVariationInput = z.infer<typeof decideVariationSchema>;

// --- RA bills ------------------------------------------------------------------------------------

export const raDeductionSchema = z.object({
  kind: z.enum(SUBCONTRACT_DEDUCTION_KINDS),
  description: z.string().trim().min(1).max(300),
  amount: paiseSchema.refine((value) => value > 0n, { message: 'amount must be more than zero' }),
  /** Where the recovery is booked; taken from the expense when one is linked and this is not. */
  cost_code_id: uuidSchema.nullable().optional(),
  /** The expense that paid for what is being charged back, when there is one. */
  expense_id: uuidSchema.nullable().optional(),
  /** The stock issue that handed material over, when there is one. */
  stock_movement_id: uuidSchema.nullable().optional(),
});
export type RaDeductionInput = z.infer<typeof raDeductionSchema>;

const billLineQuantity = z.object({
  line_id: uuidSchema,
  /** Done to date — cumulative, not this period's. */
  quantity_to_date: workQuantitySchema,
});

export const createRaBillSchema = z
  .object({
    period_from: isoDateSchema.optional(),
    period_to: isoDateSchema,
    bill_date: isoDateSchema.optional(),
    /** Lines left out carry the previous bill's quantity: nothing more done on them. */
    lines: z.array(billLineQuantity).max(1000).default([]),
    deductions: z.array(raDeductionSchema).max(100).default([]),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((value) => !value.period_from || value.period_from <= value.period_to, {
    message: 'the period cannot end before it starts',
    path: ['period_to'],
  });
export type CreateRaBillInput = z.infer<typeof createRaBillSchema>;

export const updateRaBillSchema = z
  .object({
    period_from: isoDateSchema.nullable().optional(),
    period_to: isoDateSchema.optional(),
    bill_date: isoDateSchema.optional(),
    lines: z.array(billLineQuantity).max(1000).optional(),
    /** Replaces the bill's deductions when given. */
    deductions: z.array(raDeductionSchema).max(100).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateRaBillInput = z.infer<typeof updateRaBillSchema>;

export const certifyRaBillSchema = z.object({
  /** Certified to date per line; a line left out is certified as claimed. */
  lines: z
    .array(z.object({ line_id: uuidSchema, certified_quantity_to_date: workQuantitySchema }))
    .max(1000)
    .default([]),
  /** Replaces the deductions when given: the certifier may add a back-charge the site missed. */
  deductions: z.array(raDeductionSchema).max(100).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type CertifyRaBillInput = z.infer<typeof certifyRaBillSchema>;

export const returnRaBillSchema = z.object({
  note: z.string().trim().min(1).max(1000),
});
export type ReturnRaBillInput = z.infer<typeof returnRaBillSchema>;

// --- money out -----------------------------------------------------------------------------------

const paymentFields = {
  amount: paiseSchema.refine((value) => value > 0n, { message: 'amount must be more than zero' }),
  paid_on: isoDateSchema,
  mode: z.enum(PAYMENT_MODES).default('bank'),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  /** Idempotency key, so a retried request cannot pay twice. */
  client_id: clientIdSchema.optional(),
};

/** Paying a certified bill. */
export const payRaBillSchema = z.object(paymentFields);
export type PayRaBillInput = z.infer<typeof payRaBillSchema>;

/** Paying the advance, or retention that has been released. */
export const subcontractPaymentSchema = z
  .object({
    kind: z.enum(['advance', 'retention']),
    retention_release_id: uuidSchema.optional(),
    ...paymentFields,
  })
  .refine((value) => value.kind !== 'retention' || value.retention_release_id, {
    message: 'say which retention release this pays',
    path: ['retention_release_id'],
  });
export type SubcontractPaymentInput = z.infer<typeof subcontractPaymentSchema>;

export const releaseRetentionSchema = z.object({
  amount: paiseSchema.refine((value) => value > 0n, { message: 'amount must be more than zero' }),
  released_on: isoDateSchema,
  note: z.string().trim().max(500).optional(),
});
export type ReleaseRetentionInput = z.infer<typeof releaseRetentionSchema>;

export const attachSubcontractDocumentSchema = z.object({ document_id: uuidSchema });
export type AttachSubcontractDocumentInput = z.infer<typeof attachSubcontractDocumentSchema>;
