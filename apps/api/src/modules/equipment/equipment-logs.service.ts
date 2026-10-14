import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  EQUIPMENT_FUEL_SOURCE_LABELS,
  currencyMinorDigits,
  decimalToMinor,
  equipmentCheckLog,
  equipmentFromTenths,
  equipmentFuelRate,
  equipmentLitresFromHundredths,
  equipmentLitresToHundredths,
  equipmentMeterFits,
  equipmentToTenths,
  isoDateToUtcDate,
  parseBillDate,
  quantityToThousandths,
  thousandthsToQuantity,
  utcDateToIsoDate,
  type CreateEquipmentFuelInput,
  type CreateEquipmentLogInput,
  type EquipmentFuelBillScanResult,
  type EquipmentFuelInLogInput,
  type EquipmentMeterScanResult,
  type EquipmentMeterType,
  type EquipmentScanInput,
  type IsoDate,
  type ListEquipmentLogsQuery,
  type UpdateEquipmentLogInput,
} from '@sitebook/shared';
import { can, type RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { EquipmentReader } from '../ai/equipment-reader.service';
import { AiGateway } from '../ai/ai-gateway.service';
import { UploadsService } from '../uploads/uploads.service';
import {
  assertEquipmentKey,
  costCodeOnSite,
  hundredthsOf,
  litresText,
  money,
  namesFor,
  oneDecimalText,
  siteFor,
  tenthsOf,
} from './equipment-common';

/** A photograph of a dial or a pump slip. Anything bigger is not one. */
const MAX_PHOTO_BYTES = 8_000_000;

const LOG_INCLUDE = {
  equipment: { select: { id: true, code: true, name: true, meterType: true } },
  project: { select: { id: true, name: true } },
  costCode: { select: { id: true, code: true, name: true } },
  operator: { select: { id: true, name: true } },
  fuel: { select: { litres: true } },
} satisfies Prisma.EquipmentLogInclude;

type LogRow = Prisma.EquipmentLogGetPayload<{ include: typeof LOG_INCLUDE }>;

const FUEL_INCLUDE = {
  equipment: { select: { id: true, code: true, name: true } },
  project: { select: { id: true, name: true } },
  material: { select: { id: true, name: true, unit: true } },
} satisfies Prisma.EquipmentFuelInclude;

type FuelRow = Prisma.EquipmentFuelGetPayload<{ include: typeof FUEL_INCLUDE }>;

const READING_NOT_CONFIGURED = 'Reading photos is not configured on this deployment. Enter it by hand.';

/**
 * The daily logs and the fuel (roadmap Phase 2, module 10): the supervisor's or operator's job, from
 * a phone, at the end of a shift. One log per machine per day; the site comes from where the machine
 * was allocated that day, so its hours and cost cannot land on the wrong job.
 */
@Injectable()
export class EquipmentLogsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    private readonly uploads: UploadsService,
    private readonly reader: EquipmentReader,
    private readonly gateway: AiGateway,
  ) {}

  // --- logs ---------------------------------------------------------------------------------------

  async list(actor: RequestUser, query: ListEquipmentLogsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.equipmentLog.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...(query.equipment_id ? { equipmentId: query.equipment_id } : {}),
          ...(query.from || query.to
            ? {
                logDate: {
                  ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                  ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
                },
              }
            : {}),
        },
        include: LOG_INCLUDE,
        orderBy: [{ logDate: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      const names = await namesFor(tx, rows.map((row) => row.recordedBy));
      return { items: rows.map((row) => logView(row, names)) };
    });
  }

  async create(actor: RequestUser, input: CreateEquipmentLogInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.equipmentLog.findFirst({ where: { clientId: input.client_id }, include: LOG_INCLUDE });
        if (existing) return logView(existing, await namesFor(tx, [existing.recordedBy]));
      }
      const machine = await this.machine(tx, input.equipment_id);
      const site = await siteFor(tx, machine.id, input.log_date, input.project_id);
      await this.access.assertAccess(actor, site.projectId);

      const hours = await this.checkHours(tx, machine, input.log_date, input, null);
      const operatorWorkerId = await this.operator(tx, input.operator_worker_id);
      const costCodeId =
        input.cost_code_id !== undefined ? await costCodeOnSite(tx, site.projectId, input.cost_code_id) : site.costCodeId;
      assertEquipmentKey(actor, input.meter_photo_key);

      let log;
      try {
        log = await tx.equipmentLog.create({
          data: {
            tenantId: actor.tenantId,
            equipmentId: machine.id,
            projectId: site.projectId,
            costCodeId,
            logDate: isoDateToUtcDate(input.log_date),
            openingMeter: hours.opening,
            closingMeter: hours.closing,
            hoursWorked: equipmentFromTenths(hours.worked),
            idleHours: equipmentFromTenths(hours.idle),
            breakdownHours: equipmentFromTenths(hours.breakdown),
            operatorWorkerId,
            operatorName: operatorWorkerId ? null : (input.operator_name ?? null),
            workDone: input.work_done ?? null,
            meterPhotoKey: input.meter_photo_key ?? null,
            recordedBy: actor.userId,
            clientId: input.client_id ?? null,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw ApiError.conflict(`${machine.code} is already logged for ${input.log_date}. Edit that log instead.`);
        }
        throw error;
      }
      await this.bumpMeter(tx, machine.id, hours.closing);

      if (input.fuel) {
        await this.addFuel(tx, actor, machine, {
          projectId: site.projectId,
          costCodeId,
          date: input.log_date,
          logId: log.id,
          meterReading: hours.closing,
          fuel: input.fuel,
          clientId: null,
        });
      }
      const row = await tx.equipmentLog.findUniqueOrThrow({ where: { id: log.id }, include: LOG_INCLUDE });
      return logView(row, await namesFor(tx, [row.recordedBy]));
    });
  }

  /** Correct a log. Whoever logs may fix their own; a manager may fix anybody's. */
  async update(actor: RequestUser, id: string, input: UpdateEquipmentLogInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await tx.equipmentLog.findUnique({ where: { id } });
      if (!current) throw ApiError.notFound('Log');
      await this.access.assertAccess(actor, current.projectId);
      if (!can(actor, 'equipment.manage') && current.recordedBy !== actor.userId) {
        throw ApiError.forbidden('Only the person who logged it, or a manager, can change this log');
      }
      const machine = await this.machine(tx, current.equipmentId);
      const date = input.log_date ?? utcDateToIsoDate(current.logDate);
      const site = await siteFor(tx, machine.id, date, undefined);
      await this.access.assertAccess(actor, site.projectId);

      const merged = {
        opening_meter: input.opening_meter !== undefined ? input.opening_meter : oneDecimalText(current.openingMeter),
        closing_meter: input.closing_meter !== undefined ? input.closing_meter : oneDecimalText(current.closingMeter),
        hours_worked: input.hours_worked !== undefined ? input.hours_worked : oneDecimalText(current.hoursWorked),
        idle_hours: input.idle_hours ?? oneDecimalText(current.idleHours) ?? '0',
        breakdown_hours: input.breakdown_hours ?? oneDecimalText(current.breakdownHours) ?? '0',
      };
      const hours = await this.checkHours(tx, machine, date, merged, id);
      const operatorWorkerId =
        input.operator_worker_id !== undefined ? await this.operator(tx, input.operator_worker_id) : current.operatorWorkerId;
      const costCodeId =
        input.cost_code_id !== undefined
          ? await costCodeOnSite(tx, site.projectId, input.cost_code_id)
          : site.projectId === current.projectId
            ? current.costCodeId
            : site.costCodeId;
      assertEquipmentKey(actor, input.meter_photo_key);
      try {
        await tx.equipmentLog.update({
          where: { id },
          data: {
            projectId: site.projectId,
            costCodeId,
            logDate: isoDateToUtcDate(date),
            openingMeter: hours.opening,
            closingMeter: hours.closing,
            hoursWorked: equipmentFromTenths(hours.worked),
            idleHours: equipmentFromTenths(hours.idle),
            breakdownHours: equipmentFromTenths(hours.breakdown),
            operatorWorkerId,
            ...(input.operator_name !== undefined || operatorWorkerId
              ? { operatorName: operatorWorkerId ? null : (input.operator_name ?? null) }
              : {}),
            ...(input.work_done !== undefined ? { workDone: input.work_done } : {}),
            ...(input.meter_photo_key !== undefined ? { meterPhotoKey: input.meter_photo_key } : {}),
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw ApiError.conflict(`${machine.code} is already logged for ${date}`);
        }
        throw error;
      }
      await this.bumpMeter(tx, machine.id, hours.closing);
      const row = await tx.equipmentLog.findUniqueOrThrow({ where: { id }, include: LOG_INCLUDE });
      return logView(row, await namesFor(tx, [row.recordedBy]));
    });
  }

  async remove(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await tx.equipmentLog.findUnique({ where: { id } });
      if (!current) throw ApiError.notFound('Log');
      await this.access.assertAccess(actor, current.projectId);
      await tx.equipmentLog.delete({ where: { id } });
    });
  }

  // --- fuel ---------------------------------------------------------------------------------------

  async listFuel(actor: RequestUser, query: ListEquipmentLogsQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const rows = await tx.equipmentFuel.findMany({
        where: {
          ...(query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor)),
          ...(query.equipment_id ? { equipmentId: query.equipment_id } : {}),
          ...(query.from || query.to
            ? {
                issuedOn: {
                  ...(query.from ? { gte: isoDateToUtcDate(query.from) } : {}),
                  ...(query.to ? { lte: isoDateToUtcDate(query.to) } : {}),
                },
              }
            : {}),
        },
        include: FUEL_INCLUDE,
        orderBy: [{ issuedOn: 'desc' }, { id: 'desc' }],
        take: query.limit,
      });
      return { items: rows.map((row) => fuelView(actor, row)) };
    });
  }

  async createFuel(actor: RequestUser, input: CreateEquipmentFuelInput) {
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (input.client_id) {
        const existing = await tx.equipmentFuel.findFirst({ where: { clientId: input.client_id }, include: FUEL_INCLUDE });
        if (existing) return fuelView(actor, existing);
      }
      const machine = await this.machine(tx, input.equipment_id);
      const site = await siteFor(tx, machine.id, input.issued_on, input.project_id);
      await this.access.assertAccess(actor, site.projectId);
      const log = await tx.equipmentLog.findUnique({
        where: { equipmentId_logDate: { equipmentId: machine.id, logDate: isoDateToUtcDate(input.issued_on) } },
        select: { id: true, costCodeId: true },
      });
      const reading = input.meter_reading ?? null;
      const id = await this.addFuel(tx, actor, machine, {
        projectId: site.projectId,
        costCodeId: log?.costCodeId ?? site.costCodeId,
        date: input.issued_on,
        logId: log?.id ?? null,
        meterReading: reading,
        fuel: input,
        clientId: input.client_id ?? null,
      });
      await this.bumpMeter(tx, machine.id, reading);
      return fuelView(actor, await tx.equipmentFuel.findUniqueOrThrow({ where: { id }, include: FUEL_INCLUDE }));
    });
  }

  /**
   * Taking a fuel entry back. Diesel issued from stock goes back into stock; an expense that was
   * recorded for it stays — it is its own record, with its own approval, and is deleted there.
   */
  async removeFuel(actor: RequestUser, id: string): Promise<void> {
    await this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const current = await tx.equipmentFuel.findUnique({ where: { id } });
      if (!current) throw ApiError.notFound('Fuel entry');
      await this.access.assertAccess(actor, current.projectId);
      if (current.stockMovementId) {
        await tx.stockMovement.update({ where: { id: current.stockMovementId }, data: { deletedAt: new Date() } });
      }
      await tx.equipmentFuel.delete({ where: { id } });
    });
  }

  // --- photos -------------------------------------------------------------------------------------

  /** Read a meter photo. Writes nothing: the reading pre-fills the form and the person confirms it. */
  async scanMeter(actor: RequestUser, input: EquipmentScanInput): Promise<EquipmentMeterScanResult> {
    assertEquipmentKey(actor, input.s3_key);
    // Before the photo is fetched: refused (not configured, or switched off) costs nothing.
    await this.gateway.assertEnabled(actor.tenantId, 'reading', READING_NOT_CONFIGURED);
    const file = await this.uploads.readObject(actor, input.s3_key, MAX_PHOTO_BYTES);
    return this.reader.readMeter(actor.tenantId, file.body, file.contentType);
  }

  /** Read a fuel bill. The amount becomes minor units here, in tested code, never in the model. */
  async scanFuelBill(actor: RequestUser, input: EquipmentScanInput): Promise<EquipmentFuelBillScanResult> {
    assertEquipmentKey(actor, input.s3_key);
    await this.gateway.assertEnabled(actor.tenantId, 'reading', READING_NOT_CONFIGURED);
    const file = await this.uploads.readObject(actor, input.s3_key, MAX_PHOTO_BYTES);
    const draft = await this.reader.readFuelBill(actor.tenantId, file.body, file.contentType, {
      country: actor.country,
      currency: actor.currency,
      taxRegime: actor.taxRegime,
    });
    const amount = draft.amount === null ? null : decimalToMinor(draft.amount, currencyMinorDigits(actor.currency));
    const issuedOn = draft.date_printed === null ? null : parseBillDate(draft.date_printed, new Date());
    const result = {
      litres: draft.litres,
      amount: amount === null ? null : amount.toString(),
      issued_on: issuedOn,
      vendor: draft.vendor,
    };
    return {
      ...result,
      unread: Object.entries(result)
        .filter(([key, value]) => key !== 'vendor' && value === null)
        .map(([key]) => key),
    };
  }

  // --- helpers ------------------------------------------------------------------------------------

  private async machine(tx: TenantTx, id: string) {
    const machine = await tx.equipment.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, meterType: true, fuelIncluded: true, archivedAt: true },
    });
    if (!machine) throw ApiError.notFound('Equipment');
    if (machine.archivedAt) throw ApiError.conflict('This machine is archived');
    return machine;
  }

  /** Validates a day's readings and hours, against the days logged either side. */
  private async checkHours(
    tx: TenantTx,
    machine: { id: string; meterType: string },
    date: IsoDate,
    input: {
      opening_meter?: string | null;
      closing_meter?: string | null;
      hours_worked?: string | null;
      idle_hours?: string;
      breakdown_hours?: string;
    },
    excludeId: string | null,
  ) {
    const meterType = machine.meterType as EquipmentMeterType;
    const opening = input.opening_meter ? equipmentToTenths(input.opening_meter) : null;
    const closing = input.closing_meter ? equipmentToTenths(input.closing_meter) : null;
    const checked = equipmentCheckLog({
      meterType,
      openingTenths: meterType === 'none' ? null : opening,
      closingTenths: meterType === 'none' ? null : closing,
      workedTenths: input.hours_worked ? equipmentToTenths(input.hours_worked) : null,
      idleTenths: input.idle_hours ? equipmentToTenths(input.idle_hours) : 0,
      breakdownTenths: input.breakdown_hours ? equipmentToTenths(input.breakdown_hours) : 0,
    });
    if (!checked.ok) throw ApiError.validationFailed(checked.errors, Object.values(checked.errors)[0]);

    if (meterType !== 'none' && opening !== null && closing !== null) {
      const day = isoDateToUtcDate(date);
      const others = { equipmentId: machine.id, ...(excludeId ? { id: { not: excludeId } } : {}) };
      const [previous, next] = await Promise.all([
        tx.equipmentLog.findFirst({
          where: { ...others, logDate: { lt: day }, closingMeter: { not: null } },
          orderBy: { logDate: 'desc' },
          select: { closingMeter: true },
        }),
        tx.equipmentLog.findFirst({
          where: { ...others, logDate: { gt: day }, openingMeter: { not: null } },
          orderBy: { logDate: 'asc' },
          select: { openingMeter: true },
        }),
      ]);
      const fits = equipmentMeterFits(
        { openingTenths: opening, closingTenths: closing },
        previous ? { closingTenths: tenthsOf(previous.closingMeter) } : null,
        next ? { openingTenths: tenthsOf(next.openingMeter) } : null,
      );
      if (!fits.ok) throw ApiError.validationFailed({ [fits.field]: fits.message }, `The meter readings overlap another day: ${fits.message}`);
    }
    return {
      opening: meterType === 'none' || opening === null ? null : equipmentFromTenths(opening),
      closing: meterType === 'none' || closing === null ? null : equipmentFromTenths(closing),
      worked: checked.workedTenths,
      idle: checked.idleTenths,
      breakdown: checked.breakdownTenths,
    };
  }

  private async operator(tx: TenantTx, workerId: string | null | undefined): Promise<string | null> {
    if (!workerId) return null;
    const worker = await tx.worker.findFirst({ where: { id: workerId, deletedAt: null }, select: { id: true } });
    if (!worker) throw ApiError.validationFailed({ operator_worker_id: 'unknown worker' }, 'That worker is not on the roster');
    return worker.id;
  }

  /** The machine's reading only moves forwards — a late log for last week does not wind it back. */
  private async bumpMeter(tx: TenantTx, id: string, reading: string | null): Promise<void> {
    if (!reading) return;
    await tx.$executeRaw`UPDATE "equipment" SET "meter_reading" = GREATEST(COALESCE("meter_reading", 0), ${reading}::numeric), "updated_at" = now() WHERE "id" = ${id}::uuid`;
  }

  /**
   * One fuel entry, and the record that carries its cost where another one does:
   * a stock issue for diesel from the site store, or an expense for a bill paid on the spot.
   */
  private async addFuel(
    tx: TenantTx,
    actor: RequestUser,
    machine: { id: string; code: string },
    entry: {
      projectId: string;
      costCodeId: string | null;
      date: IsoDate;
      logId: string | null;
      meterReading: string | null;
      fuel: EquipmentFuelInLogInput;
      clientId: string | null;
    },
  ): Promise<string> {
    const { fuel } = entry;
    assertEquipmentKey(actor, fuel.bill_s3_key);
    const litres = equipmentLitresFromHundredths(equipmentLitresToHundredths(fuel.litres));
    if (equipmentLitresToHundredths(fuel.litres) <= 0) {
      throw ApiError.validationFailed({ litres: 'must be more than zero' }, 'Enter the litres issued');
    }
    let amount = fuel.amount ?? 0n;
    let stockMovementId: string | null = null;
    let expenseId: string | null = null;
    let materialId: string | null = null;
    const label = `Diesel for ${machine.code} (${litres} L)`;

    if (fuel.source === 'vendor') {
      // The vendor's diesel is in the hire rate; there is nothing for us to pay.
      amount = 0n;
    } else if (fuel.source === 'stock') {
      if (!fuel.material_id) {
        throw ApiError.validationFailed({ material_id: 'pick the diesel' }, 'Pick which material in stock is the diesel');
      }
      const material = await tx.material.findFirst({
        where: { id: fuel.material_id, deletedAt: null },
        select: { id: true, name: true, unit: true },
      });
      if (!material) throw ApiError.notFound('Material');
      const grouped = await tx.stockMovement.groupBy({
        by: ['type'],
        where: { projectId: entry.projectId, materialId: material.id, deletedAt: null },
        _sum: { quantity: true },
      });
      const onHand = grouped.reduce((sum, row) => {
        const quantity = quantityToThousandths((row._sum.quantity ?? 0).toString());
        return row.type === 'in' ? sum + quantity : sum - quantity;
      }, 0n);
      if (quantityToThousandths(litres) > onHand) {
        throw ApiError.conflict(
          `Only ${thousandthsToQuantity(onHand)} ${material.unit} of ${material.name} on site. Record what arrived first.`,
        );
      }
      const movement = await tx.stockMovement.create({
        data: {
          tenantId: actor.tenantId,
          projectId: entry.projectId,
          materialId: material.id,
          type: 'out',
          quantity: litres,
          movedOn: isoDateToUtcDate(entry.date),
          note: label,
          recordedBy: actor.userId,
        },
      });
      stockMovementId = movement.id;
      materialId = material.id;
    } else if (fuel.source === 'expense') {
      if (fuel.expense_id) {
        const expense = await tx.expense.findFirst({
          where: { id: fuel.expense_id, deletedAt: null },
          select: { id: true, projectId: true, amount: true },
        });
        if (!expense) throw ApiError.notFound('Expense');
        if (expense.projectId !== entry.projectId) {
          throw ApiError.validationFailed({ expense_id: 'another site' }, 'That expense is on another site');
        }
        expenseId = expense.id;
        if (!fuel.amount) amount = expense.amount;
      } else if (fuel.create_expense) {
        if (!can(actor, 'expenses.record')) throw ApiError.forbidden('Recording an expense needs permission to record expenses');
        if (amount <= 0n) throw ApiError.validationFailed({ amount: 'required' }, 'Enter what the fuel cost');
        const expense = await tx.expense.create({
          data: {
            tenantId: actor.tenantId,
            projectId: entry.projectId,
            amount,
            category: 'fuel',
            spentOn: isoDateToUtcDate(entry.date),
            billS3Key: fuel.bill_s3_key ?? null,
            note: fuel.note ? `${label} · ${fuel.note}` : label,
            costCodeId: entry.costCodeId,
            submittedBy: actor.userId,
          },
        });
        expenseId = expense.id;
      } else {
        throw ApiError.validationFailed(
          { expense_id: 'pick or create the expense' },
          'Pick the expense this fuel was recorded on, or record it as a new one',
        );
      }
    }

    const row = await tx.equipmentFuel.create({
      data: {
        tenantId: actor.tenantId,
        equipmentId: machine.id,
        projectId: entry.projectId,
        logId: entry.logId,
        costCodeId: entry.costCodeId,
        issuedOn: isoDateToUtcDate(entry.date),
        litres,
        amount,
        source: fuel.source,
        materialId,
        stockMovementId,
        expenseId,
        billS3Key: fuel.bill_s3_key ?? null,
        meterReading: entry.meterReading,
        note: fuel.note ?? null,
        recordedBy: actor.userId,
        clientId: entry.clientId,
      },
    });
    return row.id;
  }
}

