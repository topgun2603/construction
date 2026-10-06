import { addDays, daysBetweenInclusive, type IsoDate } from './dates';
import { roundedDivide } from './subcontracts';

/**
 * Equipment and plant (roadmap Phase 2, module 10): owned and hired machines, their daily hours and
 * fuel, their servicing, and what they cost each site.
 *
 * The vocabulary and every piece of arithmetic the module does — hours from meter readings, hire
 * charges with minimum hours, monthly hire with extra hours, the internal charge-out for owned kit,
 * fuel per hour and its outliers, when a service falls due, utilisation. Pure functions only: the
 * API's cost report, the hire statement a vendor's invoice is checked against, the CSV and the web
 * all call these, so they agree by construction.
 *
 * Units, so nothing is ever a float in a ledger:
 * - hours and meter readings travel as decimal strings with at most one decimal and are added up
 *   in integer **tenths** (`7.5` h = 75);
 * - litres travel with at most two decimals and are added up in integer **hundredths**;
 * - money is `bigint` minor units, like everywhere else.
 *
 * Every export is prefixed `equipment`/`EQUIPMENT_` so it can never be mistaken for another
 * module's name in an import.
 */

// --- vocabulary ------------------------------------------------------------------------------------

export const EQUIPMENT_CATEGORIES = [
  'excavator',
  'backhoe',
  'crane',
  'concrete_mixer',
  'compactor',
  'generator',
  'pump',
  'scaffolding',
  'vehicle',
  'small_tools',
  'other',
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  excavator: 'Excavator',
  backhoe: 'Backhoe loader (JCB)',
  crane: 'Crane',
  concrete_mixer: 'Concrete mixer',
  compactor: 'Compactor / roller',
  generator: 'Generator (DG set)',
  pump: 'Pump',
  scaffolding: 'Scaffolding sets',
  vehicle: 'Vehicle',
  small_tools: 'Small tools (bulk)',
  other: 'Other',
};

export const EQUIPMENT_OWNERSHIPS = ['owned', 'hired'] as const;
export type EquipmentOwnership = (typeof EQUIPMENT_OWNERSHIPS)[number];

/** How a hired machine is charged by its vendor. */
export const EQUIPMENT_HIRE_BASES = ['hour', 'day', 'month'] as const;
export type EquipmentHireBasis = (typeof EQUIPMENT_HIRE_BASES)[number];

/** How an owned machine is charged to the site it works on. */
export const EQUIPMENT_CHARGE_BASES = ['hour', 'day'] as const;
export type EquipmentChargeBasis = (typeof EQUIPMENT_CHARGE_BASES)[number];

export const EQUIPMENT_METER_TYPES = ['hours', 'km', 'none'] as const;
export type EquipmentMeterType = (typeof EQUIPMENT_METER_TYPES)[number];

export const EQUIPMENT_STATUSES = ['available', 'on_site', 'under_maintenance', 'off_hire'] as const;
export type EquipmentStatus = (typeof EQUIPMENT_STATUSES)[number];

export const EQUIPMENT_STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: 'Available',
  on_site: 'On site',
  under_maintenance: 'Under maintenance',
  off_hire: 'Off hire',
};

export const EQUIPMENT_DOCUMENT_KINDS = [
  'insurance',
  'fitness',
  'registration',
  'operator_licence',
  'pollution',
  'other',
] as const;
export type EquipmentDocumentKind = (typeof EQUIPMENT_DOCUMENT_KINDS)[number];

export const EQUIPMENT_DOCUMENT_LABELS: Record<EquipmentDocumentKind, string> = {
  insurance: 'Insurance',
  fitness: 'Fitness certificate',
  registration: 'Registration',
  operator_licence: 'Operator licence',
  pollution: 'Pollution certificate',
  other: 'Other document',
};

/**
 * Where the diesel in a fuel entry came from, which decides whether this module counts its cost.
 *
 * - `direct`  — bought for the machine and recorded only here (a credit slip at the pump). Counted.
 * - `expense` — the bill is an expense row (petty cash, a scanned fuel bill, a supplier invoice).
 *               The expense carries the cost; this entry only records the litres.
 * - `stock`   — issued from the site's diesel in stock. The cost was booked when the diesel was
 *               bought; the issue writes a stock movement and records litres.
 * - `vendor`  — supplied by the hire vendor as part of the rate ("fuel included"). No cost to us.
 */
export const EQUIPMENT_FUEL_SOURCES = ['direct', 'expense', 'stock', 'vendor'] as const;
export type EquipmentFuelSource = (typeof EQUIPMENT_FUEL_SOURCES)[number];

