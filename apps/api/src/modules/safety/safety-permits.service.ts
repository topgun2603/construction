import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  INDIA_LOCALE,
  SAFETY_PERMIT_MAX_HOURS,
  SAFETY_PERMIT_TYPE_LABELS,
  safetyDefaultChecklist,
  safetyInstantToLocal,
  safetyNumber,
  type ApproveSafetyPermitInput,
  type CreateSafetyPermitInput,
  type ListSafetyPermitsQuery,
  type SafetyChecklistItem,
  type SafetyPermitNoteInput,
  type SafetyPermitType,
  type UpdateSafetyPermitInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { NotificationsService } from '../notifications/notifications.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  PHOTO_SELECT,
  companyInstant,
  companyLocal,
  namesFor,
  nextSafetyNumber,
  person,
  photoView,
  withNumberRetry,
} from './safety-common';

const PERMIT_INCLUDE = {
  project: { select: { id: true, name: true } },
  crew: { include: { worker: { select: { id: true, name: true, trade: true } } } },
  photos: { select: PHOTO_SELECT, orderBy: { createdAt: 'asc' as const } },
};

const MAX_MS = SAFETY_PERMIT_MAX_HOURS * 3_600_000;

/**
 * Permits to work (roadmap Phase 2, module 8): hot work, work at height, confined spaces,
 * excavations, electrical isolation and lifting. A permit is requested with its crew and checklist,
 * signed by the issuer and by the authority for the area, and is then valid for a window of at most
 * a shift. When the window runs out with the permit still open, the people who signed it are told.
 */
