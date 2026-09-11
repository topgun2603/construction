import { z } from 'zod';
import { PLANS, TENANT_STATUSES } from '../enums';
import { MODULES } from '../plans';

/**
 * The platform console's request shapes (spec §6.1, superadmin operations).
 *
 * Separate from every tenant schema on purpose: nothing here carries a tenant_id from
 * the caller's session, because a console operator has no session tenant. The tenant is
 * always an explicit path parameter.
 */

export const platformLoginSchema = z.object({
  firebase_token: z.string().min(1),
});
export type PlatformLoginInput = z.infer<typeof platformLoginSchema>;

export const listTenantsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  plan: z.enum(PLANS).optional(),
});
export type ListTenantsQuery = z.infer<typeof listTenantsQuerySchema>;

/**
 * At least one field required. A console that accepts an empty PATCH writes an audit
 * entry recording that nothing changed, which makes the trail harder to read, not
 * easier.
 */
export const updateTenantPlatformSchema = z
  .object({
    plan: z.enum(PLANS).optional(),
    status: z.enum(TENANT_STATUSES).optional(),
    enabled_modules: z.array(z.enum(MODULES)).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });
export type UpdateTenantPlatformInput = z.infer<typeof updateTenantPlatformSchema>;
