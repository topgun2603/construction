import { describe, expect, it } from 'vitest';
import { COUNTRY_PRESETS } from './locale';
import { countryOfPhone, displayPhone, phoneCountry, toE164 } from './phone';
import { phoneSchema, toE164Indian } from './schemas/common';

describe('toE164', () => {
  it('reads Indian numbers exactly as toE164Indian always did', () => {
    for (const input of [
      '9876543210',
      '09876543210',
      '919876543210',
      '+91 98765 43210',
      '9120196797',
    ]) {
      expect(toE164(input)).toBe(toE164Indian(input));
    }
    // A mobile that merely begins with 91 is not stripped.
    expect(toE164('9120196797')).toBe('919120196797');
  });

  it('takes a Gulf number in any of the ways people type it', () => {
    for (const input of ['+971 50 123 4567', '+971501234567', '00971501234567', '971501234567']) {
      expect(toE164(input)).toBe('971501234567');
    }
    expect(toE164('+966 51 234 5678')).toBe('966512345678');
    expect(toE164('+965 500 12345')).toBe('96550012345');
  });

  it('reads national digits in the company’s country, dropping the trunk 0', () => {
    expect(toE164('050 123 4567', 'AE')).toBe('971501234567');
    expect(toE164('0512345678', 'SA')).toBe('966512345678');
    expect(toE164('984 1234567', 'NP')).toBe('9779841234567');
  });

  it('never guesses a country for bare national digits', () => {
    // A UAE mobile typed without its code, at an Indian company: refused, not stored as Indian.
    expect(toE164('501234567')).toBeNull();
    // A Nepali mobile is also a valid Indian one: in India it is Indian, in Nepal it is Nepali.
    expect(toE164('9841234567', 'IN')).toBe('919841234567');
    expect(toE164('9841234567', 'NP')).toBe('9779841234567');
  });

  it('refuses landlines, short numbers and unsupported countries', () => {
    expect(toE164('+971 4 123 4567')).toBeNull(); // Dubai landline
    expect(toE164('+44 7700 900123')).toBeNull(); // not a country a company can be in
    expect(toE164('12345')).toBeNull();
    expect(toE164('')).toBeNull();
  });

  it('has a phone rule, with a valid example, for every country a company can pick', () => {
    for (const preset of COUNTRY_PRESETS) {
      const entry = phoneCountry(preset.country);
      expect(entry).toBeDefined();
      expect(toE164(entry!.example, preset.country)).not.toBeNull();
    }
  });
});

describe('displayPhone', () => {
  it('splits off the calling code', () => {
    expect(displayPhone('971501234567')).toBe('+971 501234567');
    expect(displayPhone('919876543210')).toBe('+91 9876543210');
    expect(countryOfPhone('9779841234567')?.country).toBe('NP');
  });
});

describe('phoneSchema', () => {
  it('accepts any supported country with its code, and Indian digits without', () => {
    expect(phoneSchema.parse('9876543210')).toBe('919876543210');
    expect(phoneSchema.parse('+971 50 123 4567')).toBe('971501234567');
    expect(phoneSchema.safeParse('501234567').success).toBe(false);
  });
});