export const EQUIPMENT_FUEL_SOURCE_LABELS: Record<EquipmentFuelSource, string> = {
  direct: 'Bought for the machine',
  expense: 'Recorded as an expense',
  stock: 'From site stock',
  vendor: 'Supplied by the vendor',
};

export const EQUIPMENT_MAINTENANCE_KINDS = ['preventive', 'breakdown'] as const;
export type EquipmentMaintenanceKind = (typeof EQUIPMENT_MAINTENANCE_KINDS)[number];

/** What a cost line is for. */
export const EQUIPMENT_COST_KINDS = [
  'hire',
  'mobilisation',
  'operator',
  'charge_out',
  'fuel',
  'maintenance',
] as const;
export type EquipmentCostKind = (typeof EQUIPMENT_COST_KINDS)[number];

export const EQUIPMENT_COST_KIND_LABELS: Record<EquipmentCostKind, string> = {
  hire: 'Hire',
  mobilisation: 'Mobilisation',
  operator: 'Operator',
  charge_out: 'Charge-out',
  fuel: 'Fuel',
  maintenance: 'Maintenance',
};

/** A day has 24 hours; a log claiming more is a typo or worse. */
export const EQUIPMENT_MAX_DAY_HOURS = 24;

/**
 * The working shift a machine is expected to be available for on a day it is on site, for
 * utilisation. A machine on site with nothing logged sat idle for a shift, which is the point of
 * measuring it — a hired JCB nobody used is still on the vendor's bill.
 */
export const EQUIPMENT_SHIFT_HOURS = 8;

/** Documents are flagged this many days before they lapse — the same lead as workers' papers. */
export const EQUIPMENT_DOCUMENT_WARNING_DAYS = 30;

/** "Due soon" ahead of a service, per kind of interval. */
export const EQUIPMENT_SERVICE_DUE_SOON = Object.freeze({ hoursTenths: 250, kmTenths: 5000, days: 7 });

/**
 * The fuel leakage check: a day whose litres per hour is more than this per cent above the machine's
 * own average, with at least `minSamples` other days to form the average from.
 */
export const EQUIPMENT_FUEL_OUTLIER = Object.freeze({ percent: 30, minSamples: 3, lookbackDays: 30 });

// --- units -----------------------------------------------------------------------------------------

const TENTHS = /^(\d{1,8})(?:\.(\d))?$/;
const HUNDREDTHS = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

/** `"7.5"` → 75. Throws on anything that is not a non-negative number with at most one decimal. */
export function equipmentToTenths(value: string): number {
  const match = TENTHS.exec(value.trim());
  if (!match) throw new RangeError(`not a reading with at most one decimal: ${value}`);
  return Number(match[1]) * 10 + Number(match[2] ?? '0');
}

/** 75 → `"7.5"`, 80 → `"8"`. */
export function equipmentFromTenths(tenths: number): string {
  const negative = tenths < 0;
  const abs = Math.abs(Math.round(tenths));
  const text = abs % 10 === 0 ? String(abs / 10) : `${Math.floor(abs / 10)}.${abs % 10}`;
  return negative ? `-${text}` : text;
}

