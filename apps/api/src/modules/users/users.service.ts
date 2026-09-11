import { Injectable } from '@nestjs/common';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';

export interface SelfView {
  user: {
    id: string;
    name: string;
    phone: string;
    role: string;
    status: string;
  };
  tenant: {
    id: string;
    name: string;
    logo_url: string | null;
    plan: string;
  };
  enabled_modules: string[];
  /**
   * What this person may do. The web gates its UI on these rather than on the role name, so
   * a custom role hides and shows exactly what the API would allow.
   */
  permissions: string[];
  /** The role's display name, which for a custom role is whatever the owner called it. */
  role_name: string;
  /** Empty when the role sees every project; `sees_all_projects` says which. */
  project_ids: string[];
  sees_all_projects: boolean;
  unread_notifications: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly tenantDb: TenantDb) {}

  async describeSelf(actor: RequestUser): Promise<SelfView> {
    const db = this.tenantDb.clientFor(actor.tenantId);

    const [user, tenant, unread] = await Promise.all([
      db.user.findFirst({
        where: { id: actor.userId, deletedAt: null },
        select: { id: true, name: true, phone: true, role: true, status: true },
      }),
      db.tenant.findUnique({
        where: { id: actor.tenantId },
        select: { id: true, name: true, logoUrl: true, plan: true },
      }),
      db.notification.count({ where: { userId: actor.userId, readAt: null } }),
    ]);

    // A token whose subject no longer exists is an invalid token, not a missing
    // resource. Returning 404 here made clients treat a dead session as a broken
    // page; 401 tells them to sign in again, which is the actual remedy.
    if (!user || !tenant) throw ApiError.invalidToken('This session is no longer valid');

    return {
      user,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        logo_url: tenant.logoUrl,
        plan: tenant.plan,
      },
      enabled_modules: actor.enabledModules,
      permissions: [...actor.permissions],
      role_name: actor.roleName,
      project_ids: actor.projectIds,
      sees_all_projects: actor.seesAllProjects,
      unread_notifications: unread,
    };
  }

  /**
   * FCM tokens are a set on the user row (spec §11). Re-registering the same token
   * is a no-op rather than a duplicate, because Android re-registers on every
   * app start.
   */
  async addFcmToken(actor: RequestUser, token: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: actor.userId, deletedAt: null },
        select: { fcmTokens: true },
      });
      if (!user) throw ApiError.notFound('User');
      if (user.fcmTokens.includes(token)) return;

      await tx.user.update({
        where: { id: actor.userId },
        data: { fcmTokens: { push: token } },
      });
    });
  }

  async removeFcmToken(actor: RequestUser, token: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: actor.userId, deletedAt: null },
        select: { fcmTokens: true },
      });
      if (!user) throw ApiError.notFound('User');

      await tx.user.update({
        where: { id: actor.userId },
        data: { fcmTokens: user.fcmTokens.filter((existing) => existing !== token) },
      });
    });
  }
}
