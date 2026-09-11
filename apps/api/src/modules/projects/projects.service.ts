import { Injectable } from '@nestjs/common';
import {
  isoDateToUtcDate,
  utcDateToIsoDate,
  type AddProjectMemberInput,
  type AddProjectMediaInput,
  type CreateMilestoneInput,
  type ReorderMilestonesInput,
  type UpdateMilestoneInput,
  type ReorderProjectMediaInput,
  type UpdateProjectMediaInput,
  type CreateProjectInput,
  type ListProjectsQuery,
  type Page,
  type UpdateProjectInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';
import { JobQueueService } from '../../jobs/job-queue.service';
import { UploadsService } from '../uploads/uploads.service';

export interface ProjectView {
  id: string;
  name: string;
  client_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  start_date: string | null;
  target_end_date: string | null;
  /** Paise, serialised as a string so JSON never carries a lossy number. */
  budget_amount: string | null;
  status: string;
}

export interface ProjectListItem extends ProjectView {
  /** Signed photo URLs for the card carousel, the chosen cover first. Empty when there are none. */
  covers: Array<{ id: string; url: string }>;
  photo_count: number;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    /** Signs the cover thumbnails on the sites list. Local HMAC — no network call per row. */
    private readonly uploads: UploadsService,
    /** Queues thumbnail generation when a photo is attached. */
    private readonly jobs: JobQueueService,
  ) {}

  async list(actor: RequestUser, query: ListProjectsQuery): Promise<Page<ProjectListItem>> {
    const rows = await this.tenantDb.clientFor(actor.tenantId).project.findMany({
      where: {
        deletedAt: null,
        ...this.access.scopeFilter(actor),
        ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}),
      },
      select: selectProject,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One extra row tells us whether another page exists without a second count
      // query — the dashboard has a 500 ms budget (spec §15).
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const covers = await this.coversFor(
      actor,
      items.map((row) => row.id),
    );

    return {
      items: items.map((row) => ({ ...toView(row), ...(covers.get(row.id) ?? EMPTY_COVER) })),
      next_cursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async get(actor: RequestUser, projectId: string): Promise<ProjectView> {
    await this.access.assertAccess(actor, projectId);
    const project = await this.tenantDb
      .clientFor(actor.tenantId)
      .project.findFirst({ where: { id: projectId, deletedAt: null }, select: selectProject });
    if (!project) throw ApiError.notFound('Project');
    return toView(project);
  }

  async create(actor: RequestUser, input: CreateProjectInput): Promise<ProjectView> {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const project = await tx.project.create({
        data: {
          tenantId: actor.tenantId,
          name: input.name,
          clientName: input.client_name,
          address: input.address,
          lat: input.lat,
          lng: input.lng,
          startDate: input.start_date ? isoDateToUtcDate(input.start_date) : null,
          targetEndDate: input.target_end_date ? isoDateToUtcDate(input.target_end_date) : null,
          budgetAmount: input.budget_amount,
          status: input.status,
        },
        select: selectProject,
      });

      // The creator is added as a member so a PM who creates a project does not
      // immediately lose sight of it — their token only lists assigned projects.
      await tx.projectMember.create({
        data: {
          tenantId: actor.tenantId,
          projectId: project.id,
          userId: actor.userId,
          roleOnProject: actor.role,
        },
      });

      return toView(project);
    });
  }

  async update(
    actor: RequestUser,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectView> {
    await this.access.assertAccess(actor, projectId);

    const project = await this.tenantDb.clientFor(actor.tenantId).project.update({
      where: { id: projectId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.client_name === undefined ? {} : { clientName: input.client_name }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.lat === undefined ? {} : { lat: input.lat }),
        ...(input.lng === undefined ? {} : { lng: input.lng }),
        ...(input.start_date === undefined
          ? {}
          : { startDate: isoDateToUtcDate(input.start_date) }),
        ...(input.target_end_date === undefined
          ? {}
          : { targetEndDate: isoDateToUtcDate(input.target_end_date) }),
        ...(input.budget_amount === undefined ? {} : { budgetAmount: input.budget_amount }),
        ...(input.status === undefined ? {} : { status: input.status }),
      },
      select: selectProject,
    });
    return toView(project);
  }

  async addMember(actor: RequestUser, projectId: string, input: AddProjectMemberInput) {
    await this.access.assertAccess(actor, projectId);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      // RLS confines this read to the tenant, so a user id from elsewhere reads as
      // simply not existing.
      const user = await tx.user.findFirst({
        where: { id: input.user_id, deletedAt: null },
        select: { id: true },
      });
      if (!user) throw ApiError.notFound('User');

      const member = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId, userId: input.user_id } },
        create: {
          tenantId: actor.tenantId,
          projectId,
          userId: input.user_id,
          roleOnProject: input.role_on_project,
        },
        update: { roleOnProject: input.role_on_project },
        select: { id: true, userId: true, roleOnProject: true },
      });

      return { id: member.id, user_id: member.userId, role_on_project: member.roleOnProject };
    });
  }

  /**
   * Take somebody off a site.
   *
   * A hard delete, unlike most of the app: this row is an assignment, not a record of anything that
   * happened. The reports they filed and the attendance they marked stay exactly where they are —
   * those rows name the user, not the membership.
   *
   * Whoever runs the whole company keeps seeing the site regardless; membership is what scopes the
   * people who only see what they are put on.
   */
  async removeMember(actor: RequestUser, projectId: string, userId: string) {
    await this.access.assertAccess(actor, projectId);
    const removed = await this.tenantDb
      .clientFor(actor.tenantId)
      .projectMember.deleteMany({ where: { projectId, userId } });
    if (removed.count === 0) throw ApiError.notFound('That person is not on this site');
  }

  async listMembers(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    const members = await this.tenantDb.clientFor(actor.tenantId).projectMember.findMany({
      where: { projectId },
      select: {
        id: true,
        roleOnProject: true,
        user: { select: { id: true, name: true, phone: true, role: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((member) => ({
      id: member.id,
      role_on_project: member.roleOnProject,
      user: member.user,
    }));
  }

  async addMilestone(actor: RequestUser, projectId: string, input: CreateMilestoneInput) {
    await this.access.assertAccess(actor, projectId);
    const milestone = await this.tenantDb.clientFor(actor.tenantId).milestone.create({
      data: {
        tenantId: actor.tenantId,
        projectId,
        name: input.name,
        plannedDate: input.planned_date ? isoDateToUtcDate(input.planned_date) : null,
        actualDate: input.actual_date ? isoDateToUtcDate(input.actual_date) : null,
        sortOrder: input.sort_order,
      },
      select: { id: true, name: true, plannedDate: true, actualDate: true, sortOrder: true },
    });
    return milestoneView(milestone);
  }

  async listMilestones(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    const milestones = await this.tenantDb.clientFor(actor.tenantId).milestone.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, name: true, plannedDate: true, actualDate: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { plannedDate: 'asc' }],
    });
    return milestones.map(milestoneView);
  }

  async updateMilestone(
    actor: RequestUser,
    projectId: string,
    milestoneId: string,
    input: UpdateMilestoneInput,
  ) {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    // Scoped by projectId as well as id: the id alone is tenant-safe thanks to RLS,
    // but a milestone from a sibling project would otherwise be editable through
    // this project's URL.
    const existing = await db.milestone.findFirst({
      where: { id: milestoneId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw ApiError.notFound('That milestone no longer exists');

    const milestone = await db.milestone.update({
      where: { id: milestoneId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.planned_date === undefined
          ? {}
          : { plannedDate: input.planned_date ? isoDateToUtcDate(input.planned_date) : null }),
        ...(input.actual_date === undefined
          ? {}
          : { actualDate: input.actual_date ? isoDateToUtcDate(input.actual_date) : null }),
        ...(input.sort_order === undefined ? {} : { sortOrder: input.sort_order }),
      },
      select: { id: true, name: true, plannedDate: true, actualDate: true, sortOrder: true },
    });
    return milestoneView(milestone);
  }

  /**
   * Renumbers the whole timeline in one transaction, so the list is never half
   * reordered if a later write fails.
   */
  async reorderMilestones(
    actor: RequestUser,
    projectId: string,
    input: ReorderMilestonesInput,
  ): Promise<void> {
    await this.access.assertAccess(actor, projectId);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const live = await tx.milestone.findMany({
        where: { projectId, deletedAt: null },
        select: { id: true },
      });
      const known = new Set(live.map((row) => row.id));
      // All or nothing: a partial list would renumber some rows and leave the rest
      // colliding on whatever order they had.
      if (input.milestone_ids.length !== known.size ||
          input.milestone_ids.some((id) => !known.has(id))) {
        throw ApiError.validationFailed(
          { milestone_ids: 'must list every milestone in the project exactly once' },
          'Send every milestone in the project, in its new order',
        );
      }

      for (const [index, id] of input.milestone_ids.entries()) {
        await tx.milestone.update({ where: { id }, data: { sortOrder: index } });
      }
    });
  }

  /** Soft delete, like everything else a user can edit (spec §7). */
  async deleteMilestone(
    actor: RequestUser,
    projectId: string,
    milestoneId: string,
  ): Promise<void> {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.milestone.findFirst({
      where: { id: milestoneId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw ApiError.notFound('That milestone no longer exists');

    await db.milestone.update({
      where: { id: milestoneId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * The newest photo of each site, as a URL the list can render directly.
   *
   * Signed here rather than by the client asking per card. Signing is local HMAC with no network
   * call, so twenty of them cost nothing on the server — while twenty round trips from the browser
   * would be the slowest thing on the page.
   *
   * Photos only. A video's first frame is not a thumbnail without decoding it, which belongs in the
   * media worker alongside the thumbnails it already generates.
   */
  private async coversFor(
    actor: RequestUser,
    projectIds: string[],
  ): Promise<Map<string, { covers: Array<{ id: string; url: string }>; photo_count: number }>> {
    const result = new Map<
      string,
      { covers: Array<{ id: string; url: string }>; photo_count: number }
    >();
    if (projectIds.length === 0) return result;

    const db = this.tenantDb.clientFor(actor.tenantId);
    const [photos, counts] = await Promise.all([
      db.projectMedia.findMany({
        where: { projectId: { in: projectIds }, kind: 'photo', deletedAt: null },
        select: { id: true, projectId: true, s3Key: true, thumbS3Key: true },
        // Gallery order, so the card leads with the photo sitting first in the gallery.
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      }),
      db.projectMedia.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds }, deletedAt: null },
        _count: { _all: true },
      }),
    ]);

    const countByProject = new Map(counts.map((row) => [row.projectId, row._count._all]));
    const byProject = new Map<string, typeof photos>();
    for (const photo of photos) {
      const list = byProject.get(photo.projectId) ?? [];
      // Capped: the card is a carousel, not an album. Six is more than anybody swipes from a list,
      // and every extra is a signed URL nobody looks at.
      if (list.length < CARD_CAROUSEL_LIMIT) list.push(photo);
      byProject.set(photo.projectId, list);
    }

    for (const projectId of projectIds) {
      const list = byProject.get(projectId) ?? [];
      const covers: Array<{ id: string; url: string }> = [];
      for (const photo of list) {
        const url = await this.uploads.signedViewUrl(actor, photo.thumbS3Key ?? photo.s3Key);
        // A row whose object has gone is skipped rather than rendered as a broken frame.
        if (url) covers.push({ id: photo.id, url });
      }
      result.set(projectId, { covers, photo_count: countByProject.get(projectId) ?? 0 });
    }
    return result;
  }

  /**
   * Attach a photo or video to the site.
   *
   * The bytes went straight to S3 through a presigned URL; this records that they exist. The key is
   * checked against the caller's tenant prefix for the same reason the view URL is — a key is not a
   * capability, and one from another builder must not be attachable to this project.
   */
  async addMedia(actor: RequestUser, projectId: string, input: AddProjectMediaInput) {
    await this.access.assertAccess(actor, projectId);

    if (!input.s3_key.startsWith(`${actor.tenantId}/`)) {
      throw ApiError.forbidden('That file does not belong to this account');
    }

    const db = this.tenantDb.clientFor(actor.tenantId);

    if (input.client_id) {
      const existing = await db.projectMedia.findFirst({
        where: { clientId: input.client_id },
        select: MEDIA_SELECT,
      });
      if (existing) return mediaView(existing);
    }

    /*
     * A new file goes to the front, which is where the newest photograph of a site belongs until
     * somebody says otherwise. Two uploads racing can land on the same position; `created_at`
     * breaks the tie, so the order is still total — and both are about to be dragged anyway.
     */
    const front = await db.projectMedia.aggregate({
      where: { projectId, deletedAt: null },
      _min: { position: true },
    });
    const position = (front._min.position ?? 0) - 1;

    const media = await db.projectMedia.create({
      data: {
        tenantId: actor.tenantId,
        projectId,
        position,
        kind: input.kind,
        s3Key: input.s3_key,
        contentType: input.content_type,
        sizeBytes: input.size_bytes,
        caption: input.caption ?? null,
        takenAt: input.taken_at ? new Date(input.taken_at) : null,
        uploadedBy: actor.userId,
        clientId: input.client_id ?? null,
      },
      select: MEDIA_SELECT,
    });

    /*
     * A site gallery shows these at 190 pixels and the sites list at 340. Serving a 2 MB phone
     * capture for each is what makes the page unusable on mobile data — which is the only data a
     * site has. Videos are skipped: a first frame needs decoding, which is a different job.
     */
    if (media.kind === 'photo') {
      await this.jobs.generateThumbnail({
        tenantId: actor.tenantId,
        kind: 'project_media',
        mediaId: media.id,
        s3Key: input.s3_key,
      });
    }

    return mediaView(media);
  }

  async listMedia(actor: RequestUser, projectId: string) {
    await this.access.assertAccess(actor, projectId);
    const media = await this.tenantDb.clientFor(actor.tenantId).projectMedia.findMany({
      where: { projectId, deletedAt: null },
      select: MEDIA_SELECT,
      // The order the builder arranged, newest-first until they arrange it.
      orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });

    /*
     * Anything still without a thumbnail asks for one, here, on the way past.
     *
     * Photos uploaded before thumbnails existed would otherwise stay full-size forever, and a
     * migration that scanned every tenant's media would need a privileged connection this codebase
     * deliberately does not hand out. Looking at a gallery is exactly when the thumbnails are worth
     * having, and the job id is derived from the row, so a hundred page loads still queue one job.
     */
    for (const row of media) {
      if (row.kind === 'photo' && !row.thumbS3Key) {
        await this.jobs.generateThumbnail({
          tenantId: actor.tenantId,
          kind: 'project_media',
          mediaId: row.id,
          s3Key: row.s3Key,
        });
      }
    }

    return media.map(mediaView);
  }

  /**
   * Caption a file.
   *
   * Which photo leads the site is a matter of order, not a flag — see `reorderMedia`.
   */
  async updateMedia(
    actor: RequestUser,
    projectId: string,
    mediaId: string,
    input: UpdateProjectMediaInput,
  ) {
    await this.access.assertAccess(actor, projectId);

    const db = this.tenantDb.clientFor(actor.tenantId);
    const existing = await db.projectMedia.findFirst({
      where: { id: mediaId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw ApiError.notFound('That file no longer exists');

    const media = await db.projectMedia.update({
      where: { id: mediaId },
      data: { ...(input.caption === undefined ? {} : { caption: input.caption }) },
      select: MEDIA_SELECT,
    });
    return mediaView(media);
  }

  /**
   * Rearrange a site's photos and videos.
   *
   * The ids sent take the front in the order given; anything live and unmentioned keeps its
   * relative order behind them. That is what lets "make this the main image" be a request carrying
   * one id, and it also means a client working from a stale list cannot scramble the rest.
   *
   * Positions are rewritten as a dense 0..n-1 run inside one transaction, so a reader either sees
   * the old arrangement or the new one — never a half-applied shuffle where two photos both think
   * they are first.
   */
  async reorderMedia(actor: RequestUser, projectId: string, input: ReorderProjectMediaInput) {
    await this.access.assertAccess(actor, projectId);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const live = await tx.projectMedia.findMany({
        where: { projectId, deletedAt: null },
        select: { id: true },
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
      });
      const ids = new Set(live.map((row) => row.id));

      const wanted = [...new Set(input.media_ids)];
      const missing = wanted.filter((id) => !ids.has(id));
      if (missing.length > 0) {
        // Names the ids rather than saying "not found": the client is holding a stale list and the
        // useful thing is knowing which entries have gone.
        throw ApiError.conflict('Some of those files are no longer on this site', {
          media_ids: missing,
        });
      }

      const ordered = [...wanted, ...live.map((row) => row.id).filter((id) => !wanted.includes(id))];
      await Promise.all(
        ordered.map((id, position) =>
          tx.projectMedia.update({ where: { id }, data: { position } }),
        ),
      );

      const media = await tx.projectMedia.findMany({
        where: { projectId, deletedAt: null },
        select: MEDIA_SELECT,
        orderBy: [{ position: 'asc' }, { createdAt: 'desc' }],
        take: 200,
      });
      return media.map(mediaView);
    });
  }

  /**
   * Soft delete. The object stays in S3 deliberately: a photograph removed by mistake is
   * unrecoverable once the bytes are gone, and storage is cheap next to a site record nobody can get
   * back. A retention sweep can collect them later, when somebody has decided how long is long enough.
   */
  async removeMedia(actor: RequestUser, projectId: string, mediaId: string): Promise<void> {
    await this.access.assertAccess(actor, projectId);
    const db = this.tenantDb.clientFor(actor.tenantId);

    const existing = await db.projectMedia.findFirst({
      where: { id: mediaId, projectId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw ApiError.notFound('That file no longer exists');

    await db.projectMedia.update({ where: { id: mediaId }, data: { deletedAt: new Date() } });
  }

  /** Soft delete (spec §7): the DPR and attendance history has to survive. */
  async archive(actor: RequestUser, projectId: string): Promise<void> {
    await this.access.assertAccess(actor, projectId);
    await this.tenantDb.clientFor(actor.tenantId).project.update({
      where: { id: projectId },
      data: { deletedAt: new Date(), status: 'completed' },
    });
  }
}

const selectProject = {
  id: true,
  name: true,
  clientName: true,
  address: true,
  lat: true,
  lng: true,
  startDate: true,
  targetEndDate: true,
  budgetAmount: true,
  status: true,
} as const;

interface ProjectRow {
  id: string;
  name: string;
  clientName: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  startDate: Date | null;
  targetEndDate: Date | null;
  budgetAmount: bigint | null;
  status: string;
}

interface MilestoneRow {
  id: string;
  name: string;
  plannedDate: Date | null;
  actualDate: Date | null;
  sortOrder: number;
}

function milestoneView(milestone: MilestoneRow) {
  return {
    id: milestone.id,
    name: milestone.name,
    planned_date: milestone.plannedDate ? utcDateToIsoDate(milestone.plannedDate) : null,
    actual_date: milestone.actualDate ? utcDateToIsoDate(milestone.actualDate) : null,
    sort_order: milestone.sortOrder,
  };
}

function toView(project: ProjectRow): ProjectView {
  return {
    id: project.id,
    name: project.name,
    client_name: project.clientName,
    address: project.address,
    lat: project.lat,
    lng: project.lng,
    start_date: project.startDate ? utcDateToIsoDate(project.startDate) : null,
    target_end_date: project.targetEndDate ? utcDateToIsoDate(project.targetEndDate) : null,
    budget_amount: project.budgetAmount === null ? null : project.budgetAmount.toString(),
    status: project.status,
  };
}

const MEDIA_SELECT = {
  id: true,
  kind: true,
  s3Key: true,
  thumbS3Key: true,
  caption: true,
  position: true,
  contentType: true,
  sizeBytes: true,
  takenAt: true,
  createdAt: true,
  uploader: { select: { id: true, name: true } },
} as const;

function mediaView(row: {
  id: string;
  kind: string;
  s3Key: string;
  thumbS3Key: string | null;
  caption: string | null;
  position: number;
  contentType: string;
  sizeBytes: number;
  takenAt: Date | null;
  createdAt: Date;
  uploader: { id: string; name: string };
}) {
  return {
    id: row.id,
    kind: row.kind,
    s3_key: row.s3Key,
    thumb_s3_key: row.thumbS3Key,
    caption: row.caption,
    position: row.position,
    content_type: row.contentType,
    size_bytes: row.sizeBytes,
    taken_at: row.takenAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    uploaded_by: { id: row.uploader.id, name: row.uploader.name },
  };
}

/** A site with no photographs. Spelled out so the shape never varies between rows. */
const EMPTY_COVER: Pick<ProjectListItem, 'covers' | 'photo_count'> = { covers: [], photo_count: 0 };

/** How many photos the card carousel carries. More is signed URLs nobody looks at. */
const CARD_CAROUSEL_LIMIT = 6;
