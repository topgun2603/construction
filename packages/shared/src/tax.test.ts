import { describe, expect, it } from 'vitest';
import { TAX_REGIMES } from './locale';
import { isValidSaudiVatNumber, isValidUaeTrn, taxRule, validTaxIdOrNull } from './tax';

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

  it('keeps standard rates as data, and none where there is no single rate', () => {
    expect(taxRule('vat_ae').standardRateBp).toBe(500);
    expect(taxRule('vat_sa').standardRateBp).toBe(1500);
    expect(taxRule('gst_in').standardRateBp).toBeNull();
  });
});
