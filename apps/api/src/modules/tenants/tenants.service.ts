import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  defaultModulesForPlan,
  planExpiryFrom,
  permissionsForSystemRole,
  systemRoleSeesAllProjects,
  type CreateTenantInput,
  type InviteUserInput,
  type TokenPair,
  type UpdateTenantInput,
  type UserRole,
} from '@sitebook/shared';
import { TenantCache } from '../../common/auth/tenant-cache.service';
import { TokenService } from '../../common/auth/token.service';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import type { RequestUser } from '../../common/auth/request-user';
import { AuthService } from '../auth/auth.service';

export interface TenantView {
  id: string;
  name: string;
  logo_url: string | null;
  plan: string;
  enabled_modules: string[];
  status: string;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantDb: TenantDb,
    private readonly tenantCache: TenantCache,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
  ) {}

  /**
   * Tenant onboarding (spec §6.2 step 3). Authorised by the onboarding token from
   * `/auth/exchange`, so the phone comes from a signature rather than the body.
   *
   * The tenant id is generated here rather than by the database default: RLS is
   * FORCE'd on `tenants`, so the row can only be inserted once `app.tenant_id`
   * already equals the id being inserted. Knowing the id first is what makes the
   * first write possible at all.
   */
  async onboard(
    onboardingToken: string,
    input: CreateTenantInput,
    context: { deviceId?: string; userAgent?: string },
  ): Promise<{ tenant: TenantView; tokens: TokenPair }> {
    const { phone } = this.tokens.verifyOnboardingToken(onboardingToken);

    // Re-check rather than trusting the token's age: a second device could have
    // completed onboarding for this phone in the meantime.
    const existing = await this.prisma.authIdentity.findFirst({ where: { phone } });
    if (existing) throw ApiError.phoneAlreadyRegistered();

    const tenantId = randomUUID();

    const { tenant, ownerId } = await this.tenantDb.transaction(tenantId, async (tx) => {
      const created = await tx.tenant.create({
        data: {
          id: tenantId,
          name: input.name,
          plan: input.plan,
          // The term starts the moment the account does. Without these two an account would have
          // no expiry at all, which reads as lifetime — the most expensive plan, given away.
          planStartedOn: new Date(),
          planExpiresOn: planExpiryFrom(input.plan, new Date()),
          enabledModules: defaultModulesForPlan(input.plan),
        },
        select: selectTenant,
      });

      /*
       * The built-in roles are rows, so a new tenant gets them here — in the same
       * transaction as the tenant itself. A tenant without them would have every user
       * falling back to the hardcoded presets, which works, but its owner could not create
       * a custom role without a role list to base it on.
       */
      const roleIdByBase = new Map<UserRole, string>();
      for (const [base, name] of SYSTEM_ROLE_NAMES) {
        const row = await tx.role.create({
          data: {
            tenantId,
            name,
            baseRole: base,
            permissions: [...permissionsForSystemRole(base)],
            seesAllProjects: systemRoleSeesAllProjects(base),
            isSystem: true,
          },
          select: { id: true },
        });
        roleIdByBase.set(base, row.id);
      }

      const owner = await tx.user.create({
        data: {
          tenantId,
          phone,
          name: input.owner_name,
          role: 'owner',
          roleId: roleIdByBase.get('owner') ?? null,
          // The owner proved this phone via OTP moments ago; there is nothing to
          // activate later.
          status: 'active',
        },
        select: { id: true },
      });

      return { tenant: created, ownerId: owner.id };
    });

    const tokens = await this.auth.issueSession({
      tenantId,
      userId: ownerId,
      deviceId: context.deviceId,
      userAgent: context.userAgent,
    });

    return { tenant: toView(tenant), tokens };
  }

  async get(tenantId: string): Promise<TenantView> {
    const tenant = await this.tenantDb
      .clientFor(tenantId)
      .tenant.findUnique({ where: { id: tenantId }, select: selectTenant });
    if (!tenant) throw ApiError.notFound('Tenant');
    return toView(tenant);
  }

  async update(tenantId: string, input: UpdateTenantInput): Promise<TenantView> {
    const tenant = await this.tenantDb.clientFor(tenantId).tenant.update({
      where: { id: tenantId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.logo_url === undefined ? {} : { logoUrl: input.logo_url }),
      },
      select: selectTenant,
    });
    // Name and logo are not cached, but plan changes land here later; keeping the
    // invalidation next to every tenant write means it cannot be forgotten then.
    this.tenantCache.invalidate(tenantId);
    return toView(tenant);
  }

  /**
   * Team invite (spec §6.2 step 4). Creates the user in `pending`; their first
   * successful OTP login activates them. No SMS is sent here — the person is told
   * out of band and simply signs in with their number.
   */
  async invite(
    actor: RequestUser,
    input: InviteUserInput,
  ): Promise<{ id: string; phone: string; role: string; status: string }> {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const clash = await tx.user.findFirst({
        where: { phone: input.phone, deletedAt: null },
        select: { id: true },
      });
      if (clash) throw ApiError.phoneAlreadyRegistered();

      /*
       * Invites name a built-in role, so the matching system row is attached. Putting
       * somebody on a *custom* role is a second step (PATCH /roles/members/:userId) rather
       * than a field here: the invite form asks "what do they do", and choosing between
       * five familiar jobs is a different question from picking one of the roles this
       * company happens to have invented.
       */
      const systemRole = await tx.role.findFirst({
        where: { baseRole: input.role, isSystem: true },
        select: { id: true },
      });

      const user = await tx.user.create({
        data: {
          tenantId: actor.tenantId,
          phone: input.phone,
          name: input.name,
          role: input.role,
          roleId: systemRole?.id ?? null,
          status: 'pending',
        },
        select: { id: true, phone: true, role: true, status: true },
      });

      if (input.project_ids.length > 0) {
        // Only projects that exist in this tenant survive the RLS-scoped read, so a
        // forged id silently drops out instead of creating a dangling membership.
        const projects = await tx.project.findMany({
          where: { id: { in: input.project_ids }, deletedAt: null },
          select: { id: true },
        });
        await tx.projectMember.createMany({
          data: projects.map((project) => ({
            tenantId: actor.tenantId,
            projectId: project.id,
            userId: user.id,
            roleOnProject: input.role,
          })),
          skipDuplicates: true,
        });
      }

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'user.invited',
          entity: 'users',
          entityId: user.id,
          after: { phone: input.phone, role: input.role },
        },
      });

      return user;
    });
  }

  /**
   * Remove a team member.
   *
   * Soft delete, and the `users_sync_auth_identity` trigger drops their row from
   * `auth_identities` the moment `deleted_at` is set, so they stop resolving to a
   * tenant at sign-in. Their refresh tokens are revoked explicitly as well —
   * otherwise the one already on their phone keeps minting access tokens for 30 days
   * after you removed them, which is the whole point of removing them.
   *
   * Two refusals, both about not locking the tenant out of itself:
   *
   * - You cannot remove yourself. An owner doing this by accident has no way back in.
   * - You cannot remove the last owner. Somebody has to be able to invite, change the
   *   plan, and sign the next person in.
   *
   * History stays: attendance, expenses and reports reference the user id, and the
   * wage snapshots that matter for money were copied onto their own rows at the time.
   */
  async removeTeamMember(actor: RequestUser, userId: string): Promise<void> {
    if (userId === actor.userId) {
      throw ApiError.conflict(
        'You cannot remove your own account. Ask another owner to do it.',
      );
    }

    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { id: true, name: true, role: true },
      });
      if (!user) throw ApiError.notFound('Team member');

      if (user.role === 'owner') {
        const otherOwners = await tx.user.count({
          where: { role: 'owner', deletedAt: null, id: { not: userId } },
        });
        if (otherOwners === 0) {
          throw ApiError.conflict(
            'This is the last owner. Make somebody else an owner first.',
          );
        }
      }

      await tx.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
      // Memberships are a live assignment, not history, so they go rather than linger
      // and keep the person counted on a project roster.
      await tx.projectMember.deleteMany({ where: { userId } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorId: actor.userId,
          action: 'user.removed',
          entity: 'users',
          entityId: userId,
          before: { name: user.name, role: user.role },
        },
      });
    });
  }

  async listTeam(tenantId: string) {
    const users = await this.tenantDb.clientFor(tenantId).user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, phone: true, role: true, status: true, lastLogin: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    return users.map((user) => ({
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      last_login: user.lastLogin?.toISOString() ?? null,
    }));
  }
}

const selectTenant = {
  id: true,
  name: true,
  logoUrl: true,
  plan: true,
  enabledModules: true,
  status: true,
} as const;

type TenantRow = {
  id: string;
  name: string;
  logoUrl: string | null;
  plan: string;
  enabledModules: string[];
  status: string;
};

function toView(tenant: TenantRow): TenantView {
  return {
    id: tenant.id,
    name: tenant.name,
    logo_url: tenant.logoUrl,
    plan: tenant.plan,
    enabled_modules: tenant.enabledModules,
    status: tenant.status,
  };
}

/**
 * Display names for the built-in roles, in the order they should appear.
 *
 * The permission lists come from `permissionsForSystemRole`, so there is exactly one
 * definition of what each built-in role can do.
 */
/**
 * The built-in roles every tenant gets as rows, and what they are called.
 *
 * Exported because the platform console creates tenants too, and a second copy of this list would
 * mean an account made from the console had differently-named roles from one made by signing up.
 */
export const SYSTEM_ROLE_NAMES: ReadonlyArray<[UserRole, string]> = [
  ['owner', 'Owner'],
  ['project_manager', 'Project manager'],
  ['site_supervisor', 'Site supervisor'],
  ['accounts', 'Accounts'],
  ['client', 'Client'],
];