@Injectable()
export class SafetyPermitsService {
  private readonly logger = new Logger(SafetyPermitsService.name);

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly notifications: NotificationsService,
    private readonly uploads: UploadsService,
  ) {}

  async list(actor: RequestUser, query: ListSafetyPermitsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const now = new Date();
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.safetyPermit.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...(query.expired ? { status: 'active', validTo: { lt: now } } : {}),
          ...(query.status && !query.expired ? { status: query.status } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.from || query.to
            ? {
                // A permit belongs to the days its window touches.
                ...(query.to ? { validFrom: { lt: endOfDay(actor, query.to) } } : {}),
                ...(query.from ? { validTo: { gte: companyInstant(actor, `${query.from}T00:00`) } } : {}),
              }
            : {}),
          project: { deletedAt: null },
        },
        include: { project: { select: { id: true, name: true } }, crew: { select: { id: true } } },
        orderBy: [{ validFrom: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const names = await namesFor(
        tx,
        rows.flatMap((row) => [row.requestedBy, row.issuerId, row.areaAuthorityId]),
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          number: safetyNumber('PTW', row.number),
          project: row.project,
          type: row.type,
          description: row.description,
          area: row.area,
          valid_from: row.validFrom.toISOString(),
          valid_to: row.validTo.toISOString(),
          status: row.status,
          expired: row.status === 'active' && row.validTo < now,
          crew_count: row.crew.length,
          requested_by: person(names, row.requestedBy),
          issuer: person(names, row.issuerId),
          area_authority: person(names, row.areaAuthorityId),
        })),
      };
    });
  }

  async get(actor: RequestUser, id: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      const names = await namesFor(tx, [
        row.requestedBy,
        row.issuerId,
        row.areaAuthorityId,
        row.closedBy,
        ...row.photos.map((photo) => photo.uploadedBy),
      ]);
      const now = new Date();
      const photos = await Promise.all(
        row.photos.map(async (photo) => ({
          ...photoView(photo, names),
          url: await this.uploads.signedViewUrl(actor, photo.s3Key),
        })),
      );
      const checklist = row.checklist as unknown as SafetyChecklistItem[];
      return {
        id: row.id,
        number: safetyNumber('PTW', row.number),
        project: row.project,
        type: row.type,
        description: row.description,
        area: row.area,
        precautions: row.precautions,
        checklist,
        checklist_complete: checklist.every((item) => item.checked),
        valid_from: row.validFrom.toISOString(),
        valid_to: row.validTo.toISOString(),
        valid_from_local: companyLocal(actor, row.validFrom),
        valid_to_local: companyLocal(actor, row.validTo),
        status: row.status,
        expired: row.status === 'active' && row.validTo < now,
        requested_by: person(names, row.requestedBy),
        issuer: person(names, row.issuerId),
        issued_at: row.issuedAt?.toISOString() ?? null,
        area_authority: person(names, row.areaAuthorityId),
        area_authority_at: row.areaAuthorityAt?.toISOString() ?? null,
        suspended_reason: row.suspendedReason,
        closed_by: person(names, row.closedBy),
        closed_at: row.closedAt?.toISOString() ?? null,
        close_note: row.closeNote,
        expiry_alerted_at: row.expiryAlertedAt?.toISOString() ?? null,
        crew: row.crew.map((member) => ({
          worker_id: member.worker.id,
          name: member.worker.name,
          trade: member.worker.trade,
        })),
        photos,
        created_at: row.createdAt.toISOString(),
      };
    });
  }

  async create(actor: RequestUser, input: CreateSafetyPermitInput) {
    await this.access.assertAccess(actor, input.project_id);
    const { from, to } = this.window(actor, input.valid_from, input.valid_to);
    if (to.getTime() <= Date.now()) {
      throw ApiError.validationFailed({ valid_to: input.valid_to }, 'That permit would already have expired');
    }
    const id = await withNumberRetry(() =>
      this.tenantDb.transaction(actor.tenantId, async (tx) => {
        const number = await nextSafetyNumber(tx, 'permit');
        const made = await tx.safetyPermit.create({
          data: {
            tenantId: actor.tenantId,
            projectId: input.project_id,
            number,
            type: input.type,
            description: input.description,
            area: input.area,
            precautions: input.precautions ?? null,
            checklist: (input.checklist ?? safetyDefaultChecklist(input.type)) as unknown as Prisma.InputJsonValue,
            validFrom: from,
            validTo: to,
            requestedBy: actor.userId,
          },
          select: { id: true },
        });
        await this.replaceCrew(tx, actor, made.id, input.crew ?? []);
        return made.id;
      }),
    );
    return this.get(actor, id);
  }

  /**
   * Changes while the permit is waiting for signatures. A signature is on what was signed, so any
   * change takes the signatures already given off it — they sign again what it now says.
   */
  async update(actor: RequestUser, id: string, input: UpdateSafetyPermitInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      this.assertRequesterOrManager(actor, row.requestedBy);
      if (row.status !== 'requested') {
        throw ApiError.conflict('A permit can only change before it is issued. Close it and raise a new one.');
      }
      const window =
        input.valid_from || input.valid_to
          ? this.window(
              actor,
              input.valid_from ?? companyLocal(actor, row.validFrom),
              input.valid_to ?? companyLocal(actor, row.validTo),
            )
          : null;
      await tx.safetyPermit.update({
        where: { id },
        data: {
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.area === undefined ? {} : { area: input.area }),
          ...(input.precautions === undefined ? {} : { precautions: input.precautions }),
          ...(input.checklist === undefined
            ? {}
            : { checklist: input.checklist as unknown as Prisma.InputJsonValue }),
          ...(window ? { validFrom: window.from, validTo: window.to } : {}),
          issuerId: null,
          issuedAt: null,
          areaAuthorityId: null,
          areaAuthorityAt: null,
        },
      });
      if (input.crew) await this.replaceCrew(tx, actor, id, input.crew);
    });
    return this.get(actor, id);
  }

  /**
   * One of the two signatures. The issuer and the area authority must be different people — the
   * point of two signatures is two people having looked — and the checklist must be complete before
   * either signs. The second signature makes the permit active.
   */
  async approve(actor: RequestUser, id: string, input: ApproveSafetyPermitInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      if (row.status !== 'requested') {
        throw ApiError.conflict(`This permit is ${row.status}; it has already been decided`);
      }
      if (row.validTo.getTime() <= Date.now()) {
        throw ApiError.conflict('This permit’s time has run out. Change its times or raise a new one.');
      }
      const checklist = row.checklist as unknown as SafetyChecklistItem[];
      const unticked = checklist.filter((item) => !item.checked).map((item) => item.item);
      if (unticked.length > 0) {
        throw ApiError.conflict('Tick every check on the permit before signing it', { unticked });
      }
      const other = input.as === 'issuer' ? row.areaAuthorityId : row.issuerId;
      if (other === actor.userId) {
        throw ApiError.conflict('The issuer and the area authority must be two different people');
      }
      if ((input.as === 'issuer' ? row.issuerId : row.areaAuthorityId) !== null) {
        throw ApiError.conflict('That signature is already on this permit');
      }
      const now = new Date();
      const bothSigned = other !== null;
      await tx.safetyPermit.update({
        where: { id },
        data: {
          ...(input.as === 'issuer'
            ? { issuerId: actor.userId, issuedAt: now }
            : { areaAuthorityId: actor.userId, areaAuthorityAt: now }),
          ...(bothSigned ? { status: 'active' } : {}),
        },
      });
    });
    return this.get(actor, id);
  }

  async suspend(actor: RequestUser, id: string, input: SafetyPermitNoteInput) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      if (row.status !== 'active') throw ApiError.conflict('Only an active permit can be suspended');
      await tx.safetyPermit.update({
        where: { id },
        data: { status: 'suspended', suspendedReason: input.note },
      });
    });
    return this.get(actor, id);
  }

  async resume(actor: RequestUser, id: string) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      if (row.status !== 'suspended') throw ApiError.conflict('Only a suspended permit can be resumed');
      if (row.validTo.getTime() <= Date.now()) {
        throw ApiError.conflict('This permit’s time has run out. Close it and raise a new one.');
      }
      await tx.safetyPermit.update({ where: { id }, data: { status: 'active', suspendedReason: null } });
    });
    return this.get(actor, id);
  }

  /** The work is finished and the area handed back, or a request is withdrawn. */
  async close(actor: RequestUser, id: string, input: Partial<SafetyPermitNoteInput>) {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const row = await this.find(tx, actor, id);
      this.assertRequesterOrManager(actor, row.requestedBy);
      if (row.status === 'closed') throw ApiError.conflict('This permit is already closed');
      await tx.safetyPermit.update({
        where: { id },
        data: { status: 'closed', closedBy: actor.userId, closedAt: new Date(), closeNote: input.note ?? null },
      });
    });
    return this.get(actor, id);
  }

  /**
   * Tells the people who signed an active permit that its time has run out and it is still open.
   *
   * Run from the scheduler every quarter-hour for every company (jobs/tenant-clock.ts), so an alert
   * goes out within fifteen minutes of a permit lapsing, and the time in it is read on the company's
   * own clock. Each permit is alerted once: `expiry_alerted_at` is claimed in the same transaction
   * that finds it, so overlapping ticks cannot both send.
   */
  async alertExpired(tenantId: string, now: Date = new Date()): Promise<{ alerted: number }> {
    const { lapsed, timezone } = await this.tenantDb.transaction(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
      const rows = await tx.safetyPermit.findMany({
        where: { status: 'active', validTo: { lte: now }, expiryAlertedAt: null, project: { deletedAt: null } },
        select: {
          id: true,
          number: true,
          type: true,
          area: true,
          validTo: true,
          projectId: true,
          requestedBy: true,
          issuerId: true,
          areaAuthorityId: true,
          project: { select: { name: true } },
        },
        orderBy: { validTo: 'asc' },
      });
      if (rows.length > 0) {
        await tx.safetyPermit.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, expiryAlertedAt: null },
          data: { expiryAlertedAt: now },
        });
      }
      return { lapsed: rows, timezone: tenant?.timezone ?? INDIA_LOCALE.timezone };
    });

    for (const permit of lapsed) {
      const number = safetyNumber('PTW', permit.number);
      const label = SAFETY_PERMIT_TYPE_LABELS[permit.type as SafetyPermitType];
      const at = safetyInstantToLocal(permit.validTo, timezone).slice(11);
      const notice = {
        tenantId,
        type: 'safety_permit.expired',
        title: `${number} ${label} permit has expired`,
        body: `${permit.project.name}, ${permit.area}: it ran out at ${at} and is still open. Stop the work, then close or re-permit it.`,
        payload: { permit_id: permit.id, project_id: permit.projectId, number },
      };
      try {
        // The people who asked for and signed it, and the site's managers — one notification each,
        // since `projectId` narrows only the role fan-out and the named people are added to it.
        await this.notifications.notify({
          ...notice,
          userIds: [permit.requestedBy, permit.issuerId, permit.areaAuthorityId].filter(
            (userId): userId is string => Boolean(userId),
          ),
          roles: ['project_manager'],
          projectId: permit.projectId,
        });
      } catch (error) {
        this.logger.error({ err: error, permitId: permit.id }, 'Could not send a permit expiry alert');
      }
    }
    if (lapsed.length > 0) this.logger.log({ tenantId, alerted: lapsed.length }, 'Expired permit alerts sent');
    return { alerted: lapsed.length };
  }

  // --- helpers -----------------------------------------------------------------------------------

  private async find(tx: TenantTx, actor: RequestUser, id: string) {
    const row = await tx.safetyPermit.findFirst({ where: { id }, include: PERMIT_INCLUDE });
    if (!row) throw ApiError.notFound('Permit');
    await this.access.assertAccess(actor, row.projectId);
    return row;
  }

  private assertRequesterOrManager(actor: RequestUser, requestedBy: string): void {
    if (requestedBy !== actor.userId && !can(actor, 'safety.manage')) {
      throw ApiError.forbidden('Only the person who requested this permit or a safety manager can do that');
    }
  }

  private window(actor: RequestUser, fromLocal: string, toLocal: string) {
    const from = companyInstant(actor, fromLocal);
    const to = companyInstant(actor, toLocal);
    if (to <= from) {
      throw ApiError.validationFailed({ valid_to: toLocal }, 'A permit must end after it starts');
    }
    if (to.getTime() - from.getTime() > MAX_MS) {
      throw ApiError.validationFailed(
        { valid_to: toLocal },
        `A permit runs for at most ${SAFETY_PERMIT_MAX_HOURS} hours. Re-permit longer work shift by shift.`,
      );
    }
    return { from, to };
  }

  private async replaceCrew(tx: TenantTx, actor: RequestUser, permitId: string, workerIds: readonly string[]) {
    const unique = [...new Set(workerIds)];
    await tx.safetyPermitCrew.deleteMany({ where: { permitId } });
    if (unique.length === 0) return;
    const found = await tx.worker.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      const known = new Set(found.map((worker) => worker.id));
      throw ApiError.validationFailed({ crew: unique.filter((id) => !known.has(id)) }, 'Worker not found');
    }
    await tx.safetyPermitCrew.createMany({
      data: unique.map((workerId) => ({ tenantId: actor.tenantId, permitId, workerId })),
    });
  }
}

/** The instant a company-clock day ends (the next midnight). */
function endOfDay(actor: RequestUser, day: string): Date {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return companyInstant(actor, `${next.toISOString().slice(0, 10)}T00:00`);
}
