import { Injectable, Logger } from '@nestjs/common';
import {
  SAFETY_INCIDENT_TRANSITIONS,
  SAFETY_INCIDENT_TYPE_LABELS,
  isoDateToUtcDate,
  safetyIsRecordable,
  safetyIsSerious,
  safetyNumber,
  type AddSafetyPhotoInput,
  type CreateSafetyActionInput,
  type CreateSafetyIncidentInput,
  type ListSafetyIncidentsQuery,
  type SafetyIncidentPersonInput,
  type SafetyIncidentStatus,
  type SafetyIncidentStatusInput,
  type SafetyIncidentType,
  type UpdateSafetyActionInput,
  type UpdateSafetyIncidentInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { siteActor } from '../../common/site-clock';
import { JobQueueService } from '../../jobs/job-queue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  PHOTO_SELECT,
  actionView,
  addPhotos,
  assertSafetyPhotoKey,
  companyDay,
  companyInstant,
  companyLocal,
  companyToday,
  isoDay,
  namesFor,
  nextSafetyNumber,
  person,
  photoView,
  withNumberRetry,
  type Names,
} from './safety-common';

const INCIDENT_INCLUDE = {
  project: { select: { id: true, name: true } },
  people: { orderBy: { createdAt: 'asc' as const } },
  actions: { orderBy: { createdAt: 'asc' as const } },
  photos: { select: PHOTO_SELECT, orderBy: { createdAt: 'asc' as const } },
};

/**
 * Incidents and near misses (roadmap Phase 2, module 8): who was hurt and how, what was done on
 * the spot, why it happened, and what is being done so it does not happen again.
 *
 * Also owns corrective and preventive actions and safety photos, which incidents and observations
 * share.
 */
@Injectable()
export class SafetyIncidentsService {
  private readonly logger = new Logger(SafetyIncidentsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobQueueService,
    private readonly uploads: UploadsService,
  ) {}

