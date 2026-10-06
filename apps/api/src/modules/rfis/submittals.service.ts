import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  SUBMITTAL_RESUBMITTABLE,
  SUBMITTAL_STATUS_LABELS,
  SUBMITTAL_TYPE_LABELS,
  isoDateToUtcDate,
  rfiAverageDays,
  rfiDueDate,
  rfiLinkMessage,
  submittalIsInReview,
  submittalIsOverdue,
  submittalLabel,
  type CreateSubmittalInput,
  type ListSubmittalsQuery,
  type ResubmitSubmittalInput,
  type ReviewSubmittalInput,
  type SubmitSubmittalInput,
  type SubmittalFilesInput,
  type UpdateSubmittalInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { TokenService } from '../../common/auth/token.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  assertMember,
  companyToday,
  csv,
  dialable,
  fileView,
  isoDay,
  namesFor,
  person,
  resolveFiles,
  responderLink,
  rfiSettingsFor,
  withNumberRetry,
} from './rfi-common';
import {
  SUBMITTAL_INCLUDE,
  currentRevisionOf,
  recordSubmittalReview,
  type SubmittalRecord,
  type SubmittalReviewNotice,
} from './submittal-records';

/** What the create schema hands over once zod has applied its defaults. */
type CreateSubmittalParsed = Omit<CreateSubmittalInput, 'type' | 'reviewer_kind'> & {
  type: NonNullable<CreateSubmittalInput['type']>;
  reviewer_kind: NonNullable<CreateSubmittalInput['reviewer_kind']>;
};

/**
 * Submittals (roadmap Phase 2, module 9): the contractor's shop drawings, samples, method statements
 * and data sheets sent to the consultant or the client for approval. Each resubmission is a new
 * revision on the same log item, linked to the one it answers, so the history of what was sent and
 * what came back reads top to bottom.
 */
