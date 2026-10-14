import { z } from 'zod';
import { planPriceProblem } from '../plan-pricing';

/**
 * A plan's code.
 *
 * Shape only. Whether a code names a plan that exists is the server's question — the catalogue is
 * rows now, and a zod enum compiled into every client would be stale the first time an operator
 * added a term.
 */
export const planCodeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'lower case letters, digits and underscores only');

/** Creating a plan in the catalogue. */
export const createPlanSchema = z.object({
  code: planCodeSchema,
  name: z.string().trim().min(1).max(60),
  /** Null is a plan that never expires. Zero would read as one that expires immediately. */
  months: z.number().int().min(1).max(600).nullable(),
  /** Whole-term price in paise, as a decimal string like all money on the wire. */
  price: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .pipe(z.string().regex(/^\d+$/, 'a price is whole paise')),
  /**
   * The price in other currencies (roadmap Phase 0, item 7), each in its own minor units:
   * { AED: "99900" }. Rupees stay in `price`; a currency with no entry cannot subscribe online.
   */
  prices: z
    .record(
      z.string().regex(/^[A-Z]{3}$/, 'a currency is a three-letter code'),
      z
        .union([z.string(), z.number()])
        .transform((value) => String(value).trim())
        .pipe(z.string().regex(/^\d+$/, 'a price is whole minor units')),
    )
    // A code the runtime does not know, a zero, or a dinar price the card processor cannot charge
    // would all be accepted here and refused at checkout, in front of the customer.
    .superRefine((prices, ctx) => {
      for (const [currency, minor] of Object.entries(prices)) {
        const problem = planPriceProblem(currency, minor);
        if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [currency], message: problem });
      }
    })
    .optional(),
  description: z.string().trim().max(300).nullable().optional(),
  /**
   * A ribbon on the card: "Best value", "Most popular", "Premium".
   *
   * Short on purpose — it sits on top of a card on a phone, and anything longer than a couple of
   * words wraps into the price. Null is the ordinary case: a plan with no badge is not called out.
   */
  badge: z.string().trim().min(1).max(24).nullable().optional(),
  highlights: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
  is_active: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(1000).default(0),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

/**
 * Editing one. `code` is absent on purpose: it is what every tenant row points at, and renaming it
 * would orphan every account on that plan.
 */
export const updatePlanSchema = createPlanSchema
  .omit({ code: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

/**
 * An owner asking for a plan to be invoiced for bank transfer. Like a checkout, no amount: the
 * quote is the catalogue's, worked out on the server.
 */
export const planBankTransferRequestSchema = z.object({
  plan: planCodeSchema,
  /** Anything the platform team should know: the name on the invoice, a purchase order number. */
  note: z.string().trim().max(500).optional(),
});
export type PlanBankTransferRequestInput = z.infer<typeof planBankTransferRequestSchema>;

/** The console settling a request: the money arrived (the plan applies) or it never will. */
export const planBankTransferSettleSchema = z.object({
  status: z.enum(['paid', 'cancelled']),
  /** The bank's reference for the transfer, for the day somebody asks which payment this was. */
  payment_reference: z.string().trim().min(1).max(120).optional(),
});
export type PlanBankTransferSettleInput = z.infer<typeof planBankTransferSettleSchema>;

export const PLAN_BANK_TRANSFER_STATUSES = ['pending', 'paid', 'cancelled'] as const;

export const planBankTransferListQuerySchema = z.object({
  status: z.enum(PLAN_BANK_TRANSFER_STATUSES).optional(),
});
export type PlanBankTransferListQuery = z.infer<typeof planBankTransferListQuerySchema>;
