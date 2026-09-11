import { z } from 'zod';
import { USER_ROLES } from '../enums';
import { PERMISSIONS } from '../permissions';
import { uuidSchema } from './common';

/**
 * Owner-defined roles.
 *
 * `base_role` is required and cannot be `owner`: a custom role is described in terms of the
 * built-in role it behaves like underneath, because two things are not expressible as
 * permissions — which role a person holds on a given project, and the approver identity
 * checks inside the services. Allowing a custom role to base itself on `owner` would be a
 * way to mint a second full administrator while appearing to create something narrower.
 */
const baseRoleSchema = z.enum(USER_ROLES).refine((role) => role !== 'owner', {
  message: 'a custom role cannot be based on owner',
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  base_role: baseRoleSchema,
  permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length),
  sees_all_projects: z.boolean().default(false),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length).optional(),
    sees_all_projects: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'nothing to update' });
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

/** Moving somebody onto a different role. */
export const assignRoleSchema = z.object({
  role_id: uuidSchema,
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
