import { z } from 'zod';
import { COMPANY_GROUP_PERMISSIONS, parseCompanyGroupRate } from '../company-groups';
import { isoDateSchema, phoneSchema, uuidSchema } from './common';

/** Company groups, roadmap Phase 2, module 11. Request bodies for `/company-groups`. */

const companyGroupCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'currency must be a three-letter ISO code');

const companyGroupNameSchema = z.string().trim().min(2).max(120);

export const createCompanyGroupSchema = z.object({
  name: companyGroupNameSchema,
  /** What the consolidated total is shown in. Defaults to the founding company's own currency. */
  base_currency: companyGroupCurrencySchema.optional(),
});
export type CreateCompanyGroupInput = z.infer<typeof createCompanyGroupSchema>;

export const updateCompanyGroupSchema = z
  .object({
    name: companyGroupNameSchema.optional(),
    base_currency: companyGroupCurrencySchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.base_currency !== undefined, {
    message: 'nothing to change',
  });
export type UpdateCompanyGroupInput = z.infer<typeof updateCompanyGroupSchema>;

/**
 * Invite a company: by its id (shown to its owner on the group settings page), or by its owner's
 * mobile number. Exactly one of the two.
 */
export const companyGroupInviteSchema = z
  .object({
    tenant_id: uuidSchema.optional(),
    owner_phone: phoneSchema.optional(),
  })
  .refine((value) => (value.tenant_id === undefined) !== (value.owner_phone === undefined), {
    message: 'give either the company id or its owner’s mobile number',
  });
export type CompanyGroupInviteInput = z.infer<typeof companyGroupInviteSchema>;

/**
 * Make someone a group admin: a person in one of the group's companies, named by that company and
 * their mobile number there — never by browsing another company's team list.
 */
export const companyGroupAdminSchema = z.object({
  tenant_id: uuidSchema,
  phone: phoneSchema,
  permissions: z.array(z.enum(COMPANY_GROUP_PERMISSIONS)).min(1).max(COMPANY_GROUP_PERMISSIONS.length),
});
export type CompanyGroupAdminInput = z.infer<typeof companyGroupAdminSchema>;

export const companyGroupRateSchema = z.object({
  currency: companyGroupCurrencySchema,
  /** Units of the group's base currency per one unit of `currency`, as a decimal string. */
  rate: z
    .union([z.string(), z.number()])
    .transform((value) => String(value).trim())
    .refine((value) => parseCompanyGroupRate(value) !== null, {
      message: 'rate must be a positive number with at most ten decimal places',
    }),
  effective_from: isoDateSchema,
});
export type CompanyGroupRateInput = z.infer<typeof companyGroupRateSchema>;

export const companyGroupReportQuerySchema = z
  .object({
    /** Period for labour cost and expenses; everything else is "to date". Defaults to this month. */
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    /** One company of the group only. Refused for a company outside the caller's group. */
    tenant_id: uuidSchema.optional(),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: 'from must not be after to',
  });
export type CompanyGroupReportQuery = z.infer<typeof companyGroupReportQuerySchema>;

/** Swap the session for one in another company this person belongs to. */
export const companySwitchSchema = z.object({
  tenant_id: uuidSchema,
  /** The session being left, so it is revoked rather than left alive on the server. Optional. */
  refresh_token: z.string().min(1).max(4096).optional(),
  device_id: z.string().min(1).max(128).optional(),
});
export type CompanySwitchInput = z.infer<typeof companySwitchSchema>;