@Injectable()
export class SubmittalsService {
  private readonly logger = new Logger(SubmittalsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly tokens: TokenService,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- reading -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListSubmittalsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const today = companyToday(actor);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const where = this.where(actor, query, today);
      const rows = await tx.submittal.findMany({
        where,
        include: SUBMITTAL_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        take: query.limit,
      });
      const names = await namesFor(tx, rows.flatMap((row) => [row.createdBy, row.submittedByUserId]));
      const all = await tx.submittal.findMany({ where, select: { status: true, dueOn: true } });
      const reviewed = await tx.submittalRevision.findMany({
        where: { submittal: where, reviewedAt: { not: null } },
        select: { submittedAt: true, reviewedAt: true },
      });
      return {
        items: rows.map((row) => this.summary(row, names, today)),
        stats: {
          total: all.length,
          in_review: all.filter((row) => submittalIsInReview(row.status)).length,
          overdue: all.filter((row) => submittalIsOverdue(row.status, isoDay(row.dueOn), today)).length,
          approved: all.filter((row) => row.status === 'approved' || row.status === 'approved_as_noted').length,
          returned: all.filter((row) => row.status === 'revise_resubmit' || row.status === 'rejected').length,
          avg_review_days: rfiAverageDays(reviewed.map((row) => ({ from: row.submittedAt, to: row.reviewedAt }))),
        },
      };
    });
  }

  async exportCsv(actor: RequestUser, query: ListSubmittalsQuery): Promise<string> {
    const { items } = await this.list(actor, { ...query, limit: 500 });
    return csv([
      ['Number', 'Revision', 'Site', 'Title', 'Type', 'Spec section', 'Status', 'Overdue', 'Submitted by', 'Reviewer', 'Submitted', 'Due', 'Reviewed'],
      ...items.map((row) => [
        row.label,
        row.current_revision,
        row.project.name,
        row.title,
        SUBMITTAL_TYPE_LABELS[row.type],
        row.spec_section,
        SUBMITTAL_STATUS_LABELS[row.status],
        row.overdue ? 'Yes' : '',
        row.submitted_by,
        [row.reviewer.name, row.reviewer.company].filter(Boolean).join(', ') || (row.reviewer.kind === 'client' ? 'Client' : ''),
        row.submitted_at?.slice(0, 10) ?? '',
        row.due_on,
        row.reviewed_at?.slice(0, 10) ?? '',
      ]),
    ]);
  }

  async get(actor: RequestUser, id: string) {
    const row = await this.tenantDb.transaction(actor.tenantId, (tx) => this.load(tx, actor, id));
    return this.detail(actor, row);
  }

  // --- preparing ---------------------------------------------------------------------------------

  async create(actor: RequestUser, input: CreateSubmittalParsed) {
    await this.access.assertAccess(actor, input.project_id);
    const id = await withNumberRetry(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        if (input.client_id) {
          const existing = await tx.submittal.findFirst({ where: { clientId: input.client_id }, select: { id: true } });
          if (existing) return existing.id;
        }
        await this.assertParties(tx, input.project_id, input);
        const files = await resolveFiles(tx, actor, input.project_id, input.files);
        const last = await tx.submittal.aggregate({ where: { projectId: input.project_id }, _max: { number: true } });
        const made = await tx.submittal.create({
          data: {
            tenantId: actor.tenantId,
            projectId: input.project_id,
            number: (last._max.number ?? 0) + 1,
            title: input.title,
            type: input.type,
            specSection: input.spec_section ?? null,
            description: input.description ?? null,
            costCodeId: input.cost_code_id ?? null,
            submittedByUserId: input.submitted_by_user_id ?? null,
            contractorId: input.contractor_id ?? null,
            vendorId: input.vendor_id ?? null,
            reviewerKind: input.reviewer_kind,
            reviewerName: input.reviewer_name ?? null,
            reviewerEmail: input.reviewer_email ?? null,
            reviewerCompany: input.reviewer_company ?? null,
            reviewerPhone: dialable(input.reviewer_phone),
            createdBy: actor.userId,
            clientId: input.client_id ?? null,
          },
          select: { id: true },
        });
        const revision = await tx.submittalRevision.create({
          data: { tenantId: actor.tenantId, submittalId: made.id, revision: 0 },
          select: { id: true },
        });
        await this.insertFiles(tx, actor, revision.id, files);
        return made.id;
      }),
    );
    return this.get(actor, id);
  }

  async update(actor: RequestUser, id: string, input: UpdateSubmittalInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      await this.assertParties(tx, row.projectId, input);
      const reviewerChanged =
        input.reviewer_kind !== undefined && input.reviewer_kind !== row.reviewerKind;
      // Who is reviewing a revision is settled when it is sent. Change it on the next revision.
      if (reviewerChanged && submittalIsInReview(row.status)) {
        throw ApiError.conflict('This revision is already with its reviewer. Change the reviewer on the next revision.');
      }
      await tx.submittal.update({
        where: { id },
        data: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.spec_section === undefined ? {} : { specSection: input.spec_section }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.cost_code_id === undefined ? {} : { costCodeId: input.cost_code_id }),
          ...(input.submitted_by_user_id === undefined ? {} : { submittedByUserId: input.submitted_by_user_id }),
          ...(input.contractor_id === undefined ? {} : { contractorId: input.contractor_id }),
          ...(input.vendor_id === undefined ? {} : { vendorId: input.vendor_id }),
          ...(input.reviewer_kind === undefined ? {} : { reviewerKind: input.reviewer_kind }),
          ...(input.reviewer_name === undefined ? {} : { reviewerName: input.reviewer_name }),
          ...(input.reviewer_email === undefined ? {} : { reviewerEmail: input.reviewer_email ?? null }),
          ...(input.reviewer_company === undefined ? {} : { reviewerCompany: input.reviewer_company }),
          ...(input.reviewer_phone === undefined ? {} : { reviewerPhone: dialable(input.reviewer_phone) }),
        },
      });
    });
    return this.get(actor, id);
  }

  /** A first draft that was never sent. Anything sent is part of the log. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const current = currentRevisionOf(row);
      if (row.currentRevision !== 0 || current.status !== 'draft' || current.submittedAt) {
        throw ApiError.conflict('Only a first draft that was never submitted can be deleted');
      }
      await tx.submittal.delete({ where: { id } });
    });
  }

  async addFiles(actor: RequestUser, id: string, input: SubmittalFilesInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const current = this.assertDraft(row);
      await this.insertFiles(tx, actor, current.id, await resolveFiles(tx, actor, row.projectId, input.files));
    });
    return this.get(actor, id);
  }

  async removeFile(actor: RequestUser, id: string, fileId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const current = this.assertDraft(row);
      if (!current.files.some((file) => file.id === fileId && file.role === 'submission')) {
        throw ApiError.notFound('File');
      }
      await tx.submittalFile.delete({ where: { id: fileId } });
    });
    return this.get(actor, id);
  }

  // --- sending and reviewing ---------------------------------------------------------------------

  /**
   * Send the current revision to its reviewer. A client reviewer gets it as a portal approval — the
   * same inbox and the same "who decided" record as everything else they sign off; an outside
   * consultant is sent a link (`sendLink`).
   */
  async submit(actor: RequestUser, id: string, input: SubmitSubmittalInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const current = this.assertDraft(row);
      if (!current.files.some((file) => file.role === 'submission')) {
        throw ApiError.conflict('Attach the drawings or documents being submitted first');
      }
      const settings = await rfiSettingsFor(tx);
      const dueOn = input.due_on ?? rfiDueDate(companyToday(actor), settings.submittal_review_days);
      let approvalId: string | null = null;
      if (row.reviewerKind === 'client') {
        const label = submittalLabel(row.number, current.revision);
        const firstDocument = current.files.find((file) => file.role === 'submission' && file.documentId);
        const approval = await tx.approval.create({
          data: {
            tenantId: actor.tenantId,
            projectId: row.projectId,
            documentId: firstDocument?.documentId ?? null,
            title: `Submittal ${label}: ${row.title}`.slice(0, 300),
            // Plain text, so it reads the same in the portal, a notification and an older phone.
            body: [
              SUBMITTAL_TYPE_LABELS[row.type],
              row.specSection ? `Spec section ${row.specSection}` : '',
              input.note ?? '',
              `Please review by ${dueOn}.`,
            ]
              .filter(Boolean)
              .join('\n'),
            requestedBy: actor.userId,
          },
          select: { id: true },
        });
        approvalId = approval.id;
      }
      await tx.submittalRevision.update({
        where: { id: current.id },
        data: {
          status: 'submitted',
          submittedAt: new Date(),
          submittedBy: actor.userId,
          dueOn: isoDateToUtcDate(dueOn),
          note: input.note ?? null,
          approvalId,
        },
      });
      await tx.submittal.update({ where: { id }, data: { status: 'submitted', dueOn: isoDateToUtcDate(dueOn) } });
    });
    return this.get(actor, id);
  }

  async sendLink(actor: RequestUser, id: string) {
    const row = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await this.load(tx, actor, id);
      if (current.reviewerKind !== 'external') {
        throw ApiError.conflict('The client reviews this through their approvals, not a link');
      }
      const revision = currentRevisionOf(current);
      if (!submittalIsInReview(revision.status)) {
        throw ApiError.conflict(
          revision.status === 'draft' ? 'Submit this revision before sending it' : 'This revision has been reviewed',
        );
      }
      await tx.submittalRevision.update({ where: { id: revision.id }, data: { linkSentAt: new Date() } });
      return this.load(tx, actor, id);
    });
    const revision = currentRevisionOf(row);
    const token = this.tokens.signRfiLink({
      tenantId: actor.tenantId,
      kind: 'submittal',
      recordId: revision.id,
      version: revision.linkVersion,
    });
    const link = responderLink(token);
    const company = await this.tenantDb
      .clientFor(actor.tenantId)
      .tenant.findUnique({ where: { id: actor.tenantId }, select: { name: true } });
    const label = submittalLabel(row.number, revision.revision);
    return {
      ...link,
      expires_at: new Date(Date.now() + this.tokens.rfiLinkTtlSeconds * 1000).toISOString(),
      message: rfiLinkMessage({
        recipientName: row.reviewerName,
        companyName: company?.name ?? '',
        siteName: row.project.name,
        label,
        subject: row.title,
        dueOn: isoDay(revision.dueOn),
        url: '{url}',
        kind: 'submittal',
      }),
      phone: row.reviewerPhone,
      email: row.reviewerEmail,
      subject: `${label}: ${row.title}`,
      submittal: await this.detail(actor, row),
    };
  }

  async revokeLinks(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const revision = currentRevisionOf(row);
      await tx.submittalRevision.update({
        where: { id: revision.id },
        data: { linkVersion: { increment: 1 }, linkSentAt: null },
      });
    });
    return this.get(actor, id);
  }

  /** The reviewer has it on their desk. Optional: a review can be recorded straight from submitted. */
  async startReview(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const revision = currentRevisionOf(row);
      if (revision.status !== 'submitted') throw ApiError.conflict('Only a submitted revision can go under review');
      await tx.submittalRevision.update({
        where: { id: revision.id },
        data: { status: 'under_review', reviewStartedAt: new Date() },
      });
      await tx.submittal.update({ where: { id }, data: { status: 'under_review' } });
    });
    return this.get(actor, id);
  }

  /** A review that came back by email or by hand, recorded by somebody holding `submittals.review`. */
  async review(actor: RequestUser, id: string, input: ReviewSubmittalInput) {
    const notice = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const revision = currentRevisionOf(row);
      if (!submittalIsInReview(revision.status)) {
        throw ApiError.conflict(revision.status === 'draft' ? 'Submit this revision first' : 'This revision has already been reviewed');
      }
      // The client's answer is the client's: it is recorded through their approval, with their name.
      if (revision.approvalId && revision.approval?.status === 'pending') {
        throw ApiError.conflict('The client reviews this through their approvals');
      }
      const me = await tx.user.findFirst({ where: { id: actor.userId }, select: { name: true } });
      return recordSubmittalReview(tx, {
        tenantId: actor.tenantId,
        submittal: row,
        revision,
        outcome: input.outcome,
        comments: input.comments ?? null,
        reviewerName: input.reviewer_name ?? me?.name ?? 'Team',
        reviewerEmail: null,
        reviewedBy: actor.userId,
        markups: await resolveFiles(tx, actor, row.projectId, input.markups),
      });
    });
    await this.notifyReview(actor.tenantId, notice);
    return this.get(actor, id);
  }

  /**
   * The next revision after "revise and resubmit" or a rejection: a new draft linked to the one it
   * answers, optionally starting with the same files so only what changed needs replacing.
   */
  async resubmit(actor: RequestUser, id: string, input: ResubmitSubmittalInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.load(tx, actor, id);
      const previous = currentRevisionOf(row);
      if (!(SUBMITTAL_RESUBMITTABLE as readonly string[]).includes(previous.status)) {
        throw ApiError.conflict('Only a revision returned for revision, or rejected, is resubmitted');
      }
      const next = await tx.submittalRevision.create({
        data: {
          tenantId: actor.tenantId,
          submittalId: id,
          revision: previous.revision + 1,
          previousRevisionId: previous.id,
        },
        select: { id: true },
      });
      if (input.copy_files) {
        const carried = previous.files.filter((file) => file.role === 'submission');
        if (carried.length > 0) {
          await tx.submittalFile.createMany({
            data: carried.map((file) => ({
              tenantId: actor.tenantId,
              revisionId: next.id,
              role: 'submission',
              documentId: file.documentId,
              s3Key: file.s3Key,
              contentType: file.contentType,
              filename: file.filename,
              uploadedBy: actor.userId,
            })),
          });
        }
      }
      await tx.submittal.update({
        where: { id },
        data: { currentRevision: previous.revision + 1, status: 'draft', dueOn: null },
      });
    });
    return this.get(actor, id);
  }

  async notifyReview(tenantId: string, notice: SubmittalReviewNotice | null): Promise<void> {
    if (!notice || notice.recipients.length === 0) return;
    const title = `${notice.label}: ${SUBMITTAL_STATUS_LABELS[notice.outcome].toLowerCase()}`;
    try {
      await this.notifications.notify({
        tenantId,
        userIds: notice.recipients,
        projectId: notice.projectId,
        type: 'submittal.reviewed',
        title,
        body: `${notice.title} · ${notice.projectName}`,
        payload: {
          title,
          project_name: notice.projectName,
          project_id: notice.projectId,
          submittal_id: notice.submittalId,
          outcome: notice.outcome,
        },
      });
    } catch (error) {
      this.logger.warn({ err: error, submittalId: notice.submittalId }, 'Submittal notice failed');
    }
  }

  // --- helpers -----------------------------------------------------------------------------------

  private where(actor: RequestUser, query: ListSubmittalsQuery, today: string): Prisma.SubmittalWhereInput {
    const party = query.party
      ? {
          OR: [
            { reviewerName: { contains: query.party, mode: 'insensitive' as const } },
            { reviewerCompany: { contains: query.party, mode: 'insensitive' as const } },
            { contractor: { name: { contains: query.party, mode: 'insensitive' as const } } },
            { vendor: { name: { contains: query.party, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    const text = query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' as const } },
            { specSection: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    return {
      project: { deletedAt: null },
      ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.overdue
        ? { status: { in: ['submitted' as const, 'under_review' as const] }, dueOn: { lt: isoDateToUtcDate(today) } }
        : {}),
      AND: [party, text],
    };
  }

  private async load(tx: TenantTx, actor: RequestUser, id: string): Promise<SubmittalRecord> {
    const row = await tx.submittal.findFirst({ where: { id, project: { deletedAt: null } }, include: SUBMITTAL_INCLUDE });
    if (!row) throw ApiError.notFound('Submittal');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  private async insertFiles(
    tx: TenantTx,
    actor: RequestUser,
    revisionId: string,
    files: Awaited<ReturnType<typeof resolveFiles>>,
  ): Promise<void> {
    if (files.length === 0) return;
    await tx.submittalFile.createMany({
      data: files.map((file) => ({
        tenantId: actor.tenantId,
        revisionId,
        role: 'submission',
        ...file,
        uploadedBy: actor.userId,
      })),
    });
  }

  private assertDraft(row: SubmittalRecord) {
    const current = currentRevisionOf(row);
    if (current.status !== 'draft') {
      throw ApiError.conflict(`${submittalLabel(row.number, current.revision)} has been submitted; its files are fixed`);
    }
    return current;
  }

  private async assertParties(
    tx: TenantTx,
    projectId: string,
    input: {
      cost_code_id?: string | null;
      contractor_id?: string | null;
      vendor_id?: string | null;
      submitted_by_user_id?: string | null;
    },
  ): Promise<void> {
    if (input.cost_code_id) {
      const code = await tx.costCode.findFirst({ where: { id: input.cost_code_id, projectId }, select: { id: true } });
      if (!code) throw ApiError.validationFailed({ cost_code_id: input.cost_code_id }, 'That cost code is not on this site');
    }
    if (input.contractor_id) {
      const found = await tx.contractor.findFirst({ where: { id: input.contractor_id, deletedAt: null }, select: { id: true } });
      if (!found) throw ApiError.validationFailed({ contractor_id: input.contractor_id }, 'That subcontractor is not on the books');
    }
    if (input.vendor_id) {
      const found = await tx.vendor.findFirst({ where: { id: input.vendor_id }, select: { id: true } });
      if (!found) throw ApiError.validationFailed({ vendor_id: input.vendor_id }, 'That supplier is not on the books');
    }
    await assertMember(tx, input.submitted_by_user_id, 'submitted_by_user_id');
  }

  summary(row: SubmittalRecord, names: Map<string, string>, today: string) {
    const current = currentRevisionOf(row);
    const due = isoDay(row.dueOn);
    return {
      id: row.id,
      number: row.number,
      label: submittalLabel(row.number, row.currentRevision),
      project: row.project,
      title: row.title,
      type: row.type,
      spec_section: row.specSection,
      cost_code: row.costCode,
      status: row.status,
      overdue: submittalIsOverdue(row.status, due, today),
      due_on: due,
      current_revision: row.currentRevision,
      submitted_at: current.submittedAt?.toISOString() ?? null,
      reviewed_at: current.reviewedAt?.toISOString() ?? null,
      submitted_by:
        row.contractor?.name ?? row.vendor?.name ?? person(names, row.submittedByUserId)?.name ?? null,
      submitted_by_party: {
        user: person(names, row.submittedByUserId),
        contractor: row.contractor,
        vendor: row.vendor,
      },
      reviewer: {
        kind: row.reviewerKind,
        name: row.reviewerName,
        email: row.reviewerEmail,
        company: row.reviewerCompany,
        phone: row.reviewerPhone,
      },
      created_by: person(names, row.createdBy),
      created_at: row.createdAt.toISOString(),
    };
  }

  async detail(actor: RequestUser, row: SubmittalRecord) {
    const today = companyToday(actor);
    const names = await this.tenantDb.transaction(actor.tenantId, (tx) =>
      namesFor(tx, [
        row.createdBy,
        row.submittedByUserId,
        ...row.revisions.flatMap((revision) => [revision.submittedBy, revision.reviewedBy]),
      ]),
    );
    const sign = (key: string) => this.uploads.signedViewUrl(actor, key);
    return {
      ...this.summary(row, names, today),
      description: row.description,
      revisions: await Promise.all(
        row.revisions.map(async (revision) => ({
          id: revision.id,
          revision: revision.revision,
          label: submittalLabel(row.number, revision.revision),
          status: revision.status,
          overdue: submittalIsOverdue(revision.status, isoDay(revision.dueOn), today),
          note: revision.note,
          submitted_at: revision.submittedAt?.toISOString() ?? null,
          submitted_by: person(names, revision.submittedBy),
          due_on: isoDay(revision.dueOn),
          review_started_at: revision.reviewStartedAt?.toISOString() ?? null,
          reviewed_at: revision.reviewedAt?.toISOString() ?? null,
          reviewed_by: person(names, revision.reviewedBy),
          reviewer_name: revision.reviewerName,
          reviewer_email: revision.reviewerEmail,
          review_comments: revision.reviewComments,
          approval: revision.approval
            ? {
                id: revision.approval.id,
                status: revision.approval.status,
                decided_at: revision.approval.decidedAt?.toISOString() ?? null,
              }
            : null,
          link_sent_at: revision.linkSentAt?.toISOString() ?? null,
          files: await Promise.all(
            revision.files.filter((file) => file.role === 'submission').map((file) => fileView(file, sign)),
          ),
          markups: await Promise.all(
            revision.files.filter((file) => file.role === 'markup').map((file) => fileView(file, sign)),
          ),
        })),
      ),
    };
  }
}
