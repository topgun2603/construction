import { describe, expect, it } from 'vitest';
import { TAX_REGIMES } from './locale';
import {
  isValidSaudiVatNumber,
  isValidUaeTrn,
  taxIncluded,
  taxOnTop,
  taxRule,
  validTaxIdOrNull,
} from './tax';

describe('tax rules', () => {
  it('has a rule for every regime a company can pick', () => {
    for (const regime of TAX_REGIMES) expect(taxRule(regime).regime).toBe(regime);
  });

  it('checks a GSTIN by its check digit, as before', () => {
    expect(validTaxIdOrNull('gst_in', '27aapfu0939f1zv')).toBe('27AAPFU0939F1ZV');
    expect(validTaxIdOrNull('gst_in', '27AAPFU0939F1ZJ')).toBeNull();
  });

  it('checks a UAE TRN and a Saudi VAT number by shape', () => {
    expect(isValidUaeTrn('100-1234-5678-9012')).toBe(true);
    expect(isValidUaeTrn('200123456789012')).toBe(false);
    expect(isValidSaudiVatNumber('300012345600003')).toBe(true);
    expect(isValidSaudiVatNumber('300012345600004')).toBe(false);
  });

  it('never accepts another country’s number', () => {
    expect(validTaxIdOrNull('vat_ae', '27AAPFU0939F1ZV')).toBeNull();
    expect(validTaxIdOrNull('gst_in', '100123456789012')).toBeNull();
    expect(validTaxIdOrNull('none', '100123456789012')).toBeNull();
  });

  it('finds the VAT inside an inclusive amount, and adds it to a net one', () => {
    // AED 105.00 at 5% holds AED 5.00; SAR 115.00 at 15% holds SAR 15.00.
    expect(taxIncluded(10_500n, 500)).toBe(500n);
    expect(taxIncluded(11_500n, 1500)).toBe(1_500n);
    // AED 1.00 at 5% holds 4.76 fils, rounded to 5.
    expect(taxIncluded(100n, 500)).toBe(5n);
    expect(taxOnTop(10_000n, 500)).toBe(500n);
    expect(taxOnTop(333n, 500)).toBe(17n);
  });

  it('keeps standard rates as data, and none where there is no single rate', () => {
    expect(taxRule('vat_ae').standardRateBp).toBe(500);
    expect(taxRule('vat_sa').standardRateBp).toBe(1500);
    expect(taxRule('gst_in').standardRateBp).toBeNull();
  });
});
