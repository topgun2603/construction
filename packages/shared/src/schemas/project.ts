import { z } from 'zod';
import { PROJECT_STATUSES, USER_ROLES } from '../enums';
import { isoDateSchema, paiseSchema, uuidSchema } from './common';

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    client_name: z.string().trim().min(1).max(160).optional(),
    address: z.string().trim().max(500).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    start_date: isoDateSchema.optional(),
    target_end_date: isoDateSchema.optional(),
    budget_amount: paiseSchema.optional(),
    status: z.enum(PROJECT_STATUSES).default('planning'),
  })
  .refine(
    (value) =>
      !value.start_date || !value.target_end_date || value.start_date <= value.target_end_date,
    { message: 'target_end_date cannot be before start_date', path: ['target_end_date'] },
  );
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema
  .innerType()
  .partial()
  .extend({
    /*
     * Nullable on update, unlike on create. Clearing an address is a real edit — "the one we had was
     * wrong" — and omitting the key already means "leave it alone", so the two cases need different
     * representations. The service writes whatever it is handed.
     */
    address: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'no fields to update' });
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const listProjectsQuerySchema = z.object({
  status: z.enum(PROJECT_STATUSES).optional(),
  q: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const addProjectMemberSchema = z.object({
  user_id: uuidSchema,
  role_on_project: z.enum(USER_ROLES),
});
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;

export const createMilestoneSchema = z.object({
  name: z.string().trim().min(1).max(160),
  planned_date: isoDateSchema.optional(),
  actual_date: isoDateSchema.optional(),
  sort_order: z.number().int().min(0).max(10_000).default(0),
});
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;

/**
 * Every field optional, but at least one required: a PATCH that names nothing is a
 * mistake on the caller's side, not a no-op to swallow.
 *
 * `planned_date` and `actual_date` accept null explicitly — clearing a date is a
 * real edit ("this isn't done after all"), and omitting the key has to keep the
 * existing value, so the two cases cannot share a representation.
 */
export const updateMilestoneSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    planned_date: isoDateSchema.nullable().optional(),
    actual_date: isoDateSchema.nullable().optional(),
    sort_order: z.number().int().min(0).max(10_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneSchema>;

/**
 * Reordering sends the whole list of ids in their new order rather than one moved
 * id: dragging a row changes every `sort_order` after it, and a per-row PATCH would
 * leave the timeline briefly showing two milestones in the same slot.
 */
export const reorderMilestonesSchema = z.object({
  milestone_ids: z.array(uuidSchema).min(1).max(200),
});
export type ReorderMilestonesInput = z.infer<typeof reorderMilestonesSchema>;
