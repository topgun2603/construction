import { Injectable } from '@nestjs/common';
import {
  permissionsForSystemRole,
  systemRoleSeesAllProjects,
  type CreateRoleInput,
  type UpdateRoleInput,
  type UserRole,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { RoleCache } from '../../common/auth/role-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';

export interface RoleView {
  id: string;
  name: string;
  base_role: string;
  permissions: string[];
  sees_all_projects: boolean;
  is_system: boolean;
  /** How many people currently hold it, so the UI can warn before a delete. */
  member_count: number;
}

/**
 * Roles within one tenant.
 *
 * The five built-in roles are rows here too, marked `is_system`, and are read-only. An owner
 * able to edit the Owner role could remove `roles.manage` from themselves and then have no
 * way to put it back — the account would need support to recover. Custom roles are
 * unrestricted because every one of them is something the owner invented.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly roleCache: RoleCache,
  ) {}

  async list(actor: RequestUser): Promise<RoleView[]> {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const [roles, counts] = await Promise.all([
      db.role.findMany({
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
      db.user.groupBy({
        by: ['roleId'],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const byRole = new Map(counts.map((row) => [row.roleId, row._count._all]));
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      base_role: role.baseRole,
      /*
       * For a built-in role this is the preset from code, not the stored column — the same source
       * the guards check. Showing the stored snapshot would tell an owner their Owner role cannot
       * do something it demonstrably can.
       */
      permissions: role.isSystem
        ? [...permissionsForSystemRole(role.baseRole)]
        : role.permissions,
      sees_all_projects: role.isSystem
        ? systemRoleSeesAllProjects(role.baseRole)
        : role.seesAllProjects,
      is_system: role.isSystem,
      member_count: byRole.get(role.id) ?? 0,
    }));
  }

  async create(actor: RequestUser, input: CreateRoleInput): Promise<RoleView> {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const clash = await db.role.findFirst({ where: { name: input.name }, select: { id: true } });
    if (clash) throw ApiError.conflict(`A role called "${input.name}" already exists`);

    /*
     * A custom role cannot hold a permission its base role does not, which stops this
     * endpoint becoming a privilege-escalation route. Without it, a project manager with
     * `roles.manage` delegated to them could mint a role holding `tenant.manage`, assign it
     * to themselves, and own the account.
     *
     * The owner is exempt: they already hold everything, so there is nothing to escalate to.
     */
    const ceiling = new Set<string>(
      actor.role === 'owner' ? input.permissions : actor.permissions,
    );
    const refused = input.permissions.filter((permission) => !ceiling.has(permission));
    if (refused.length > 0) {
      throw ApiError.forbidden(
        `You cannot grant a permission you do not hold yourself: ${refused.join(', ')}`,
      );
    }

    const role = await db.role.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        baseRole: input.base_role,
        permissions: input.permissions,
        seesAllProjects: input.sees_all_projects,
        isSystem: false,
      },
    });

    return {
      id: role.id,
      name: role.name,
      base_role: role.baseRole,
      permissions: role.permissions,
      sees_all_projects: role.seesAllProjects,
      is_system: false,
      member_count: 0,
    };
  }

  async update(actor: RequestUser, id: string, input: UpdateRoleInput): Promise<RoleView> {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const existing = await db.role.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Role');
    if (existing.isSystem) {
      throw ApiError.conflict(
        `"${existing.name}" is a built-in role and cannot be edited. Create a role based on it instead.`,
      );
    }

    if (input.name && input.name !== existing.name) {
      const clash = await db.role.findFirst({
        where: { name: input.name, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw ApiError.conflict(`A role called "${input.name}" already exists`);
    }

    if (input.permissions) {
      const ceiling = new Set<string>(
        actor.role === 'owner' ? input.permissions : actor.permissions,
      );
      const refused = input.permissions.filter((permission) => !ceiling.has(permission));
      if (refused.length > 0) {
        throw ApiError.forbidden(
          `You cannot grant a permission you do not hold yourself: ${refused.join(', ')}`,
        );
      }
    }

    const role = await db.role.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
        ...(input.sees_all_projects === undefined
          ? {}
          : { seesAllProjects: input.sees_all_projects }),
      },
    });

    // Every holder's next request must see the change. Without this the edit would sit
    // behind the cache TTL, and an owner who had just removed a permission would watch it
    // keep working — which reads as the feature being broken.
    this.roleCache.invalidate(id);

    const memberCount = await db.user.count({ where: { roleId: id, deletedAt: null } });
    return {
      id: role.id,
      name: role.name,
      base_role: role.baseRole,
      permissions: role.permissions,
      sees_all_projects: role.seesAllProjects,
      is_system: role.isSystem,
      member_count: memberCount,
    };
  }

  /**
   * Delete a custom role.
   *
   * Refused while anyone holds it. The alternative — deleting and letting those people fall
   * back to their base role — moves someone's access without telling anybody, and the
   * fallback is deliberately a safety net for corrupted data, not a migration path.
   */
  async remove(actor: RequestUser, id: string): Promise<void> {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const existing = await db.role.findUnique({ where: { id } });
    if (!existing) throw ApiError.notFound('Role');
    if (existing.isSystem) {
      throw ApiError.conflict(`"${existing.name}" is a built-in role and cannot be deleted`);
    }

    const holders = await db.user.count({ where: { roleId: id, deletedAt: null } });
    if (holders > 0) {
      throw ApiError.conflict(
        `${holders} ${holders === 1 ? 'person is' : 'people are'} on "${existing.name}". Move them to another role first.`,
        { member_count: holders },
      );
    }

    await db.role.delete({ where: { id } });
    this.roleCache.invalidate(id);
  }

  /**
   * Move somebody onto a different role.
   *
   * `users.role` (the base enum) is updated to match, because project membership and the
   * service-level approver checks still read it. Keeping the two in step here is what lets
   * the rest of the codebase carry on treating `role` as meaningful.
   */
  async assign(actor: RequestUser, userId: string, roleId: string): Promise<void> {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const role = await db.role.findUnique({ where: { id: roleId } });
    if (!role) throw ApiError.notFound('Role');

    const user = await db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, roleId: true },
    });
    if (!user) throw ApiError.notFound('Team member');

    /*
     * Nobody may move themselves. An owner demoting their own account is the one change on
     * this screen with no way back: the moment it lands they no longer hold `team.manage`,
     * so they cannot undo it. Another owner has to do it.
     */
    if (userId === actor.userId) {
      throw ApiError.conflict('You cannot change your own role. Ask another owner to do it.');
    }

    // Guard the last owner the same way removal does, or an account can end up with nobody
    // who can invite, change the plan, or edit roles.
    if (user.role === 'owner' && role.baseRole !== 'owner') {
      const otherOwners = await db.user.count({
        where: { role: 'owner', deletedAt: null, id: { not: userId } },
      });
      if (otherOwners === 0) {
        throw ApiError.conflict('This is the last owner. Make somebody else an owner first.');
      }
    }

    await db.user.update({
      where: { id: userId },
      data: { roleId, role: role.baseRole as UserRole },
    });

    // Their next request must see the new role, not the one cached a moment ago.
    this.roleCache.invalidateUser(userId);
  }

  /**
   * Seed the built-in roles for a tenant that has just been created.
   *
   * Called from onboarding. Reads the presets from shared rather than repeating them, so a
   * new tenant and an existing one (seeded by migration) end up identical.
   */
  async seedSystemRoles(tenantId: string): Promise<string | null> {
    const db = this.tenantDb.clientFor(tenantId);

    const names: Record<UserRole, string> = {
      owner: 'Owner',
      project_manager: 'Project manager',
      site_supervisor: 'Site supervisor',
      accounts: 'Accounts',
      client: 'Client',
    };

    let ownerRoleId: string | null = null;
    for (const [role, name] of Object.entries(names) as Array<[UserRole, string]>) {
      const created = await db.role.create({
        data: {
          tenantId,
          name,
          baseRole: role,
          permissions: [...permissionsForSystemRole(role)],
          seesAllProjects: systemRoleSeesAllProjects(role),
          isSystem: true,
        },
        select: { id: true },
      });
      if (role === 'owner') ownerRoleId = created.id;
    }
    return ownerRoleId;
  }
}
