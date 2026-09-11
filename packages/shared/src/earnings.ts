import type { AttendanceStatus } from './enums';
import { decimalToTenths, halfDayAmount, overtimeAmount } from './money';

/**
 * Labour earnings arithmetic (spec §8A). Pure and shared so the API, the nightly
 * rollup job and the Flutter app's offline preview cannot drift apart.
 *
 * Rates are the values frozen onto the attendance row, never the worker's current
 * wage — changing a wage must not alter what was already earned.
 */

export interface AttendanceEarningInput {
  status: AttendanceStatus;
  /** `numeric(4,1)` as a string, e.g. `"1.5"`. */
  overtimeHours: string;
  /** `attendance.wage_snapshot`, paise. */
  wageSnapshot: bigint;
  /** `attendance.overtime_rate_snapshot`, paise per hour. */
  overtimeRateSnapshot: bigint;
}

export interface AttendanceEarning {
  basePaise: bigint;
  overtimePaise: bigint;
  totalPaise: bigint;
  /** Attendance days this row contributes: 1, 0.5 or 0, as tenths. */
  dayTenths: bigint;
}

/** Days credited by a status, in tenths of a day. */
export function dayTenthsFor(status: AttendanceStatus): bigint {
  switch (status) {
    case 'present':
      return 10n;
    case 'half_day':
      return 5n;
    case 'absent':
      return 0n;
  }
}

export function attendanceEarning(input: AttendanceEarningInput): AttendanceEarning {
  const basePaise = baseAmountFor(input.status, input.wageSnapshot);
  // Overtime is paid on hours actually worked, so an absent day with recorded
  // overtime still pays the overtime — the roll call cannot produce that, but a
  // backdated edit can, and silently dropping it would lose money for the worker.
  const overtimePaise = overtimeAmount(input.overtimeHours, input.overtimeRateSnapshot);
  return {
    basePaise,
    overtimePaise,
    totalPaise: basePaise + overtimePaise,
    dayTenths: dayTenthsFor(input.status),
  };
}

function baseAmountFor(status: AttendanceStatus, wageSnapshot: bigint): bigint {
  switch (status) {
    case 'present':
      return wageSnapshot;
    case 'half_day':
      return halfDayAmount(wageSnapshot);
    case 'absent':
      return 0n;
  }
}

export interface WageLineTotals {
  /** `numeric(4,1)` string for `wage_lines.days_present`. */
  daysPresent: string;
  /** `numeric(4,1)` string for `wage_lines.overtime_hours`. */
  overtimeHours: string;
  grossAmount: bigint;
}

/** Roll a worker's attendance rows for a period into one wage line. */
export function wageLineTotals(rows: readonly AttendanceEarningInput[]): WageLineTotals {
  let dayTenths = 0n;
  let otTenths = 0n;
  let gross = 0n;

  for (const row of rows) {
    const earning = attendanceEarning(row);
    dayTenths += earning.dayTenths;
    otTenths += decimalToTenths(row.overtimeHours);
    gross += earning.totalPaise;
  }

  return {
    daysPresent: tenths(dayTenths),
    overtimeHours: tenths(otTenths),
    grossAmount: gross,
  };
}

function tenths(value: bigint): string {
  return `${value / 10n}.${value % 10n}`;
}

/**
 * Net payable for a wage line. Advances can exceed the gross in a thin week; the
 * shortfall carries forward rather than becoming a negative payment, so net is
 * floored at zero and the uncovered advance stays outstanding.
 */
export function netPayable(grossAmount: bigint, advancesAvailable: bigint): {
  advancesDeducted: bigint;
  netPayable: bigint;
} {
  const advancesDeducted = advancesAvailable > grossAmount ? grossAmount : advancesAvailable;
  return { advancesDeducted, netPayable: grossAmount - advancesDeducted };
}

export interface LedgerMovement {
  earnedPaise?: bigint;
  /** Wage and advance payments reduce the outstanding balance. */
  paidPaise?: bigint;
  /** Bonus increases what is owed; deduction reduces it. */
  bonusPaise?: bigint;
  deductionPaise?: bigint;
}

/** Worker or contractor outstanding balance (spec §8A "Balances"). */
export function outstandingBalance(movements: readonly LedgerMovement[]): bigint {
  let balance = 0n;
  for (const m of movements) {
    balance += m.earnedPaise ?? 0n;
    balance += m.bonusPaise ?? 0n;
    balance -= m.deductionPaise ?? 0n;
    balance -= m.paidPaise ?? 0n;
  }
  return balance;
}
