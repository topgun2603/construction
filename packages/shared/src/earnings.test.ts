import { describe, expect, it } from 'vitest';
import {
  attendanceEarning,
  netPayable,
  outstandingBalance,
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
  });

  it('returns zeroes for an empty period', () => {
    expect(wageLineTotals([])).toEqual({
      daysPresent: '0.0',
      overtimeHours: '0.0',
      grossAmount: 0n,
    });
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
