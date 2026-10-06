import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  equipmentDocumentStanding,
  equipmentFromTenths,
  equipmentServiceDue,
  equipmentSuggestCode,
  isoDateToUtcDate,
  siteTimeToday,
  todayIn,
  type AllocateEquipmentInput,
  type CreateEquipmentDocumentInput,
  type CreateEquipmentInput,
  type CreateEquipmentServicePlanInput,
  type EquipmentCategory,
  type EquipmentDocumentStanding,
  type EquipmentMeterType,
  type EquipmentServiceState,
  type ListEquipmentQuery,
  type ReleaseEquipmentInput,
  type UpdateEquipmentAllocationInput,
  type UpdateEquipmentDocumentInput,
  type UpdateEquipmentInput,
  type UpdateEquipmentServicePlanInput,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  assertEquipmentKey,
  costCodeOnSite,
  isoDay,
  money,
  oneDecimalText,
  tenthsOf,
} from './equipment-common';

const LIST_INCLUDE = {
  vendor: { select: { id: true, name: true } },
  allocations: {
    where: { toDate: null },
    include: {
      project: { select: { id: true, name: true } },
      costCode: { select: { id: true, code: true, name: true } },
    },
    take: 1,
  },
  servicePlans: { where: { active: true } },
  documents: { where: { deletedAt: null }, select: { expiresOn: true } },
} satisfies Prisma.EquipmentInclude;

type ListRow = Prisma.EquipmentGetPayload<{ include: typeof LIST_INCLUDE }>;

type PlanRow = Prisma.EquipmentServicePlanGetPayload<object>;

const STATE_RANK: Record<EquipmentServiceState, number> = { ok: 0, due_soon: 1, due: 2, overdue: 3 };
const STANDING_RANK: Record<EquipmentDocumentStanding, number> = { no_expiry: 0, valid: 0, expiring: 1, expired: 2 };

/**
 * The register of machines and plant, where each one is, its documents and its service plans
 * (roadmap Phase 2, module 10). Logs, fuel and maintenance are `EquipmentLogsService` and
 * `EquipmentMaintenanceService`; cost is `EquipmentCostsService`.
 *
 * The register is the company's, not a site's — a JCB belongs to the yard and visits jobs — so
 * anybody who works with equipment sees all of it. What each machine costs is shown only to
 * `equipment.view`.
 */
