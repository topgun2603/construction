import { z } from 'zod';
import { ACCOUNTING_CATEGORIES, ACCOUNTING_SYSTEMS, isAccountingKey } from '../accounting';
import { daysBetweenInclusive } from '../dates';
import { isoDateSchema, uuidSchema } from './common';

/** Longest period one export covers: a financial year, with a day to spare for a leap year. */
export const ACCOUNTING_MAX_EXPORT_DAYS = 366;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** `PUT /accounting/settings`: which system, and the few details each one's files need. */
export const accountingSettingsSchema = z.object({
  system: z.enum(ACCOUNTING_SYSTEMS),
  /** The two-digit GST state code of the company's own GSTIN: decides IGST against CGST + SGST. */
  gst_home_state: z
    .string()
    .trim()
    .regex(/^\d{2}$/, 'a two-digit GST state code, like 33 for Tamil Nadu')
    .nullish()
    .transform((value) => value ?? null),
  tally_company: optionalText(120),
  qbo_site_dimension: z.enum(['class', 'location']).default('class'),
  xero_tracking_name: optionalText(60),
  netsuite_subsidiary: optionalText(120),
  netsuite_site_dimension: z.enum(['department', 'class', 'location']).default('department'),
});
export type AccountingSettingsInput = z.infer<typeof accountingSettingsSchema>;

/**
 * `PUT /accounting/mappings`: rows to save for one system. A row with an empty name removes the
 * mapping, so the grid can send exactly what is on screen.
 */
export const accountingMappingSchema = z.object({
  system: z.enum(ACCOUNTING_SYSTEMS),
  rows: z
    .array(
      z.object({
        key: z.string().trim().refine(isAccountingKey, { message: 'not an account the mapping knows' }),
        code: z.string().trim().max(60).default(''),
        name: z.string().trim().max(200).default(''),
      }),
    )
    .max(2000),
});
export type AccountingMappingInput = z.infer<typeof accountingMappingSchema>;

/** `POST /accounting/mappings/defaults`: fill the unmapped keys with the suggested accounts. */
export const accountingDefaultsSchema = z.object({
  system: z.enum(ACCOUNTING_SYSTEMS),
});
export type AccountingDefaultsInput = z.infer<typeof accountingDefaultsSchema>;

/** `POST /accounting/preview` and `POST /accounting/exports`. */
export const accountingExportSchema = z
  .object({
    system: z.enum(ACCOUNTING_SYSTEMS),
    from: isoDateSchema,
    to: isoDateSchema,
    /** Empty or absent: every site the caller can see. */
    project_ids: z.array(uuidSchema).max(200).default([]),
    include: z.array(z.enum(ACCOUNTING_CATEGORIES)).min(1, 'choose at least one thing to export'),
    /** Export transactions an earlier batch already carried, too. Off unless somebody ticks it. */
    include_exported: z.boolean().default(false),
  })
  .refine((value) => value.from <= value.to, { message: 'from must not be after to', path: ['to'] })
  .refine((value) => value.from > value.to || daysBetweenInclusive(value.from, value.to) <= ACCOUNTING_MAX_EXPORT_DAYS, {
    message: `one export covers at most ${ACCOUNTING_MAX_EXPORT_DAYS} days`,
    path: ['from'],
  });
export type AccountingExportInput = z.infer<typeof accountingExportSchema>;
