import { Injectable } from '@nestjs/common';
import {
  isoDateToUtcDate,
  utcDateToIsoDate,
  type CreateDprInput,
  type ListDprQuery,
  type Page,
  type UpdateDprInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { JobQueueService } from '../../jobs/job-queue.service';

const SELECT = {
  id: true,
  projectId: true,
  reportDate: true,
  weather: true,
  workDone: true,
  issues: true,
  status: true,
  submittedAt: true,
  clientId: true,
  project: { select: { name: true } },
  submitter: { select: { id: true, name: true } },
  activities: { select: { id: true, activity: true, quantity: true, unit: true } },
  manpower: { select: { id: true, trade: true, count: true } },
  photos: { select: { id: true, s3Key: true, thumbS3Key: true, caption: true, takenAt: true } },
} as const;

@Injectable()
export class DprService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly jobs: JobQueueService,
  ) {}

  async list(actor: RequestUser, query: ListDprQuery): Promise<Page<ReturnType<typeof toView>>> {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);

    const rows = await this.tenantDb.clientFor(actor.tenantId).dailyReport.findMany({
      where: {
        deletedAt: null,
        ...(query.project_id
          ? { projectId: query.project_id }
          : this.access.scopeFilterByProjectId(actor)),
        ...(query.status ? { status: query.status } : {}),
        ...(query.from || query.to
          ? {
              reportDate: {
                ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
              },
            }
          : {}),
      },
      select: SELECT,
      orderBy: [{ reportDate: 'desc' }, { id: 'desc' }],
      ...cursorArgs(query),
    });
    return toPage(rows, query.limit, toView);
  }

  async get(actor: RequestUser, id: string) {
    const report = await this.tenantDb
      .clientFor(actor.tenantId)
      .dailyReport.findFirst({ where: { id, deletedAt: null }, select: SELECT });
    if (!report) throw ApiError.notFound('Daily report');
    await this.access.assertAccess(actor, report.projectId);
    return toView(report);
  }

  /**
   * Create or replace the report for a site and date.
   *
   * One report per site per day is a database constraint, so a supervisor who
   * submits twice — or whose outbox retries — updates the existing report rather
   * than colliding. `client_id` short-circuits that entirely when present.
   */
  async create(actor: RequestUser, input: CreateDprInput) {
    await this.access.assertAccess(actor, input.project_id);
    const reportDate = isoDateToUtcDate(input.report_date);

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.dailyReport.findFirst({
          where: { clientId: input.client_id },
          select: { id: true },
        });
        if (existing) {
          await this.replaceChildren(tx, actor, existing.id, input);
          const updated = await tx.dailyReport.update({
            where: { id: existing.id },
            data: {
              weather: input.weather,
              workDone: input.work_done,
              issues: input.issues,
              status: input.status,
              ...(input.status === 'submitted' ? { submittedAt: new Date() } : {}),
            },
            select: SELECT,
          });
          return toView(updated);
        }
      }

      const report = await tx.dailyReport.upsert({
        where: { projectId_reportDate: { projectId: input.project_id, reportDate } },
        create: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          reportDate,
          submittedBy: actor.userId,
          weather: input.weather,
          workDone: input.work_done,
          issues: input.issues,
          status: input.status,
          submittedAt: input.status === 'submitted' ? new Date() : null,
          clientId: input.client_id,
        },
        update: {
          weather: input.weather,
          workDone: input.work_done,
          issues: input.issues,
          status: input.status,
          deletedAt: null,
          ...(input.status === 'submitted' ? { submittedAt: new Date() } : {}),
        },
        select: { id: true },
      });

      await this.replaceChildren(tx, actor, report.id, input);

      const full = await tx.dailyReport.findUniqueOrThrow({
        where: { id: report.id },
        select: SELECT,
      });
      return toView(full);
    });
  }

  async update(actor: RequestUser, id: string, input: UpdateDprInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const report = await tx.dailyReport.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, projectId: true, status: true },
      });
      if (!report) throw ApiError.notFound('Daily report');
      await this.access.assertAccess(actor, report.projectId);

      // A submitted report is the record of what happened that day. Editing it
      // would quietly rewrite history the owner has already read.
      if (report.status === 'submitted') {
        throw ApiError.conflict('This report has been submitted and can no longer be edited');
      }

      if (input.activities || input.manpower || input.photos) {
        await this.replaceChildren(tx, actor, id, {
          project_id: report.projectId,
          activities: input.activities,
          manpower: input.manpower,
          photos: input.photos,
        });
      }

      const updated = await tx.dailyReport.update({
        where: { id },
        data: {
          ...(input.weather === undefined ? {} : { weather: input.weather }),
          ...(input.work_done === undefined ? {} : { workDone: input.work_done }),
          ...(input.issues === undefined ? {} : { issues: input.issues }),
        },
        select: SELECT,
      });
      return toView(updated);
    });
  }

  /**
   * Soft delete a daily report — drafts only.
   *
   * A submitted DPR is the site's record of what happened that day, and it is what
   * the client portal and every progress report are built from. Once it is in, the
   * way to correct it is to edit it, not to make the day disappear.
   */
  async archive(actor: RequestUser, id: string): Promise<void> {
    const db = this.tenantDb.clientFor(actor.tenantId);
    const report = await db.dailyReport.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, projectId: true, status: true, submittedBy: true },
    });
    if (!report) throw ApiError.notFound('Daily report');
    await this.access.assertAccess(actor, report.projectId);

    if (report.status === 'submitted') {
      throw ApiError.conflict(
        'A submitted report is the record for that day. Edit it instead of deleting it.',
      );
    }
    // A supervisor may discard their own draft; an owner or PM may discard any.
    if (report.submittedBy !== actor.userId && !['owner', 'project_manager'].includes(actor.role)) {
      throw ApiError.forbidden('Only the person who started this draft can discard it');
    }

    await db.dailyReport.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async submit(actor: RequestUser, id: string) {
    const result = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const report = await tx.dailyReport.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, projectId: true, status: true },
      });
      if (!report) throw ApiError.notFound('Daily report');
      await this.access.assertAccess(actor, report.projectId);

      // Submitting twice is a no-op rather than an error: the mobile app retries.
      if (report.status === 'submitted') {
        const already = await tx.dailyReport.findUniqueOrThrow({ where: { id }, select: SELECT });
        return { view: toView(already), changed: false };
      }

      const submitted = await tx.dailyReport.update({
        where: { id },
        data: { status: 'submitted', submittedAt: new Date(), submittedBy: actor.userId },
        select: SELECT,
      });
      return { view: toView(submitted), changed: true };
    });

    // Only a fresh submission notifies. A retry that found the report already
    // submitted must not push the owner a second time.
    if (result.changed) {
      await this.jobs.dprSubmitted({ tenantId: actor.tenantId, dailyReportId: id });
    }
    return result.view;
  }

  /**
   * Activities, manpower and photos are always sent as complete lists — the mobile
   * form has them all in memory — so replacing beats diffing, and it cannot leave
   * an orphan row from a deleted line.
   */
  private async replaceChildren(
    tx: TenantTx,
    actor: RequestUser,
    reportId: string,
    input: {
      project_id: string;
      activities?: CreateDprInput['activities'];
      manpower?: CreateDprInput['manpower'];
      photos?: CreateDprInput['photos'];
    },
  ): Promise<void> {
    if (input.activities) {
      await tx.dprActivity.deleteMany({ where: { dailyReportId: reportId } });
      if (input.activities.length > 0) {
        await tx.dprActivity.createMany({
          data: input.activities.map((activity) => ({
            tenantId: actor.tenantId,
            dailyReportId: reportId,
            activity: activity.activity,
            quantity: activity.quantity ?? null,
            unit: activity.unit ?? null,
          })),
        });
      }
    }

    if (input.manpower) {
      await tx.dprManpower.deleteMany({ where: { dailyReportId: reportId } });
      if (input.manpower.length > 0) {
        await tx.dprManpower.createMany({
          data: input.manpower.map((entry) => ({
            tenantId: actor.tenantId,
            dailyReportId: reportId,
            trade: entry.trade,
            count: entry.count,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (input.photos) {
      // Photos upload asynchronously and can arrive after the report is filed, so
      // new keys are added rather than replacing the set.
      const existing = await tx.dprPhoto.findMany({
        where: { dailyReportId: reportId },
        select: { s3Key: true },
      });
      const known = new Set(existing.map((photo) => photo.s3Key));
      const fresh = input.photos.filter((photo) => !known.has(photo.s3_key));
      if (fresh.length > 0) {
        await tx.dprPhoto.createMany({
          data: fresh.map((photo) => ({
            tenantId: actor.tenantId,
            dailyReportId: reportId,
            s3Key: photo.s3_key,
            caption: photo.caption ?? null,
            takenAt: photo.taken_at ? new Date(photo.taken_at) : null,
          })),
        });

        // The DPR feed shows these at thumbnail size; serving the full 1600px
        // capture for each is what makes the page unusable on 3G.
        const stored = await tx.dprPhoto.findMany({
          where: { dailyReportId: reportId, s3Key: { in: fresh.map((p) => p.s3_key) } },
          select: { id: true, s3Key: true },
        });
        for (const photo of stored) {
          await this.jobs.generateThumbnail({
            tenantId: actor.tenantId,
            kind: 'dpr_photo',
            mediaId: photo.id,
            s3Key: photo.s3Key,
          });
        }
      }
    }
  }
}

function toView(row: {
  id: string;
  projectId: string;
  reportDate: Date;
  weather: string | null;
  workDone: string | null;
  issues: string | null;
  status: string;
  submittedAt: Date | null;
  clientId: string | null;
  project: { name: string };
  submitter: { id: string; name: string };
  activities: Array<{ id: string; activity: string; quantity: unknown; unit: string | null }>;
  manpower: Array<{ id: string; trade: string; count: number }>;
  photos: Array<{
    id: string;
    s3Key: string;
    thumbS3Key: string | null;
    caption: string | null;
    takenAt: Date | null;
  }>;
}) {
  return {
    id: row.id,
    project_id: row.projectId,
    project_name: row.project.name,
    report_date: utcDateToIsoDate(row.reportDate),
    weather: row.weather,
    work_done: row.workDone,
    issues: row.issues,
    status: row.status,
    submitted_at: row.submittedAt?.toISOString() ?? null,
    submitted_by: { id: row.submitter.id, name: row.submitter.name },
    client_id: row.clientId,
    headcount: row.manpower.reduce((sum, entry) => sum + entry.count, 0),
    activities: row.activities.map((activity) => ({
      id: activity.id,
      activity: activity.activity,
      quantity: activity.quantity === null ? null : String(activity.quantity),
      unit: activity.unit,
    })),
    manpower: row.manpower.map((entry) => ({
      id: entry.id,
      trade: entry.trade,
      count: entry.count,
    })),
    photos: row.photos.map((photo) => ({
      id: photo.id,
      s3_key: photo.s3Key,
      thumb_s3_key: photo.thumbS3Key,
      caption: photo.caption,
      taken_at: photo.takenAt?.toISOString() ?? null,
    })),
  };
}

export type DprView = ReturnType<typeof toView>;
