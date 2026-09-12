import { Injectable } from '@nestjs/common';
import type {
  CreateApprovalInput,
  DecideApprovalInput,
  ListApprovalsQuery,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { ProjectAccess } from '../../common/auth/project-access.service';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { UploadsService } from '../uploads/uploads.service';

const APPROVAL_SELECT = {
  id: true,
  projectId: true,
  documentId: true,
  title: true,
  body: true,
  status: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  requester: { select: { id: true, name: true, role: true } },
  decider: { select: { id: true, name: true, role: true } },
  project: { select: { id: true, name: true } },
  document: {
    select: { id: true, title: true, version: true, s3Key: true, visibleToClient: true },
  },
} as const;

/**
 * Things the client has been asked to sign off.
 *
 * The record names whoever decided, and the database refuses a decided row without one. That is the
 * entire value of the table: six months on, the argument is whether the client ever agreed to the
 * granite, and an approval with nobody's name attached settles nothing.
 *
 * A decision is final. There is no route back to `pending` and no way to edit a note after the
 * fact — an approval somebody can quietly revise is evidence of nothing.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
  ) {}

  async list(actor: RequestUser, query: ListApprovalsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const db = this.tenantDb.clientFor(actor.tenantId);
    const rows = await db.approval.findMany({
      where: {
        deletedAt: null,
        ...(query.project_id ? { projectId: query.project_id } : {}),
        ...(query.status ? { status: query.status } : {}),
        // Somebody who only sees their own sites must not get the company-wide pile.
        ...(query.project_id || actor.seesAllProjects
          ? {}
          : { projectId: { in: actor.projectIds } }),
      },
      select: APPROVAL_SELECT,
      // Waiting first: this list exists to be cleared.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });

    return { items: await Promise.all(rows.map((row) => this.view(actor, row))) };
  }

  async create(actor: RequestUser, projectId: string, input: CreateApprovalInput) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    if (input.client_id) {
      const existing = await db.approval.findFirst({
        where: { clientId: input.client_id },
        select: APPROVAL_SELECT,
      });
      if (existing) return this.view(actor, existing);
    }

    if (input.document_id) {
      const document = await db.document.findFirst({
        where: { id: input.document_id, deletedAt: null },
        select: { id: true, projectId: true, visibleToClient: true },
      });
      if (!document) throw ApiError.notFound('That document');
      if (document.projectId && document.projectId !== projectId) {
        throw ApiError.notFound('That document');
      }
      /*
       * Asking somebody to approve a drawing they cannot open is asking them to sign blind.
       *
       * Refused rather than silently shared: making the document visible as a side effect of
       * raising an approval would be a share nobody chose, on a table whose whole default is that
       * nothing reaches the client unless somebody says so.
       */
      if (!document.visibleToClient) {
        throw ApiError.conflict(
          'Share that document with the client before asking them to approve it',
        );
      }
    }

    const approval = await db.approval.create({
      data: {
        tenantId: actor.tenantId,
        projectId,
        documentId: input.document_id ?? null,
        title: input.title,
        body: input.body,
        requestedBy: actor.userId,
        clientId: input.client_id ?? null,
      },
      select: APPROVAL_SELECT,
    });

    return this.view(actor, approval);
  }

  async decide(actor: RequestUser, approvalId: string, input: DecideApprovalInput) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.approval.findFirst({
      where: { id: approvalId, deletedAt: null },
      select: { id: true, projectId: true, status: true },
    });
    if (!existing) throw ApiError.notFound('That approval');
    await this.access.assertAccess(actor, existing.projectId);

    if (existing.status !== 'pending') {
      // Not an error worth hiding: whoever is looking should be told it is already settled, and by
      // whom, rather than having their answer quietly replace somebody else's.
      throw ApiError.conflict('That has already been decided');
    }

    const approval = await db.approval.update({
      where: { id: approvalId },
      data: {
        status: input.status,
        decidedBy: actor.userId,
        decidedAt: new Date(),
        decisionNote: input.note ?? null,
      },
      select: APPROVAL_SELECT,
    });

    return this.view(actor, approval);
  }

  /**
   * Withdraw a request.
   *
   * Only while it is still pending. Removing a decided one would delete the answer, which is the
   * part worth keeping.
   */
  async remove(actor: RequestUser, approvalId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const approval = await db.approval.findFirst({
      where: { id: approvalId, deletedAt: null },
      select: { id: true, projectId: true, status: true, requestedBy: true },
    });
    if (!approval) throw ApiError.notFound('That approval');
    await this.access.assertAccess(actor, approval.projectId);

    if (approval.status !== 'pending') {
      throw ApiError.conflict('A decided approval is a record and stays on the job');
    }

    await db.approval.update({ where: { id: approvalId }, data: { deletedAt: new Date() } });
  }

  private async view(
    actor: RequestUser,
    row: {
      id: string;
      projectId: string;
      documentId: string | null;
      title: string;
      body: string;
      status: string;
      decidedAt: Date | null;
      decisionNote: string | null;
      createdAt: Date;
      requester: { id: string; name: string; role: string };
      decider: { id: string; name: string; role: string } | null;
      project: { id: string; name: string } | null;
      document: {
        id: string;
        title: string;
        version: number;
        s3Key: string;
        visibleToClient: boolean;
      } | null;
    },
  ) {
    return {
      id: row.id,
      project_id: row.projectId,
      project_name: row.project?.name ?? null,
      title: row.title,
      body: row.body,
      status: row.status,
      requested_by: row.requester,
      created_at: row.createdAt.toISOString(),
      /*
       * The decider's role travels with their name.
       *
       * An owner may hold `approvals.decide` and record what a client told them on the phone, which
       * is how sites actually work. What must never happen is that reading back as the client
       * having clicked it, so the screen can say "approved by Gowtham Kumar (owner)".
       */
      decided_by: row.decider,
      decided_at: row.decidedAt?.toISOString() ?? null,
      decision_note: row.decisionNote,
      document: row.document
        ? {
            id: row.document.id,
            title: row.document.title,
            version: row.document.version,
            url: await this.uploads.signedViewUrl(actor, row.document.s3Key),
          }
        : null,
    };
  }
}
