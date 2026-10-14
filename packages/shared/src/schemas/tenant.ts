import { z } from 'zod';
import { planCodeSchema } from './plan';
import { MODULES } from '../plans';
import { tenantLocaleSchema } from '../locale';
import { MUDAD_ESTABLISHMENT_PATTERN } from '../mudad';

/**
 * `POST /tenants` — onboarding. Authorised by the onboarding token handed back by
 * `/auth/exchange` for an unknown phone, so the phone is never taken from the body.
 *
 * **No `plan` field, deliberately.** It used to be here with a default, and the server put the
 * account on whatever the body said — so anybody who could pass OTP with an unregistered number
 * could ask for `lifetime` and be given the most expensive plan in the catalogue for nothing. An
 * unknown code was worse still: the term length of a plan that does not exist is null, which is
 * also how lifetime is spelled, so a typo bought a lifetime account too.
 *
 * Which term a new account starts on is a commercial decision, so the server makes it from the
 * catalogue. Zod strips unknown keys, so a client still sending `plan` is ignored rather than
 * rejected.
 */
export const createTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    owner_name: z.string().trim().min(1).max(120),
  })
  // Each locale setting is optional and the database defaults are India's, so an onboarding
  // request that sends none of them makes exactly the company it always did.
  .merge(tenantLocaleSchema.partial());
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    logo_url: z.string().url().max(2048).nullable().optional(),
    /** UAE WPS: the 13-digit MOL establishment id, printed on every salary file. */
    wps_employer_id: z
      .string()
      .trim()
      .regex(/^[0-9]{13}$/, 'the MOL establishment id is 13 digits')
      .nullable()
      .optional(),
    /** UAE WPS: routing code of the bank or exchange house that pays the salaries. */
    wps_bank_code: z
      .string()
      .trim()
      .regex(/^[0-9]{9}$/, 'a routing code is 9 digits')
      .nullable()
      .optional(),
    /**
     * Saudi WPS (Mudad): the MHRSD establishment number — labour office id, a dash, the
     * establishment's sequence ("1-123456") — printed on every payroll file.
     */
    mudad_establishment_id: z
      .string()
      .trim()
      .regex(MUDAD_ESTABLISHMENT_PATTERN, 'the establishment number looks like 1-123456')
      .nullable()
      .optional(),
  })
  /*
   * Every locale setting, `currency` included — but the service refuses a currency change once
   * the company has recorded any money. Stored amounts are counts of minor units in the company's
   * currency, so changing it then would silently re-read every rupee figure as dirhams.
   */
  .merge(tenantLocaleSchema.partial())
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/** Superadmin-only: plan and module changes are not part of the tenant-facing API. */
export const setTenantPlanSchema = z.object({
  plan: planCodeSchema,
  enabled_modules: z.array(z.enum(MODULES)).optional(),
});
export type SetTenantPlanInput = z.infer<typeof setTenantPlanSchema>;
