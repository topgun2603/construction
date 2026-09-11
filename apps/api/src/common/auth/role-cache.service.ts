import { Injectable } from '@nestjs/common';
import {
  isPermission,
  permissionsForSystemRole,
  systemRoleSeesAllProjects,
  type Permission,
  type UserRole,
} from '@sitebook/shared';
import { env } from '../../config/env';
import { TenantDb } from '../prisma/tenant-db.service';

export interface ResolvedRole {
  id: string | null;
  name: string;
  permissions: readonly Permission[];
  seesAllProjects: boolean;
}

interface CacheEntry {
  value: ResolvedRole;
  expiresAt: number;
}

/**
 * Resolves a user's role row into the permissions the guards check.
 *
 * Cached in process for a few seconds, like `TenantCache` and for the same reason: this
 * runs on every authenticated request and a role changes a few times a year. The short TTL
 * is also what makes a permission change take effect without waiting out a 15-minute access
 * token — the token carries a role id, never the permission list itself.
 *
 * That distinction matters. If permissions travelled in the JWT, revoking one would leave a
 * signed token asserting it for another quarter of an hour, and there would be nothing the
 * owner could do about it from the UI.
 *
 * For the same reason *which* role a person holds is read from the user row rather than
 * taken from the token. The token's `role_id` is only a fallback for the brief window where
 * the user row cannot be read. Moving somebody between roles has to behave like editing a
 * role does — immediately — or the two halves of the same screen disagree about whether a
 * change has landed.
 */
@Injectable()
export class RoleCache {
  private readonly ttlMs = env().TENANT_CACHE_TTL_SECONDS * 1000;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly byUser = new Map<string, { value: ResolvedRole; expiresAt: number }>();

  constructor(private readonly tenantDb: TenantDb) {}

  /**
   * The role a given user holds right now.
   *
   * One extra cached read per request, alongside the tenant lookup the guard already does.
   * It buys correctness: an owner who moves somebody onto a narrower role sees it apply on
   * that person's next request rather than up to fifteen minutes later.
   */
  async resolveForUser(
    tenantId: string,
    userId: string,
    tokenRoleId: string | null,
    baseRole: UserRole,
  ): Promise<ResolvedRole> {
    const cached = this.byUser.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const user = await this.tenantDb.clientFor(tenantId).user.findUnique({
      where: { id: userId },
      select: { roleId: true, role: true },
    });

    // No row is not this layer's problem to report — JwtAuthGuard has already established
    // the tenant, and a missing user surfaces as a 401 from `/me`. Fall back to the token so
    // the request fails on its own terms rather than on a null dereference here.
    const roleId = user ? user.roleId : tokenRoleId;
    const effectiveBase = user ? user.role : baseRole;

    const resolved = await this.resolve(tenantId, roleId, effectiveBase);
    this.byUser.set(userId, { value: resolved, expiresAt: Date.now() + this.ttlMs });
    return resolved;
  }

  /** Called when somebody is moved onto a different role. */
  invalidateUser(userId: string): void {
    this.byUser.delete(userId);
  }

  /**
   * `roleId` is null for a user created before roles existed, or one whose custom role was
   * deleted. Both fall back to the built-in preset for their base role, so a person is
   * never left with no permissions at all — they keep exactly the access the product
   * shipped with, which is a safe floor rather than a lockout.
   */
  async resolve(
    tenantId: string,
    roleId: string | null,
    baseRole: UserRole,
  ): Promise<ResolvedRole> {
    if (!roleId) return fallback(baseRole);

    const cached = this.entries.get(roleId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.tenantDb.clientFor(tenantId).role.findUnique({
      where: { id: roleId },
      select: {
        id: true,
        name: true,
        permissions: true,
        seesAllProjects: true,
        isSystem: true,
        baseRole: true,
      },
    });
    if (!row) {
      this.entries.delete(roleId);
      return fallback(baseRole);
    }

    /*
     * A built-in role is defined by code, not by its stored column.
     *
     * The row is seeded once, so a permission added to the catalogue later would never reach it —
     * which is exactly what happened when stock shipped: every existing tenant's Owner role was a
     * snapshot taken before those permissions existed, and the owner was refused access to their
     * own new feature. Reading the preset here means adding a permission applies everywhere
     * immediately, with nothing to migrate and no way for the two to drift.
     *
     * The stored array is kept in step by migration anyway, so the table is not misleading to
     * anything reading it directly — but it is not what authorises a request.
     */
    const value: ResolvedRole = row.isSystem
      ? {
          id: row.id,
          name: row.name,
          permissions: permissionsForSystemRole(row.baseRole),
          seesAllProjects: systemRoleSeesAllProjects(row.baseRole),
        }
      : {
          id: row.id,
          name: row.name,
          // Filtered rather than cast: a permission removed from the catalogue in a later release
          // would otherwise linger in a custom role and be checked against nothing.
          permissions: row.permissions.filter(isPermission),
          seesAllProjects: row.seesAllProjects,
        };
    this.entries.set(roleId, { value, expiresAt: Date.now() + this.ttlMs });
    return value;
  }

  /**
   * Called after a role is edited, so the change lands immediately on this instance.
   *
   * The per-user entries are cleared wholesale rather than tracked back to their role: the
   * map is small, editing a role is rare, and a stale entry here means somebody keeps a
   * permission the owner has just taken away.
   */
  invalidate(roleId: string): void {
    this.entries.delete(roleId);
    this.byUser.clear();
  }
}

function fallback(baseRole: UserRole): ResolvedRole {
  return {
    id: null,
    name: baseRole,
    permissions: permissionsForSystemRole(baseRole),
    seesAllProjects: systemRoleSeesAllProjects(baseRole),
  };
}
