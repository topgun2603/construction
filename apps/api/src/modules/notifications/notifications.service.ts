import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { UserRole } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { FcmService } from '../../integrations/fcm.service';

export interface NotifyInput {
  tenantId: string;
  /** Explicit recipients. Combined with `roles` and `projectId` if those are set. */
  userIds?: string[];
  /** Everyone in the tenant holding one of these roles. */
  roles?: UserRole[];
  /** Narrows a role fan-out to the people assigned to this project. */
  projectId?: string;
  type: string;
  title: string;
  body: string;
  payload?: Prisma.InputJsonValue;
  /** Do not notify the person who caused the event. */
  exceptUserId?: string;
}

export interface NotifyResult {
  recipients: number;
  pushed: number;
  prunedTokens: number;
}

/**
 * In-app notifications plus push (spec §11).
 *
 * One call writes the `notifications` rows *and* sends FCM, because the two must
 * not drift: a push the app never records leaves nothing to open, and a row with
 * no push is a badge nobody sees until they next launch.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly fcm: FcmService,
  ) {}

  async notify(input: NotifyInput): Promise<NotifyResult> {
    return this.tenantDb.transaction(input.tenantId, async (tx) => {
      const targeted = new Set(input.userIds ?? []);

      if (input.roles && input.roles.length > 0) {
        const byRole = await tx.user.findMany({
          where: {
            role: { in: input.roles },
            status: 'active',
            deletedAt: null,
            // A supervisor should only hear about the sites they are on.
            ...(input.projectId
              ? { projectMemberships: { some: { projectId: input.projectId } } }
              : {}),
          },
          select: { id: true },
        });
        for (const user of byRole) targeted.add(user.id);
      }

      if (input.exceptUserId) targeted.delete(input.exceptUserId);
      const recipients = [...targeted];
      if (recipients.length === 0) return { recipients: 0, pushed: 0, prunedTokens: 0 };

      await tx.notification.createMany({
        data: recipients.map((userId) => ({
          tenantId: input.tenantId,
          userId,
          type: input.type,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
        })),
      });

      const devices = await tx.user.findMany({
        where: { id: { in: recipients } },
        select: { id: true, fcmTokens: true },
      });
      const tokens = devices.flatMap((device) => device.fcmTokens);

      const push = await this.fcm.push({
        tokens,
        title: input.title,
        body: input.body,
        data: { type: input.type, ...(input.projectId ? { project_id: input.projectId } : {}) },
      });

      // Drop tokens FCM has told us are dead, so they are not retried forever.
      let pruned = 0;
      if (push.staleTokens.length > 0) {
        const stale = new Set(push.staleTokens);
        for (const device of devices) {
          const live = device.fcmTokens.filter((token) => !stale.has(token));
          if (live.length !== device.fcmTokens.length) {
            await tx.user.update({ where: { id: device.id }, data: { fcmTokens: live } });
            pruned += device.fcmTokens.length - live.length;
          }
        }
        this.logger.log({ pruned }, 'Pruned dead FCM tokens');
      }

      return { recipients: recipients.length, pushed: push.sent, prunedTokens: pruned };
    });
  }

  async list(
    tenantId: string,
    userId: string,
    query: { unread?: boolean; limit: number; cursor?: string },
  ) {
    const rows = await this.tenantDb.clientFor(tenantId).notification.findMany({
      where: { userId, ...(query.unread ? { readAt: null } : {}) },
      select: { id: true, type: true, payload: true, readAt: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: items.map((row) => ({
        id: row.id,
        type: row.type,
        payload: row.payload,
        read_at: row.readAt?.toISOString() ?? null,
        created_at: row.createdAt.toISOString(),
      })),
      next_cursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async markRead(tenantId: string, userId: string, id: string) {
    // Scoped by userId as well as id: one member must not be able to clear
    // another's badge by guessing a notification id inside the same tenant.
    const updated = await this.tenantDb.clientFor(tenantId).notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      const exists = await this.tenantDb
        .clientFor(tenantId)
        .notification.findFirst({ where: { id, userId }, select: { id: true } });
      if (!exists) throw ApiError.notFound('Notification');
    }
    return { id, read: true };
  }

  async markAllRead(tenantId: string, userId: string) {
    const updated = await this.tenantDb.clientFor(tenantId).notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: updated.count };
  }
}
