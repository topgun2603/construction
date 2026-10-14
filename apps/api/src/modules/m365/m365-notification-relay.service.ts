import { Injectable, Logger } from '@nestjs/common';
import type { M365EmailKind } from '@sitebook/shared';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import type { NotificationEmail, NotificationEmailRelay } from '../notifications/notification-email-relay';
import { notificationEmail } from './email-templates';
import { M365ConfigService } from './m365-config.service';
import { M365ConnectionService } from './m365-connection.service';
import { M365MailService } from './m365-mail.service';

/**
 * Which notices also go by email, and as what. Deliberately short: an RFI answered is the moment
 * somebody waiting on a drawing can get on with it, and an overdue RFI is the daily nudge that
 * gets the designer chased. Everything else stays a push — a team member who gets an email per
 * reply stops reading them.
 */
const EMAILED: Record<string, { kind: M365EmailKind; button: string; path: (notice: NotificationEmail) => string }> = {
  'rfi.answered': {
    kind: 'rfi_answered',
    button: 'Open the RFI',
    path: (notice) => {
      const id = (notice.payload as { rfi_id?: unknown } | undefined)?.rfi_id;
      return typeof id === 'string' ? `/rfis/${id}` : '/rfis';
    },
  },
  'rfi.overdue': {
    kind: 'rfi_overdue',
    button: 'See the overdue RFIs',
    path: (notice) => `/rfis?overdue=true${notice.projectId ? `&project_id=${notice.projectId}` : ''}`,
  },
};

/**
 * Copies chosen in-app notifications to the inboxes of the team members they went to, from the
 * company's connected mailbox. Nothing at all when no mailbox is connected, or for people with no
 * email on their profile — the push and the in-app notice still reached them.
 */
@Injectable()
export class M365NotificationRelay implements NotificationEmailRelay {
  private readonly logger = new Logger(M365NotificationRelay.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly config: M365ConfigService,
    private readonly connection: M365ConnectionService,
    private readonly mail: M365MailService,
  ) {}

  async relay(notice: NotificationEmail): Promise<void> {
    const rule = EMAILED[notice.type];
    if (!rule) return;
    try {
      if (!(await this.connection.status(notice.tenantId)).connected) return;
      const { people, company } = await this.tenantDb.transaction(notice.tenantId, async (tx) => ({
        people: await tx.user.findMany({
          where: { id: { in: notice.userIds }, status: 'active', deletedAt: null, email: { not: null } },
          select: { email: true, name: true },
        }),
        company: await tx.tenant.findUnique({ where: { id: notice.tenantId }, select: { name: true } }),
      }));
      if (people.length === 0) return;
      const base = this.config.webBase;
      await this.mail.send({
        tenantId: notice.tenantId,
        actorId: null,
        kind: rule.kind,
        entityType: rule.kind === 'rfi_answered' ? 'rfi' : null,
        entityId: rule.kind === 'rfi_answered' ? ((notice.payload as { rfi_id?: string } | undefined)?.rfi_id ?? null) : null,
        projectId: notice.projectId ?? null,
        to: people.map((person) => ({ address: person.email!, name: person.name })),
        content: notificationEmail({
          companyName: company?.name ?? 'BUILDR',
          title: notice.title,
          body: notice.body,
          url: base ? `${base}${rule.path(notice)}` : null,
          buttonLabel: rule.button,
        }),
      });
    } catch (error) {
      this.logger.warn({ err: error, tenantId: notice.tenantId, type: notice.type }, 'Notification email not sent');
    }
  }
}
