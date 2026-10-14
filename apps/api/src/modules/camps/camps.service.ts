import { Injectable } from '@nestjs/common';
import {
  isoDateToUtcDate,
  todayIn,
  type CampResidentsInput,
  type CreateCampInput,
  type UpdateCampInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb } from '../../common/prisma/tenant-db.service';

export interface CampView {
  id: string;
  name: string;
  address: string | null;
  capacity: number | null;
  transport_note: string | null;
  residents: number;
  /** Residents marked present or half day on the date asked for. */
  on_site: number;
  /** Where they went: one row per site, most first — the seats each bus run needs. */
  by_site: Array<{ project_id: string; project_name: string; count: number }>;
}

const WORKED = ['present', 'half_day'] as const;

/**
 * Labour camps and the transport from them (roadmap Phase 1, item 4).
 *
 * The day's numbers come from the roll call, not from a separate transport log: a worker marked
 * present on a site travelled there, so the camp × site counts are the bus loads without anybody
 * entering them twice.
 */
@Injectable()
export class CampsService {
  constructor(private readonly tenantDb: TenantDb) {}

  async list(
    actor: RequestUser,
    date: string | undefined,
  ): Promise<{ date: string; camps: CampView[]; unhoused_on_site: number }> {
    const day = date ?? todayIn(actor.timezone);
    const db = this.tenantDb.clientFor(actor.tenantId);

    const [camps, residents, attendance] = await Promise.all([
      db.camp.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      db.worker.groupBy({
        by: ['campId'],
        where: { deletedAt: null, status: 'active', campId: { not: null } },
        _count: { _all: true },
      }),
      db.attendance.findMany({
        where: { attendanceDate: isoDateToUtcDate(day), status: { in: [...WORKED] } },
        select: {
          projectId: true,
          project: { select: { name: true } },
          worker: { select: { campId: true } },
        },
      }),
    ]);

    const residentCount = new Map(residents.map((row) => [row.campId, row._count._all]));
    const loads = new Map<string, Map<string, { name: string; count: number }>>();
    let unhoused = 0;
    for (const row of attendance) {
      const campId = row.worker.campId;
      if (!campId) {
        unhoused += 1;
        continue;
      }
      const sites = loads.get(campId) ?? new Map();
      const site = sites.get(row.projectId) ?? { name: row.project.name, count: 0 };
      site.count += 1;
      sites.set(row.projectId, site);
      loads.set(campId, sites);
    }

    return {
      date: day,
      unhoused_on_site: unhoused,
      camps: camps.map((camp) => {
        const sites = [...(loads.get(camp.id) ?? new Map()).entries()]
          .map(([projectId, site]) => ({
            project_id: projectId,
            project_name: site.name,
            count: site.count,
          }))
          .sort((a, b) => b.count - a.count);
        return {
          id: camp.id,
          name: camp.name,
          address: camp.address,
          capacity: camp.capacity,
          transport_note: camp.transportNote,
          residents: residentCount.get(camp.id) ?? 0,
          on_site: sites.reduce((sum, site) => sum + site.count, 0),
          by_site: sites,
        };
      }),
    };
  }

  async create(actor: RequestUser, input: CreateCampInput) {
    return this.tenantDb.clientFor(actor.tenantId).camp.create({
      data: {
        tenantId: actor.tenantId,
        name: input.name,
        address: input.address ?? null,
        capacity: input.capacity ?? null,
        transportNote: input.transport_note ?? null,
      },
    });
  }

  async update(actor: RequestUser, id: string, input: UpdateCampInput) {
    await this.find(actor, id);
    return this.tenantDb.clientFor(actor.tenantId).camp.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
        ...(input.transport_note === undefined ? {} : { transportNote: input.transport_note }),
      },
    });
  }

  /** Archive. Residents become unassigned rather than following the camp into the archive. */
  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.find(actor, id);
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await tx.worker.updateMany({ where: { campId: id }, data: { campId: null } });
      await tx.camp.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  async residents(actor: RequestUser, id: string) {
    await this.find(actor, id);
    return this.tenantDb.clientFor(actor.tenantId).worker.findMany({
      where: { campId: id, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, trade: true, status: true },
    });
  }

  /** Move workers into this camp. Each leaves whatever camp they were in. */
  async addResidents(actor: RequestUser, id: string, input: CampResidentsInput) {
    await this.find(actor, id);
    const db = this.tenantDb.clientFor(actor.tenantId);
    const found = await db.worker.count({
      where: { id: { in: input.worker_ids }, deletedAt: null },
    });
    if (found !== new Set(input.worker_ids).size) throw ApiError.notFound('Worker');
    const result = await db.worker.updateMany({
      where: { id: { in: input.worker_ids } },
      data: { campId: id },
    });
    return { moved: result.count };
  }

  async removeResident(actor: RequestUser, id: string, workerId: string): Promise<void> {
    await this.find(actor, id);
    await this.tenantDb
      .clientFor(actor.tenantId)
      .worker.updateMany({ where: { id: workerId, campId: id }, data: { campId: null } });
  }

  private async find(actor: RequestUser, id: string) {
    const camp = await this.tenantDb
      .clientFor(actor.tenantId)
      .camp.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!camp) throw ApiError.notFound('Camp');
    return camp;
  }
}