/** `"120.25"` litres → 12025. */
export function equipmentLitresToHundredths(value: string): number {
  const match = HUNDREDTHS.exec(value.trim());
  if (!match) throw new RangeError(`not litres with at most two decimals: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
}

/** 12025 → `"120.25"`, 4000 → `"40"`. */
export function equipmentLitresFromHundredths(hundredths: number): string {
  const whole = Math.floor(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** `"A-0007"` style codes for machines registered without one: the category's initials and a number. */
export function equipmentSuggestCode(category: EquipmentCategory, next: number): string {
  const prefix: Record<EquipmentCategory, string> = {
    excavator: 'EX',
    backhoe: 'BH',
    crane: 'CR',
    concrete_mixer: 'MX',
    compactor: 'CP',
    generator: 'DG',
    pump: 'PU',
    scaffolding: 'SC',
    vehicle: 'VH',
    small_tools: 'TL',
    other: 'EQ',
  };
  return `${prefix[category]}-${String(next).padStart(3, '0')}`;
}

// --- a day's log -----------------------------------------------------------------------------------

export interface EquipmentLogInput {
  meterType: EquipmentMeterType;
  /** Tenths; required for a machine with a meter. */
  openingTenths: number | null;
  closingTenths: number | null;
  /** Tenths. For an hour meter this is worked out from the readings and anything typed is ignored. */
  workedTenths: number | null;
  idleTenths: number;
  breakdownTenths: number;
}

export type EquipmentLogResult =
  | { ok: true; workedTenths: number; idleTenths: number; breakdownTenths: number; distanceTenths: number | null }
  | { ok: false; errors: Record<string, string> };

/**
 * Checks one day's log and works out the hours.
 *
 * An hour meter *is* the hours worked: closing minus opening, nothing to type. A kilometre meter
 * measures distance, and the hours are entered. No meter, the hours are entered. In every case the
 * closing reading cannot be below the opening one, and worked + idle + breakdown fit in one day.
 */
export function equipmentCheckLog(input: EquipmentLogInput): EquipmentLogResult {
  const errors: Record<string, string> = {};
  const hasMeter = input.meterType !== 'none';
  let worked = input.workedTenths ?? 0;
  let distance: number | null = null;

  if (hasMeter) {
    if (input.openingTenths === null) errors['opening_meter'] = 'enter the opening reading';
    if (input.closingTenths === null) errors['closing_meter'] = 'enter the closing reading';
    if (input.openingTenths !== null && input.closingTenths !== null) {
      if (input.closingTenths < input.openingTenths) {
        errors['closing_meter'] = 'the closing reading is below the opening reading';
      } else if (input.meterType === 'hours') {
        worked = input.closingTenths - input.openingTenths;
      } else {
        distance = input.closingTenths - input.openingTenths;
      }
    }
  }
  if (input.meterType !== 'hours' && input.workedTenths === null) {
    errors['hours_worked'] = 'enter the hours worked';
  }

  const day = EQUIPMENT_MAX_DAY_HOURS * 10;
  if (worked > day) errors['hours_worked'] = `more than ${EQUIPMENT_MAX_DAY_HOURS} hours in one day`;
  if (!errors['hours_worked'] && worked + input.idleTenths + input.breakdownTenths > day) {
    errors['idle_hours'] = `worked, idle and breakdown hours add up to more than ${EQUIPMENT_MAX_DAY_HOURS}`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    workedTenths: worked,
    idleTenths: input.idleTenths,
    breakdownTenths: input.breakdownTenths,
    distanceTenths: distance,
  };
}

/**
 * Whether a new day's readings fit between the days logged either side of it. A meter only runs
 * forwards, so the opening reading cannot be below the previous day's closing and the closing cannot
 * be above the next day's opening — two logs that overlap are the same hours billed twice.
 */
export function equipmentMeterFits(
  reading: { openingTenths: number; closingTenths: number },
  previous: { closingTenths: number | null } | null,
  next: { openingTenths: number | null } | null,
): { ok: true } | { ok: false; field: 'opening_meter' | 'closing_meter'; message: string } {
  if (previous?.closingTenths != null && reading.openingTenths < previous.closingTenths) {
    return {
      ok: false,
      field: 'opening_meter',
      message: `the opening reading is below the previous log's closing ${equipmentFromTenths(previous.closingTenths)}`,
    };
  }
  if (next?.openingTenths != null && reading.closingTenths > next.openingTenths) {
    return {
      ok: false,
      field: 'closing_meter',
      message: `the closing reading is above the next log's opening ${equipmentFromTenths(next.openingTenths)}`,
    };
  }
  return { ok: true };
}

// --- charges ---------------------------------------------------------------------------------------

export interface EquipmentDayUse {
  workedTenths: number;
  idleTenths: number;
  breakdownTenths: number;
}

export interface EquipmentDayCharge {
  amount: bigint;
  /** Hours charged, in tenths: worked hours, topped up to the minimum where one applies. */
  chargeableTenths: number;
  /** How much of `chargeableTenths` is the minimum topping up the hours actually worked. */
  topUpTenths: number;
}

/**
 * One day of a machine hired by the hour or by the day.
 *
 * - **By the hour**, with a minimum: the vendor is paid for at least the minimum hours on a day the
 *   machine was on site — that is what a minimum is for, a JCB kept waiting all day — but not for
 *   the hours it was broken down, which are the vendor's problem. So the minimum is reduced by the
 *   breakdown hours, and the day is charged the larger of that and the hours worked.
 * - **By the day**: a day the machine was available (worked or stood idle) is a day's hire; a day it
 *   spent entirely broken down is not.
 */
export function equipmentDayCharge(
  terms: { basis: 'hour' | 'day'; rate: bigint; minHoursTenths: number | null },
  day: EquipmentDayUse,
): EquipmentDayCharge {
  if (terms.basis === 'day') {
    const available = day.workedTenths + day.idleTenths > 0;
    return { amount: available ? terms.rate : 0n, chargeableTenths: day.workedTenths, topUpTenths: 0 };
  }
  const minimum = Math.max(0, (terms.minHoursTenths ?? 0) - day.breakdownTenths);
  const chargeable = Math.max(day.workedTenths, minimum);
  return {
    amount: roundedDivide(terms.rate * BigInt(chargeable), 10n),
    chargeableTenths: chargeable,
    topUpTenths: chargeable - day.workedTenths,
  };
}

