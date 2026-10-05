import { describe, expect, it } from 'vitest';
import { todayIn, todayInIst } from './dates';
import {
  COUNTRY_PRESETS,
  currencyMinorDigits,
  INDIA_LOCALE,
  isValidLocale,
  isValidTimeZone,
  localesFor,
  presetFor,
  tenantLocaleSchema,
} from './locale';
import {
  decimalToMinor,
  formatInr,
  formatMoney,
  formatMoneyCompact,
  minorToDecimal,
} from './money';

const UAE = { currency: 'AED', locale: 'en-AE' };
const KUWAIT = { currency: 'KWD', locale: 'en-KW' };

describe('currencyMinorDigits', () => {
  it('reads the exponent from ICU, three places for the Gulf dinars', () => {
    expect(currencyMinorDigits('INR')).toBe(2);
    expect(currencyMinorDigits('AED')).toBe(2);
    expect(currencyMinorDigits('KWD')).toBe(3);
    expect(currencyMinorDigits('BHD')).toBe(3);
    expect(currencyMinorDigits('OMR')).toBe(3);
  });
});

describe('decimalToMinor', () => {
  it('reads a printed amount by the currency’s places, and refuses more places than it has', () => {
    expect(decimalToMinor('1250.5', 2)).toBe(125050n);
    expect(decimalToMinor('1.250', 3)).toBe(1250n);
    expect(decimalToMinor('42', 0)).toBe(42n);
    expect(decimalToMinor('1.2345', 3)).toBeNull();
    expect(decimalToMinor('12a', 2)).toBeNull();
  });
});

describe('minorToDecimal', () => {
  it('places the point by the currency exponent, exactly', () => {
    expect(minorToDecimal(125050n, 2)).toBe('1250.50');
    expect(minorToDecimal(1250500n, 3)).toBe('1250.500');
    expect(minorToDecimal(-5n, 2)).toBe('-0.05');
    expect(minorToDecimal(42n, 0)).toBe('42');
  });

  it('survives amounts past Number.MAX_SAFE_INTEGER', () => {
    expect(minorToDecimal(900719925474099312n, 2)).toBe('9007199254740993.12');
  });
});

describe('formatMoney', () => {
  it('is formatInr for an Indian company', () => {
    expect(formatMoney(123456789n, INDIA_LOCALE)).toBe(formatInr(123456789n));
    expect(formatMoney(123456789n)).toBe('₹12,34,567.89');
  });

  it('shows no rupee sign and no lakh grouping for a UAE company', () => {
    const text = formatMoney(123456789n, UAE);
    expect(text).toContain('AED');
    expect(text).toContain('1,234,567.89');
    expect(text).not.toContain('₹');
  });

  it('keeps three decimals for a dinar', () => {
    expect(formatMoney(1250500n, KUWAIT)).toContain('1,250.500');
  });
});

describe('formatMoneyCompact', () => {
  it('keeps crores and lakhs for Indian locales only', () => {
    expect(formatMoneyCompact(4_200_000_000n, INDIA_LOCALE)).toBe('₹4.2 Cr');
    expect(formatMoneyCompact(4_200_000_000n, { currency: 'INR', locale: 'ta-IN' })).toBe(
      '₹4.2 Cr',
    );
    expect(formatMoneyCompact(4_200_000_000n, UAE)).not.toContain('Cr');
  });

  it('shows no stray decimal on small or zero amounts', () => {
    expect(formatMoneyCompact(45_000n, UAE)).toMatch(/^AED\s450$/);
    expect(formatMoneyCompact(0n, UAE)).toMatch(/^AED\s0$/);
  });

  it('truncates in compact notation too, never overstating', () => {
    // AED 9,999,999 must not read as AED 10M.
    expect(formatMoneyCompact(999_999_900n, UAE)).toContain('9.9M');
  });
});

describe('todayIn', () => {
  // 18:20 UTC on 4 Oct: already 5 Oct in Kathmandu (+5:45) and Dhaka (+6), still 4 Oct in Dubai.
  const evening = new Date('2026-10-04T18:20:00Z');

  it('follows each zone, including quarter-hour offsets', () => {
    expect(todayIn('Asia/Kolkata', evening)).toBe('2026-10-04');
    expect(todayIn('Asia/Kathmandu', evening)).toBe('2026-10-05');
    expect(todayIn('Asia/Dhaka', evening)).toBe('2026-10-05');
    expect(todayIn('Asia/Dubai', evening)).toBe('2026-10-04');
    expect(todayIn('Asia/Riyadh', evening)).toBe('2026-10-04');
  });

  it('flips Kathmandu at 18:15 UTC, not on the half hour', () => {
    expect(todayIn('Asia/Kathmandu', new Date('2026-10-04T18:14:00Z'))).toBe('2026-10-04');
    expect(todayIn('Asia/Kathmandu', new Date('2026-10-04T18:15:00Z'))).toBe('2026-10-05');
  });

  it('agrees with todayInIst', () => {
    for (const iso of ['2026-10-04T18:29:59Z', '2026-10-04T18:30:00Z', '2026-12-31T23:59:00Z']) {
      expect(todayInIst(new Date(iso))).toBe(todayIn('Asia/Kolkata', new Date(iso)));
    }
    expect(todayInIst(new Date('2026-10-04T18:29:59Z'))).toBe('2026-10-04');
    expect(todayInIst(new Date('2026-10-04T18:30:00Z'))).toBe('2026-10-05');
  });
});

describe('COUNTRY_PRESETS', () => {
  it('passes its own validation, so picking a country can never be refused', () => {
    for (const preset of COUNTRY_PRESETS) {
      expect(() =>
        tenantLocaleSchema.parse({
          country: preset.country,
          currency: preset.currency,
          timezone: preset.timezone,
          locale: preset.locale,
          tax_regime: preset.taxRegime,
        }),
      ).not.toThrow();
      for (const locale of localesFor(preset.country)) expect(isValidLocale(locale)).toBe(true);
    }
  });

  it('starts with India and matches the Indian defaults', () => {
    expect(COUNTRY_PRESETS[0]).toMatchObject({ ...INDIA_LOCALE });
    expect(presetFor('AE')?.currency).toBe('AED');
    expect(localesFor('SA')).toEqual(['en-SA', 'ar-SA']);
  });
});

describe('tenantLocaleSchema', () => {
  it('accepts a Gulf company and normalises case', () => {
    expect(
      tenantLocaleSchema.parse({
        country: 'ae',
        currency: 'aed',
        timezone: 'Asia/Dubai',
        locale: 'ar-AE',
        tax_regime: 'vat_ae',
      }),
    ).toEqual({
      country: 'AE',
      currency: 'AED',
      timezone: 'Asia/Dubai',
      locale: 'ar-AE',
      tax_regime: 'vat_ae',
    });
  });

  it('rejects a zone or locale the runtime cannot use', () => {
    expect(isValidTimeZone('Asia/Atlantis')).toBe(false);
    expect(isValidLocale('not a locale')).toBe(false);
  });
});
