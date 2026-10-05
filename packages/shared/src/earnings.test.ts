import { describe, expect, it } from 'vitest';
import {
  attendanceEarning,
  netPayable,
  outstandingBalance,
  monthlyWageLine,
  wageLineTotals,
  type AttendanceEarningInput,
} from './earnings';

const WAGE = 65000n; // ₹650/day
const OT_RATE = 8000n; // ₹80/hour

function row(
  status: AttendanceEarningInput['status'],
  overtimeHours = '0',
): AttendanceEarningInput {
  return { status, overtimeHours, wageSnapshot: WAGE, overtimeRateSnapshot: OT_RATE };
}

describe('attendanceEarning', () => {
  it('pays full wage for present', () => {
    expect(attendanceEarning(row('present')).totalPaise).toBe(65000n);
  });

  it('pays half wage for half_day', () => {
    const earning = attendanceEarning(row('half_day'));
    expect(earning.basePaise).toBe(32500n);
    expect(earning.dayTenths).toBe(5n);
  });

  it('pays nothing for absent', () => {
    expect(attendanceEarning(row('absent')).totalPaise).toBe(0n);
  });

  it('adds overtime on top of the base wage', () => {
    expect(attendanceEarning(row('present', '2.5')).totalPaise).toBe(65000n + 20000n);
  });

  it('uses the frozen snapshot, not a later wage revision', () => {
    const earning = attendanceEarning({
      status: 'present',
      overtimeHours: '0',
      wageSnapshot: 60000n, // what the worker earned that day
      overtimeRateSnapshot: OT_RATE,
    });
    expect(earning.totalPaise).toBe(60000n);
  });
});

describe('wageLineTotals', () => {
  it('rolls a week of attendance into days, overtime and gross', () => {
    const totals = wageLineTotals([
      row('present'),
      row('present', '2'),
      row('half_day'),
      row('absent'),
      row('present', '1.5'),
      row('present'),
    ]);

    expect(totals.daysPresent).toBe('4.5');
    expect(totals.overtimeHours).toBe('3.5');
    // 4 full days + 1 half day = 4.5 × ₹650 = ₹2925; 3.5 h × ₹80 = ₹280
    expect(totals.grossAmount).toBe(292500n + 28000n);
    // Split for a salary file: day wages fixed, overtime variable; one absence and a half day.
    expect(totals.fixedAmount).toBe(292500n);
    expect(totals.variableAmount).toBe(28000n);
    expect(totals.leaveDays).toBe('1.5');
  });

  it('returns zeroes for an empty period', () => {
    expect(wageLineTotals([])).toEqual({
      daysPresent: '0.0',
      overtimeHours: '0.0',
      grossAmount: 0n,
      fixedAmount: 0n,
      variableAmount: 0n,
      leaveDays: '0.0',
    });
  });
});

describe('monthlyWageLine', () => {
  // AED 2,000 basic + 600 housing + 200 transport + 200 food = AED 3,000 a month, in fils.
  const pay = { basic: 200_000n, housing: 60_000n, transport: 20_000n, food: 20_000n };
  const october = { start: '2026-10-01', end: '2026-10-31' };

  it('pays the full month when nobody was marked absent, rest days included', () => {
    const line = monthlyWageLine(pay, october, [row('present'), row('present')]);
    expect(line.fixedAmount).toBe(300_000n);
    expect(line.grossAmount).toBe(300_000n);
    expect(line.leaveDays).toBe('0.0');
  });

  it('takes a thirtieth off for each absent day, half for a half day', () => {
    const line = monthlyWageLine(pay, october, [row('absent'), row('half_day'), row('present')]);
    // 1.5 days × 3,000 / 30 = 150 off.
    expect(line.fixedAmount).toBe(300_000n - 15_000n);
    expect(line.leaveDays).toBe('1.5');
  });

  it('pays overtime on top, at the rate frozen on each row', () => {
    const line = monthlyWageLine(pay, october, [row('present', '2')]);
    expect(line.variableAmount).toBe(16_000n);
    expect(line.grossAmount).toBe(300_000n + 16_000n);
  });

  it('pays a share of the month for a shorter period', () => {
    const line = monthlyWageLine(pay, { start: '2026-10-01', end: '2026-10-15' }, []);
    expect(line.fixedAmount).toBe((300_000n * 15n) / 31n);
  });
});

describe('netPayable', () => {
  it('deducts advances from gross', () => {
    expect(netPayable(292500n, 50000n)).toEqual({
      advancesDeducted: 50000n,
      netPayable: 242500n,
    });
  });

  it('never produces a negative payment when advances exceed the gross', () => {
    const result = netPayable(100000n, 150000n);
    expect(result.advancesDeducted).toBe(100000n);
    expect(result.netPayable).toBe(0n);
  });
});

describe('outstandingBalance', () => {
  it('nets earnings, payments, bonus and deduction', () => {
    expect(
      outstandingBalance([
        { earnedPaise: 292500n },
        { paidPaise: 200000n },
        { bonusPaise: 10000n },
        { deductionPaise: 2500n },
      ]),
    ).toBe(100000n);
  });
});
