import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  rfiIsOverdue,
  rfiLabel,
  submittalIsInReview,
  submittalIsOverdue,
  submittalLabel,
  todayIn,
  type RfiExternalAnswerInput,
  type RfiExternalPresignInput,
  type SubmittalExternalReviewInput,
} from '@sitebook/shared';
import { TokenService, type RfiLinkClaims } from '../../common/auth/token.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { selectTenantLocale, tenantLocaleView } from '../../common/tenant-locale';
import { NotificationsService } from '../notifications/notifications.service';
import { WebhookEvents } from '../webhooks/webhook-events.service';
import { UploadsService } from '../uploads/uploads.service';
import { FILE_SELECT, externalUploadPrefix, fileView, isoDay, siteManagers, type ResolvedFile } from './rfi-common';
import { recordSubmittalReview } from './submittal-records';
import { SubmittalsService } from './submittals.service';

/**
 * Every refusal reads the same — expired, withdrawn, voided or mistyped — so a stranger cannot tell
 * a real link from a guessed one. (`ApiError.notFound` words it "Link not found".)
 */
const INACTIVE = 'Link';

/**
 * What the designer or consultant sees and does through the link they were sent — no account.
 *
 * The properties this has to hold, because the reader is unauthenticated:
 *
 *   * **One record only.** The record id is inside the signed token, and every query is by that id
 *     under that tenant. No parameter names another RFI, another submittal or another company.
 *   * **Only what they need.** The question (or the submittal), the drawings it is about, the files,
 *     and the thread — never the site's budget, the team list, or any other record.
 *   * **It stops working.** The token expires after thirty days; the record's link version withdraws
 *     it sooner; and a voided RFI, a decided revision or a suspended company stops writes at once.
 *   * **Uploads stay in their lane.** A responder's file can only be put under a key prefixed with
 *     this tenant and this record, and only such keys are accepted back.
 */
@Injectable()
export class RfiLinksService {
  private readonly logger = new Logger(RfiLinksService.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly tenantDb: TenantDb,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
    private readonly submittals: SubmittalsService,
    private readonly webhooks: WebhookEvents,
  ) {}

  async view(token: string) {
    const claims = this.verify(token);
    const tenant = await this.activeTenant(claims.tenantId);
    const sign = (key: string) => this.uploads.signedViewUrlFor(claims.tenantId, key);
    const today = todayIn(tenant.timezone);
    const company = { name: tenant.name, logo_url: tenant.logoUrl, ...tenantLocaleView(tenant) };

    if (claims.kind === 'rfi') {
      const rfi = await this.tenantDb.transaction(claims.tenantId, (tx) => this.loadRfi(tx, claims));
      return {
        kind: 'rfi' as const,
        company,
        site: { name: rfi.project.name },
        can_respond: rfi.status === 'open' || rfi.status === 'answered',
        rfi: {
          label: rfiLabel(rfi.number),
          subject: rfi.subject,
          question: rfi.question,
          discipline: rfi.discipline,
          priority: rfi.priority,
          location: rfi.location,
          status: rfi.status,
          overdue: rfiIsOverdue(rfi.status, isoDay(rfi.dueOn), today),
          due_on: isoDay(rfi.dueOn),
          sent_at: rfi.sentAt?.toISOString() ?? null,
          addressed_to_name: rfi.addressedToName,
          documents: await Promise.all(
            rfi.documents
              .filter((link) => !link.document.deletedAt)
              .map(async (link) => ({
                title: link.document.title,
                version: link.document.version,
                url: await sign(link.document.s3Key),
              })),
          ),
          attachments: await Promise.all(rfi.attachments.map((file) => fileView(file, sign))),
          responses: await Promise.all(
            rfi.responses.map(async (response) => ({
              id: response.id,
              author_name: response.authorName,
              external: response.external,
              is_official: response.isOfficial,
              body: response.body,
              created_at: response.createdAt.toISOString(),
              attachments: await Promise.all(response.attachments.map((file) => fileView(file, sign))),
            })),
          ),
        },
      };
    }

    // Opening the link is the reviewer picking it up: a submitted revision is now under review.
    const { submittal, revision } = await this.tenantDb.transaction(claims.tenantId, async (tx) => {
      const found = await this.loadRevision(tx, claims);
      if (found.revision.status === 'submitted' && found.isCurrent) {
        await tx.submittalRevision.update({
          where: { id: found.revision.id },
          data: { status: 'under_review', reviewStartedAt: new Date() },
        });
        await tx.submittal.update({ where: { id: found.submittal.id }, data: { status: 'under_review' } });
        return this.loadRevision(tx, claims);
      }
      return found;
    });
    return {
      kind: 'submittal' as const,
      company,
      site: { name: submittal.project.name },
      can_respond: submittalIsInReview(revision.status),
      submittal: {
        label: submittalLabel(submittal.number, revision.revision),
        title: submittal.title,
        type: submittal.type,
        spec_section: submittal.specSection,
        description: submittal.description,
        submitted_by: submittal.contractor?.name ?? submittal.vendor?.name ?? null,
        reviewer_name: submittal.reviewerName,
        revision: revision.revision,
        status: revision.status,
        overdue: submittalIsOverdue(revision.status, isoDay(revision.dueOn), today),
        due_on: isoDay(revision.dueOn),
        submitted_at: revision.submittedAt?.toISOString() ?? null,
        note: revision.note,
        reviewed_at: revision.reviewedAt?.toISOString() ?? null,
        reviewer: revision.reviewerName,
        review_comments: revision.reviewComments,
        files: await Promise.all(
          revision.files.filter((file) => file.role === 'submission').map((file) => fileView(file, sign)),
        ),
        markups: await Promise.all(
          revision.files.filter((file) => file.role === 'markup').map((file) => fileView(file, sign)),
        ),
      },
    };
  }

