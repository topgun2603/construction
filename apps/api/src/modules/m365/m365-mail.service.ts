import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { m365UniqueEmails, type M365EmailKind } from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import type { EmailContent } from './email-templates';
import { GraphRequestError, type GraphRecipient } from './graph-client.service';
import { GraphClient } from './graph-client.service';
import { M365ConnectionService, deliveryView } from './m365-connection.service';

export interface SendEmailInput {
  tenantId: string;
  /** Who pressed the button; null for a scheduled reminder. */
  actorId: string | null;
  kind: M365EmailKind;
  entityType?: 'rfi' | 'submittal' | 'change_order' | 'meeting' | null;
  entityId?: string | null;
  projectId?: string | null;
  to: Array<{ address: string; name?: string | null }>;
  cc?: string[];
  content: EmailContent;
}

/**
 * Sends one email from the company's connected mailbox (Graph `POST /me/sendMail`) and records it
 * in `email_deliveries` whatever happens — sent with Microsoft's request id, or failed with
 * Microsoft's reason. That row is audited by its trigger, so "who emailed the architect what, and
 * when" is in the audit log as well as on the record.
 *
 * Not connected is a 409 the screens read as "offer WhatsApp and copy instead" — nothing is
 * recorded, because nothing was attempted.
 */
@Injectable()
export class M365MailService {
  private readonly logger = new Logger(M365MailService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly connection: M365ConnectionService,
    private readonly graph: GraphClient,
  ) {}

  async send(input: SendEmailInput) {
    const seen = new Set<string>();
    const to = input.to
      .map((recipient) => ({ address: recipient.address.trim().toLowerCase(), name: recipient.name?.trim() || undefined }))
      .filter((recipient) => recipient.address.includes('@') && !seen.has(recipient.address) && seen.add(recipient.address));
    if (to.length === 0) throw ApiError.validationFailed({ to: 'required' }, 'There is nobody with an email address to send this to.');
    const cc = m365UniqueEmails(input.cc ?? []).filter((address) => !seen.has(address));

    const session = await this.connection.session(input.tenantId);
    const deliveryId = randomUUID();
    const recipients = (list: Array<{ address: string; name?: string }>): GraphRecipient[] =>
      list.map((entry) => ({ emailAddress: entry.name ? { address: entry.address, name: entry.name } : { address: entry.address } }));

    let requestId: string | null = null;
    let failure: string | null = null;
    try {
      ({ requestId } = await this.connection.withGraph(input.tenantId, (live) =>
        this.graph.sendMail(live.accessToken, {
          subject: input.content.subject,
          body: { contentType: 'HTML', content: input.content.html },
          toRecipients: recipients(to),
          ...(cc.length > 0 ? { ccRecipients: recipients(cc.map((address) => ({ address }))) } : {}),
          // Our id on the message itself, so a bounce or a forwarded copy can be traced to this row.
          internetMessageHeaders: [{ name: 'X-Buildr-Delivery-Id', value: deliveryId }],
        }),
      ));
    } catch (error) {
      if (error instanceof ApiError) throw error; // not connected / needs reconnect: nothing attempted
      failure = error instanceof GraphRequestError ? `${error.code}: ${error.message}` : 'Could not reach Microsoft';
      requestId = error instanceof GraphRequestError ? error.requestId : null;
      this.logger.warn({ err: error, tenantId: input.tenantId, kind: input.kind }, 'Email through Microsoft 365 failed');
    }

    const row = await this.tenantDb.transaction(input.tenantId, (tx) =>
      tx.emailDelivery.create({
        data: {
          id: deliveryId,
          tenantId: input.tenantId,
          kind: input.kind,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          projectId: input.projectId ?? null,
          fromEmail: session.mailbox,
          toEmails: to.map((entry) => entry.address),
          ccEmails: cc,
          subject: input.content.subject,
          status: failure ? 'failed' : 'sent',
          providerRequestId: requestId,
          error: failure,
          sentAt: failure ? null : new Date(),
          sentByUserId: input.actorId,
        },
      }),
    );
    if (failure) {
      throw ApiError.conflict(`Microsoft 365 did not send the email: ${failure}`, { delivery_id: row.id });
    }
    return deliveryView(row);
  }

  /** Every email sent about one record, newest first — what the record's page lists. */
  async deliveriesFor(tenantId: string, entityType: string, entityId: string) {
    const rows = await this.tenantDb.clientFor(tenantId).emailDelivery.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(deliveryView);
  }
}