export interface EquipmentMonthCharge {
  /** The monthly rate for the days on hire: `rate × days / days in the month`. */
  base: bigint;
  /** Hours the base covers, in tenths, prorated the same way. Null when the terms set no hours. */
  includedTenths: number | null;
  /** Hours worked beyond those, in tenths. */
  extraTenths: number;
  /** Extra hours at the monthly rate's own hourly rate (`rate / minimum hours`). */
  extra: bigint;
  total: bigint;
}

/**
 * A machine hired by the month — "₹1,80,000 a month for 200 hours, extra hours pro rata", the usual
 * way a crane or an excavator is let.
 *
 * Part of a month on site pays that part of the rate, and gets that part of the hours. Hours beyond
 * the included ones are charged at the rate divided by the monthly hours. Without a monthly hours
 * figure the rate is flat, whatever the hours.
 */
export function equipmentMonthCharge(input: {
  rate: bigint;
  minHoursTenths: number | null;
  onHireDays: number;
  daysInMonth: number;
  workedTenths: number;
}): EquipmentMonthCharge {
  const days = BigInt(Math.max(0, Math.min(input.onHireDays, input.daysInMonth)));
  const month = BigInt(input.daysInMonth);
  const base = roundedDivide(input.rate * days, month);
  if (!input.minHoursTenths || input.minHoursTenths <= 0) {
    return { base, includedTenths: null, extraTenths: 0, extra: 0n, total: base };
  }
  const included = Number(roundedDivide(BigInt(input.minHoursTenths) * days, month));
  const extraTenths = Math.max(0, input.workedTenths - included);
  const extra = roundedDivide(input.rate * BigInt(extraTenths), BigInt(input.minHoursTenths));
  return { base, includedTenths: included, extraTenths, extra, total: base + extra };
}

/**
 * What an owned machine charges the site it worked on for a day: its internal rate per hour worked,
 * or per day it worked at all. The rate is meant to recover owning the machine (depreciation,
 * finance, insurance) — fuel and repairs are booked as themselves, so they are not in it.
 */
export function equipmentChargeOut(
  terms: { basis: EquipmentChargeBasis; rate: bigint },
  day: EquipmentDayUse,
): bigint {
  if (terms.basis === 'day') return day.workedTenths > 0 ? terms.rate : 0n;
  return roundedDivide(terms.rate * BigInt(day.workedTenths), 10n);
}

// --- cost lines ------------------------------------------------------------------------------------

export interface EquipmentCostMachine {
  id: string;
  code: string;
  ownership: EquipmentOwnership;
  hireBasis: EquipmentHireBasis | null;
  hireRate: bigint;
  minHoursTenths: number | null;
  operatorIncluded: boolean;
  /** What the vendor charges per working day for the operator when one is not included. */
  operatorRatePerDay: bigint;
  mobilisation: bigint;
  chargeOutBasis: EquipmentChargeBasis | null;
  chargeOutRate: bigint;
}

export interface EquipmentCostAllocation {
  projectId: string;
  costCodeId: string | null;
  from: IsoDate;
  /** Null while it is still there. */
  to: IsoDate | null;
}

export interface EquipmentCostLog extends EquipmentDayUse {
  date: IsoDate;
  projectId: string;
  costCodeId: string | null;
}

export interface EquipmentCostFuel {
  id: string;
  date: IsoDate;
  projectId: string;
  costCodeId: string | null;
  amount: bigint;
  source: EquipmentFuelSource;
}

export interface EquipmentCostMaintenance {
  id: string;
  date: IsoDate;
  projectId: string | null;
  costCodeId: string | null;
  cost: bigint;
  /** The cost was recorded as an expense, which the cost report already counts. */
  expenseLinked: boolean;
}

