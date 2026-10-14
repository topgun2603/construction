import { Injectable } from '@nestjs/common';
import {
  DEFAULT_MATCH_TOLERANCE_BP,
  effectiveApprovalLimit,
  withinApprovalLimit,
  type ProcurementSettingsInput,
  type UserRole,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { RoleCache } from '../../common/auth/role-cache.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';

export interface ProcurementSettingsView {
  match_tolerance_bp: number;
  limits: Array<{
    id: string;
    role_id: string | null;
    role_name: string | null;
    user_id: string | null;
    user_name: string | null;
    /** Minor units; null is unlimited. */
    max_amount: string | null;
  }>;
  /** What the caller may approve on one order; null is unlimited. */
  my_limit: string | null;
  can_approve: boolean;
}

/**
 * Approval limits and the match tolerance: the company's procurement settings.
 *
 * A limit is an amount, not a permission. `procurement.approve` says somebody approves orders at
 * all; the limit says up to how much. Keeping them apart means a custom role can be given the
 * permission without the owner having to invent a role per spending band.
 */
@Injectable()
export class ApprovalLimitsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly roles: RoleCache,
  ) {}

  async settings(actor: RequestUser): Promise<ProcurementSettingsView> {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const [tenant, rows, myLimit] = await Promise.all([
        tx.tenant.findUniqueOrThrow({
          where: { id: actor.tenantId },
          select: { matchToleranceBp: true },
        }),
        tx.purchaseApprovalLimit.findMany({
          include: {
            role: { select: { name: true } },
            user: { select: { name: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        this.limitFor(tx, { userId: actor.userId, role: actor.role, roleId: null }),
      ]);
      return {
        match_tolerance_bp: tenant.matchToleranceBp,
        limits: rows.map((row) => ({
          id: row.id,
          role_id: row.roleId,
          role_name: row.role?.name ?? null,
          user_id: row.userId,
          user_name: row.user?.name ?? null,
          max_amount: row.maxAmount === null ? null : row.maxAmount.toString(),
        })),
        my_limit: myLimit === null ? null : myLimit.toString(),
        can_approve: can(actor, 'procurement.approve'),
      };
    });
  }

  /** Replaces the limits wholesale when given, so the screen saves what it shows. */
  async update(actor: RequestUser, input: ProcurementSettingsInput): Promise<ProcurementSettingsView> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.match_tolerance_bp !== undefined) {
        await tx.tenant.update({
          where: { id: actor.tenantId },
          data: { matchToleranceBp: input.match_tolerance_bp },
        });
      }
      if (input.limits) {
        const roleIds = input.limits.flatMap((limit) => (limit.role_id ? [limit.role_id] : []));
        const userIds = input.limits.flatMap((limit) => (limit.user_id ? [limit.user_id] : []));
        if (new Set(roleIds).size !== roleIds.length || new Set(userIds).size !== userIds.length) {
          throw ApiError.validationFailed(
            { limits: 'duplicate' },
            'Each role and each person can have only one limit',
          );
        }
        const [roles, users] = await Promise.all([
          tx.role.count({ where: { id: { in: roleIds } } }),
          tx.user.count({ where: { id: { in: userIds }, deletedAt: null } }),
        ]);
        if (roles !== roleIds.length || users !== userIds.length) {
          throw ApiError.validationFailed({ limits: 'unknown' }, 'A role or person in the list does not exist');
        }
        await tx.purchaseApprovalLimit.deleteMany({});
        if (input.limits.length > 0) {
          await tx.purchaseApprovalLimit.createMany({
            data: input.limits.map((limit) => ({
              tenantId: actor.tenantId,
              roleId: limit.role_id ?? null,
              userId: limit.user_id ?? null,
              maxAmount: limit.max_amount,
            })),
          });
        }
      }
    });
    return this.settings(actor);
  }

  async tolerance(tx: TenantTx, tenantId: string): Promise<number> {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { matchToleranceBp: true },
    });
    return tenant?.matchToleranceBp ?? DEFAULT_MATCH_TOLERANCE_BP;
  }

  /**
   * The most this person may approve on one order; null is unlimited.
   *
   * The role is read from the user row rather than trusted from the caller, so the limit always
   * matches the role the person holds now — the same rule `RoleCache` follows.
   */
  async limitFor(
    tx: TenantTx,
    who: { userId: string; role?: UserRole; roleId?: string | null },
  ): Promise<bigint | null> {
    const user = await tx.user.findUnique({
      where: { id: who.userId },
      select: { role: true, roleId: true },
    });
    const baseRole = user?.role ?? who.role;
    if (baseRole === 'owner') return null;
    const roleId = user ? user.roleId : (who.roleId ?? null);
    const rows = await tx.purchaseApprovalLimit.findMany({
      where: {
        OR: [{ userId: who.userId }, ...(roleId ? [{ roleId }] : [])],
      },
      select: { userId: true, roleId: true, maxAmount: true },
    });
    const own = rows.find((row) => row.userId === who.userId);
    const role = rows.find((row) => row.roleId !== null && row.roleId === roleId);
    return effectiveApprovalLimit({
      isOwner: false,
      userLimit: own ? own.maxAmount : undefined,
      roleLimit: role ? role.maxAmount : undefined,
    });
  }

  /**
   * Everybody who could approve an order of this value on this site: holds `procurement.approve`,
   * may see the site, and has a limit that covers it. The people to notify, and the answer to "who
   * can sign this?" when the person asking cannot.
   */
  async approversFor(
    tx: TenantTx,
    tenantId: string,
    projectId: string,
    total: bigint,
  ): Promise<Array<{ id: string; name: string }>> {
    const users = await tx.user.findMany({
      where: { status: 'active', deletedAt: null },
      select: {
        id: true,
        name: true,
        role: true,
        roleId: true,
        projectMemberships: { where: { projectId }, select: { id: true } },
      },
    });
    const limits = await tx.purchaseApprovalLimit.findMany({
      select: { userId: true, roleId: true, maxAmount: true },
    });
    const approvers: Array<{ id: string; name: string }> = [];
    for (const user of users) {
      const resolved = await this.roles.resolve(tenantId, user.roleId, user.role);
      if (!resolved.permissions.includes('procurement.approve')) continue;
      if (!resolved.seesAllProjects && user.projectMemberships.length === 0) continue;
      const own = limits.find((row) => row.userId === user.id);
      const role = limits.find((row) => row.roleId !== null && row.roleId === user.roleId);
      const limit = effectiveApprovalLimit({
        isOwner: user.role === 'owner',
        userLimit: own ? own.maxAmount : undefined,
        roleLimit: role ? role.maxAmount : undefined,
      });
      if (withinApprovalLimit(total, limit)) approvers.push({ id: user.id, name: user.name });
    }
    return approvers;
  }
}
