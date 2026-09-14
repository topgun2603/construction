import { z } from 'zod';

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