export interface EquipmentCostLine {
  kind: EquipmentCostKind;
  projectId: string | null;
  costCodeId: string | null;
  /** The day the cost belongs to; a month's hire is dated on its last day on hire. */
  date: IsoDate;
  /** `YYYY-MM` the line belongs to — what a hire booking is matched on. */
  month: string;
  amount: bigint;
  /**
   * Whether this module puts the amount into the site's actual cost. False when another record
   * already carries it — an expense, a booked hire invoice, a stock issue — or when there is no
   * site to put it on.
   */
  counted: boolean;
  /** Why it is not counted, when it is not. */
  via: 'expense' | 'stock' | 'vendor' | 'booked' | 'no_site' | null;
  /** Hours worked behind the line, in tenths, where it has hours. */
  workedTenths?: number;
  /** Hours charged, in tenths, including any minimum top-up. */
  chargeableTenths?: number;
  topUpTenths?: number;
  /** For a monthly hire: the days on hire and the hours the rate covered. */
  onHireDays?: number;
  includedTenths?: number | null;
  extraTenths?: number;
  /** The fuel or maintenance record behind it. */
  sourceId?: string;
}

export interface EquipmentCostInput {
  machine: EquipmentCostMachine;
  allocations: readonly EquipmentCostAllocation[];
  logs: readonly EquipmentCostLog[];
  fuel: readonly EquipmentCostFuel[];
  maintenance: readonly EquipmentCostMaintenance[];
  /**
   * `projectId:YYYY-MM` for every hire month booked as an expense (a checked vendor invoice) whose
   * expense still counts. Hire, operator and mobilisation for that site and month are then the
   * expense's, not ours.
   */
  booked: ReadonlySet<string>;
  /** Inclusive. `from` null is "since the beginning". */
  window: { from: IsoDate | null; to: IsoDate };
}

export function equipmentMonthOf(date: IsoDate): string {
  return date.slice(0, 7);
}

function daysInMonth(month: string): number {
  const [year, mm] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, mm!, 0)).getUTCDate();
}

function monthStart(month: string): IsoDate {
  return `${month}-01`;
}

