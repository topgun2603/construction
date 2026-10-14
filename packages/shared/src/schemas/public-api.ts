import { z } from 'zod';
import {
  PUBLIC_API_MAX_KEY_CIDRS,
  PUBLIC_API_PAGE_SIZE,
  PUBLIC_API_SCOPES,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_URL_MAX_LENGTH,
} from '../public-api';
import { ipNormaliseCidr } from '../security';
import { isoDateSchema, uuidSchema } from './common';
import { EXPENSE_CATEGORIES } from './expenses';

// ---------------------------------------------------------------------------------------------
// Settings → Developers (session-authenticated, owner only)
// ---------------------------------------------------------------------------------------------

/** `POST /developers/api-keys`. */
export const publicApiKeyCreateSchema = z.object({
  /** What it is for — "Tally sync", "Power BI" — so the list and the audit log say something useful. */
  name: z.string().trim().min(1).max(80),
  scopes: z
    .array(z.enum(PUBLIC_API_SCOPES))
    .min(1, 'choose at least one scope')
    .transform((scopes) => [...new Set(scopes)]),
  /** ISO date-time; absent or null for a key that does not expire. Must be in the future. */
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  /** Addresses or blocks the key may be used from. Empty: wherever the company's own rules allow. */
  allowed_cidrs: z
    .array(
      z
        .string()
        .max(64)
        .transform((value, ctx) => {
          const cidr = ipNormaliseCidr(value);
          if (!cidr) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'expected an address or block like 203.0.113.0/24',
            });
            return z.NEVER;
          }
          return cidr;
        }),
    )
    .max(PUBLIC_API_MAX_KEY_CIDRS)
    .default([]),
});
export type PublicApiKeyCreateInput = z.infer<typeof publicApiKeyCreateSchema>;

/** `POST /developers/webhooks`. */
export const webhookEndpointCreateSchema = z.object({
  url: z.string().trim().min(1).max(WEBHOOK_URL_MAX_LENGTH),
  description: z.string().trim().max(200).optional(),
  events: z
    .array(z.enum(WEBHOOK_EVENT_TYPES))
    .min(1, 'choose at least one event')
    .transform((events) => [...new Set(events)]),
});
export type WebhookEndpointCreateInput = z.infer<typeof webhookEndpointCreateSchema>;

/** `PATCH /developers/webhooks/:id`. `status: 'active'` switches back on one that was switched off. */
export const webhookEndpointUpdateSchema = z
  .object({
    url: z.string().trim().min(1).max(WEBHOOK_URL_MAX_LENGTH).optional(),
    description: z.string().trim().max(200).nullable().optional(),
    events: z
      .array(z.enum(WEBHOOK_EVENT_TYPES))
      .min(1, 'choose at least one event')
      .transform((events) => [...new Set(events)])
      .optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type WebhookEndpointUpdateInput = z.infer<typeof webhookEndpointUpdateSchema>;

// ---------------------------------------------------------------------------------------------
// The public API itself (`/public/v1`)
// ---------------------------------------------------------------------------------------------

/** Every list: a page size, the cursor from the last page, and "changed since" for syncing. */
export const publicApiListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PUBLIC_API_PAGE_SIZE.max).default(PUBLIC_API_PAGE_SIZE.default),
  /** Opaque: `next_cursor` from the previous page. */
  cursor: z.string().max(200).optional(),
  /** ISO date-time. Only records changed at or after it, oldest change first. */
  updated_since: z.string().datetime({ offset: true }).optional(),
});
export type PublicApiListQuery = z.infer<typeof publicApiListQuerySchema>;

export const publicApiProjectScopedQuerySchema = publicApiListQuerySchema.extend({
  project_id: uuidSchema.optional(),
});
export type PublicApiProjectScopedQuery = z.infer<typeof publicApiProjectScopedQuerySchema>;

export const publicApiAttendanceQuerySchema = publicApiProjectScopedQuerySchema.extend({
  /** Inclusive. Both required: attendance is read a range at a time. */
  from: isoDateSchema,
  to: isoDateSchema,
});
export type PublicApiAttendanceQuery = z.infer<typeof publicApiAttendanceQuerySchema>;

export const publicApiExpenseQuerySchema = publicApiProjectScopedQuerySchema.extend({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type PublicApiExpenseQuery = z.infer<typeof publicApiExpenseQuerySchema>;

/** Integer minor units (paise, fils, cents), as a JSON number or a string of digits. */
const minorUnitsSchema = z
  .union([z.number().int(), z.string().regex(/^\d+$/)])
  .transform((value) => BigInt(value))
  .refine((value) => value >= 0n, { message: 'cannot be negative' });

/** `POST /public/v1/expenses`. */
export const publicApiExpenseCreateSchema = z
  .object({
    project_id: uuidSchema,
    amount: minorUnitsSchema.refine((value) => value > 0n, { message: 'must be more than zero' }),
    /** Optional, but when sent it must be the company's own currency — nothing is converted. */
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    category: z.enum(EXPENSE_CATEGORIES),
    spent_on: isoDateSchema,
    note: z.string().trim().max(1000).optional(),
    tax_amount: minorUnitsSchema.optional(),
    supplier_tax_id: z.string().trim().max(30).optional(),
    cost_code_id: uuidSchema.optional(),
    /** The person in the company the spend is filed under. Default: the owner who made the key. */
    submitted_by: uuidSchema.optional(),
  })
  .refine((value) => value.tax_amount === undefined || value.tax_amount <= value.amount, {
    message: 'the tax cannot be more than the amount it is part of',
    path: ['tax_amount'],
  });
export type PublicApiExpenseCreateInput = z.infer<typeof publicApiExpenseCreateSchema>;
