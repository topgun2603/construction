import { z } from 'zod';
import { PAYMENT_MODES } from '../enums';
import { clientIdSchema, isoDateSchema, positivePaiseSchema, uuidSchema } from './common';

/**
 * What the client owes, what they have paid, and what they have signed off.
 *
 * The money here is money coming *in*. It is deliberately a different shape from expenses and
 * labour payments, which go out â€” the difference between the two is the margin on the job, and a
 * client can be shown one and never the other only because they were never the same thing.
 */

export const createPaymentStageSchema = z.object({
  /** What the client will recognise it as: "On completion of the slab". */
  label: z.string().trim().min(1).max(160),
  /** Paise, as a decimal string. Positive â€” a credit note is not a negative instalment. */
  amount: positivePaiseSchema.refine((value) => value > 0n, {
    message: 'an instalment has to be for something',
  }),
  /** Optional link to the milestone that triggers it. */
  milestone_id: uuidSchema.nullable().optional(),
  due_date: isoDateSchema.nullable().optional(),
  client_id: clientIdSchema.optional(),
});
export type CreatePaymentStageInput = z.infer<typeof createPaymentStageSchema>;

export const updatePaymentStageSchema = z
  .object({
    label: z.string().trim().min(1).max(160).optional(),
    amount: positivePaiseSchema.refine((value) => value > 0n).optional(),
    milestone_id: uuidSchema.nullable().optional(),
    due_date: isoDateSchema.nullable().optional(),
    /**
     * Whether the builder has asked for this instalment yet.
     *
     * A boolean rather than a timestamp: the caller says "I have raised this" and the server stamps
     * when. A client supplying their own time is a client who can date a demand to last month.
     */
    raised: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });
export type UpdatePaymentStageInput = z.infer<typeof updatePaymentStageSchema>;

/** Reordering, as a whole list â€” the same shape the site media gallery uses. */
export const reorderPaymentStagesSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(200),
});
export type ReorderPaymentStagesInput = z.infer<typeof reorderPaymentStagesSchema>;

export const recordClientPaymentSchema = z.object({
  amount: positivePaiseSchema.refine((value) => value > 0n, {
    message: 'a receipt has to be for something',
  }),
  received_on: isoDateSchema,
  mode: z.enum(PAYMENT_MODES).default('bank'),
  /**
   * Null for a round sum that arrives against nothing in particular, which is most of them until
   * somebody reconciles it. It still counts against the total owed.
   */
  stage_id: uuidSchema.nullable().optional(),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
  client_id: clientIdSchema.optional(),
});
export type RecordClientPaymentInput = z.infer<typeof recordClientPaymentSchema>;

// --- approvals -------------------------------------------------------------

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const createApprovalSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(4000).default(''),
  /** The drawing or quote in question, if there is one. */
  document_id: uuidSchema.nullable().optional(),
  client_id: clientIdSchema.optional(),
});
export type CreateApprovalInput = z.infer<typeof createApprovalSchema>;

export const decideApprovalSchema = z.object({
  /**
   * `pending` is not offered. Undeciding an approval would erase the name attached to the decision,
   * which is the only thing that makes the record worth having when somebody disputes it later.
   */
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});
export type DecideApprovalInput = z.infer<typeof decideApprovalSchema>;

export const listApprovalsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(APPROVAL_STATUSES).optional(),
});
export type ListApprovalsQuery = z.infer<typeof listApprovalsQuerySchema>;