  /** A PUT URL for one file, under this tenant and this record only. */
  async presign(input: RfiExternalPresignInput) {
    const claims = this.verify(input.token);
    await this.activeTenant(claims.tenantId);
    await this.tenantDb.transaction(claims.tenantId, async (tx) => {
      if (claims.kind === 'rfi') this.assertAnswerable(await this.loadRfi(tx, claims));
      else this.assertReviewable(await this.loadRevision(tx, claims));
    });
    const prefix = externalUploadPrefix(claims.tenantId, claims.kind, claims.recordId);
    const key = `${prefix}${randomUUID()}.${this.uploads.extensionFor(input.content_type)}`;
    return this.uploads.presignKey(key, input.content_type, input.content_length);
  }

  async answer(input: RfiExternalAnswerInput) {
    const claims = this.verify(input.token);
    if (claims.kind !== 'rfi') throw ApiError.notFound(INACTIVE);
    await this.activeTenant(claims.tenantId);
    const files = this.externalFiles(claims, input.attachments);
    const notice = await this.tenantDb.transaction(claims.tenantId, async (tx) => {
      const rfi = await this.loadRfi(tx, claims);
      this.assertAnswerable(rfi);
      // The designer's first answer is taken as the official one; the team can choose another.
      const official = !rfi.responses.some((response) => response.isOfficial);
      const response = await tx.rfiResponse.create({
        data: {
          tenantId: claims.tenantId,
          rfiId: rfi.id,
          body: input.body,
          authorName: input.name,
          authorEmail: input.email ?? null,
          external: true,
          isOfficial: official,
        },
        select: { id: true },
      });
      if (files.length > 0) {
        await tx.rfiAttachment.createMany({
          data: files.map((file) => ({ tenantId: claims.tenantId, rfiId: rfi.id, responseId: response.id, ...file })),
        });
      }
      if (rfi.status === 'open') {
        await tx.rfi.update({ where: { id: rfi.id }, data: { status: 'answered', answeredAt: new Date() } });
        await this.webhooks.rfiAnswered(tx, claims.tenantId, rfi.id);
      }
      const recipients = new Set([
        rfi.raisedBy,
        ...(rfi.assigneeId ? [rfi.assigneeId] : []),
        ...(await siteManagers(tx, rfi.projectId)),
      ]);
      return { rfi, recipients: [...recipients] };
    });
    const title = `${rfiLabel(notice.rfi.number)} answered by ${input.name}`;
    try {
      await this.notifications.notify({
        tenantId: claims.tenantId,
        userIds: notice.recipients,
        projectId: notice.rfi.projectId,
        type: 'rfi.answered',
        title,
        body: `${notice.rfi.subject} · ${notice.rfi.project.name}`,
        payload: { title, project_name: notice.rfi.project.name, project_id: notice.rfi.projectId, rfi_id: notice.rfi.id },
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'RFI answer notice failed');
    }
    return this.view(input.token);
  }

  async review(input: SubmittalExternalReviewInput) {
    const claims = this.verify(input.token);
    if (claims.kind !== 'submittal') throw ApiError.notFound(INACTIVE);
    await this.activeTenant(claims.tenantId);
    const files = this.externalFiles(claims, input.markups);
    const notice = await this.tenantDb.transaction(claims.tenantId, async (tx) => {
      const found = await this.loadRevision(tx, claims);
      this.assertReviewable(found);
      return recordSubmittalReview(tx, {
        tenantId: claims.tenantId,
        submittal: found.submittal,
        revision: found.revision,
        outcome: input.outcome,
        comments: input.comments ?? null,
        reviewerName: input.name,
        reviewerEmail: input.email ?? null,
        reviewedBy: null,
        markups: files,
      });
    });
    await this.submittals.notifyReview(claims.tenantId, notice);
    return this.view(input.token);
  }

  // --- helpers -----------------------------------------------------------------------------------

  private verify(token: string): RfiLinkClaims {
    try {
      return this.tokens.verifyRfiLink(token);
    } catch {
      throw ApiError.notFound(INACTIVE);
    }
  }

  private async activeTenant(tenantId: string) {
    const tenant = await this.tenantDb.clientFor(tenantId).tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, status: true, logoUrl: true, ...selectTenantLocale },
    });
    if (!tenant || tenant.status !== 'active') throw ApiError.notFound(INACTIVE);
    return tenant;
  }

  private async loadRfi(tx: TenantTx, claims: RfiLinkClaims) {
    const rfi = await tx.rfi.findFirst({
      where: { id: claims.recordId, project: { deletedAt: null } },
      include: {
        project: { select: { name: true } },
        documents: {
          orderBy: { createdAt: 'asc' },
          select: { document: { select: { title: true, version: true, s3Key: true, deletedAt: true } } },
        },
        attachments: { where: { responseId: null }, orderBy: { createdAt: 'asc' }, select: FILE_SELECT },
        responses: {
          orderBy: { createdAt: 'asc' },
          include: { attachments: { orderBy: { createdAt: 'asc' }, select: FILE_SELECT } },
        },
      },
    });
    // Withdrawn (version moved on), never sent, or voided: the link no longer opens anything.
    if (!rfi || rfi.linkVersion !== claims.version || rfi.status === 'draft' || rfi.status === 'void') {
      throw ApiError.notFound(INACTIVE);
    }
    return rfi;
  }

  private async loadRevision(tx: TenantTx, claims: RfiLinkClaims) {
    const revision = await tx.submittalRevision.findFirst({
      where: { id: claims.recordId },
      include: { files: { orderBy: { createdAt: 'asc' }, select: { ...FILE_SELECT, role: true } } },
    });
    if (!revision || revision.linkVersion !== claims.version || revision.status === 'draft') {
      throw ApiError.notFound(INACTIVE);
    }
    const submittal = await tx.submittal.findFirst({
      where: { id: revision.submittalId, project: { deletedAt: null } },
      include: {
        project: { select: { name: true } },
        contractor: { select: { name: true } },
        vendor: { select: { name: true } },
      },
    });
    if (!submittal || submittal.reviewerKind !== 'external') throw ApiError.notFound(INACTIVE);
    return { submittal, revision, isCurrent: submittal.currentRevision === revision.revision };
  }

  private assertAnswerable(rfi: { status: string }): void {
    if (rfi.status !== 'open' && rfi.status !== 'answered') {
      throw ApiError.conflict('This RFI is closed and takes no more answers');
    }
  }

  private assertReviewable(found: { revision: { status: string }; isCurrent: boolean }): void {
    if (!found.isCurrent || !submittalIsInReview(found.revision.status)) {
      throw ApiError.conflict('This revision has already been reviewed');
    }
  }

  /** Files the responder uploaded through their own presign, and nothing else. */
  private externalFiles(
    claims: RfiLinkClaims,
    files: ReadonlyArray<{ s3_key: string; content_type?: string; filename?: string }> | undefined,
  ): ResolvedFile[] {
    const prefix = externalUploadPrefix(claims.tenantId, claims.kind, claims.recordId);
    return (files ?? []).map((file) => {
      if (!file.s3_key.startsWith(prefix) || file.s3_key.includes('..')) {
        throw ApiError.forbidden('That file was not uploaded through this link');
      }
      return {
        documentId: null,
        s3Key: file.s3_key,
        contentType: file.content_type ?? null,
        filename: file.filename ?? null,
      };
    });
  }
}