function logView(row: LogRow, names: Map<string, string>) {
  const worked = tenthsOf(row.hoursWorked) ?? 0;
  const litres = row.fuel.reduce((sum, entry) => sum + hundredthsOf(entry.litres), 0);
  return {
    id: row.id,
    equipment: row.equipment,
    project: row.project,
    cost_code: row.costCode,
    log_date: utcDateToIsoDate(row.logDate),
    opening_meter: oneDecimalText(row.openingMeter),
    closing_meter: oneDecimalText(row.closingMeter),
    hours_worked: oneDecimalText(row.hoursWorked),
    idle_hours: oneDecimalText(row.idleHours),
    breakdown_hours: oneDecimalText(row.breakdownHours),
    distance:
      row.equipment.meterType === 'km' && row.openingMeter !== null && row.closingMeter !== null
        ? equipmentFromTenths((tenthsOf(row.closingMeter) ?? 0) - (tenthsOf(row.openingMeter) ?? 0))
        : null,
    operator: row.operator ? { worker_id: row.operator.id, name: row.operator.name } : row.operatorName ? { worker_id: null, name: row.operatorName } : null,
    work_done: row.workDone,
    has_meter_photo: Boolean(row.meterPhotoKey),
    fuel_litres: litres > 0 ? equipmentLitresFromHundredths(litres) : null,
    fuel_per_hour: litres > 0 ? equipmentFuelRate(litres, worked) : null,
    recorded_by: { id: row.recordedBy, name: names.get(row.recordedBy) ?? 'Former member' },
    created_at: row.createdAt.toISOString(),
  };
}

function fuelView(actor: RequestUser, row: FuelRow) {
  return {
    id: row.id,
    equipment: row.equipment,
    project: row.project,
    log_id: row.logId,
    issued_on: utcDateToIsoDate(row.issuedOn),
    litres: litresText(row.litres),
    amount: money(actor, row.amount),
    source: row.source,
    source_label: EQUIPMENT_FUEL_SOURCE_LABELS[row.source as keyof typeof EQUIPMENT_FUEL_SOURCE_LABELS] ?? row.source,
    material: row.material,
    expense_id: row.expenseId,
    stock_movement_id: row.stockMovementId,
    meter_reading: oneDecimalText(row.meterReading),
    has_bill: Boolean(row.billS3Key),
    note: row.note,
  };
}
