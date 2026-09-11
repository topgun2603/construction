import type { Permission, Plan, UserRole } from '@sitebook/shared';

/** The authenticated caller, assembled by JwtAuthGuard from the app JWT. */
export interface RequestUser {
  userId: string;
  tenantId: string;
  /**
   * The built-in role this person's role is based on. Still needed for the handful of rules
   * that are not expressible as permissions — which role they hold on a given project, and
   * the approver identity checks inside the services.
   */
  role: UserRole;
  /** The role row's display name, which for a custom role is what the owner called it. */
  roleName: string;
  /** What this person may do. Resolved per request from the role row, never from the JWT. */
  permissions: readonly Permission[];
  /**
   * Projects this user is assigned to. Empty for roles that see every project in
   * the tenant — check `seesAllProjects` rather than testing for emptiness.
   */
  projectIds: string[];
  seesAllProjects: boolean;
  plan: Plan;
  enabledModules: string[];
}

/**
 * Does this caller hold a permission?
 *
 * A helper rather than an inline `includes` so the services read as a sentence and there is
 * one place to change if permissions ever gain structure (wildcards, inheritance).
 */
export function can(user: RequestUser, permission: Permission): boolean {
  return user.permissions.includes(permission);
}

export interface AuthenticatedRequest {
  user?: RequestUser;
}
