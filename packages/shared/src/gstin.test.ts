import { describe, expect, it } from 'vitest';
import { gstinCheckDigit, isValidGstin } from './gstin';

/**
 * The check digit is the whole point of validating a GSTIN rather than pattern-matching one.
 *
 * A model reading a bill from a photograph will occasionally return fifteen plausible characters
 * that are not anybody's GSTIN — `S` read as `J`, `B` as `8`. The shape alone cannot catch that;
 * the checksum can, and a rejected GSTIN becomes a field somebody fills in rather than a wrong
 * number filed against a supplier.
 */
describe('GSTIN', () => {
  it('accepts the published sample', () => {
    // The example used throughout the GST documentation itself.
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
  });

  it('is case and whitespace forgiving, because it is read off paper', () => {
    expect(isValidGstin('  27aapfu0939f1zv ')).toBe(true);
  });

  it('rejects one transposed character, which is what a misread looks like', () => {
    // Same length, same shape, one letter different — indistinguishable without the checksum.
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin('27AAPFJ0939F1ZV')).toBe(false);
  });

  it('rejects a state code nobody issues', () => {
    expect(isValidGstin('00AAPFU0939F1ZV')).toBe(false);
    expect(isValidGstin('45AAPFU0939F1ZV')).toBe(false);
  });

  it('rejects anything that is not the right shape', () => {
    expect(isValidGstin('')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false); // fourteen
    expect(isValidGstin('27AAPFU0939F1ZVV')).toBe(false); // sixteen
    expect(isValidGstin('27AAPFU0939F1AV')).toBe(false); // the fixed Z is not a Z
    expect(isValidGstin('2AAAPFU0939F1ZV')).toBe(false); // state code is not two digits
  });

  it('computes a digit that validates the number it completes', () => {
    const first14 = '27AAPFU0939F1Z';
    const digit = gstinCheckDigit(first14);
    expect(digit).toBe('V');
    expect(isValidGstin(`${first14}${digit}`)).toBe(true);
  });

  it('returns null for a prefix containing something outside the alphabet', () => {
    expect(gstinCheckDigit('27AAPFU0939F1-')).toBeNull();
  });
});
