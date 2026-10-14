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
  /**
   * Gross split the way a salary file wants it: the fixed part (day wages, or salary and
   * allowances) and the variable part (overtime). They always add up to `grossAmount`.
   */
  fixedAmount: bigint;
  variableAmount: bigint;
  /** `numeric(4,1)` string: days marked absent, for the WPS "days on leave" field. */
  leaveDays: string;
}

/** Roll a worker's attendance rows for a period into one wage line. */
export function wageLineTotals(rows: readonly AttendanceEarningInput[]): WageLineTotals {
  let dayTenths = 0n;
  let otTenths = 0n;
  let gross = 0n;
  let overtime = 0n;
  let leaveTenths = 0n;

  for (const row of rows) {
    const earning = attendanceEarning(row);
    dayTenths += earning.dayTenths;
    otTenths += decimalToTenths(row.overtimeHours);
    gross += earning.totalPaise;
    overtime += earning.overtimePaise;
    leaveTenths += 10n - earning.dayTenths;
  }

  return {
    daysPresent: tenths(dayTenths),
    overtimeHours: tenths(otTenths),
    grossAmount: gross,
    fixedAmount: gross - overtime,
    variableAmount: overtime,
    leaveDays: tenths(leaveTenths),
  };
}

/** A monthly-salaried worker's pay: basic plus allowances (roadmap Phase 1, item 2). */
export interface MonthlyPay {
  basic: bigint;
  housing: bigint;
  transport: bigint;
  food: bigint;
}

/**
 * Days of salary one absent day costs: the 30-day month most Gulf payrolls use. A convention to
 * confirm with the company's accountant, kept in one place so changing it is one line.
 */
export const SALARY_DAYS_PER_MONTH = 30n;

/**
 * One monthly-salaried worker's line for a period.
 *
 * Fixed pay (basic + allowances) is due for the month whether or not the roll call recorded every
 * day — a Friday off is not a lost day's pay. What reduces it is a day the roll call marked
 * absent: one thirtieth of the fixed pay each, half that for a half day. A period shorter than its
 * month gets that share of the month. Overtime is paid on top from the hours the roll call
 * recorded, at the rate frozen on each row.
 */
export function monthlyWageLine(
  pay: MonthlyPay,
  period: { start: string; end: string },
  rows: readonly AttendanceEarningInput[],
): WageLineTotals {
  const fixed = pay.basic + pay.housing + pay.transport + pay.food;

  const start = new Date(`${period.start}T00:00:00Z`);
  const end = new Date(`${period.end}T00:00:00Z`);
  const periodDays = BigInt(Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const monthDays = BigInt(
    new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate(),
  );
  const due = periodDays >= monthDays ? fixed : (fixed * periodDays) / monthDays;

  let dayTenths = 0n;
  let otTenths = 0n;
  let leaveTenths = 0n;
  let overtime = 0n;
  for (const row of rows) {
    const worked = dayTenthsFor(row.status);
    dayTenths += worked;
    leaveTenths += 10n - worked;
    otTenths += decimalToTenths(row.overtimeHours);
    overtime += overtimeAmount(row.overtimeHours, row.overtimeRateSnapshot);
  }

  const deduction = (fixed * leaveTenths) / (SALARY_DAYS_PER_MONTH * 10n);
  const fixedAmount = deduction > due ? 0n : due - deduction;

  return {
    daysPresent: tenths(dayTenths),
    overtimeHours: tenths(otTenths),
    grossAmount: fixedAmount + overtime,
    fixedAmount,
    variableAmount: overtime,
    leaveDays: tenths(leaveTenths),
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
