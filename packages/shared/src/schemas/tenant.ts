import { z } from 'zod';
import { PLANS } from '../enums';
import { MODULES } from '../plans';

/**
 * `POST /tenants` — onboarding. Authorised by the onboarding token handed back by
 * `/auth/exchange` for an unknown phone, so the phone is never taken from the body.
 */
export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(160),
  owner_name: z.string().trim().min(1).max(120),
  plan: z.enum(PLANS).default('three_months'),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    logo_url: z.string().url().max(2048).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/** Superadmin-only: plan and module changes are not part of the tenant-facing API. */
export const setTenantPlanSchema = z.object({
  plan: z.enum(PLANS),
  enabled_modules: z.array(z.enum(MODULES)).optional(),
});
export type SetTenantPlanInput = z.infer<typeof setTenantPlanSchema>;
