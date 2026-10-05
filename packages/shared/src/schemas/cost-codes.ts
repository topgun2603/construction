import { z } from 'zod';
import { COST_CODE_PATTERN, STANDARD_TEMPLATE_ID } from '../cost-codes';
import { positivePaiseSchema, uuidSchema } from './common';

/**
 * Cost codes, budgets and the company's template library (roadmap Phase 2, module 1).
 */
export const costCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(COST_CODE_PATTERN, 'letters and digits, in parts joined by "." or "-", like 03.20');

const nameSchema = z.string().trim().min(1).max(120);
const unitSchema = z.string().trim().min(1).max(20);

export const createCostCodeSchema = z.object({
  code: costCodeSchema,
  name: nameSchema,
  parent_id: uuidSchema.nullable().optional(),
  unit: unitSchema.optional(),
  budget: positivePaiseSchema.optional(),
  /** Labour on the site that is not booked anywhere else lands on this line. One per site. */
  labour_default: z.boolean().optional(),
});
export type CreateCostCodeInput = z.infer<typeof createCostCodeSchema>;

export const updateCostCodeSchema = z
  .object({
    code: costCodeSchema.optional(),
    name: nameSchema.optional(),
    parent_id: uuidSchema.nullable().optional(),
    unit: unitSchema.nullable().optional(),
    budget: positivePaiseSchema.optional(),
    labour_default: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateCostCodeInput = z.infer<typeof updateCostCodeSchema>;

/** The built-in template's id, or one of the company's own. */
export const costCodeTemplateIdSchema = z.union([z.literal(STANDARD_TEMPLATE_ID), uuidSchema]);

export const applyCostCodeTemplateSchema = z.object({ template_id: costCodeTemplateIdSchema });
export type ApplyCostCodeTemplateInput = z.infer<typeof applyCostCodeTemplateSchema>;

/** One row of a sheet, already parsed by `parseCostCodeCsv`. `budget` in minor units. */
export const costCodeImportRowSchema = z.object({
  code: costCodeSchema,
  name: nameSchema,
  parent_code: costCodeSchema.nullable().optional(),
  unit: unitSchema.nullable().optional(),
  budget: positivePaiseSchema.nullable().optional(),
});

/**
 * Codes and budgets from a spreadsheet. Matched on code: a code the site already has is updated
 * (name, unit, and the budget when the sheet gives one), anything new is added.
 */
export const importCostCodesSchema = z.object({
  rows: z.array(costCodeImportRowSchema).min(1).max(2000),
});
export type ImportCostCodesInput = z.infer<typeof importCostCodesSchema>;

export const costCodeTemplateItemSchema = z.object({
  code: costCodeSchema,
  name: nameSchema,
  parent_code: costCodeSchema.nullable().optional(),
  unit: unitSchema.nullable().optional(),
});
export type CostCodeTemplateItemInput = z.infer<typeof costCodeTemplateItemSchema>;

/**
 * A new template: empty, a copy of another (the built-in one included), a copy of a site's codes,
 * or the items given. At most one source.
 */
export const createCostCodeTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).optional(),
    items: z.array(costCodeTemplateItemSchema).max(2000).optional(),
    from_template_id: costCodeTemplateIdSchema.optional(),
    from_project_id: uuidSchema.optional(),
  })
  .refine(
    (value) =>
      [value.items, value.from_template_id, value.from_project_id].filter((v) => v !== undefined)
        .length <= 1,
    { message: 'give items, a template or a site to copy — not more than one' },
  );
export type CreateCostCodeTemplateInput = z.infer<typeof createCostCodeTemplateSchema>;

/** `items`, when given, replaces the template's lines wholesale — the editor saves the list. */
export const updateCostCodeTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    items: z.array(costCodeTemplateItemSchema).max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateCostCodeTemplateInput = z.infer<typeof updateCostCodeTemplateSchema>;
