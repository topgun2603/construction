import { Injectable } from '@nestjs/common';
import {
  EQUIPMENT_COST_KINDS,
  EQUIPMENT_COST_KIND_LABELS,
  EQUIPMENT_FUEL_OUTLIER,
  addDays,
  currencyMinorDigits,
  equipmentCostLines,
  equipmentDaysOnSite,
  equipmentFromTenths,
  equipmentFuelOutliers,
  equipmentFuelRate,
  equipmentLitresFromHundredths,
  equipmentUtilisation,
  isoDateToUtcDate,
  todayIn,
  utcDateToIsoDate,
  type BookEquipmentHireInput,
  type EquipmentCostKind,
  type EquipmentCostLine,
  type EquipmentExportQuery,
  type EquipmentFuelSource,
  type EquipmentHireStatementQuery,
  type EquipmentReportQuery,
  type IsoDate,
} from '@sitebook/shared';
import type { RequestUser } from '../../common/auth/request-user';
import { ProjectAccess } from '../../common/auth/project-access.service';
import { ApiError } from '../../common/errors/api-error';
import { TenantDb, type TenantTx } from '../../common/prisma/tenant-db.service';
import { CostActualsService, type ActualCostRow, type ActualCostSource } from '../cost-codes/cost-actuals.service';
import {
  MACHINE_COST_SELECT,
  assertEquipmentKey,
  costMachine,
  csv,
  csvMoney,
  hundredthsOf,
  litresText,
  oneDecimalText,
  tenthsOf,
} from './equipment-common';

/** A cost line with the machine it belongs to. */
export type MachineCostLine = EquipmentCostLine & { equipmentId: string; code: string; name: string };

interface Scope {
  /** One site, or every site. */
  projectId?: string;
  equipmentId?: string;
  vendorId?: string;
  from: IsoDate | null;
  to: IsoDate;
}

/** Report windows default to the last 30 days on the company's clock. */
function window(actor: RequestUser, query: { from?: string; to?: string }): { from: IsoDate; to: IsoDate } {
  const to = query.to ?? todayIn(actor.timezone);
  const from = query.from ?? addDays(to, -29);
  if (from > to) throw ApiError.validationFailed({ from: 'after to' }, 'The start is after the end');
  return { from, to };
}

const emptyKinds = () =>
  Object.fromEntries(EQUIPMENT_COST_KINDS.map((kind) => [kind, 0n])) as Record<EquipmentCostKind, bigint>;

const kindsView = (kinds: Record<EquipmentCostKind, bigint>) =>
  Object.fromEntries(Object.entries(kinds).map(([kind, amount]) => [kind, amount.toString()])) as Record<
    EquipmentCostKind,
    string
  >;

/**
 * What equipment costs, and how it reaches the cost report (roadmap Phase 2, module 10).
 *
 * Every figure here comes from `equipmentCostLines` in @sitebook/shared, which is also where the
 * **no double counting** rule is written down: a line already carried by another record — an
 * expense, a booked hire invoice, a stock issue — is shown but not counted. Registering with
 * `CostActualsService` puts the counted lines into the site's actual cost beside expenses, labour
 * and certified subcontract bills.
 */
