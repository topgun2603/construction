import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  CreateDocumentInput,
  ListDocumentsQuery,
  UpdateDocumentInput,
} from '@sitebook/shared';
import { ApiError } from '../../common/errors/api-error';
import { ProjectAccess } from '../../common/auth/project-access.service';
import type { RequestUser } from '../../common/auth/request-user';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { UploadsService } from '../uploads/uploads.service';

const DOCUMENT_SELECT = {
  id: true,
  projectId: true,
  familyId: true,
  version: true,
  title: true,
  category: true,
  s3Key: true,
  contentType: true,
  sizeBytes: true,
  visibleToClient: true,
  createdAt: true,
  uploader: { select: { id: true, name: true } },
  project: { select: { id: true, name: true } },
} as const;

/**
 * Drawings, contracts, approvals — and which revision is current.
 *
 * Revisions share a `familyId` and count up. Listing gives the newest of each family, because "the
 * slab drawing" means the current one; the history is there when somebody needs to prove what was
 * current on the day the slab was poured.
 *
 * Two rules matter more than the rest:
 *
 *   * **A client sees only what was deliberately shared.** `visibleToClient` is false by default in
 *     the schema, the API and the UI, and a client's list is filtered on it rather than on anything
 *     the caller passes in.
 *   * **A new revision inherits its title and category** from the document it supersedes, so
 *     revision 4 of a drawing cannot quietly become a contract.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
  ) {}

  private clientOnly(actor: RequestUser): boolean {
    // Whoever cannot manage documents and cannot read the team's notes is the client.
    return (
      !actor.permissions.includes('documents.manage') &&
      !actor.permissions.includes('messages.internal')
    );
  }

  async list(actor: RequestUser, query: ListDocumentsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const db = this.tenantDb.clientFor(actor.tenantId);
    const rows = await db.document.findMany({
      where: {
        deletedAt: null,
        ...(query.project_id ? { projectId: query.project_id } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(this.clientOnly(actor) ? { visibleToClient: true } : {}),
        // Somebody who only sees their own sites must not get the company-wide pile either.
        ...(query.project_id || actor.seesAllProjects
          ? {}
          : { projectId: { in: actor.projectIds } }),
      },
      select: DOCUMENT_SELECT,
      orderBy: [{ familyId: 'asc' }, { version: 'desc' }],
    });

    const visible = query.include_history ? rows : onlyLatestOfEachFamily(rows);
    // Newest first is what a list of documents should read as.
    visible.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return { items: await Promise.all(visible.map((row) => this.view(actor, row))) };
  }

  /** Every revision of one document, newest first. */
  async history(actor: RequestUser, familyId: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const rows = await db.document.findMany({
      where: {
        familyId,
        deletedAt: null,
        ...(this.clientOnly(actor) ? { visibleToClient: true } : {}),
      },
      select: DOCUMENT_SELECT,
      orderBy: { version: 'desc' },
    });
    if (rows.length === 0) throw ApiError.notFound('Document');
    if (rows[0]!.projectId) await this.access.assertAccess(actor, rows[0]!.projectId);

    return { items: await Promise.all(rows.map((row) => this.view(actor, row))) };
  }

  async create(actor: RequestUser, input: CreateDocumentInput) {
    if (input.project_id) await this.access.assertAccess(actor, input.project_id);

    if (!input.s3_key.startsWith(`${actor.tenantId}/`)) {
      throw ApiError.forbidden('That file does not belong to this account');
    }

    const db = this.tenantDb.clientFor(actor.tenantId);

    if (input.client_id) {
      const existing = await db.document.findFirst({
        where: { clientId: input.client_id },
        select: DOCUMENT_SELECT,
      });
      if (existing) return this.view(actor, existing);
    }

    let familyId: string = randomUUID();
    let version = 1;
    let title = input.title;
    let category = input.category;
    let visibleToClient = input.visible_to_client;

    if (input.supersedes_id) {
      const previous = await db.document.findFirst({
        where: { id: input.supersedes_id, deletedAt: null },
        select: {
          familyId: true,
          title: true,
          category: true,
          projectId: true,
          visibleToClient: true,
        },
      });
      if (!previous) throw ApiError.notFound('The document this revises');
      if (previous.projectId) await this.access.assertAccess(actor, previous.projectId);

      familyId = previous.familyId;
      title = previous.title;
      category = previous.category;
      /*
       * A revision stays as visible as the one it replaces.
       *
       * Uploading revision 4 and having it default to hidden would silently take a drawing away
       * from the client who has been building to it — they would still see revision 3 and believe
       * it current.
       */
      visibleToClient = previous.visibleToClient;

      const latest = await db.document.aggregate({
        where: { familyId: previous.familyId },
        _max: { version: true },
      });
      version = (latest._max.version ?? 0) + 1;
    }

    const document = await db.document.create({
      data: {
        tenantId: actor.tenantId,
        projectId: input.project_id,
        familyId,
        version,
        title,
        category,
        s3Key: input.s3_key,
        contentType: input.content_type,
        sizeBytes: input.size_bytes,
        visibleToClient,
        uploadedBy: actor.userId,
        clientId: input.client_id ?? null,
      },
      select: DOCUMENT_SELECT,
    });

    return this.view(actor, document);
  }

  async update(actor: RequestUser, id: string, input: UpdateDocumentInput) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.document.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, familyId: true },
    });
    if (!existing) throw ApiError.notFound('Document');
    if (existing.projectId) await this.access.assertAccess(actor, existing.projectId);

    /*
     * Title, category and visibility belong to the document, not to one revision of it.
     *
     * Renaming revision 4 and leaving revisions 1-3 under the old name would make the history
     * unreadable, and — worse — sharing revision 4 with the client while its predecessors stayed
     * hidden would show them a drawing with no past.
     */
    await db.document.updateMany({
      where: { familyId: existing.familyId, deletedAt: null },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.visible_to_client === undefined
          ? {}
          : { visibleToClient: input.visible_to_client }),
      },
    });

    const updated = await db.document.findFirstOrThrow({ where: { id }, select: DOCUMENT_SELECT });
    return this.view(actor, updated);
  }

  /**
   * Soft delete, one revision.
   *
   * The stored object stays: a drawing removed by mistake is unrecoverable once the bytes are gone,
   * and storage is cheap beside a document somebody signed.
   */
  async remove(actor: RequestUser, id: string) {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.document.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true },
    });
    if (!existing) throw ApiError.notFound('Document');
    if (existing.projectId) await this.access.assertAccess(actor, existing.projectId);

    await db.document.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async view(
    actor: RequestUser,
    row: {
      id: string;
      projectId: string | null;
      familyId: string;
      version: number;
      title: string;
      category: string;
      s3Key: string;
      contentType: string;
      sizeBytes: number;
      visibleToClient: boolean;
      createdAt: Date;
      uploader: { id: string; name: string };
      project: { id: string; name: string } | null;
    },
  ) {
    return {
      id: row.id,
      project_id: row.projectId,
      project_name: row.project?.name ?? null,
      family_id: row.familyId,
      version: row.version,
      title: row.title,
      category: row.category,
      content_type: row.contentType,
      size_bytes: row.sizeBytes,
      visible_to_client: row.visibleToClient,
      created_at: row.createdAt.toISOString(),
      uploaded_by: row.uploader,
      url: await this.uploads.signedViewUrl(actor, row.s3Key),
    };
  }
}

/** The newest revision of each family, from rows already ordered family then version desc. */
function onlyLatestOfEachFamily<T extends { familyId: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.familyId)) return false;
    seen.add(row.familyId);
    return true;
  });
}
