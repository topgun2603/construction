import { Injectable } from '@nestjs/common';
import { formatMoney, m365UniqueEmails, type M365SendEmailInput } from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { ChangeOrdersService } from '../change-orders/change-orders.service';
import { RfisService } from '../rfis/rfis.service';
import { SubmittalsService } from '../rfis/submittals.service';
import { changeOrderEmail, rfiSentEmail, submittalReviewEmail } from './email-templates';
import { M365ConfigService } from './m365-config.service';
import { M365ConnectionService } from './m365-connection.service';
import { M365MailService } from './m365-mail.service';

/**
 * "Send by email" on an RFI, a submittal and a change order: the same link the WhatsApp button
 * sends, in a proper email from the company's own mailbox.
 *
 * Each goes through the feature's own service for the record — so its permission, site access and
 * state rules (only a live RFI, only a submittal with an external reviewer, only a change order
 * waiting on the client) are exactly the ones the WhatsApp path has — and only then mints the link.
 * The connection is checked *first*: a draft RFI must not be opened, nor a link minted, for an email
 * that was never going to leave.
 */
@Injectable()
export class M365SendService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly config: M365ConfigService,
    private readonly connection: M365ConnectionService,
    private readonly mail: M365MailService,
    private readonly rfis: RfisService,
    private readonly submittals: SubmittalsService,
    private readonly changeOrders: ChangeOrdersService,
  ) {}

  async rfi(actor: RequestUser, id: string, input: M365SendEmailInput) {
    await this.connection.session(actor.tenantId);
    const webBase = this.requireWebBase();
    const current = await this.rfis.get(actor, id);
    const to = input.to ?? m365UniqueEmails([current.addressed_to.email]);
    if (to.length === 0) throw noAddress('the RFI has no email for the designer');

    const link = await this.rfis.sendLink(actor, id);
    const content = rfiSentEmail({
      companyName: await this.companyName(actor.tenantId),
      recipientName: input.to ? null : current.addressed_to.name,
      siteName: current.project.name,
      label: current.label,
      subject: current.subject,
      question: current.question,
      dueOn: link.rfi.due_on,
      url: absolute(webBase, link.path),
      note: input.note,
    });
    const delivery = await this.mail.send({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      kind: 'rfi_sent',
      entityType: 'rfi',
      entityId: id,
      projectId: current.project.id,
      to: to.map((address) => ({ address, name: input.to ? null : current.addressed_to.name })),
      cc: input.cc,
      content,
    });
    return { delivery, rfi: await this.rfis.get(actor, id) };
  }

  async submittal(actor: RequestUser, id: string, input: M365SendEmailInput) {
    await this.connection.session(actor.tenantId);
    const webBase = this.requireWebBase();
    const current = await this.submittals.get(actor, id);
    if (current.reviewer.kind !== 'external') {
      throw ApiError.conflict('The client reviews this through their approvals, not a link');
    }
    const to = input.to ?? m365UniqueEmails([current.reviewer.email]);
    if (to.length === 0) throw noAddress('the submittal has no email for the reviewer');

    const link = await this.submittals.sendLink(actor, id);
    const content = submittalReviewEmail({
      companyName: await this.companyName(actor.tenantId),
      recipientName: input.to ? null : current.reviewer.name,
      siteName: current.project.name,
      label: link.submittal.label,
      title: current.title,
      dueOn: link.submittal.due_on,
      url: absolute(webBase, link.path),
      note: input.note,
    });
    const delivery = await this.mail.send({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      kind: 'submittal_review',
      entityType: 'submittal',
      entityId: id,
      projectId: current.project.id,
      to: to.map((address) => ({ address, name: input.to ? null : current.reviewer.name })),
      cc: input.cc,
      content,
    });
    return { delivery, submittal: await this.submittals.get(actor, id) };
  }

  /**
   * The change order is already in front of the client as a portal approval (sending it to them is
   * the internal approval); this is the email telling them so, with the link to where they decide.
   * Recipients default to the client users on the site who have an address.
   */
  async changeOrder(actor: RequestUser, id: string, input: M365SendEmailInput) {
    await this.connection.session(actor.tenantId);
    const webBase = this.requireWebBase();
    const current = await this.changeOrders.get(actor, id);
    if (current.status !== 'sent') {
      throw ApiError.conflict(`${current.label} is not waiting on the client. Approve it to send it to them.`);
    }
    const clients = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      tx.user.findMany({
        where: {
          status: 'active',
          deletedAt: null,
          role: 'client',
          email: { not: null },
          projectMemberships: { some: { projectId: current.project.id } },
        },
        select: { email: true, name: true },
      }),
    );
    const recipients = input.to
      ? input.to.map((address) => ({ address, name: null }))
      : clients.map((client) => ({ address: client.email!, name: client.name }));
    if (recipients.length === 0) throw noAddress('no client on this site has an email address');

    const content = changeOrderEmail({
      companyName: await this.companyName(actor.tenantId),
      siteName: current.project.name,
      label: current.label,
      title: current.title,
      price: formatMoney(BigInt(current.client_total), { currency: actor.currency, locale: actor.locale }),
      days: current.time_impact_days,
      url: absolute(webBase, `/projects/${current.project.id}?tab=approvals`),
      note: input.note,
    });
    const delivery = await this.mail.send({
      tenantId: actor.tenantId,
      actorId: actor.userId,
      kind: 'change_order_sent',
      entityType: 'change_order',
      entityId: id,
      projectId: current.project.id,
      to: recipients,
      cc: input.cc,
      content,
    });
    return { delivery };
  }

  private requireWebBase(): string {
    const base = this.config.webBase;
    // An email whose link is a bare path is a dead link in every mail client.
    if (!base) throw ApiError.conflict('Emails need WEB_BASE_URL set on this server so their links work.');
    return base;
  }

  private async companyName(tenantId: string): Promise<string> {
    const tenant = await this.tenantDb
      .clientFor(tenantId)
      .tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    return tenant?.name ?? 'Your builder';
  }
}

function absolute(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function noAddress(why: string): ApiError {
  return ApiError.validationFailed({ to: 'required' }, `Add an email address to send to — ${why}.`);
}