@Injectable()
export class EquipmentCostsService implements ActualCostSource {
  readonly name = 'equipment';

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: ProjectAccess,
    actuals: CostActualsService,
  ) {
    actuals.register(this);
  }

  /** Counted equipment cost on one site, for the cost report and the forecast. */
  async actuals(tx: TenantTx, projectId: string, upTo: IsoDate): Promise<ActualCostRow[]> {
    const lines = await this.lines(tx, { projectId, from: null, to: upTo });
    return lines
      .filter((line) => line.counted && line.projectId === projectId)
      .map((line) => ({
        costCodeId: line.costCodeId,
        amount: line.amount,
        date: line.date > upTo ? upTo : line.date,
        line: `Equipment · ${line.code} ${EQUIPMENT_COST_KIND_LABELS[line.kind].toLowerCase()}`,
      }));
  }

  /** Cost lines for every machine in scope, inside the scope's window and on its site. */
  async lines(tx: TenantTx, scope: Scope): Promise<MachineCostLine[]> {
    const touches = scope.projectId
      ? {
          OR: [
            { allocations: { some: { projectId: scope.projectId } } },
            { maintenance: { some: { projectId: scope.projectId } } },
            { fuel: { some: { projectId: scope.projectId } } },
          ],
        }
      : {};
    const machines = await tx.equipment.findMany({
      where: {
        ...touches,
        ...(scope.equipmentId ? { id: scope.equipmentId } : {}),
        ...(scope.vendorId ? { vendorId: scope.vendorId } : {}),
      },
      select: { ...MACHINE_COST_SELECT, name: true },
    });
    if (machines.length === 0) return [];
    const ids = machines.map((machine) => machine.id);
    const upTo = isoDateToUtcDate(scope.to);
    const since = scope.from ? { gte: isoDateToUtcDate(scope.from) } : {};

    const [allocations, logs, fuel, maintenance, bookings] = await Promise.all([
      tx.equipmentAllocation.findMany({ where: { equipmentId: { in: ids }, fromDate: { lte: upTo } } }),
      tx.equipmentLog.findMany({
        where: { equipmentId: { in: ids }, logDate: { lte: upTo, ...since } },
        select: {
          equipmentId: true,
          projectId: true,
          costCodeId: true,
          logDate: true,
          hoursWorked: true,
          idleHours: true,
          breakdownHours: true,
        },
      }),
      tx.equipmentFuel.findMany({
        where: { equipmentId: { in: ids }, issuedOn: { lte: upTo, ...since } },
        select: {
          id: true,
          equipmentId: true,
          projectId: true,
          costCodeId: true,
          issuedOn: true,
          amount: true,
          source: true,
        },
      }),
      tx.equipmentMaintenance.findMany({
        where: { equipmentId: { in: ids }, doneOn: { lte: upTo, ...since } },
        select: {
          id: true,
          equipmentId: true,
          projectId: true,
          costCodeId: true,
          doneOn: true,
          cost: true,
          expenseId: true,
          expense: { select: { deletedAt: true, status: true } },
        },
      }),
      // A booking counts only while its expense does: rejected or deleted, the hire is ours again.
      tx.equipmentHireBooking.findMany({
        where: { equipmentId: { in: ids }, expense: { deletedAt: null, status: { not: 'rejected' } } },
        select: { equipmentId: true, projectId: true, month: true },
      }),
    ]);

    const group = <T extends { equipmentId: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) map.set(row.equipmentId, [...(map.get(row.equipmentId) ?? []), row]);
      return map;
    };
    const byAllocation = group(allocations);
    const byLog = group(logs);
    const byFuel = group(fuel);
    const byRecord = group(maintenance);
    const byBooking = group(bookings);

    const out: MachineCostLine[] = [];
    for (const machine of machines) {
      const lines = equipmentCostLines({
        machine: costMachine(machine),
        allocations: (byAllocation.get(machine.id) ?? []).map((row) => ({
          projectId: row.projectId,
          costCodeId: row.costCodeId,
          from: utcDateToIsoDate(row.fromDate),
          to: row.toDate ? utcDateToIsoDate(row.toDate) : null,
        })),
        logs: (byLog.get(machine.id) ?? []).map((row) => ({
          date: utcDateToIsoDate(row.logDate),
          projectId: row.projectId,
          costCodeId: row.costCodeId,
          workedTenths: tenthsOf(row.hoursWorked) ?? 0,
          idleTenths: tenthsOf(row.idleHours) ?? 0,
          breakdownTenths: tenthsOf(row.breakdownHours) ?? 0,
        })),
        fuel: (byFuel.get(machine.id) ?? []).map((row) => ({
          id: row.id,
          date: utcDateToIsoDate(row.issuedOn),
          projectId: row.projectId,
          costCodeId: row.costCodeId,
          amount: row.amount,
          source: row.source as EquipmentFuelSource,
        })),
        maintenance: (byRecord.get(machine.id) ?? []).map((row) => ({
          id: row.id,
          date: utcDateToIsoDate(row.doneOn),
          projectId: row.projectId,
          costCodeId: row.costCodeId,
          cost: row.cost,
          // A rejected or deleted expense no longer carries the cost, so the repair is ours to count.
          expenseLinked: Boolean(row.expense && row.expense.deletedAt === null && row.expense.status !== 'rejected'),
        })),
        booked: new Set((byBooking.get(machine.id) ?? []).map((row) => `${row.projectId}:${row.month}`)),
        window: { from: scope.from, to: scope.to },
      });
      for (const line of lines) {
        if (scope.projectId && line.projectId !== scope.projectId) continue;
        out.push({ ...line, equipmentId: machine.id, code: machine.code, name: machine.name });
      }
    }
    return out;
  }

  // --- reports ------------------------------------------------------------------------------------

  /** Cost per machine per site, per site and per cost code, in a window. */
  async costs(actor: RequestUser, query: EquipmentReportQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const range = window(actor, query);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const lines = this.visible(
        actor,
        await this.lines(tx, { projectId: query.project_id, equipmentId: query.equipment_id, ...range }),
      );
      const projectNames = await this.projectNames(tx, lines.map((line) => line.projectId));
      const codeNames = await this.codeNames(tx, lines.map((line) => line.costCodeId));

      type Row = {
        equipmentId: string;
        code: string;
        name: string;
        projectId: string | null;
        kinds: Record<EquipmentCostKind, bigint>;
        total: bigint;
        counted: bigint;
        workedTenths: number;
        chargeableTenths: number;
      };
      const rows = new Map<string, Row>();
      const sites = new Map<string | null, { total: bigint; counted: bigint }>();
      const codes = new Map<string, { projectId: string | null; costCodeId: string | null; counted: bigint; total: bigint }>();
      for (const line of lines) {
        const key = `${line.equipmentId}:${line.projectId}`;
        const row = rows.get(key) ?? {
          equipmentId: line.equipmentId,
          code: line.code,
          name: line.name,
          projectId: line.projectId,
          kinds: emptyKinds(),
          total: 0n,
          counted: 0n,
          workedTenths: 0,
          chargeableTenths: 0,
        };
        row.kinds[line.kind] += line.amount;
        row.total += line.amount;
        if (line.counted) row.counted += line.amount;
        if (line.kind === 'hire' || line.kind === 'charge_out') {
          row.workedTenths += line.workedTenths ?? 0;
          row.chargeableTenths += line.chargeableTenths ?? line.workedTenths ?? 0;
        }
        rows.set(key, row);
        const site = sites.get(line.projectId) ?? { total: 0n, counted: 0n };
        site.total += line.amount;
        if (line.counted) site.counted += line.amount;
        sites.set(line.projectId, site);
        const codeKey = `${line.projectId}:${line.costCodeId}`;
        const code = codes.get(codeKey) ?? { projectId: line.projectId, costCodeId: line.costCodeId, counted: 0n, total: 0n };
        code.total += line.amount;
        if (line.counted) code.counted += line.amount;
        codes.set(codeKey, code);
      }
      const totals = { total: 0n, counted: 0n, kinds: emptyKinds() };
      for (const row of rows.values()) {
        totals.total += row.total;
        totals.counted += row.counted;
        for (const kind of EQUIPMENT_COST_KINDS) totals.kinds[kind] += row.kinds[kind];
      }
      const site = (id: string | null) => (id ? { id, name: projectNames.get(id) ?? '—' } : null);
      return {
        from: range.from,
        to: range.to,
        rows: [...rows.values()]
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((row) => ({
            equipment: { id: row.equipmentId, code: row.code, name: row.name },
            project: site(row.projectId),
            ...kindsView(row.kinds),
            total: row.total.toString(),
            counted: row.counted.toString(),
            not_counted: (row.total - row.counted).toString(),
            hours_worked: equipmentFromTenths(row.workedTenths),
            hours_charged: equipmentFromTenths(row.chargeableTenths),
          })),
        sites: [...sites.entries()].map(([id, value]) => ({
          project: site(id),
          total: value.total.toString(),
          counted: value.counted.toString(),
        })),
        cost_codes: [...codes.values()].map((value) => ({
          project: site(value.projectId),
          cost_code: value.costCodeId ? { id: value.costCodeId, ...(codeNames.get(value.costCodeId) ?? { code: '', name: '' }) } : null,
          total: value.total.toString(),
          counted: value.counted.toString(),
        })),
        totals: {
          ...kindsView(totals.kinds),
          total: totals.total.toString(),
          counted: totals.counted.toString(),
          not_counted: (totals.total - totals.counted).toString(),
        },
      };
    });
  }

  /** Worked against available hours, idle and breakdown, and fuel per hour, per machine. */
  async utilisation(actor: RequestUser, query: EquipmentReportQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const range = window(actor, query);
    const today = todayIn(actor.timezone);
    // Days still to come are not days the machine failed to work.
    const upTo = range.to < today ? range.to : today;
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const sites = query.project_id
        ? { projectId: query.project_id }
        : this.access.scopeFilterByProjectId(actor);
      const machines = await tx.equipment.findMany({
        where: {
          ...(query.equipment_id ? { id: query.equipment_id } : {}),
          OR: [{ archivedAt: null }, { logs: { some: { logDate: { gte: isoDateToUtcDate(range.from) } } } }],
        },
        select: {
          id: true,
          code: true,
          name: true,
          category: true,
          ownership: true,
          allocations: {
            where: { ...sites, fromDate: { lte: isoDateToUtcDate(upTo) } },
            select: { fromDate: true, toDate: true },
          },
          logs: {
            where: { ...sites, logDate: { gte: isoDateToUtcDate(range.from), lte: isoDateToUtcDate(upTo) } },
            select: { logDate: true, hoursWorked: true, idleHours: true, breakdownHours: true },
          },
          fuel: {
            where: { ...sites, issuedOn: { gte: isoDateToUtcDate(range.from), lte: isoDateToUtcDate(upTo) } },
            select: { litres: true },
          },
        },
        orderBy: { code: 'asc' },
      });
      const rows = machines
        .map((machine) => {
          const days = equipmentDaysOnSite(
            machine.allocations.map((allocation) => ({
              from: utcDateToIsoDate(allocation.fromDate),
              to: allocation.toDate ? utcDateToIsoDate(allocation.toDate) : null,
            })),
            { from: range.from, to: upTo },
          );
          const use = equipmentUtilisation(
            days,
            machine.logs.map((log) => ({
              date: utcDateToIsoDate(log.logDate),
              workedTenths: tenthsOf(log.hoursWorked) ?? 0,
              idleTenths: tenthsOf(log.idleHours) ?? 0,
              breakdownTenths: tenthsOf(log.breakdownHours) ?? 0,
            })),
          );
          const litres = machine.fuel.reduce((sum, entry) => sum + hundredthsOf(entry.litres), 0);
          return {
            equipment: { id: machine.id, code: machine.code, name: machine.name, category: machine.category, ownership: machine.ownership },
            days_on_site: use.daysOnSite,
            hours_worked: equipmentFromTenths(use.workedTenths),
            hours_idle: equipmentFromTenths(use.idleTenths),
            hours_breakdown: equipmentFromTenths(use.breakdownTenths),
            hours_available: equipmentFromTenths(use.availableTenths),
            utilisation_percent: use.utilisationPercent,
            breakdown_percent: use.breakdownPercent,
            fuel_litres: equipmentLitresFromHundredths(litres),
            fuel_per_hour: equipmentFuelRate(litres, use.workedTenths),
          };
        })
        .filter((row) => row.days_on_site > 0 || row.fuel_litres !== '0');
      return { from: range.from, to: upTo, rows };
    });
  }

  /** Fuel per machine per day, and the days well above the machine's own average. */
  async fuel(actor: RequestUser, query: EquipmentReportQuery) {
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const range = window(actor, query);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      const days = await this.fuelDays(tx, {
        from: range.from,
        to: range.to,
        projectId: query.project_id,
        equipmentId: query.equipment_id,
        scope: this.access.scopeFilterByProjectId(actor),
      });
      const outliers = equipmentFuelOutliers(days);
      const machines = await tx.equipment.findMany({
        where: { id: { in: [...new Set(days.map((day) => day.equipmentId))] } },
        select: { id: true, code: true, name: true },
      });
      const names = new Map(machines.map((machine) => [machine.id, machine]));
      const perMachine = new Map<string, { litres: number; hours: number; days: number }>();
      for (const day of days) {
        const entry = perMachine.get(day.equipmentId) ?? { litres: 0, hours: 0, days: 0 };
        entry.litres += day.litresHundredths;
        entry.hours += day.workedTenths;
        entry.days += 1;
        perMachine.set(day.equipmentId, entry);
      }
      const projectNames = await this.projectNames(tx, outliers.map((row) => row.projectId));
      return {
        from: range.from,
        to: range.to,
        threshold_percent: EQUIPMENT_FUEL_OUTLIER.percent,
        machines: [...perMachine.entries()].map(([id, entry]) => ({
          equipment: names.get(id) ?? { id, code: '', name: '' },
          litres: equipmentLitresFromHundredths(entry.litres),
          hours_worked: equipmentFromTenths(entry.hours),
          fuel_per_hour: equipmentFuelRate(entry.litres, entry.hours),
          days: entry.days,
        })),
        outliers: outliers.map((row) => ({
          equipment: names.get(row.equipmentId) ?? { id: row.equipmentId, code: '', name: '' },
          project: { id: row.projectId, name: projectNames.get(row.projectId) ?? '—' },
          date: row.date,
          litres: equipmentLitresFromHundredths(row.litresHundredths),
          hours_worked: equipmentFromTenths(row.workedTenths),
          fuel_per_hour: row.rate,
          usual_per_hour: row.average,
          above_percent: row.abovePercent,
        })),
      };
    });
  }

  /**
   * Litres and hours per machine per day — what the fuel report judges, and the same day-by-day sums
   * the nightly leakage check (checks module, `fuelOutliers`) builds for itself.
   */
  private async fuelDays(
    tx: TenantTx,
    input: {
      from: IsoDate;
      to: IsoDate;
      projectId?: string;
      equipmentId?: string;
      scope?: { projectId?: { in: string[] } };
    },
  ) {
    const range = { gte: isoDateToUtcDate(input.from), lte: isoDateToUtcDate(input.to) };
    const site = input.projectId ? { projectId: input.projectId } : (input.scope ?? {});
    const machine = input.equipmentId ? { equipmentId: input.equipmentId } : {};
    const [fuel, logs] = await Promise.all([
      tx.equipmentFuel.findMany({
        where: { ...site, ...machine, issuedOn: range },
        select: { equipmentId: true, projectId: true, issuedOn: true, litres: true },
      }),
      tx.equipmentLog.findMany({
        where: { ...site, ...machine, logDate: range },
        select: { equipmentId: true, projectId: true, logDate: true, hoursWorked: true },
      }),
    ]);
    const days = new Map<string, { equipmentId: string; projectId: string; date: IsoDate; litresHundredths: number; workedTenths: number }>();
    const key = (equipmentId: string, date: Date) => `${equipmentId}:${utcDateToIsoDate(date)}`;
    for (const entry of fuel) {
      const k = key(entry.equipmentId, entry.issuedOn);
      const day = days.get(k) ?? {
        equipmentId: entry.equipmentId,
        projectId: entry.projectId,
        date: utcDateToIsoDate(entry.issuedOn),
        litresHundredths: 0,
        workedTenths: 0,
      };
      day.litresHundredths += hundredthsOf(entry.litres);
      days.set(k, day);
    }
    for (const log of logs) {
      const day = days.get(key(log.equipmentId, log.logDate));
      if (day) day.workedTenths += tenthsOf(log.hoursWorked) ?? 0;
    }
    return [...days.values()];
  }

  // --- hire statements ----------------------------------------------------------------------------

  /**
   * One vendor's month: every machine hired from them, per site — days, hours worked, the minimum
   * hours topped up, hire at the agreed rate, operator and mobilisation. What their invoice is checked
   * against, line by line.
   */
  async hireStatement(actor: RequestUser, query: EquipmentHireStatementQuery) {
    return this.tenantDb.transaction(actor.tenantId, (tx) => this.statement(tx, actor, query));
  }

  /**
   * The vendor's invoice for the month has been checked: book it. Each machine and site becomes an
   * expense in the equipment-hire category, dated the month's last day (or today, mid-month), coded
   * to the site's line when the hire had one — and from then on the cost report counts the expense,
   * not the hire worked out here.
   */
  async bookHire(actor: RequestUser, input: BookEquipmentHireInput) {
    assertEquipmentKey(actor, input.bill_s3_key);
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      // A booking whose expense was rejected or deleted no longer carries the cost; clear it so the
      // month can be booked again.
      await tx.equipmentHireBooking.deleteMany({
        where: {
          vendorId: input.vendor_id,
          month: input.month,
          expense: { OR: [{ deletedAt: { not: null } }, { status: 'rejected' }] },
        },
      });
      const statement = await this.statement(tx, actor, { vendor_id: input.vendor_id, month: input.month });
      const open = statement.rows.filter((row) => !row.booked && BigInt(row.total) > 0n && row.project);
      if (open.length === 0) throw ApiError.conflict('Nothing left to book for this vendor and month');
      const spentOn = statement.to;
      for (const row of open) {
        await this.access.assertAccess(actor, row.project!.id);
        const note = [`Hire · ${row.equipment.code} ${row.equipment.name}`, statement.vendor.name, input.month, input.invoice_ref]
          .filter(Boolean)
          .join(' · ');
        const expense = await tx.expense.create({
          data: {
            tenantId: actor.tenantId,
            projectId: row.project!.id,
            amount: BigInt(row.total),
            category: 'equipment_hire',
            spentOn: isoDateToUtcDate(spentOn),
            billS3Key: input.bill_s3_key ?? null,
            note: note.slice(0, 500),
            costCodeId: row.cost_code_id,
            submittedBy: actor.userId,
          },
        });
        await tx.equipmentHireBooking.create({
          data: {
            tenantId: actor.tenantId,
            vendorId: input.vendor_id,
            equipmentId: row.equipment.id,
            projectId: row.project!.id,
            month: input.month,
            amount: BigInt(row.total),
            expenseId: expense.id,
            invoiceRef: input.invoice_ref ?? null,
            createdBy: actor.userId,
          },
        });
      }
      return this.statement(tx, actor, { vendor_id: input.vendor_id, month: input.month });
    });
  }

  private async statement(tx: TenantTx, actor: RequestUser, query: EquipmentHireStatementQuery) {
    const vendor = await tx.vendor.findUnique({ where: { id: query.vendor_id }, select: { id: true, name: true } });
    if (!vendor) throw ApiError.notFound('Vendor');
    const from = `${query.month}-01`;
    const monthEnd = addDays(utcDateToIsoDate(new Date(Date.UTC(Number(query.month.slice(0, 4)), Number(query.month.slice(5, 7)), 1))), -1);
    const today = todayIn(actor.timezone);
    const to = monthEnd < today ? monthEnd : today;
    if (from > to) throw ApiError.validationFailed({ month: 'in the future' }, 'That month has not started yet');

    const lines = this.visible(
      actor,
      (await this.lines(tx, { vendorId: vendor.id, from, to })).filter((line) =>
        ['hire', 'operator', 'mobilisation'].includes(line.kind),
      ),
    );
    const machines = await tx.equipment.findMany({
      where: { vendorId: vendor.id },
      select: { id: true, hireBasis: true, hireRate: true, minHours: true, operatorRate: true, mobilisationCharge: true },
    });
    const terms = new Map(machines.map((machine) => [machine.id, machine]));
    const bookings = await tx.equipmentHireBooking.findMany({
      where: { vendorId: vendor.id, month: query.month, expense: { deletedAt: null, status: { not: 'rejected' } } },
      select: { equipmentId: true, projectId: true, expenseId: true, invoiceRef: true, amount: true },
    });
    const booked = new Map(bookings.map((row) => [`${row.equipmentId}:${row.projectId}`, row]));
    const projectNames = await this.projectNames(tx, lines.map((line) => line.projectId));

    type Row = {
      equipmentId: string;
      code: string;
      name: string;
      projectId: string | null;
      days: Set<string>;
      worked: number;
      charged: number;
      topUp: number;
      onHireDays: number;
      extra: number;
      hire: bigint;
      operator: bigint;
      mobilisation: bigint;
      codes: Set<string | null>;
    };
    const rows = new Map<string, Row>();
    for (const line of lines) {
      const key = `${line.equipmentId}:${line.projectId}`;
      const row = rows.get(key) ?? {
        equipmentId: line.equipmentId,
        code: line.code,
        name: line.name,
        projectId: line.projectId,
        days: new Set<string>(),
        worked: 0,
        charged: 0,
        topUp: 0,
        onHireDays: 0,
        extra: 0,
        hire: 0n,
        operator: 0n,
        mobilisation: 0n,
        codes: new Set<string | null>(),
      };
      row.codes.add(line.costCodeId);
      if (line.kind === 'hire') {
        row.hire += line.amount;
        row.worked += line.workedTenths ?? 0;
        row.charged += line.chargeableTenths ?? 0;
        row.topUp += line.topUpTenths ?? 0;
        row.extra += line.extraTenths ?? 0;
        if (line.onHireDays) row.onHireDays += line.onHireDays;
        else row.days.add(line.date);
      } else if (line.kind === 'operator') {
        row.operator += line.amount;
      } else {
        row.mobilisation += line.amount;
      }
      rows.set(key, row);
    }
    const out = [...rows.values()]
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((row) => {
        const machine = terms.get(row.equipmentId);
        const booking = booked.get(`${row.equipmentId}:${row.projectId}`);
        const total = row.hire + row.operator + row.mobilisation;
        return {
          equipment: { id: row.equipmentId, code: row.code, name: row.name },
          project: row.projectId ? { id: row.projectId, name: projectNames.get(row.projectId) ?? '—' } : null,
          hire_basis: machine?.hireBasis ?? null,
          rate: machine?.hireRate.toString() ?? '0',
          min_hours: oneDecimalText(machine?.minHours),
          days: row.onHireDays || row.days.size,
          hours_worked: equipmentFromTenths(row.worked),
          hours_charged: equipmentFromTenths(row.charged),
          minimum_top_up: equipmentFromTenths(row.topUp),
          extra_hours: equipmentFromTenths(row.extra),
          hire: row.hire.toString(),
          operator: row.operator.toString(),
          mobilisation: row.mobilisation.toString(),
          total: total.toString(),
          // One code across the month is the code the booked expense takes; mixed, it is left for a person.
          cost_code_id: row.codes.size === 1 ? [...row.codes][0]! : null,
          booked: booking ? { expense_id: booking.expenseId, invoice_ref: booking.invoiceRef, amount: booking.amount.toString() } : null,
        };
      });
    return {
      vendor,
      month: query.month,
      from,
      to,
      rows: out,
      total: out.reduce((sum, row) => sum + BigInt(row.total), 0n).toString(),
      booked_total: out.reduce((sum, row) => sum + (row.booked ? BigInt(row.booked.amount) : 0n), 0n).toString(),
    };
  }

  // --- CSV ----------------------------------------------------------------------------------------

  async exportCsv(actor: RequestUser, query: EquipmentExportQuery): Promise<string> {
    const digits = currencyMinorDigits(actor.currency);
    const amount = (value: string | null) => (value === null ? '' : csvMoney(BigInt(value), digits));
    switch (query.kind) {
      case 'costs': {
        const report = await this.costs(actor, query);
        return csv([
          ['Code', 'Machine', 'Site', 'Hours worked', 'Hours charged', ...EQUIPMENT_COST_KINDS.map((kind) => EQUIPMENT_COST_KIND_LABELS[kind]), 'Total', 'Counted in cost report', 'Carried by an expense or stock'],
          ...report.rows.map((row) => [
            row.equipment.code,
            row.equipment.name,
            row.project?.name ?? 'Yard',
            row.hours_worked,
            row.hours_charged,
            ...EQUIPMENT_COST_KINDS.map((kind) => amount(row[kind])),
            amount(row.total),
            amount(row.counted),
            amount(row.not_counted),
          ]),
        ]);
      }
      case 'utilisation': {
        const report = await this.utilisation(actor, query);
        return csv([
          ['Code', 'Machine', 'Days on site', 'Hours worked', 'Hours idle', 'Hours breakdown', 'Hours available', 'Utilisation %', 'Breakdown %', 'Fuel (L)', 'Fuel per hour (L/h)'],
          ...report.rows.map((row) => [
            row.equipment.code,
            row.equipment.name,
            row.days_on_site,
            row.hours_worked,
            row.hours_idle,
            row.hours_breakdown,
            row.hours_available,
            row.utilisation_percent,
            row.breakdown_percent,
            row.fuel_litres,
            row.fuel_per_hour,
          ]),
        ]);
      }
      default:
        return this.exportRecords(actor, query, amount);
    }
  }

  private async exportRecords(
    actor: RequestUser,
    query: EquipmentExportQuery,
    amount: (value: string | null) => string,
  ): Promise<string> {
    const range = window(actor, query);
    if (query.project_id) await this.access.assertAccess(actor, query.project_id);
    const site = query.project_id ? { projectId: query.project_id } : this.access.scopeFilterByProjectId(actor);
    const machine = query.equipment_id ? { equipmentId: query.equipment_id } : {};
    const dates = { gte: isoDateToUtcDate(range.from), lte: isoDateToUtcDate(range.to) };
    return this.tenantDb.transaction(actor.tenantId, async (tx) => {
      if (query.kind === 'register') {
        const rows = await tx.equipment.findMany({
          where: { archivedAt: null, ...(query.equipment_id ? { id: query.equipment_id } : {}) },
          include: {
            vendor: { select: { name: true } },
            allocations: { where: { toDate: null }, include: { project: { select: { name: true } } } },
          },
          orderBy: { code: 'asc' },
        });
        return csv([
          ['Code', 'Name', 'Category', 'Make', 'Model', 'Registration', 'Serial', 'Ownership', 'Vendor', 'Hire basis', 'Hire rate', 'Min hours', 'Charge-out basis', 'Charge-out rate', 'Meter', 'Reading', 'Status', 'Site'],
          ...rows.map((row) => [
            row.code,
            row.name,
            row.category,
            row.make,
            row.model,
            row.registrationNo,
            row.serialNo,
            row.ownership,
            row.vendor?.name,
            row.hireBasis,
            row.ownership === 'hired' ? amount(row.hireRate.toString()) : '',
            oneDecimalText(row.minHours),
            row.chargeOutBasis,
            row.ownership === 'owned' ? amount(row.chargeOutRate.toString()) : '',
            row.meterType,
            oneDecimalText(row.meterReading),
            row.status,
            row.allocations[0]?.project.name,
          ]),
        ]);
      }
      if (query.kind === 'logs') {
        const rows = await tx.equipmentLog.findMany({
          where: { ...site, ...machine, logDate: dates },
          include: {
            equipment: { select: { code: true, name: true } },
            project: { select: { name: true } },
            operator: { select: { name: true } },
            costCode: { select: { code: true } },
          },
          orderBy: [{ logDate: 'asc' }],
        });
        return csv([
          ['Date', 'Code', 'Machine', 'Site', 'Cost code', 'Opening', 'Closing', 'Worked', 'Idle', 'Breakdown', 'Operator', 'Work done'],
          ...rows.map((row) => [
            utcDateToIsoDate(row.logDate),
            row.equipment.code,
            row.equipment.name,
            row.project.name,
            row.costCode?.code,
            oneDecimalText(row.openingMeter),
            oneDecimalText(row.closingMeter),
            oneDecimalText(row.hoursWorked),
            oneDecimalText(row.idleHours),
            oneDecimalText(row.breakdownHours),
            row.operator?.name ?? row.operatorName,
            row.workDone,
          ]),
        ]);
      }
      if (query.kind === 'fuel') {
        const rows = await tx.equipmentFuel.findMany({
          where: { ...site, ...machine, issuedOn: dates },
          include: { equipment: { select: { code: true, name: true } }, project: { select: { name: true } } },
          orderBy: [{ issuedOn: 'asc' }],
        });
        return csv([
          ['Date', 'Code', 'Machine', 'Site', 'Litres', 'Amount', 'Source', 'Meter'],
          ...rows.map((row) => [
            utcDateToIsoDate(row.issuedOn),
            row.equipment.code,
            row.equipment.name,
            row.project.name,
            litresText(row.litres),
            amount(row.amount.toString()),
            row.source,
            oneDecimalText(row.meterReading),
          ]),
        ]);
      }
      const rows = await tx.equipmentMaintenance.findMany({
        where: {
          // Yard work belongs to no site, so only those who see every site see it here.
          ...site,
          ...machine,
          doneOn: dates,
        },
        include: { equipment: { select: { code: true, name: true } }, project: { select: { name: true } } },
        orderBy: [{ doneOn: 'asc' }],
      });
      return csv([
        ['Date', 'Code', 'Machine', 'Site', 'Kind', 'Description', 'Parts', 'Cost', 'Downtime (h)', 'Recorded as expense'],
        ...rows.map((row) => [
          utcDateToIsoDate(row.doneOn),
          row.equipment.code,
          row.equipment.name,
          row.project?.name ?? 'Yard',
          row.kind,
          row.description,
          row.parts,
          amount(row.cost.toString()),
          oneDecimalText(row.downtimeHours),
          row.expenseId ? 'yes' : 'no',
        ]),
      ]);
    });
  }

  // --- helpers ------------------------------------------------------------------------------------

  /** Only the sites this person can see; yard costs only for those who see every site. */
  private visible<T extends { projectId: string | null }>(actor: RequestUser, lines: T[]): T[] {
    if (actor.seesAllProjects) return lines;
    const mine = new Set(actor.projectIds);
    return lines.filter((line) => line.projectId !== null && mine.has(line.projectId));
  }

  private async projectNames(tx: TenantTx, ids: ReadonlyArray<string | null>) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map<string, string>();
    const rows = await tx.project.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private async codeNames(tx: TenantTx, ids: ReadonlyArray<string | null>) {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map<string, { code: string; name: string }>();
    const rows = await tx.costCode.findMany({ where: { id: { in: wanted } }, select: { id: true, code: true, name: true } });
    return new Map(rows.map((row) => [row.id, { code: row.code, name: row.name }]));
  }
}
