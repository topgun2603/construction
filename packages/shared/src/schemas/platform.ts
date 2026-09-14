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

/**
 * Deleting a tenant asks for its name back.
 *
 * Not a checkbox: an operator working down a list of accounts can tick one without reading which
 * row they are on, and typing "Green Acres LLP" cannot be done without looking.
 */
export const deleteTenantSchema = z.object({
  confirm_name: z.string().trim().min(1).max(200),
});
export type DeleteTenantInput = z.infer<typeof deleteTenantSchema>;

/**
 * Granting console access to somebody who is not named in the deployment config.
 *
 * The phone is normalised server-side against the same rule every other number in the product
 * goes through, so an operator typing +91 98765 43210 and the OTP that later arrives for
 * 9876543210 are the same person.
 */
export const grantOperatorSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  name: z.string().trim().max(120).optional(),
});
export type GrantOperatorInput = z.infer<typeof grantOperatorSchema>;

/**
 * Creating an account from the console.
 *
 * The path a builder takes is OTP then onboarding, and it stays the primary one. This exists for
 * the calls that do not go that way: a customer who paid by cheque and wants the account ready
 * before they first sign in, a demo for a sales conversation, an account being recreated after a
 * mistake.
 *
 * The owner is named by phone and created `pending` — nobody is signed in, and the number becomes
 * a working login the first time its owner passes OTP. No password is set because the product has
 * none.
 */
export const createTenantPlatformSchema = z.object({
  name: z.string().trim().min(2).max(160),
  owner_name: z.string().trim().min(1).max(120),
  owner_phone: z.string().trim().min(6).max(20),
  plan: z.enum(PLANS).default('three_months'),
});
export type CreateTenantPlatformInput = z.infer<typeof createTenantPlatformSchema>;
