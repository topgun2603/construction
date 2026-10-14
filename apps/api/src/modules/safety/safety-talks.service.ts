import { Injectable } from '@nestjs/common';
import {
  SAFETY_TOOLBOX_TOPICS,
  addDays,
  isoDateToUtcDate,
  safetyCoverage,
  utcDateToIsoDate,
  type CreateSafetyToolboxTalkInput,
  type ListSafetyToolboxTalksQuery,
  type SafetyCoverageQuery,
  type SafetyRollQuery,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { UploadsService } from '../uploads/uploads.service';
import { dayRange } from './safety-incidents.service';
import { PHOTO_SELECT, addPhotos, assertSafetyPhotoKey, companyToday, namesFor, person, photoView } from './safety-common';

/**
 * Toolbox talks (roadmap Phase 2, module 8): the short safety briefing before a shift. Attendees are
 * picked from that day's roll call, so a talk can only claim people who were actually on site, and
 * the coverage view can say what share of the week's workforce heard one.
 */
@Injectable()
export class SafetyTalksService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
  ) {}

  /** Who was on site that day: everybody on the roll who was not marked absent. */
  async roll(actor: RequestUser, query: SafetyRollQuery) {
    await this.access.assertAccess(actor, query.project_id);
    const rows = await this.tenantDb.clientFor(actor.tenantId).attendance.findMany({
      where: {
        projectId: query.project_id,
        attendanceDate: isoDateToUtcDate(query.date),
        status: { not: 'absent' },
      },
      select: { status: true, worker: { select: { id: true, name: true, trade: true } } },
      orderBy: { worker: { name: 'asc' } },
    });
    return {
      date: query.date,
      items: rows.map((row) => ({
        worker_id: row.worker.id,
        name: row.worker.name,
        trade: row.worker.trade,
        status: row.status,
      })),
    };
  }

  async list(actor: RequestUser, query: ListSafetyToolboxTalksQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.safetyToolboxTalk.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...dayRange('talkDate', query.from, query.to),
          project: { deletedAt: null },
        },
        include: {
          project: { select: { id: true, name: true } },
          attendees: { select: { signedAt: true } },
        },
        orderBy: [{ talkDate: 'desc' }, { createdAt: 'desc' }],
        take: query.limit,
      });
      const names = await namesFor(tx, rows.map((row) => row.presenterId));
      return {
        items: rows.map((row) => ({
          id: row.id,
          project: row.project,
          talk_date: utcDateToIsoDate(row.talkDate),
          topic: row.topic,
          topic_key: row.topicKey,
          presenter: person(names, row.presenterId),
          duration_minutes: row.durationMinutes,
          attendees: row.attendees.length,
          signed: row.attendees.filter((a) => a.signedAt).length,
        })),
      };
    });
  }

  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      const names = await namesFor(tx, [row.presenterId, row.createdBy, ...row.photos.map((p) => p.uploadedBy)]);
      const photos = await Promise.all(
        row.photos.map(async (photo) => ({
          ...photoView(photo, names),
          url: await this.uploads.signedViewUrl(actor, photo.s3Key),
        })),
      );
      return {
        id: row.id,
        project: row.project,
        talk_date: utcDateToIsoDate(row.talkDate),
        topic: row.topic,
        topic_key: row.topicKey,
        notes: row.notes,
        presenter: person(names, row.presenterId),
        duration_minutes: row.durationMinutes,
        created_by: person(names, row.createdBy),
        attendees: row.attendees.map((a) => ({
          worker_id: a.worker.id,
          name: a.worker.name,
          trade: a.worker.trade,
          signed_at: a.signedAt?.toISOString() ?? null,
        })),
        photos,
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  async create(actor: RequestUser, input: CreateSafetyToolboxTalkInput) {
    await this.access.assertAccess(actor, input.project_id);
    if (input.talk_date > companyToday(actor)) {
      throw ApiError.validationFailed({ talk_date: input.talk_date }, 'A talk is recorded after it is given');
    }
    const libraryTopic = input.topic_key
      ? SAFETY_TOOLBOX_TOPICS.find((topic) => topic.key === input.topic_key)
      : undefined;
    if (input.topic_key && !libraryTopic) {
      throw ApiError.validationFailed({ topic_key: input.topic_key }, 'No such topic in the library');
    }
    for (const key of input.photo_keys ?? []) assertSafetyPhotoKey(actor, key);

    const id = await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.presenter_id) {
        const presenter = await tx.user.findFirst({
          where: { id: input.presenter_id, deletedAt: null },
          select: { id: true },
        });
        if (!presenter) throw ApiError.validationFailed({ presenter_id: input.presenter_id }, 'That person is not on the team');
      }
      await this.assertOnRoll(tx, input.project_id, input.talk_date, input.attendees.map((a) => a.worker_id));
      const now = new Date();
      const made = await tx.safetyToolboxTalk.create({
        data: {
          tenantId: actor.tenantId,
          projectId: input.project_id,
          talkDate: isoDateToUtcDate(input.talk_date),
          topicKey: libraryTopic?.key ?? null,
          topic: input.topic ?? libraryTopic!.title,
          notes: input.notes ?? null,
          presenterId: input.presenter_id ?? actor.userId,
          durationMinutes: input.duration_minutes,
          createdBy: actor.userId,
        },
        select: { id: true },
      });
      const unique = new Map(input.attendees.map((a) => [a.worker_id, a.signed]));
      if (unique.size > 0) {
        await tx.safetyToolboxAttendee.createMany({
          data: [...unique].map(([workerId, signed]) => ({
            tenantId: actor.tenantId,
            talkId: made.id,
            workerId,
            signedAt: signed ? now : null,
          })),
        });
      }
      await addPhotos(tx, actor, input.project_id, { toolboxTalkId: made.id }, input.photo_keys ?? [], 'attendance');
      return made.id;
    });
    return this.get(actor, id);
  }

  /** A worker signs (or thumbprints) the sheet after the talk. */
  async sign(actor: RequestUser, talkId: string, workerId: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.find(tx, actor, talkId);
      const updated = await tx.safetyToolboxAttendee.updateMany({
        where: { talkId, workerId, signedAt: null },
        data: { signedAt: new Date() },
      });
      if (updated.count === 0) {
        const exists = await tx.safetyToolboxAttendee.findFirst({ where: { talkId, workerId }, select: { id: true } });
        if (!exists) throw ApiError.notFound('Attendee');
      }
    });
    return this.get(actor, talkId);
  }

  /**
   * Talks this week, site by site: how many were given, and what share of the people on the roll
   * this week heard at least one. The week runs Monday to Sunday on the company's clock.
   */
  async coverage(actor: RequestUser, query: SafetyCoverageQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const anchor = query.week_of ?? companyToday(actor);
    const day = new Date(`${anchor}T00:00:00Z`).getUTCDay();
    const from = addDays(anchor, day === 0 ? -6 : 1 - day);
    const to = addDays(from, 6);
    const range = { gte: isoDateToUtcDate(from), lte: isoDateToUtcDate(to) };

    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const projects = await tx.project.findMany({
        where: {
          deletedAt: null,
          ...(query.project_id ? { id: query.project_id } : { status: { in: ['active', 'planning'] } }),
          ...this.access.scopeFilter(actor),
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const ids = projects.map((project) => project.id);
      const [talks, roll] = await Promise.all([
        tx.safetyToolboxTalk.findMany({
          where: { projectId: { in: ids }, talkDate: range },
          select: { projectId: true, talkDate: true, attendees: { select: { workerId: true } } },
        }),
        tx.attendance.findMany({
          where: { projectId: { in: ids }, attendanceDate: range, status: { not: 'absent' } },
          select: { projectId: true, workerId: true },
          distinct: ['projectId', 'workerId'],
        }),
      ]);

      const sites = projects.map((project) => {
        const own = talks.filter((talk) => talk.projectId === project.id);
        const attended = new Set(own.flatMap((talk) => talk.attendees.map((a) => a.workerId)));
        const onRoll = new Set(roll.filter((row) => row.projectId === project.id).map((row) => row.workerId));
        const reached = [...attended].filter((workerId) => onRoll.has(workerId)).length;
        const last = own.map((talk) => utcDateToIsoDate(talk.talkDate)).sort().at(-1) ?? null;
        return {
          project_id: project.id,
          project_name: project.name,
          talks: own.length,
          attendees: attended.size,
          on_roll: onRoll.size,
          coverage_percent: safetyCoverage(reached, onRoll.size),
          last_talk_on: last,
        };
      });
      return {
        week_from: from,
        week_to: to,
        talks: sites.reduce((sum, site) => sum + site.talks, 0),
        sites,
      };
    });
  }

  private async find(tx: TenantTx, actor: RequestUser, id: string) {
    const row = await tx.safetyToolboxTalk.findFirst({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        attendees: {
          include: { worker: { select: { id: true, name: true, trade: true } } },
          orderBy: { worker: { name: 'asc' } },
        },
        photos: { select: PHOTO_SELECT, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!row) throw ApiError.notFound('Toolbox talk');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  /** Every attendee must be on that day's roll for that site, not absent. */
  private async assertOnRoll(tx: TenantTx, projectId: string, date: string, workerIds: readonly string[]) {
    if (workerIds.length === 0) return;
    const present = await tx.attendance.findMany({
      where: {
        projectId,
        attendanceDate: isoDateToUtcDate(date),
        status: { not: 'absent' },
        workerId: { in: [...workerIds] },
      },
      select: { workerId: true },
    });
    const onRoll = new Set(present.map((row) => row.workerId));
    const missing = workerIds.filter((workerId) => !onRoll.has(workerId));
    if (missing.length > 0) {
      throw ApiError.validationFailed(
        { not_on_roll: missing },
        'Some attendees are not on that day’s roll call for this site. Take the roll first.',
      );
    }
  }
}
