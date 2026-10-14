import { describe, expect, it } from 'vitest';
import {
  COMPANY_GROUP_MONEY_KEYS,
  companyGroupRateOn,
  consolidateCompanyGroup,
  convertCompanyGroupMinor,
  isCompanyGroupPermission,
  parseCompanyGroupRate,
  type CompanyGroupRate,
} from './company-groups';

describe('parseCompanyGroupRate', () => {
  it('reads a positive decimal at ten places', () => {
    expect(parseCompanyGroupRate('1')).toBe(10_000_000_000n);
    expect(parseCompanyGroupRate('0.0441')).toBe(441_000_000n);
    expect(parseCompanyGroupRate(' 22.65 ')).toBe(226_500_000_000n);
  });

  it('refuses zero, negatives, exponents and too many places', () => {
    expect(parseCompanyGroupRate('0')).toBeNull();
    expect(parseCompanyGroupRate('0.0000000000')).toBeNull();
    expect(parseCompanyGroupRate('-1')).toBeNull();
    expect(parseCompanyGroupRate('1e-3')).toBeNull();
    expect(parseCompanyGroupRate('0.12345678901')).toBeNull();
    expect(parseCompanyGroupRate('abc')).toBeNull();
  });
});

describe('convertCompanyGroupMinor', () => {
  it('leaves an amount alone in its own currency', () => {
    expect(convertCompanyGroupMinor(12_345n, 'AED', 'AED', '3')).toBe(12_345n);
  });

  it('converts paise to fils at the rate given', () => {
    // ₹1,00,000.00 at 0.0441 AED per rupee = AED 4,410.00.
    expect(convertCompanyGroupMinor(10_000_000n, 'INR', 'AED', '0.0441')).toBe(441_000n);
  });

  it('applies the difference in minor units between currencies', () => {
    // KWD has three decimals: 1.000 KWD (1000 fils) at 11.95 AED = AED 11.95 (1195 fils).
    expect(convertCompanyGroupMinor(1_000n, 'KWD', 'AED', '11.95')).toBe(1_195n);
    // JPY has none: ¥1,000 at 0.0245 AED = AED 24.50.
    expect(convertCompanyGroupMinor(1_000n, 'JPY', 'AED', '0.0245')).toBe(2_450n);
    // And back into a currency with none: AED 10.00 at 40.8 JPY = ¥408.
    expect(convertCompanyGroupMinor(1_000n, 'AED', 'JPY', '40.8')).toBe(408n);
  });

  it('rounds half away from zero, for negatives too', () => {
    // 1 paise at 0.5 = half a fils.
    expect(convertCompanyGroupMinor(1n, 'INR', 'AED', '0.5')).toBe(1n);
    expect(convertCompanyGroupMinor(-1n, 'INR', 'AED', '0.5')).toBe(-1n);
    expect(convertCompanyGroupMinor(1n, 'INR', 'AED', '0.49')).toBe(0n);
  });

  it('refuses a rate it cannot use rather than guessing', () => {
    expect(() => convertCompanyGroupMinor(100n, 'INR', 'AED', '0')).toThrow(RangeError);
  });
});

describe('companyGroupRateOn', () => {
  const rates: CompanyGroupRate[] = [
    { currency: 'INR', rate: '0.0440', effective_from: '2026-09-01' },
    { currency: 'INR', rate: '0.0441', effective_from: '2026-10-01' },
    { currency: 'SAR', rate: '0.98', effective_from: '2026-11-01' },
  ];

  it('picks the latest rate on or before the date', () => {
    expect(companyGroupRateOn(rates, 'INR', 'AED', '2026-09-30')?.rate).toBe('0.0440');
    expect(companyGroupRateOn(rates, 'INR', 'AED', '2026-10-01')?.rate).toBe('0.0441');
    expect(companyGroupRateOn(rates, 'INR', 'AED', '2027-01-01')?.effective_from).toBe('2026-10-01');
  });

  it('has nothing before the first rate, and needs nothing for the base currency', () => {
    expect(companyGroupRateOn(rates, 'SAR', 'AED', '2026-10-15')).toBeNull();
    expect(companyGroupRateOn(rates, 'AED', 'AED', '2020-01-01')).toEqual({
      currency: 'AED',
      rate: '1',
      effective_from: null,
    });
  });
});

describe('consolidateCompanyGroup', () => {
  const money = (amount: bigint) =>
    Object.fromEntries(COMPANY_GROUP_MONEY_KEYS.map((key) => [key, amount])) as Record<
      (typeof COMPANY_GROUP_MONEY_KEYS)[number],
      bigint
    >;

  it('converts each company and adds them, naming the rates used', () => {
    const result = consolidateCompanyGroup({
      baseCurrency: 'AED',
      asOf: '2026-10-06',
      rates: [{ currency: 'INR', rate: '0.0441', effective_from: '2026-10-01' }],
      keys: COMPANY_GROUP_MONEY_KEYS,
      companies: [
        { currency: 'AED', money: money(100_000n) },
        { currency: 'INR', money: money(10_000_000n) },
      ],
    });
    expect(result.totals.expenses).toBe(100_000n + 441_000n);
    expect(result.complete).toBe(true);
    expect(result.rates_used).toEqual([
      { currency: 'AED', rate: '1', effective_from: null },
      { currency: 'INR', rate: '0.0441', effective_from: '2026-10-01' },
    ]);
  });

  it('leaves out — and names — a company whose currency has no rate, never converting at 1', () => {
    const result = consolidateCompanyGroup({
      baseCurrency: 'AED',
      asOf: '2026-10-06',
      rates: [],
      keys: COMPANY_GROUP_MONEY_KEYS,
      companies: [
        { currency: 'AED', money: money(500n) },
        { currency: 'INR', money: money(10_000_000n) },
        { currency: 'INR', money: money(1n) },
      ],
    });
    expect(result.totals.budget).toBe(500n);
    expect(result.missing_currencies).toEqual(['INR']);
    expect(result.complete).toBe(false);
  });
});

describe('isCompanyGroupPermission', () => {
  it('knows the group grants and nothing else', () => {
    expect(isCompanyGroupPermission('group.manage')).toBe(true);
    expect(isCompanyGroupPermission('group.view_reports')).toBe(true);
    expect(isCompanyGroupPermission('projects.manage')).toBe(false);
  });
});