@Injectable()
export class EquipmentService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
  ) {}

  // --- register -----------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListEquipmentQuery) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const today = todayIn(actor.timezone);
      const rows = await tx.equipment.findMany({
        where: {
          archivedAt: query.archived ? { not: null } : null,
          ...(query.status ? { status: query.status } : {}),
          ...(query.ownership ? { ownership: query.ownership } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.vendor_id ? { vendorId: query.vendor_id } : {}),
          ...(query.project_id ? { allocations: { some: { projectId: query.project_id, toDate: null } } } : {}),
          ...(query.q
            ? {
                OR: [
                  { code: { contains: query.q, mode: 'insensitive' as const } },
                  { name: { contains: query.q, mode: 'insensitive' as const } },
                  { registrationNo: { contains: query.q, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        include: LIST_INCLUDE,
        orderBy: [{ code: 'asc' }],
        take: 1000,
      });
      return { items: rows.map((row) => this.view(actor, row, today)) };
    });
  }

  async create(actor: RequestUser, input: CreateEquipmentInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const terms = await this.terms(tx, input);
      const code = input.code?.trim() || (await this.nextCode(tx, input.category));
      try {
        const row = await tx.equipment.create({
          data: {
            tenantId: actor.tenantId,
            code,
            name: input.name,
            category: input.category,
            make: input.make ?? null,
            model: input.model ?? null,
            registrationNo: input.registration_no ?? null,
            serialNo: input.serial_no ?? null,
            year: input.year ?? null,
            quantity: input.quantity,
            meterType: input.meter_type,
            meterReading: input.meter_type === 'none' ? null : (input.meter_reading ?? null),
            notes: input.notes ?? null,
            createdBy: actor.userId,
            ...terms,
          },
          include: LIST_INCLUDE,
        });
        return this.view(actor, row, todayIn(actor.timezone));
      } catch (error) {
        throw duplicateCode(error, code);
      }
    });
  }

  async update(actor: RequestUser, id: string, input: UpdateEquipmentInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await this.find(tx, id);
      const merged = {
        ownership: input.ownership ?? current.ownership,
        vendor_id: input.vendor_id !== undefined ? input.vendor_id : current.vendorId,
        hire_basis: input.hire_basis !== undefined ? input.hire_basis : current.hireBasis,
        hire_rate: input.hire_rate ?? current.hireRate,
        min_hours: input.min_hours !== undefined ? input.min_hours : oneDecimalText(current.minHours),
        operator_included: input.operator_included ?? current.operatorIncluded,
        operator_rate: input.operator_rate ?? current.operatorRate,
        fuel_included: input.fuel_included ?? current.fuelIncluded,
        mobilisation_charge: input.mobilisation_charge ?? current.mobilisationCharge,
        charge_out_basis: input.charge_out_basis !== undefined ? input.charge_out_basis : current.chargeOutBasis,
        charge_out_rate: input.charge_out_rate ?? current.chargeOutRate,
      } as CreateEquipmentInput;
      const terms = await this.terms(tx, merged);

      if (input.status && input.status !== current.status) {
        const open = current.allocations.find((allocation) => allocation.toDate === null);
        if (input.status === 'on_site' && !open) {
          throw ApiError.conflict('Allocate the machine to a site to put it on site');
        }
        if ((input.status === 'available' || input.status === 'off_hire') && open) {
          throw ApiError.conflict('Release the machine from its site first');
        }
      }
      const meterType = (input.meter_type ?? current.meterType) as EquipmentMeterType;

      try {
        const row = await tx.equipment.update({
          where: { id },
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.make !== undefined ? { make: input.make } : {}),
            ...(input.model !== undefined ? { model: input.model } : {}),
            ...(input.registration_no !== undefined ? { registrationNo: input.registration_no } : {}),
            ...(input.serial_no !== undefined ? { serialNo: input.serial_no } : {}),
            ...(input.year !== undefined ? { year: input.year } : {}),
            ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
            meterType,
            ...(meterType === 'none'
              ? { meterReading: null }
              : input.meter_reading !== undefined
                ? { meterReading: input.meter_reading }
                : {}),
            ...terms,
          },
          include: LIST_INCLUDE,
        });
        return this.view(actor, row, todayIn(actor.timezone));
      } catch (error) {
        throw duplicateCode(error, input.code ?? current.code);
      }
    });
  }

  /** Archived, not deleted: its logs and costs are history somebody will ask about. */
  async archive(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await this.find(tx, id);
      if (current.allocations.some((allocation) => allocation.toDate === null)) {
        throw ApiError.conflict('Release the machine from its site before archiving it');
      }
      await tx.equipment.update({ where: { id }, data: { archivedAt: new Date() } });
    });
  }

  // --- where it is --------------------------------------------------------------------------------

  /**
   * Put a machine on a site from a date. A machine is on one site at a time: moving it closes the
   * site it was on the day before, and a date that would overlap the history is refused.
   */
  async allocate(actor: RequestUser, id: string, input: AllocateEquipmentInput) {
    await this.access.assertAccess(actor, input.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const machine = await this.find(tx, id);
      if (machine.archivedAt) throw ApiError.conflict('This machine is archived');
      const from = isoDateToUtcDate(input.from_date);
      const open = machine.allocations.find((allocation) => allocation.toDate === null) ?? null;

      if (open) {
        if (open.projectId === input.project_id) throw ApiError.conflict('The machine is already on this site');
        if (open.fromDate >= from) {
          throw ApiError.validationFailed(
            { from_date: 'before it arrived where it is' },
            'It only arrived on its current site on that date or later. Pick a later date.',
          );
        }
        const lastDay = isoDateToUtcDate(addDays(input.from_date, -1));
        await this.assertNoLogsOutside(tx, id, open.projectId, open.fromDate, lastDay);
        await tx.equipmentAllocation.update({ where: { id: open.id }, data: { toDate: lastDay } });
      }
      const clash = machine.allocations.find(
        (allocation) => allocation.id !== open?.id && (allocation.toDate === null || allocation.toDate >= from),
      );
      if (clash) {
        throw ApiError.validationFailed(
          { from_date: 'overlaps its history' },
          'The machine was on another site on or after that date. Correct the history first.',
        );
      }
      const costCodeId = await costCodeOnSite(tx, input.project_id, input.cost_code_id);
      const allocation = await tx.equipmentAllocation.create({
        data: {
          tenantId: actor.tenantId,
          equipmentId: id,
          projectId: input.project_id,
          costCodeId,
          fromDate: from,
          note: input.note ?? null,
          createdBy: actor.userId,
        },
      });
      await tx.equipment.update({ where: { id }, data: { status: 'on_site' } });
      return { id: allocation.id };
    });
  }

  /** Take a machine off its site after a date: back to the yard, or back to the vendor. */
  async release(actor: RequestUser, id: string, input: ReleaseEquipmentInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const machine = await this.find(tx, id);
      const open = machine.allocations.find((allocation) => allocation.toDate === null);
      if (!open) throw ApiError.conflict('The machine is not on a site');
      await this.access.assertAccess(actor, open.projectId);
      const to = isoDateToUtcDate(input.to_date);
      if (to < open.fromDate) {
        throw ApiError.validationFailed({ to_date: 'before it arrived' }, 'That is before it arrived on the site');
      }
      await this.assertNoLogsOutside(tx, id, open.projectId, open.fromDate, to);
      await tx.equipmentAllocation.update({ where: { id: open.id }, data: { toDate: to } });
      const status = input.status ?? (machine.ownership === 'hired' ? 'off_hire' : 'available');
      await tx.equipment.update({ where: { id }, data: { status } });
      return { id: open.id, status };
    });
  }

  /** Correct the history: dates or the cost code. Logs already on the site must stay inside it. */
  async updateAllocation(actor: RequestUser, allocationId: string, input: UpdateEquipmentAllocationInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const allocation = await tx.equipmentAllocation.findUnique({ where: { id: allocationId } });
      if (!allocation) throw ApiError.notFound('Allocation');
      await this.access.assertAccess(actor, allocation.projectId);
      const from = input.from_date ? isoDateToUtcDate(input.from_date) : allocation.fromDate;
      const to = input.to_date !== undefined ? (input.to_date ? isoDateToUtcDate(input.to_date) : null) : allocation.toDate;
      if (to && to < from) throw ApiError.validationFailed({ to_date: 'before from' }, 'The end is before the start');

      const others = await tx.equipmentAllocation.findMany({
        where: { equipmentId: allocation.equipmentId, id: { not: allocation.id } },
      });
      const overlaps = others.some(
        (other) => (other.toDate === null || other.toDate >= from) && (to === null || other.fromDate <= to),
      );
      if (overlaps) {
        throw ApiError.validationFailed({ from_date: 'overlaps' }, 'Those dates overlap another site in its history');
      }
      if (to === null && others.some((other) => other.toDate === null)) {
        throw ApiError.conflict('The machine is already on another site');
      }
      await this.assertNoLogsOutside(tx, allocation.equipmentId, allocation.projectId, from, to);
      const costCodeId =
        input.cost_code_id !== undefined
          ? await costCodeOnSite(tx, allocation.projectId, input.cost_code_id)
          : allocation.costCodeId;
      const updated = await tx.equipmentAllocation.update({
        where: { id: allocationId },
        data: { fromDate: from, toDate: to, costCodeId, ...(input.note !== undefined ? { note: input.note } : {}) },
      });
      return { id: updated.id };
    });
  }

  /** Machines on each site today, for the on-site board. */
  async board(actor: RequestUser) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const today = todayIn(actor.timezone);
      /*
       * "Logged today" is today at each machine's site (a separate time zone per site), which can be
       * a day either side of the company's; the logs either side are fetched and each machine is
       * held to its own site's date below.
       */
      const days = [-1, 0, 1].map((offset) => isoDateToUtcDate(addDays(today, offset)));
      const allocations = await tx.equipmentAllocation.findMany({
        where: {
          toDate: null,
          equipment: { archivedAt: null },
          project: { deletedAt: null },
          ...this.access.scopeFilterByProjectId(actor),
        },
        include: {
          project: { select: { id: true, name: true, timeZone: true } },
          equipment: {
            select: {
              id: true,
              code: true,
              name: true,
              category: true,
              ownership: true,
              status: true,
              meterType: true,
              meterReading: true,
              logs: {
                where: { logDate: { in: days } },
                select: { id: true, hoursWorked: true, logDate: true },
              },
            },
          },
        },
        orderBy: [{ fromDate: 'asc' }],
      });
      const sites = new Map<string, { project_id: string; project_name: string; machines: unknown[] }>();
      for (const allocation of allocations) {
        const site = sites.get(allocation.projectId) ?? {
          project_id: allocation.projectId,
          project_name: allocation.project.name,
          machines: [],
        };
        const siteDay = siteTimeToday(allocation.project, actor);
        const log = allocation.equipment.logs.find((entry) => isoDay(entry.logDate) === siteDay);
        site.machines.push({
          id: allocation.equipment.id,
          code: allocation.equipment.code,
          name: allocation.equipment.name,
          category: allocation.equipment.category,
          ownership: allocation.equipment.ownership,
          status: allocation.equipment.status,
          meter_type: allocation.equipment.meterType,
          meter_reading: oneDecimalText(allocation.equipment.meterReading),
          since: isoDay(allocation.fromDate),
          logged_today: Boolean(log),
          hours_today: log ? oneDecimalText(log.hoursWorked) : null,
        });
        sites.set(allocation.projectId, site);
      }
      return {
        date: today,
        sites: [...sites.values()].sort((a, b) => a.project_name.localeCompare(b.project_name)),
      };
    });
  }

  // --- documents ----------------------------------------------------------------------------------

  async listDocuments(actor: RequestUser, equipmentId: string) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.find(tx, equipmentId);
      const rows = await tx.equipmentDocument.findMany({
        where: { equipmentId, deletedAt: null },
        orderBy: [{ expiresOn: 'asc' }],
      });
      const today = todayIn(actor.timezone);
      return {
        items: await Promise.all(rows.map((row) => this.documentView(actor, row, today))),
      };
    });
  }

  async addDocument(actor: RequestUser, equipmentId: string, input: CreateEquipmentDocumentInput) {
    assertEquipmentKey(actor, input.s3_key);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      await this.find(tx, equipmentId);
      checkDocumentDates(input.issued_on ?? null, input.expires_on ?? null);
      const row = await tx.equipmentDocument.create({
        data: {
          tenantId: actor.tenantId,
          equipmentId,
          kind: input.kind,
          number: input.number ?? null,
          issuedOn: input.issued_on ? isoDateToUtcDate(input.issued_on) : null,
          expiresOn: input.expires_on ? isoDateToUtcDate(input.expires_on) : null,
          s3Key: input.s3_key ?? null,
          note: input.note ?? null,
          createdBy: actor.userId,
        },
      });
      return this.documentView(actor, row, todayIn(actor.timezone));
    });
  }

  async updateDocument(actor: RequestUser, id: string, input: UpdateEquipmentDocumentInput) {
    assertEquipmentKey(actor, input.s3_key);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await tx.equipmentDocument.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw ApiError.notFound('Document');
      const issued = input.issued_on !== undefined ? input.issued_on : isoDay(current.issuedOn);
      const expires = input.expires_on !== undefined ? input.expires_on : isoDay(current.expiresOn);
      checkDocumentDates(issued, expires);
      const row = await tx.equipmentDocument.update({
        where: { id },
        data: {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.number !== undefined ? { number: input.number } : {}),
          ...(input.s3_key !== undefined ? { s3Key: input.s3_key } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          issuedOn: issued ? isoDateToUtcDate(issued) : null,
          expiresOn: expires ? isoDateToUtcDate(expires) : null,
          // A renewed paper gets its own reminder when it, in turn, nears expiry.
          ...(expires !== isoDay(current.expiresOn) ? { remindedAt: null } : {}),
        },
      });
      return this.documentView(actor, row, todayIn(actor.timezone));
    });
  }

  async removeDocument(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await tx.equipmentDocument.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw ApiError.notFound('Document');
      await tx.equipmentDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    });
  }

  // --- service plans ------------------------------------------------------------------------------

  async addPlan(actor: RequestUser, equipmentId: string, input: CreateEquipmentServicePlanInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const machine = await this.find(tx, equipmentId);
      if (input.interval_meter && machine.meterType === 'none') {
        throw ApiError.validationFailed(
          { interval_meter: 'no meter' },
          'This machine has no meter; set the interval in days',
        );
      }
      const row = await tx.equipmentServicePlan.create({
        data: {
          tenantId: actor.tenantId,
          equipmentId,
          name: input.name,
          intervalMeter: input.interval_meter ?? null,
          intervalDays: input.interval_days ?? null,
          // A plan set up today counts from where the machine is today, unless told otherwise.
          lastDoneMeter: input.last_done_meter ?? (machine.meterReading ? machine.meterReading : null),
          lastDoneOn: isoDateToUtcDate(input.last_done_on ?? todayIn(actor.timezone)),
        },
      });
      return planView(row, machine.meterType as EquipmentMeterType, tenthsOf(machine.meterReading), todayIn(actor.timezone));
    });
  }

  async updatePlan(actor: RequestUser, id: string, input: UpdateEquipmentServicePlanInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await tx.equipmentServicePlan.findUnique({ where: { id }, include: { equipment: true } });
      if (!current) throw ApiError.notFound('Service plan');
      const intervalMeter = input.interval_meter !== undefined ? input.interval_meter : current.intervalMeter;
      const intervalDays = input.interval_days !== undefined ? input.interval_days : current.intervalDays;
      if (!intervalMeter && !intervalDays) {
        throw ApiError.validationFailed({ interval_meter: 'needs an interval' }, 'Set an interval in hours, km or days');
      }
      const row = await tx.equipmentServicePlan.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
          intervalMeter,
          intervalDays,
          ...(input.last_done_meter !== undefined ? { lastDoneMeter: input.last_done_meter } : {}),
          ...(input.last_done_on !== undefined
            ? { lastDoneOn: input.last_done_on ? isoDateToUtcDate(input.last_done_on) : null }
            : {}),
          // Moving the goalposts re-arms the reminder.
          remindedAt: null,
        },
      });
      return planView(
        row,
        current.equipment.meterType as EquipmentMeterType,
        tenthsOf(current.equipment.meterReading),
        todayIn(actor.timezone),
      );
    });
  }

  // --- shared -------------------------------------------------------------------------------------

  /** The machine with its whole allocation history, or 404. */
  async find(tx: TenantTx, id: string) {
    const row = await tx.equipment.findUnique({
      where: { id },
      include: { allocations: { orderBy: { fromDate: 'asc' } } },
    });
    if (!row) throw ApiError.notFound('Equipment');
    return row;
  }

  view(actor: RequestUser, row: ListRow, today: string) {
    const meterType = row.meterType as EquipmentMeterType;
    const current = tenthsOf(row.meterReading);
    const plans = row.servicePlans.map((plan) => planView(plan, meterType, current, today));
    const service = plans.reduce<EquipmentServiceState>(
      (worst, plan) => (STATE_RANK[plan.state] > STATE_RANK[worst] ? plan.state : worst),
      'ok',
    );
    const documents = row.documents.reduce<EquipmentDocumentStanding>((worst, doc) => {
      const standing = equipmentDocumentStanding(isoDay(doc.expiresOn), today);
      return STANDING_RANK[standing] > STANDING_RANK[worst] ? standing : worst;
    }, 'valid');
    const open = row.allocations[0] ?? null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      category: row.category,
      make: row.make,
      model: row.model,
      registration_no: row.registrationNo,
      serial_no: row.serialNo,
      year: row.year,
      quantity: row.quantity,
      ownership: row.ownership,
      vendor: row.vendor,
      hire_basis: row.hireBasis,
      hire_rate: money(actor, row.ownership === 'hired' ? row.hireRate : null),
      min_hours: oneDecimalText(row.minHours),
      operator_included: row.operatorIncluded,
      operator_rate: money(actor, row.ownership === 'hired' ? row.operatorRate : null),
      fuel_included: row.fuelIncluded,
      mobilisation_charge: money(actor, row.ownership === 'hired' ? row.mobilisationCharge : null),
      charge_out_basis: row.chargeOutBasis,
      charge_out_rate: money(actor, row.ownership === 'owned' ? row.chargeOutRate : null),
      meter_type: row.meterType,
      meter_reading: oneDecimalText(row.meterReading),
      status: row.status,
      notes: row.notes,
      archived: row.archivedAt !== null,
      current_site: open
        ? {
            allocation_id: open.id,
            project: open.project,
            cost_code: open.costCode,
            since: isoDay(open.fromDate),
          }
        : null,
      service_state: service,
      documents_state: documents,
    };
  }

  /** Hire terms for the ownership: a hired machine has a vendor and rates; an owned one a charge-out. */
  private async terms(tx: TenantTx, input: CreateEquipmentInput) {
    if (input.ownership === 'hired') {
      if (!input.vendor_id || !input.hire_basis) {
        throw ApiError.validationFailed(
          { vendor_id: 'required for hired kit' },
          'A hired machine needs its vendor and how it is charged',
        );
      }
      const vendor = await tx.vendor.findFirst({ where: { id: input.vendor_id }, select: { id: true, active: true } });
      if (!vendor) throw ApiError.validationFailed({ vendor_id: 'unknown vendor' }, 'That vendor is not in your list');
      return {
        ownership: 'hired',
        vendorId: vendor.id,
        hireBasis: input.hire_basis,
        hireRate: input.hire_rate ?? 0n,
        minHours: input.hire_basis === 'day' ? null : (input.min_hours ?? null),
        operatorIncluded: input.operator_included ?? true,
        operatorRate: input.operator_included === false ? (input.operator_rate ?? 0n) : 0n,
        fuelIncluded: input.fuel_included ?? false,
        mobilisationCharge: input.mobilisation_charge ?? 0n,
        chargeOutBasis: null,
        chargeOutRate: 0n,
      };
    }
    return {
      ownership: 'owned',
      vendorId: null,
      hireBasis: null,
      hireRate: 0n,
      minHours: null,
      operatorIncluded: true,
      operatorRate: 0n,
      fuelIncluded: false,
      mobilisationCharge: 0n,
      chargeOutBasis: input.charge_out_basis ?? (input.charge_out_rate ? 'hour' : null),
      chargeOutRate: input.charge_out_rate ?? 0n,
    };
  }

  private async nextCode(tx: TenantTx, category: EquipmentCategory): Promise<string> {
    const prefix = equipmentSuggestCode(category, 0).split('-')[0]!;
    const existing = await tx.equipment.findMany({
      where: { code: { startsWith: `${prefix}-` } },
      select: { code: true },
    });
    const highest = existing.reduce((max, row) => {
      const number = Number(row.code.slice(prefix.length + 1));
      return Number.isInteger(number) && number > max ? number : max;
    }, 0);
    return equipmentSuggestCode(category, highest + 1);
  }

  /** Logs on a site must stay inside the time the machine was there. */
  private async assertNoLogsOutside(
    tx: TenantTx,
    equipmentId: string,
    projectId: string,
    from: Date,
    to: Date | null,
  ): Promise<void> {
    const outside = await tx.equipmentLog.count({
      where: {
        equipmentId,
        projectId,
        OR: [{ logDate: { lt: from } }, ...(to ? [{ logDate: { gt: to } }] : [])],
      },
    });
    if (outside > 0) {
      throw ApiError.conflict(
        'There are logs for this machine on this site outside those dates. Move or delete them first.',
      );
    }
  }

  private async documentView(
    actor: RequestUser,
    row: Prisma.EquipmentDocumentGetPayload<object>,
    today: string,
  ) {
    return {
      id: row.id,
      equipment_id: row.equipmentId,
      kind: row.kind,
      number: row.number,
      issued_on: isoDay(row.issuedOn),
      expires_on: isoDay(row.expiresOn),
      standing: equipmentDocumentStanding(isoDay(row.expiresOn), today),
      note: row.note,
      has_file: Boolean(row.s3Key),
      url: row.s3Key ? await this.uploads.signedViewUrl(actor, row.s3Key) : null,
    };
  }
}

