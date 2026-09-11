import { describe, expect, it } from 'vitest';
import { phoneSchema, toE164Indian } from './common';

/**
 * Phone normalisation decides whether a person can sign in at all: the invite
 * stores one form and login looks up another, so the two must agree for every
 * shape a human might type.
 */
describe('toE164Indian', () => {
  it('accepts a bare 10-digit mobile', () => {
    expect(toE164Indian('9876543210')).toBe('919876543210');
  });

  it('keeps numbers that themselves begin with 91', () => {
    // The regression: a leading "91" here is the mobile, not the country code.
    // Stripping it stored 9120196797 while login looked up 919120196797.
    expect(toE164Indian('9120196797')).toBe('919120196797');
    expect(toE164Indian('9199999999')).toBe('919199999999');
  });

  it('strips the country code only when 12 digits remain', () => {
    expect(toE164Indian('919876543210')).toBe('919876543210');
    expect(toE164Indian('+919876543210')).toBe('919876543210');
    expect(toE164Indian('+91 98765 43210')).toBe('919876543210');
  });

  it('strips a leading trunk zero', () => {
    expect(toE164Indian('09876543210')).toBe('919876543210');
  });

  it('ignores spaces, dashes and brackets', () => {
    expect(toE164Indian('(98765) 43210')).toBe('919876543210');
    expect(toE164Indian('98765-43210')).toBe('919876543210');
  });

  it('rejects anything that is not an Indian mobile', () => {
    expect(toE164Indian('1234567890')).toBeNull(); // must start 6-9
    expect(toE164Indian('987654321')).toBeNull(); // too short
    expect(toE164Indian('98765432109')).toBeNull(); // 11 digits, no trunk zero
    expect(toE164Indian('')).toBeNull();
    expect(toE164Indian('not a phone')).toBeNull();
  });

  it('is idempotent — normalising a stored number returns it unchanged', () => {
    const stored = toE164Indian('9120196797');
    expect(stored).not.toBeNull();
    expect(toE164Indian(stored as string)).toBe(stored);
  });
});

describe('phoneSchema', () => {
  it('parses to the stored form', () => {
    expect(phoneSchema.parse('  +91 91201 96797 ')).toBe('919120196797');
  });

  it('rejects with a readable message', () => {
    const result = phoneSchema.safeParse('12345');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/10-digit Indian mobile/);
    }
  });
});
