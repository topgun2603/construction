import { z } from 'zod';
import { isoDateSchema, clientIdSchema, uuidSchema } from './common';

/**
 * Materials stock (spec §3 item 10, §7 Phase 2).
 *
 * Quantities travel as strings with at most three decimals, matching `numeric(14,3)`. A string
 * rather than a number for the same reason money does: a quantity read back as a float and
 * summed would drift from the ledger it came from.
 */
const quantitySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(
    z
      .string()
      .regex(/^\d+(?:\.\d{1,3})?$/, 'expected a quantity with at most three decimals')
      .refine((value) => Number.parseFloat(value) > 0, 'quantity must be more than zero'),
  );

/** Estimates may be zero — "we expect to use none of this" is a real statement. */
const estimateQuantitySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .pipe(z.string().regex(/^\d+(?:\.\d{1,3})?$/, 'expected a quantity with at most three decimals'));

export const recordStockMovementSchema = z.object({
  project_id: uuidSchema,
  material_id: uuidSchema,
  type: z.enum(['in', 'out']),
  quantity: quantitySchema,
  moved_on: isoDateSchema,
  /** Challan or bill number for an inward movement. Free text: every supplier differs. */
  ref: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
  client_id: clientIdSchema.optional(),
});
export type RecordStockMovementInput = z.infer<typeof recordStockMovementSchema>;

export const listStockMovementsQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  material_id: uuidSchema.optional(),
  type: z.enum(['in', 'out']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;

export const stockOnHandQuerySchema = z.object({
  project_id: uuidSchema.optional(),
});
export type StockOnHandQuery = z.infer<typeof stockOnHandQuerySchema>;

/**
 * Correcting what a delivery actually contained.
 *
 * A separate action from the status change, because the status is already right — the indent was
 * received. What is wrong is the count, and that happens: 40 bags are signed for at the gate and
 * the store finds 37. Overloading the status endpoint to also mean "and change the numbers" is how
 * that endpoint turns into a junk drawer.
 *
 * Quantities are absolute, not deltas: the person amending is looking at what is actually there,
 * not working out a difference.
 */
export const amendReceiptSchema = z.object({
  /** A corrected challan or bill number, if that was wrong too. */
  ref: z.string().trim().max(80).optional(),
  note: z.string().trim().max(500).optional(),
  items: z
    .array(
      z.object({
        material_id: uuidSchema,
        /** Zero is allowed: a line that did not arrive at all is worth recording as nil. */
        received_quantity: estimateQuantitySchema,
      }),
    )
    .min(1),
});
export type AmendReceiptInput = z.infer<typeof amendReceiptSchema>;

export const setMaterialEstimatesSchema = z.object({
  items: z
    .array(
      z.object({
        material_id: uuidSchema,
        estimated_quantity: estimateQuantitySchema,
        note: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(300),
});
export type SetMaterialEstimatesInput = z.infer<typeof setMaterialEstimatesSchema>;

export const materialOverrunQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  /** Only materials with an estimate, which is the default — the rest have nothing to exceed. */
  estimated_only: z.coerce.boolean().default(true),
});
export type MaterialOverrunQuery = z.infer<typeof materialOverrunQuerySchema>;
