import { z } from 'zod';
import {
  clientIdSchema,
  isoDateSchema,
  positivePaiseSchema,
  uuidSchema,
} from './common';

/**
 * Site expenses and petty cash (spec §3 item 9).
 *
 * Categories are a fixed list rather than free text: the whole point of the module
 * is the summary report, and "Diesel" / "diesel" / "fuel" as three separate rows
 * makes that report worthless.
 */
export const EXPENSE_CATEGORIES = [
  'materials',
  'transport',
  'fuel',
  'equipment_hire',
  'tools',
  'site_office',
  'utilities',
  'food',
  'permits',
  'repairs',
  'safety',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];

export const createExpenseSchema = z.object({
  project_id: uuidSchema,
  amount: positivePaiseSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  /** The day the money left, which is not always the day it was entered. */
  spent_on: isoDateSchema,
  bill_s3_key: z.string().max(512).optional(),
  note: z.string().trim().max(1000).optional(),
  client_id: clientIdSchema.optional(),
});
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    amount: positivePaiseSchema.optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
    spent_on: isoDateSchema.optional(),
    bill_s3_key: z.string().max(512).nullable().optional(),
    note: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

/** Approve or reject. There is no transition back out of either. */
export const decideExpenseSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});
export type DecideExpenseInput = z.infer<typeof decideExpenseSchema>;

export const listExpensesQuerySchema = z.object({
  project_id: uuidSchema.optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;

export const expenseSummaryQuerySchema = z.object({
  group_by: z.enum(['category', 'project']).default('category'),
  from: isoDateSchema,
  to: isoDateSchema,
  project_id: uuidSchema.optional(),
  /**
   * Pending expenses are money the builder has already spent, whether or not the
   * paperwork has cleared — so the summary counts them by default and can exclude
   * them when reconciling against approvals.
   */
  approved_only: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ExpenseSummaryQuery = z.infer<typeof expenseSummaryQuerySchema>;

/** Human label for a category, for tables and charts. */
export function expenseCategoryLabel(category: string): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
