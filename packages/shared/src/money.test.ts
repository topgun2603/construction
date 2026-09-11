import { describe, expect, it } from 'vitest';
import {
  decimalToTenths,
  formatInr,
  formatInrCompact,
  formatPaise,
  halfDayAmount,
  overtimeAmount,
  rupeesToPaise,
} from './money';

describe('formatPaise', () => {
  it('groups with Indian lakh/crore separators', () => {
    expect(formatPaise(123456789n)).toBe('12,34,567.89');
    expect(formatPaise(100000n)).toBe('1,000.00');
    expect(formatPaise(5n)).toBe('0.05');
  });

  it('keeps the sign outside the rupee symbol', () => {
    expect(formatInr(-125050n)).toBe('-₹1,250.50');
  });
});

describe('formatInrCompact', () => {
  it('uses crores and lakhs the way builders say them', () => {
    expect(formatInrCompact(rupeesToPaise(42_000_000))).toBe('₹4.2 Cr');
    expect(formatInrCompact(rupeesToPaise(9_420_000))).toBe('₹94.2 L');
    expect(formatInrCompact(rupeesToPaise(110_000_000))).toBe('₹11.0 Cr');
  });

  it('falls back to grouped rupees below a lakh', () => {
    expect(formatInrCompact(rupeesToPaise(45_000))).toBe('₹45,000');
    expect(formatInrCompact(0n)).toBe('₹0');
  });

  it('truncates rather than rounding up past a boundary', () => {
    // 99,99,999 must not read as ₹1.0 Cr — that would overstate the budget.
    expect(formatInrCompact(rupeesToPaise(9_999_999))).toBe('₹99.9 L');
  });

  it('keeps the sign outside the symbol', () => {
    expect(formatInrCompact(rupeesToPaise(-4_200_000))).toBe('-₹42.0 L');
  });
});

describe('rupeesToPaise', () => {
  it('rounds at the paise boundary', () => {
    expect(rupeesToPaise(650)).toBe(65000n);
    expect(rupeesToPaise(1234.565)).toBe(123457n);
  });
});

describe('halfDayAmount', () => {
  it('rounds an odd paise count down so two halves never exceed a full day', () => {
    expect(halfDayAmount(65001n)).toBe(32500n);
    expect(halfDayAmount(65001n) * 2n <= 65001n).toBe(true);
  });
});

describe('overtimeAmount', () => {
  it('pays tenth-of-an-hour precision without floats', () => {
    // 1.5 h at ₹80/h = ₹120
    expect(overtimeAmount('1.5', 8000n)).toBe(12000n);
    expect(overtimeAmount('0', 8000n)).toBe(0n);
    expect(overtimeAmount('2.3', 7500n)).toBe(17250n);
  });
});

describe('decimalToTenths', () => {
  it('rejects precision finer than one decimal place', () => {
    expect(decimalToTenths('7.5')).toBe(75n);
    expect(decimalToTenths('7')).toBe(70n);
    expect(() => decimalToTenths('7.55')).toThrow(RangeError);
  });
});
