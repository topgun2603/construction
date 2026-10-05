import { describe, expect, it } from 'vitest';
import {
  basisPointsOf,
  basisPointsToPercent,
  computeRaBill,
  lineAmount,
  percentOfQuantity,
  percentToBasisPoints,
  raQuantityProblems,
  retentionTranches,
  roundedDivide,
  subcontractStatement,
  subcontractStatementCsv,
  type RaBillInput,
} from './subcontracts';

const q = (units: number) => BigInt(Math.round(units * 1000));

describe('rounding helpers', () => {
  it('rounds half away from zero', () => {
    expect(roundedDivide(5n, 2n)).toBe(3n);
    expect(roundedDivide(4n, 3n)).toBe(1n);
    expect(roundedDivide(-5n, 2n)).toBe(-3n);
    expect(() => roundedDivide(1n, 0n)).toThrow();
  });

  it('prices a quantity in thousandths at a rate', () => {
    expect(lineAmount(q(2.5), 400_000n)).toBe(1_000_000n);
    // 0.333 × 10.01 = 3.33333 → 3.33
    expect(lineAmount(333n, 1001n)).toBe(333n);
    // 0.5 × 0.01 = 0.005 → rounds up to 0.01
    expect(lineAmount(500n, 1n)).toBe(1n);
  });

  it('takes basis points of an amount', () => {
    expect(basisPointsOf(100_000n, 500)).toBe(5_000n);
    expect(basisPointsOf(333n, 500)).toBe(17n); // 16.65 → 17
    expect(basisPointsOf(0n, 1000)).toBe(0n);
  });

  it('reads and writes percentages', () => {
    expect(percentToBasisPoints('5')).toBe(500);
    expect(percentToBasisPoints('12.5')).toBe(1250);
    expect(percentToBasisPoints('0.25')).toBe(25);
    expect(percentToBasisPoints('100')).toBe(10_000);
    expect(percentToBasisPoints('101')).toBeNull();
    expect(percentToBasisPoints('1.234')).toBeNull();
    expect(percentToBasisPoints('abc')).toBeNull();
    expect(basisPointsToPercent(1250)).toBe('12.5');
    expect(basisPointsToPercent(500)).toBe('5');
    expect(basisPointsToPercent(25)).toBe('0.25');
    expect(percentOfQuantity(q(200), 2500)).toBe(q(50));
  });
});

describe('computeRaBill', () => {
  // Plaster 1000 m² at 250.00 and tiling 400 m² at 900.00: a 6,10,000.00 contract.
  const base: RaBillInput = {
    lines: [
      { id: 'plaster', rate: 25_000n, contractQuantity: q(1000), previousQuantity: 0n, quantityToDate: q(400) },
      { id: 'tiles', rate: 90_000n, contractQuantity: q(400), previousQuantity: 0n, quantityToDate: q(100) },
    ],
    previous: { retentionToDate: 0n, advanceRecoveredToDate: 0n },
    retentionBp: 500,
    advanceRecoveryBp: 1000,
    advancePaid: 5_000_000n,
    taxRateBp: 1800,
    deductions: 150_000n,
  };

  it('works out the first bill', () => {
    const bill = computeRaBill(base);
    // 400 × 250 + 100 × 900 = 1,90,000.00
    expect(bill.grossToDate).toBe(19_000_000n);
    expect(bill.previousGross).toBe(0n);
    expect(bill.gross).toBe(19_000_000n);
    expect(bill.retention).toBe(950_000n); // 5%
    expect(bill.advanceRecovery).toBe(1_900_000n); // 10%
    expect(bill.tax).toBe(3_420_000n); // 18% of the gross, retention or not
    expect(bill.netPayable).toBe(19_000_000n + 3_420_000n - 950_000n - 1_900_000n - 150_000n);
    expect(bill.lines).toEqual([
      { id: 'plaster', previousValue: 0n, valueToDate: 10_000_000n, thisBill: 10_000_000n },
      { id: 'tiles', previousValue: 0n, valueToDate: 9_000_000n, thisBill: 9_000_000n },
    ]);
  });

  it('pays only the increment on the second bill, on cumulative retention', () => {
    const first = computeRaBill(base);
    const second = computeRaBill({
      ...base,
      lines: [
        { ...base.lines[0]!, previousQuantity: q(400), quantityToDate: q(700) },
        { ...base.lines[1]!, previousQuantity: q(100), quantityToDate: q(100) },
      ],
      previous: {
        retentionToDate: first.retentionToDate,
        advanceRecoveredToDate: first.advanceRecoveredToDate,
      },
      deductions: 0n,
    });
    expect(second.grossToDate).toBe(26_500_000n);
    expect(second.previousGross).toBe(19_000_000n);
    expect(second.gross).toBe(7_500_000n);
    expect(second.retention).toBe(375_000n);
    expect(second.retentionToDate).toBe(1_325_000n);
    expect(second.advanceRecovery).toBe(750_000n);
    expect(second.tax).toBe(1_350_000n);
    expect(second.lines[1]!.thisBill).toBe(0n);
  });

  it('keeps cumulative retention exact where per-bill rounding would drift', () => {
    // Three bills of 0.333 units at 1.00: per-bill 5% of 0.33 each rounds to 0.02, thrice = 0.06,
    // but 5% of 1.00 (rounded once, cumulatively) is 0.05.
    const line = { id: 'x', rate: 100n, contractQuantity: q(1) };
    let previous = { retentionToDate: 0n, advanceRecoveredToDate: 0n };
    let previousQuantity = 0n;
    let held = 0n;
    for (const quantityToDate of [333n, 666n, 1000n]) {
      const bill = computeRaBill({
        ...base,
        lines: [{ ...line, previousQuantity, quantityToDate }],
        previous,
        deductions: 0n,
      });
      held += bill.retention;
      previous = { retentionToDate: bill.retentionToDate, advanceRecoveredToDate: bill.advanceRecoveredToDate };
      previousQuantity = quantityToDate;
    }
    expect(held).toBe(5n);
  });

  it('never recovers more advance than was paid, nor gives any back', () => {
    const capped = computeRaBill({ ...base, advancePaid: 1_000_000n });
    expect(capped.advanceRecovery).toBe(1_000_000n);

    const next = computeRaBill({
      ...base,
      advancePaid: 1_000_000n,
      lines: base.lines.map((line) => ({ ...line, previousQuantity: line.quantityToDate })),
      previous: { retentionToDate: capped.retentionToDate, advanceRecoveredToDate: 1_000_000n },
    });
    expect(next.advanceRecovery).toBe(0n);
    expect(next.gross).toBe(0n);
    expect(next.tax).toBe(0n);
  });

  it('charges VAT at 5% for a UAE company and nothing with no tax', () => {
    expect(computeRaBill({ ...base, taxRateBp: 500 }).tax).toBe(950_000n);
    expect(computeRaBill({ ...base, taxRateBp: 0 }).tax).toBe(0n);
  });

  it('can come out negative when back-charges exceed the bill', () => {
    const bill = computeRaBill({ ...base, deductions: 100_000_000n });
    expect(bill.netPayable < 0n).toBe(true);
  });
});