export function planView(row: PlanRow, meterType: EquipmentMeterType, currentTenths: number | null, today: string) {
  const due = equipmentServiceDue({
    meterType,
    intervalTenths: tenthsOf(row.intervalMeter),
    intervalDays: row.intervalDays,
    lastMeterTenths: tenthsOf(row.lastDoneMeter),
    lastOn: isoDay(row.lastDoneOn),
    currentMeterTenths: currentTenths,
    today,
  });
  return {
    id: row.id,
    equipment_id: row.equipmentId,
    name: row.name,
    interval_meter: oneDecimalText(row.intervalMeter),
    interval_days: row.intervalDays,
    last_done_meter: oneDecimalText(row.lastDoneMeter),
    last_done_on: isoDay(row.lastDoneOn),
    active: row.active,
    state: due.state,
    next_meter: due.nextMeterTenths === null ? null : equipmentFromTenths(due.nextMeterTenths),
    remaining_meter: due.remainingTenths === null ? null : equipmentFromTenths(due.remainingTenths),
    next_on: due.nextOn,
    remaining_days: due.remainingDays,
  };
}

function checkDocumentDates(issued: string | null, expires: string | null): void {
  if (issued && expires && expires < issued) {
    throw ApiError.validationFailed({ expires_on: 'before issue' }, 'It cannot expire before it was issued');
  }
}

function duplicateCode(error: unknown, code: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return ApiError.conflict(`Another machine already has the code ${code}`);
  }
  return error;
}
