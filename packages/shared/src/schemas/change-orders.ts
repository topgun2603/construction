import { z } from 'zod';
import { CHANGE_ORDER_REASONS, CHANGE_ORDER_STATUSES } from '../change-orders';
import { clientIdSchema, isoDateSchema, paiseSchema, positivePaiseSchema, uuidSchema } from './common';

/**
 * Change orders (roadmap Phase 2, module 4).
 *
 * Money in minor units as strings, percentages as basis points, quantities as strings with at most
 * three decimals — nothing on the wire is a float.
 */

/** A quantity that may be negative (an omission) but not zero, with at most three decimals. */
const changeOrderQuantitySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(
    z
      .string()
      .regex(/^-?\d{1,11}(?:\.\d{1,3})?$/, 'expected a quantity with at most three decimals')
      .refine((value) => Number.parseFloat(value) !== 0, 'quantity cannot be zero'),
  );

/**
 * One line: measured (`quantity` × `rate`) or a lump sum (`amount`), never both. A negative
 * quantity or amount is an omission and credits the budget.
 */
export const changeOrderLineSchema = z
  .object({
    /** The site's cost code whose budget this line moves. Null moves no line's budget. */
    cost_code_id: uuidSchema.nullable().optional(),
    description: z.string().trim().min(1).max(500),
    unit: z.string().trim().max(20).nullable().optional(),
    quantity: changeOrderQuantitySchema.nullable().optional(),
    /** Minor units per unit. */
    rate: positivePaiseSchema.nullable().optional(),
    /** A lump sum, minor units. */
    amount: paiseSchema.nullable().optional(),
  })
  .superRefine((line, ctx) => {
    const measured = line.quantity != null || line.rate != null;
    const lump = line.amount != null;
    if (measured && lump) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'give either a quantity and rate, or a lump sum — not both',
      });
    } else if (measured && (line.quantity == null || line.rate == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [line.quantity == null ? 'quantity' : 'rate'],
        message: 'a measured line needs both a quantity and a rate',
      });
    } else if (!measured && !lump) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'give a quantity and rate, or a lump sum',
      });
    }
  });
export type ChangeOrderLineInput = z.infer<typeof changeOrderLineSchema>;

const changeOrderTerms = {
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  reason: z.enum(CHANGE_ORDER_REASONS),
  raised_on: isoDateSchema.optional(),
  /** Markup on cost, basis points (1500 = 15%), up to 1000%. Ignored when `client_price` is set. */
  markup_bp: z.number().int().min(0).max(100_000).optional(),
  /** A price agreed outright instead of cost plus markup. Null goes back to cost plus markup. */
  client_price: paiseSchema.nullable().optional(),
  /** The client's GST or VAT on the price. Defaults to the regime's standard rate where it has one. */
  tax_rate_bp: z.number().int().min(0).max(5000).optional(),
  /** Days the handover moves by; negative brings it forward. */
  time_impact_days: z.number().int().min(-3650).max(3650).optional(),
  /** Replaces every line when present. */
  lines: z.array(changeOrderLineSchema).max(200).optional(),
};

export const createChangeOrderSchema = z.object({
  project_id: uuidSchema,
  ...changeOrderTerms,
  /** The scope-creep suggestion this was raised from, which is then marked as taken up. */
  suggestion_id: uuidSchema.optional(),
  client_id: clientIdSchema.optional(),
});
export type CreateChangeOrderInput = z.infer<typeof createChangeOrderSchema>;

export const updateChangeOrderSchema = z
  .object({
    ...changeOrderTerms,
    title: changeOrderTerms.title.optional(),
    reason: changeOrderTerms.reason.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateChangeOrderInput = z.infer<typeof updateChangeOrderSchema>;

/** A note with a workflow step: why it was returned, cancelled, or what the approver said. */
export const changeOrderNoteSchema = z.object({
  note: z.string().trim().max(1000).optional(),
});
export type ChangeOrderNoteInput = z.infer<typeof changeOrderNoteSchema>;

/** The client's answer, recorded by somebody holding `approvals.decide`. */
export const changeOrderClientDecisionSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});
export type ChangeOrderClientDecisionInput = z.infer<typeof changeOrderClientDecisionSchema>;

/** A photo or document on a change order: one already in the library, or an uploaded photo. */
export const changeOrderAttachmentSchema = z
  .object({
    document_id: uuidSchema.optional(),
    s3_key: z.string().trim().min(1).max(400).optional(),
    content_type: z.string().trim().max(120).optional(),
    caption: z.string().trim().max(200).optional(),
  })
  .refine((value) => (value.document_id ? !value.s3_key : Boolean(value.s3_key)), {
    message: 'attach either a document or an uploaded file',
  });
export type ChangeOrderAttachmentInput = z.infer<typeof changeOrderAttachmentSchema>;

export const listChangeOrdersQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(CHANGE_ORDER_STATUSES).optional(),
});
export type ListChangeOrdersQuery = z.infer<typeof listChangeOrdersQuerySchema>;

/** The site's contract value before any change order. Null clears it. */
export const changeOrderContractValueSchema = z.object({
  contract_value: positivePaiseSchema.nullable(),
});
export type ChangeOrderContractValueInput = z.infer<typeof changeOrderContractValueSchema>;

export const listChangeOrderSuggestionsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(['open', 'dismissed', 'converted']).optional(),
});
export type ListChangeOrderSuggestionsQuery = z.infer<typeof listChangeOrderSuggestionsQuerySchema>;