  // --- reading -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListSafetyIncidentsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.safetyIncident.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...(query.status ? { status: query.status } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...dayRange('occurredOn', query.from, query.to),
          project: { deletedAt: null },
        },
        include: {
          project: { select: { id: true, name: true } },
          people: { select: { role: true } },
          actions: { select: { status: true } },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const names = await namesFor(tx, rows.map((row) => row.reportedBy));
      return {
        items: rows.map((row) => ({
          id: row.id,
          number: safetyNumber('INC', row.number),
          project: row.project,
          occurred_at: row.occurredAt.toISOString(),
          occurred_on: isoDay(row.occurredOn),
          type: row.type,
          severity: row.severity,
          title: row.title,
          location: row.location,
          status: row.status,
          injured: row.people.filter((p) => p.role === 'injured').length,
          open_actions: row.actions.filter((a) => a.status === 'open').length,
          reported_by: person(names, row.reportedBy),
          created_at: row.createdAt.toISOString(),
        })),
      };
    });
  }

  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      const names = await namesFor(tx, [
        row.reportedBy,
        row.investigatedBy,
        row.closedBy,
        ...row.actions.flatMap((a) => [a.assigneeId, a.raisedBy, a.doneBy]),
        ...row.photos.map((p) => p.uploadedBy),
      ]);
      return this.detailView(actor, row, names);
    });
  }

  // --- reporting ---------------------------------------------------------------------------------

  async create(actor: RequestUser, input: CreateSafetyIncidentInput) {
    await this.access.assertAccess(actor, input.project_id);
    // The time typed is the site's wall clock, and the day it falls on is the site's day.
    const site = await siteActor(this.tenantDb.clientFor(actor.tenantId), actor, input.project_id);
    const occurredAt = companyInstant(site, input.occurred_at);
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      throw ApiError.validationFailed({ occurred_at: input.occurred_at }, 'That time is in the future');
    }
    for (const key of input.photo_keys ?? []) assertSafetyPhotoKey(actor, key);

    // The same report sent twice on a bad connection is filed once.
    if (input.client_id) {
      const existing = await this.tenantDb
        .clientFor(actor.tenantId)
        .safetyIncident.findFirst({ where: { clientId: input.client_id }, select: { id: true } });
      if (existing) return this.get(actor, existing.id);
    }

    const serious = safetyIsSerious(input.type);
    const id = await withNumberRetry(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        const number = await nextSafetyNumber(tx, 'incident');
        const made = await tx.safetyIncident.create({
          data: {
            tenantId: actor.tenantId,
            projectId: input.project_id,
            number,
            occurredAt,
            occurredOn: companyDay(site, occurredAt),
            type: input.type,
            severity: input.severity ?? defaultSeverity(input.type),
            title: input.title,
            description: input.description ?? null,
            location: input.location ?? null,
            immediateAction: input.immediate_action ?? null,
            lostDays: input.lost_days ?? null,
            reportedBy: actor.userId,
            clientId: input.client_id ?? null,
            // Claimed in the same write, so a retried request cannot alert twice.
            seriousNotifiedAt: serious ? new Date() : null,
          },
          select: { id: true },
        });
        await this.replacePeople(tx, actor, made.id, input.people ?? []);
        await addPhotos(tx, actor, input.project_id, { incidentId: made.id }, input.photo_keys ?? []);
        return made.id;
      }),
    );

    if (serious) await this.alertSerious(actor, id);
    return this.get(actor, id);
  }

  /**
   * Corrections and the investigation: root cause, the five whys, people, lost days. The person who
   * reported it may correct it until somebody starts investigating; after that it is the manager's.
   */
  async update(actor: RequestUser, id: string, input: UpdateSafetyIncidentInput) {
    let becameSerious = false;
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      const manager = can(actor, 'safety.manage');
      if (!manager && !(row.reportedBy === actor.userId && row.status === 'reported')) {
        throw ApiError.forbidden('Only a safety manager can change an incident once it is being investigated');
      }
      if (row.status === 'closed') {
        throw ApiError.conflict('This incident is closed. Reopen it to change it.');
      }
      const site = await siteActor(tx, actor, row.projectId);
      const occurredAt = input.occurred_at ? companyInstant(site, input.occurred_at) : undefined;
      becameSerious =
        input.type !== undefined && safetyIsSerious(input.type) && row.seriousNotifiedAt === null;

      await tx.safetyIncident.update({
        where: { id },
        data: {
          ...(occurredAt ? { occurredAt, occurredOn: companyDay(site, occurredAt) } : {}),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.severity === undefined ? {} : { severity: input.severity }),
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.immediate_action === undefined ? {} : { immediateAction: input.immediate_action }),
          ...(input.lost_days === undefined ? {} : { lostDays: input.lost_days }),
          ...(input.root_cause_whys === undefined
            ? {}
            : { rootCauseWhys: input.root_cause_whys.filter((why) => why.length > 0) }),
          ...(input.root_cause === undefined ? {} : { rootCause: input.root_cause }),
          ...(becameSerious ? { seriousNotifiedAt: new Date() } : {}),
        },
      });
      if (input.people) await this.replacePeople(tx, actor, id, input.people);
    });
    // A first-aid case that turns out to be a lost-time injury tells the owners when it does.
    if (becameSerious) await this.alertSerious(actor, id);
    return this.get(actor, id);
  }

  async setStatus(actor: RequestUser, id: string, input: SafetyIncidentStatusInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      const from = row.status as SafetyIncidentStatus;
      if (!SAFETY_INCIDENT_TRANSITIONS[from].includes(input.status)) {
        throw ApiError.conflict(`A ${from.replace('_', ' ')} incident cannot be made ${input.status.replace('_', ' ')}`, {
          from,
          to: input.status,
        });
      }
      const open = row.actions.filter((action) => action.status === 'open').length;
      if (input.status === 'actions_open' && row.actions.length === 0) {
        throw ApiError.conflict('Raise at least one corrective or preventive action first');
      }
      if (input.status === 'closed') {
        if (open > 0) {
          throw ApiError.conflict(`${open} action${open === 1 ? ' is' : 's are'} still open`, { open });
        }
        // An injury closed without saying why it happened is a file, not an investigation.
        if (safetyIsRecordable(row.type) && !row.rootCause && row.rootCauseWhys.length === 0) {
          throw ApiError.conflict('Record the root cause before closing an injury');
        }
      }
      await tx.safetyIncident.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === 'investigating' && !row.investigatedBy ? { investigatedBy: actor.userId } : {}),
          ...(input.status === 'closed'
            ? { closedBy: actor.userId, closedAt: new Date(), closureNote: input.note ?? null }
            : { closedBy: null, closedAt: null }),
        },
      });
    });
    return this.get(actor, id);
  }

  // --- actions -----------------------------------------------------------------------------------

  async addAction(
    actor: RequestUser,
    parent: { incidentId: string } | { observationId: string },
    input: CreateSafetyActionInput,
  ) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const projectId = await this.parentProject(tx, actor, parent);
      if (input.assignee_id) await assertMember(tx, input.assignee_id);
      const made = await tx.safetyAction.create({
        data: {
          tenantId: actor.tenantId,
          projectId,
          ...parent,
          kind: input.kind,
          description: input.description,
          assigneeId: input.assignee_id ?? null,
          dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null,
          raisedOn: isoDateToUtcDate(companyToday(actor)),
          raisedBy: actor.userId,
        },
      });
      const names = await namesFor(tx, [made.assigneeId, made.raisedBy]);
      return actionView(made, names, companyToday(actor));
    });
  }

  /** A manager edits anything; the person it is assigned to can only mark it done. */
  async updateAction(actor: RequestUser, actionId: string, input: UpdateSafetyActionInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await tx.safetyAction.findFirst({ where: { id: actionId } });
      if (!row) throw ApiError.notFound('Action');
      await this.access.assertAccess(actor, row.projectId);
      const manager = can(actor, 'safety.manage');
      const assigneeClosing =
        row.assigneeId === actor.userId &&
        Object.keys(input).every((key) => key === 'status' || key === 'note') &&
        input.status !== 'cancelled';
      if (!manager && !assigneeClosing) {
        throw ApiError.forbidden('Only a safety manager or the person it is assigned to can change this action');
      }
      if (input.assignee_id) await assertMember(tx, input.assignee_id);
      const closing = input.status !== undefined && input.status !== 'open' && row.status === 'open';
      const updated = await tx.safetyAction.update({
        where: { id: actionId },
        data: {
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.assignee_id === undefined ? {} : { assigneeId: input.assignee_id }),
          ...(input.due_on === undefined
            ? {}
            : { dueOn: input.due_on ? isoDateToUtcDate(input.due_on) : null }),
          ...(input.status === undefined ? {} : { status: input.status }),
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(closing ? { doneBy: actor.userId, doneAt: new Date() } : {}),
          ...(input.status === 'open' ? { doneBy: null, doneAt: null } : {}),
        },
      });
      const names = await namesFor(tx, [updated.assigneeId, updated.raisedBy, updated.doneBy]);
      return actionView(updated, names, companyToday(actor));
    });
  }

  // --- photos ------------------------------------------------------------------------------------

  async addPhoto(actor: RequestUser, input: AddSafetyPhotoInput) {
    assertSafetyPhotoKey(actor, input.s3_key);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const parent = input.incident_id
        ? { incidentId: input.incident_id }
        : input.observation_id
          ? { observationId: input.observation_id }
          : input.permit_id
            ? { permitId: input.permit_id }
            : { toolboxTalkId: input.toolbox_talk_id! };
      const projectId = await this.parentProject(tx, actor, parent);
      const made = await tx.safetyPhoto.create({
        data: {
          tenantId: actor.tenantId,
          projectId,
          ...parent,
          purpose: input.purpose,
          s3Key: input.s3_key,
          caption: input.caption ?? null,
          uploadedBy: actor.userId,
        },
        select: PHOTO_SELECT,
      });
      return photoView(made, await namesFor(tx, [made.uploadedBy]));
    });
  }

  // --- serious incidents -------------------------------------------------------------------------

  /**
   * A lost-time injury or a fatality tells every owner at once — in the app, by push, and on
   * WhatsApp — and the managers on that site. Not at the next review: an owner who hears about a
   * death on their site from the police has been failed by the software they pay for.
   *
   * After the write commits, never inside it: a notification that fails must not un-report the
   * incident.
   */
  private async alertSerious(actor: RequestUser, id: string): Promise<void> {
    const incident = await this.tenantDb.clientFor(actor.tenantId).safetyIncident.findFirst({
      where: { id },
      select: {
        number: true,
        type: true,
        title: true,
        occurredAt: true,
        location: true,
        projectId: true,
        project: { select: { name: true } },
      },
    });
    if (!incident) return;
    const label = SAFETY_INCIDENT_TYPE_LABELS[incident.type as SafetyIncidentType];
    const number = safetyNumber('INC', incident.number);
    const when = companyLocal(
      await siteActor(this.tenantDb.clientFor(actor.tenantId), actor, incident.projectId),
      incident.occurredAt,
    ).replace('T', ' ');
    const notice = {
      tenantId: actor.tenantId,
      type: 'safety_incident.serious',
      title: `${label} on ${incident.project.name}`,
      body: `${number}: ${incident.title}${incident.location ? ` at ${incident.location}` : ''}, ${when}`,
      payload: { incident_id: id, project_id: incident.projectId, number, type: incident.type },
    };
    try {
      // Every owner, whichever sites they are on.
      await this.notifications.notify({ ...notice, roles: ['owner'] });
      // The managers and supervisors of that site.
      await this.notifications.notify({
        ...notice,
        roles: ['project_manager', 'site_supervisor'],
        projectId: incident.projectId,
        exceptUserId: actor.userId,
      });
      await this.jobs.safetyIncidentReported({ tenantId: actor.tenantId, incidentId: id });
    } catch (error) {
      this.logger.error({ err: error, incidentId: id }, 'Could not send the serious-incident alert');
    }
  }

  // --- helpers -----------------------------------------------------------------------------------

  private async find(tx: TenantTx, actor: RequestUser, id: string) {
    const row = await tx.safetyIncident.findFirst({ where: { id }, include: INCIDENT_INCLUDE });
    if (!row) throw ApiError.notFound('Incident');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  private async replacePeople(
    tx: TenantTx,
    actor: RequestUser,
    incidentId: string,
    people: readonly SafetyIncidentPersonInput[],
  ): Promise<void> {
    await tx.safetyIncidentPerson.deleteMany({ where: { incidentId } });
    if (people.length === 0) return;
    const workerIds = people.map((p) => p.worker_id).filter((id): id is string => Boolean(id));
    const workers = await tx.worker.findMany({
      where: { id: { in: workerIds }, deletedAt: null },
      select: { id: true, name: true },
    });
    const byId = new Map(workers.map((worker) => [worker.id, worker.name]));
    const missing = workerIds.filter((workerId) => !byId.has(workerId));
    if (missing.length > 0) throw ApiError.validationFailed({ worker_ids: missing }, 'Worker not found');
    await tx.safetyIncidentPerson.createMany({
      data: people.map((p) => ({
        tenantId: actor.tenantId,
        incidentId,
        workerId: p.worker_id ?? null,
        name: p.worker_id ? byId.get(p.worker_id)! : p.name!,
        role: p.role,
        bodyPart: p.body_part ?? null,
        injuryNature: p.injury_nature ?? null,
        statement: p.statement ?? null,
      })),
    });
  }

  /** The site a record belongs to, after checking the caller may see it. */
  private async parentProject(
    tx: TenantTx,
    actor: RequestUser,
    parent: { incidentId?: string; observationId?: string; permitId?: string; toolboxTalkId?: string },
  ): Promise<string> {
    const row = parent.incidentId
      ? await tx.safetyIncident.findFirst({ where: { id: parent.incidentId }, select: { projectId: true } })
      : parent.observationId
        ? await tx.safetyObservation.findFirst({ where: { id: parent.observationId }, select: { projectId: true } })
        : parent.permitId
          ? await tx.safetyPermit.findFirst({ where: { id: parent.permitId }, select: { projectId: true } })
          : await tx.safetyToolboxTalk.findFirst({
              where: { id: parent.toolboxTalkId },
              select: { projectId: true },
            });
    if (!row) throw ApiError.notFound('Safety record');
    await this.access.assertAccess(actor, row.projectId);
    return row.projectId;
  }

  private async detailView(
    actor: RequestUser,
    row: Awaited<ReturnType<SafetyIncidentsService['find']>>,
    names: Names,
  ) {
    const today = companyToday(actor);
    const site = await siteActor(this.tenantDb.clientFor(actor.tenantId), actor, row.projectId);
    const photos = await Promise.all(
      row.photos.map(async (photo) => ({
        ...photoView(photo, names),
        url: await this.uploads.signedViewUrl(actor, photo.s3Key),
      })),
    );
    return {
      id: row.id,
      number: safetyNumber('INC', row.number),
      project: row.project,
      occurred_at: row.occurredAt.toISOString(),
      occurred_local: companyLocal(site, row.occurredAt),
      occurred_on: isoDay(row.occurredOn),
      type: row.type,
      severity: row.severity,
      title: row.title,
      description: row.description,
      location: row.location,
      immediate_action: row.immediateAction,
      root_cause_whys: row.rootCauseWhys,
      root_cause: row.rootCause,
      lost_days: row.lostDays,
      status: row.status,
      next_statuses: SAFETY_INCIDENT_TRANSITIONS[row.status as SafetyIncidentStatus],
      recordable: safetyIsRecordable(row.type),
      serious: safetyIsSerious(row.type),
      serious_notified_at: row.seriousNotifiedAt?.toISOString() ?? null,
      reported_by: person(names, row.reportedBy),
      investigated_by: person(names, row.investigatedBy),
      closed_by: person(names, row.closedBy),
      closed_at: row.closedAt?.toISOString() ?? null,
      closure_note: row.closureNote,
      people: row.people.map((p) => ({
        id: p.id,
        worker_id: p.workerId,
        name: p.name,
        role: p.role,
        body_part: p.bodyPart,
        injury_nature: p.injuryNature,
        statement: p.statement,
      })),
      actions: row.actions.map((action) => actionView(action, names, today)),
      photos,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}

/** A sensible starting severity; the reporter can always change it. */
function defaultSeverity(type: SafetyIncidentType) {
  switch (type) {
    case 'fatality':
      return 'critical' as const;
    case 'lost_time_injury':
    case 'medical_treatment':
      return 'high' as const;
    case 'near_miss':
    case 'first_aid':
      return 'low' as const;
    default:
      return 'medium' as const;
  }
}

async function assertMember(tx: TenantTx, userId: string): Promise<void> {
  const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
  if (!user) throw ApiError.validationFailed({ assignee_id: userId }, 'That person is not on the team');
}

/** `where` fragment for an inclusive range of company-clock days on a `date` column. */
export function dayRange(field: string, from?: string, to?: string) {
  if (!from && !to) return {};
  return {
    [field]: {
      ...(from ? { gte: isoDateToUtcDate(from) } : {}),
      ...(to ? { lte: isoDateToUtcDate(to) } : {}),
    },
  };
}