function monthEnd(month: string): IsoDate {
  return `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
}

function nextMonth(month: string): string {
  return equipmentMonthOf(addDays(monthEnd(month), 1));
}

/**
 * Every cost a machine ran up in a window, line by line, and whether this module counts each one —
 * the single place the **no double counting** rule lives:
 *
 * 1. Hire (and an operator the vendor charges for, and mobilisation) is worked out from the daily
 *    logs and the hire terms. When the vendor's invoice for a site and month has been checked and
 *    booked as an expense, that month's hire on that site is the expense's — not counted here.
 * 2. An owned machine charges its internal rate for the hours it worked. Nothing else records that.
 * 3. Fuel is counted only when it was bought for the machine and recorded nowhere else (`direct`).
 *    Fuel on an expense is the expense's; fuel from stock was paid for when the diesel was bought;
 *    fuel the vendor supplies costs nothing.
 * 4. Maintenance is counted when it happened on a site and was not recorded as an expense.
 *    Servicing in the yard, with no site, is the machine's cost but nobody's site cost.
 *
 * An operator who is one of our own workers is paid through the roll call; they are never priced
 * here.
 */
export function equipmentCostLines(input: EquipmentCostInput): EquipmentCostLine[] {
  const { machine, window } = input;
  const inWindow = (date: IsoDate) => date <= window.to && (window.from === null || date >= window.from);
  const lines: EquipmentCostLine[] = [];
  const hired = machine.ownership === 'hired';
  const bookedVia = (projectId: string, month: string) =>
    input.booked.has(`${projectId}:${month}`) ? ('booked' as const) : null;

  const logs = input.logs.filter((log) => inWindow(log.date));

  for (const log of logs) {
    const month = equipmentMonthOf(log.date);
    if (hired && (machine.hireBasis === 'hour' || machine.hireBasis === 'day')) {
      const charge = equipmentDayCharge(
        { basis: machine.hireBasis, rate: machine.hireRate, minHoursTenths: machine.minHoursTenths },
        log,
      );
      const via = bookedVia(log.projectId, month);
      if (charge.amount !== 0n) {
        lines.push({
          kind: 'hire',
          projectId: log.projectId,
          costCodeId: log.costCodeId,
          date: log.date,
          month,
          amount: charge.amount,
          counted: via === null,
          via,
          workedTenths: log.workedTenths,
          chargeableTenths: charge.chargeableTenths,
          topUpTenths: charge.topUpTenths,
        });
      }
    }
    if (hired && !machine.operatorIncluded && machine.operatorRatePerDay > 0n && log.workedTenths > 0) {
      const via = bookedVia(log.projectId, month);
      lines.push({
        kind: 'operator',
        projectId: log.projectId,
        costCodeId: log.costCodeId,
        date: log.date,
        month,
        amount: machine.operatorRatePerDay,
        counted: via === null,
        via,
      });
    }
    if (!hired && machine.chargeOutBasis && machine.chargeOutRate > 0n) {
      const amount = equipmentChargeOut({ basis: machine.chargeOutBasis, rate: machine.chargeOutRate }, log);
      if (amount !== 0n) {
        lines.push({
          kind: 'charge_out',
          projectId: log.projectId,
          costCodeId: log.costCodeId,
          date: log.date,
          month,
          amount,
          counted: true,
          via: null,
          workedTenths: log.workedTenths,
        });
      }
    }
  }

  if (hired) {
    for (const allocation of input.allocations) {
      // Mobilisation: once each time the machine is brought to a site.
      if (machine.mobilisation > 0n && inWindow(allocation.from)) {
        const month = equipmentMonthOf(allocation.from);
        const via = bookedVia(allocation.projectId, month);
        lines.push({
          kind: 'mobilisation',
          projectId: allocation.projectId,
          costCodeId: allocation.costCodeId,
          date: allocation.from,
          month,
          amount: machine.mobilisation,
          counted: via === null,
          via,
        });
      }
      if (machine.hireBasis !== 'month') continue;

      // A monthly hire: each calendar month the allocation touches inside the window.
      const start = window.from && window.from > allocation.from ? window.from : allocation.from;
      const allocationEnd = allocation.to ?? window.to;
      const end = allocationEnd < window.to ? allocationEnd : window.to;
      if (end < start) continue;
      for (let month = equipmentMonthOf(start); month <= equipmentMonthOf(end); month = nextMonth(month)) {
        const from = start > monthStart(month) ? start : monthStart(month);
        const to = end < monthEnd(month) ? end : monthEnd(month);
        const worked = logs
          .filter((log) => log.projectId === allocation.projectId && log.date >= from && log.date <= to)
          .reduce((sum, log) => sum + log.workedTenths, 0);
        const onHireDays = daysBetweenInclusive(from, to);
        const charge = equipmentMonthCharge({
          rate: machine.hireRate,
          minHoursTenths: machine.minHoursTenths,
          onHireDays,
          daysInMonth: daysInMonth(month),
          workedTenths: worked,
        });
        if (charge.total === 0n) continue;
        const via = bookedVia(allocation.projectId, month);
        lines.push({
          kind: 'hire',
          projectId: allocation.projectId,
          costCodeId: allocation.costCodeId,
          date: to,
          month,
          amount: charge.total,
          counted: via === null,
          via,
          workedTenths: worked,
          chargeableTenths: worked,
          onHireDays,
          includedTenths: charge.includedTenths,
          extraTenths: charge.extraTenths,
        });
      }
    }
  }

  for (const entry of input.fuel) {
    if (!inWindow(entry.date) || entry.amount === 0n) continue;
    const via = entry.source === 'direct' ? null : entry.source;
    lines.push({
      kind: 'fuel',
      projectId: entry.projectId,
      costCodeId: entry.costCodeId,
      date: entry.date,
      month: equipmentMonthOf(entry.date),
      amount: entry.amount,
      counted: via === null,
      via,
      sourceId: entry.id,
    });
  }

  for (const record of input.maintenance) {
    if (!inWindow(record.date) || record.cost === 0n) continue;
    const via = record.expenseLinked ? ('expense' as const) : record.projectId === null ? ('no_site' as const) : null;
    lines.push({
      kind: 'maintenance',
      projectId: record.projectId,
      costCodeId: record.costCodeId,
      date: record.date,
      month: equipmentMonthOf(record.date),
      amount: record.cost,
      counted: via === null,
      via,
      sourceId: record.id,
    });
  }

  return lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Adds up cost lines: everything, and the part this module counts as site cost. */
export function equipmentSumLines(lines: readonly EquipmentCostLine[]): {
  total: bigint;
  counted: bigint;
  byKind: Record<EquipmentCostKind, bigint>;
} {
  const byKind = Object.fromEntries(EQUIPMENT_COST_KINDS.map((kind) => [kind, 0n])) as Record<
    EquipmentCostKind,
    bigint
  >;
  let total = 0n;
  let counted = 0n;
  for (const line of lines) {
    total += line.amount;
    if (line.counted) counted += line.amount;
    byKind[line.kind] += line.amount;
  }
  return { total, counted, byKind };
}

// --- fuel ------------------------------------------------------------------------------------------

/** Litres per hour worked, to two decimals; null with no hours to divide by. */
export function equipmentFuelRate(litresHundredths: number, workedTenths: number): number | null {
  if (workedTenths <= 0) return null;
  // (L×100) / (h×10) = L/h × 10, so divide by ten.
  return Math.round((litresHundredths / workedTenths) * 10) / 100;
}

export interface EquipmentFuelDay {
  equipmentId: string;
  projectId: string;
  date: IsoDate;
  litresHundredths: number;
  workedTenths: number;
}

export interface EquipmentFuelOutlier extends EquipmentFuelDay {
  rate: number;
  average: number;
  /** How far above the average, in whole per cent. */
  abovePercent: number;
}

/**
 * Days a machine drew much more fuel per hour than it usually does — the simplest leakage check
 * there is, and the one every plant manager does by eye: a JCB that burns 6 L/h does not burn 11 on a
 * Tuesday unless the diesel went somewhere else.
 *
 * Each day is judged against the machine's average over the *other* days (so one bad day cannot
 * hide by raising its own baseline), and only when there are enough of them to call it a habit. A
 * day with fuel but no hours cannot be judged by rate and is left out.
 */
export function equipmentFuelOutliers(
  days: readonly EquipmentFuelDay[],
  options: { percent: number; minSamples: number } = EQUIPMENT_FUEL_OUTLIER,
): EquipmentFuelOutlier[] {
  const byMachine = new Map<string, EquipmentFuelDay[]>();
  for (const day of days) {
    if (day.workedTenths <= 0 || day.litresHundredths <= 0) continue;
    byMachine.set(day.equipmentId, [...(byMachine.get(day.equipmentId) ?? []), day]);
  }
  const outliers: EquipmentFuelOutlier[] = [];
  for (const machineDays of byMachine.values()) {
    if (machineDays.length < options.minSamples + 1) continue;
    const litres = machineDays.reduce((sum, day) => sum + day.litresHundredths, 0);
    const hours = machineDays.reduce((sum, day) => sum + day.workedTenths, 0);
    for (const day of machineDays) {
      const otherHours = hours - day.workedTenths;
      if (otherHours <= 0) continue;
      const average = (litres - day.litresHundredths) / otherHours;
      const rate = day.litresHundredths / day.workedTenths;
      if (average <= 0 || rate <= average * (1 + options.percent / 100)) continue;
      outliers.push({
        ...day,
        rate: Math.round(rate * 10) / 100,
        average: Math.round(average * 10) / 100,
        abovePercent: Math.round((rate / average - 1) * 100),
      });
    }
  }
  return outliers.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// --- servicing -------------------------------------------------------------------------------------

export type EquipmentServiceState = 'ok' | 'due_soon' | 'due' | 'overdue';

export interface EquipmentServiceDue {
  state: EquipmentServiceState;
  /** The reading the next service is due at, in tenths; null with no meter interval. */
  nextMeterTenths: number | null;
  /** Remaining to the next service by the meter, in tenths (negative once past). */
  remainingTenths: number | null;
  nextOn: IsoDate | null;
  /** Days to the next service by the calendar (negative once past). */
  remainingDays: number | null;
}

/**
 * When a machine's next service falls due, by whichever of its intervals comes first — every 250
 * hours, every 5,000 km, every 90 days — counted from the last time it was done (or from when the
 * plan was set up, if it never has been).
 *
 * `due` is reached today or at this reading; `overdue` is past it; `due_soon` is inside the warning
 * margin (EQUIPMENT_SERVICE_DUE_SOON).
 */
export function equipmentServiceDue(input: {
  meterType: EquipmentMeterType;
  intervalTenths: number | null;
  intervalDays: number | null;
  lastMeterTenths: number | null;
  lastOn: IsoDate | null;
  currentMeterTenths: number | null;
  today: IsoDate;
}): EquipmentServiceDue {
  let nextMeter: number | null = null;
  let remaining: number | null = null;
  if (input.meterType !== 'none' && input.intervalTenths && input.intervalTenths > 0) {
    nextMeter = (input.lastMeterTenths ?? 0) + input.intervalTenths;
    remaining = nextMeter - (input.currentMeterTenths ?? input.lastMeterTenths ?? 0);
  }
  let nextOn: IsoDate | null = null;
  let remainingDays: number | null = null;
  if (input.intervalDays && input.intervalDays > 0 && input.lastOn) {
    nextOn = addDays(input.lastOn, input.intervalDays);
    remainingDays = daysBetweenInclusive(input.today, nextOn) - 1;
  }

  const soon = input.meterType === 'km' ? EQUIPMENT_SERVICE_DUE_SOON.kmTenths : EQUIPMENT_SERVICE_DUE_SOON.hoursTenths;
  let state: EquipmentServiceState = 'ok';
  const rank: Record<EquipmentServiceState, number> = { ok: 0, due_soon: 1, due: 2, overdue: 3 };
  const raise = (to: EquipmentServiceState) => {
    if (rank[to] > rank[state]) state = to;
  };
  if (remaining !== null) raise(remaining < 0 ? 'overdue' : remaining === 0 ? 'due' : remaining <= soon ? 'due_soon' : 'ok');
  if (remainingDays !== null) {
    raise(
      remainingDays < 0
        ? 'overdue'
        : remainingDays === 0
          ? 'due'
          : remainingDays <= EQUIPMENT_SERVICE_DUE_SOON.days
            ? 'due_soon'
            : 'ok',
    );
  }
  return { state, nextMeterTenths: nextMeter, remainingTenths: remaining, nextOn, remainingDays };
}

/** Whether a service in this state is one to remind somebody about. */
export function equipmentServiceNeedsAttention(state: EquipmentServiceState): boolean {
  return state === 'due' || state === 'overdue';
}

// --- documents -------------------------------------------------------------------------------------

export type EquipmentDocumentStanding = 'valid' | 'expiring' | 'expired' | 'no_expiry';

export function equipmentDocumentStanding(expiresOn: IsoDate | null, today: IsoDate): EquipmentDocumentStanding {
  if (!expiresOn) return 'no_expiry';
  if (expiresOn < today) return 'expired';
  if (expiresOn <= addDays(today, EQUIPMENT_DOCUMENT_WARNING_DAYS)) return 'expiring';
  return 'valid';
}

// --- utilisation -----------------------------------------------------------------------------------

export interface EquipmentUtilisation {
  /** Days the machine was on a site in the window. */
  daysOnSite: number;
  workedTenths: number;
  idleTenths: number;
  breakdownTenths: number;
  /** Hours it could have worked, in tenths. */
  availableTenths: number;
  /** Worked ÷ available, in whole per cent; null with nothing available. */
  utilisationPercent: number | null;
  /** Breakdown ÷ (available + breakdown), in whole per cent. */
  breakdownPercent: number | null;
}

/**
 * How much of the time a machine was on site it actually worked.
 *
 * Every day on site offers a shift (EQUIPMENT_SHIFT_HOURS), or the hours logged if more were, less
 * the hours it was broken down. A day on site with no log at all counts as a whole shift idle — the
 * machine was there and nobody used it, which is exactly what a hired machine's utilisation is for.
 */
export function equipmentUtilisation(
  daysOnSite: readonly IsoDate[],
  logs: ReadonlyArray<EquipmentDayUse & { date: IsoDate }>,
  shiftHours = EQUIPMENT_SHIFT_HOURS,
): EquipmentUtilisation {
  const shift = shiftHours * 10;
  const byDay = new Map<IsoDate, EquipmentDayUse>();
  for (const log of logs) {
    const current = byDay.get(log.date) ?? { workedTenths: 0, idleTenths: 0, breakdownTenths: 0 };
    byDay.set(log.date, {
      workedTenths: current.workedTenths + log.workedTenths,
      idleTenths: current.idleTenths + log.idleTenths,
      breakdownTenths: current.breakdownTenths + log.breakdownTenths,
    });
  }
  const days = new Set<IsoDate>([...daysOnSite, ...byDay.keys()]);
  let worked = 0;
  let idle = 0;
  let breakdown = 0;
  let available = 0;
  for (const date of days) {
    const day = byDay.get(date);
    if (!day) {
      idle += shift;
      available += shift;
      continue;
    }
    worked += day.workedTenths;
    breakdown += day.breakdownTenths;
    const offered = Math.max(0, Math.max(shift, day.workedTenths + day.idleTenths + day.breakdownTenths) - day.breakdownTenths);
    available += offered;
    idle += Math.max(0, offered - day.workedTenths);
  }
  return {
    daysOnSite: days.size,
    workedTenths: worked,
    idleTenths: idle,
    breakdownTenths: breakdown,
    availableTenths: available,
    utilisationPercent: available > 0 ? Math.round((Math.min(worked, available) / available) * 100) : null,
    breakdownPercent: available + breakdown > 0 ? Math.round((breakdown / (available + breakdown)) * 100) : null,
  };
}

/** Every day an allocation covers inside a window, for utilisation. */
export function equipmentDaysOnSite(
  allocations: ReadonlyArray<{ from: IsoDate; to: IsoDate | null }>,
  window: { from: IsoDate; to: IsoDate },
): IsoDate[] {
  const days = new Set<IsoDate>();
  for (const allocation of allocations) {
    const from = allocation.from > window.from ? allocation.from : window.from;
    const end = allocation.to ?? window.to;
    const to = end < window.to ? end : window.to;
    for (let day = from; day <= to; day = addDays(day, 1)) days.add(day);
  }
  return [...days].sort();
}
