import { z } from 'zod';
import { isoDateSchema, uuidSchema } from './common';

/**
 * Labour camps and the transport from them (roadmap Phase 1, item 4).
 *
 * Gulf crews live in company camps and ride a bus to site. Knowing who lives where, and how many
 * from each camp went to each site today, is what tells the transport manager how many seats each
 * bus needs tomorrow — and tells the owner who is unaccounted for.
 */
export const createCampSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(300).optional(),
  capacity: z.number().int().positive().max(100_000).optional(),
  /** The bus or route that serves it: "Bus 3 · Al Quoz → Marina", in the company's own words. */
  transport_note: z.string().trim().max(200).optional(),
});
export type CreateCampInput = z.infer<typeof createCampSchema>;

export const updateCampSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    capacity: z.number().int().positive().max(100_000).nullable().optional(),
    transport_note: z.string().trim().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateCampInput = z.infer<typeof updateCampSchema>;

/** Move these workers into the camp; each leaves whatever camp they were in. */
export const campResidentsSchema = z.object({
  worker_ids: z.array(uuidSchema).min(1).max(1000),
});
export type CampResidentsInput = z.infer<typeof campResidentsSchema>;

export const campDayQuerySchema = z.object({
  /** The day to count; the company's today when absent. */
  date: isoDateSchema.optional(),
});
