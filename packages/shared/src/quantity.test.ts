import { describe, expect, it } from 'vitest';
import { quantityToThousandths, thousandthsToQuantity } from './money';

/**
 * Stock is a running sum of what arrived minus what was used, so the scaling has to be exact
 * in both directions — a drift of a thousandth per movement is a wrong stock figure by the
 * end of a slab.
 */
describe('quantity scaling', () => {
  it('scales whole numbers and decimals', () => {
    expect(quantityToThousandths('40')).toBe(40_000n);
    expect(quantityToThousandths('37.5')).toBe(37_500n);
    expect(quantityToThousandths('0.125')).toBe(125n);
    expect(quantityToThousandths('1250.75')).toBe(1_250_750n);
  });

  it('round-trips without drift', () => {
    for (const value of ['40', '37.5', '0.125', '1250.75', '0.001', '999999.999']) {
      expect(thousandthsToQuantity(quantityToThousandths(value))).toBe(value);
    }
  });

  it('trims trailing zeros on the way out', () => {
    // "40 bags" rather than "40.000 bags"; the unit sits beside it.
    expect(thousandthsToQuantity(40_000n)).toBe('40');
    expect(thousandthsToQuantity(37_500n)).toBe('37.5');
    expect(thousandthsToQuantity(0n)).toBe('0');
  });

  it('handles a negative balance', () => {
    // Used more than arrived: a real state worth showing, not an error to hide.
    expect(thousandthsToQuantity(-2_500n)).toBe('-2.5');
    expect(quantityToThousandths('-2.5')).toBe(-2_500n);
  });

  it('refuses more precision than it can hold', () => {
    // A caller sending 0.3333 has a unit conversion wrong and should hear about it rather
    // than have it quietly rounded into the stock ledger.
    expect(() => quantityToThousandths('0.3333')).toThrow(RangeError);
    expect(() => quantityToThousandths('abc')).toThrow(RangeError);
    expect(() => quantityToThousandths('')).toThrow(RangeError);
  });

  it('sums exactly where floats would not', () => {
    const total = ['0.1', '0.2', '0.3'].reduce((sum, v) => sum + quantityToThousandths(v), 0n);
    expect(thousandthsToQuantity(total)).toBe('0.6');
    // 0.1 + 0.2 + 0.3 in floating point is 0.6000000000000001.
    expect(0.1 + 0.2 + 0.3).not.toBe(0.6);
  });
});