describe('raQuantityProblems', () => {
  it('flags quantities below the last bill, above the contract and above the claim', () => {
    const problems = raQuantityProblems([
      { id: 'a', rate: 1n, contractQuantity: q(10), previousQuantity: q(5), quantityToDate: q(4) },
      { id: 'b', rate: 1n, contractQuantity: q(10), previousQuantity: 0n, quantityToDate: q(11) },
      {
        id: 'c',
        rate: 1n,
        contractQuantity: q(10),
        previousQuantity: 0n,
        quantityToDate: q(6),
        claimedQuantity: q(5),
      },
      { id: 'd', rate: 1n, contractQuantity: q(10), previousQuantity: 0n, quantityToDate: q(10) },
    ]);
    expect(problems).toEqual([
      { lineId: 'a', problem: 'below_previous' },
      { lineId: 'b', problem: 'above_contract' },
      { lineId: 'c', problem: 'above_claimed' },
    ]);
  });
});

describe('retention and the statement', () => {
  it('splits retention into the completion and defects tranches without losing a paisa', () => {
    expect(retentionTranches(1_325_001n, 5000)).toEqual({ atCompletion: 662_501n, afterDefects: 662_500n });
    expect(retentionTranches(1_000n, 10_000)).toEqual({ atCompletion: 1_000n, afterDefects: 0n });
  });

  it('adds up the account with the subcontractor', () => {
    const statement = subcontractStatement({
      originalValue: 61_000_000n,
      variationsValue: 4_000_000n,
      bills: [
        {
          gross: 19_000_000n,
          tax: 3_420_000n,
          retention: 950_000n,
          advanceRecovery: 1_900_000n,
          deductions: 150_000n,
          netPayable: 19_420_000n,
          paid: 19_420_000n,
        },
        {
          gross: 7_500_000n,
          tax: 1_350_000n,
          retention: 375_000n,
          advanceRecovery: 750_000n,
          deductions: 0n,
          netPayable: 7_725_000n,
          paid: 5_000_000n,
        },
      ],
      advancePaid: 5_000_000n,
      retentionReleased: 600_000n,
      retentionPaid: 100_000n,
    });
    expect(statement).toMatchObject({
      currentValue: 65_000_000n,
      certifiedGross: 26_500_000n,
      remainingValue: 38_500_000n,
      retentionHeld: 1_325_000n,
      retentionBalance: 725_000n,
      advanceRecovered: 2_650_000n,
      advanceOutstanding: 2_350_000n,
      netCertified: 27_145_000n,
      paidOnBills: 24_420_000n,
      totalPaid: 24_420_000n + 100_000n + 5_000_000n,
      balanceDue: 2_725_000n + 500_000n,
    });
  });

  it('writes the statement as CSV', () => {
    const zero = '0';
    const csv = subcontractStatementCsv(
      { number: 'SC-001', title: 'Plaster, "internal"', contractor: 'Ravi Builders' },
      {
        originalValue: '61000000',
        variationsValue: zero,
        currentValue: '61000000',
        certifiedGross: zero,
        remainingValue: '61000000',
        tax: zero,
        retentionHeld: zero,
        retentionReleased: zero,
        retentionBalance: zero,
        advancePaid: zero,
        advanceRecovered: zero,
        advanceOutstanding: zero,
        deductions: zero,
        netCertified: zero,
        paidOnBills: zero,
        retentionPaid: zero,
        totalPaid: zero,
        balanceDue: zero,
      },
      [
        {
          number: 1,
          period_to: '2026-10-31',
          status: 'certified',
          gross: '19000000',
          tax: '3420000',
          retention: '950000',
          advance_recovery: '1900000',
          deductions: '150000',
          net_payable: '19420000',
          paid: '0',
        },
      ],
      2,
    );
    const lines = csv.trim().split('\r\n');
    expect(lines[1]).toBe('Title,"Plaster, ""internal"""');
    expect(lines).toContain('Original contract value,610000.00');
    expect(lines.at(-1)).toBe('RA-1,2026-10-31,certified,190000.00,34200.00,9500.00,19000.00,1500.00,194200.00,0.00');
  });
});
