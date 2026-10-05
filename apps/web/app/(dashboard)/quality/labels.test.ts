import { describe, expect, it } from 'vitest';
import { filterQuery, isQualityDecimal, parseCubeAges, passRate } from './labels';

/**
 * The small pieces of arithmetic and parsing behind the quality screens. A pass rate that rounds
 * the wrong way, or a cube set created with the wrong ages, is a number somebody signs off on.
 */
describe('quality labels', () => {
  it('prints a pass rate from basis points, and nothing completed as a dash', () => {
    expect(passRate(10_000)).toBe('100%');
    expect(passRate(8750)).toBe('87.5%');
    expect(passRate(6667)).toBe('66.7%');
    expect(passRate(0)).toBe('0%');
    expect(passRate(null)).toBe('—');
  });

  it('builds a query from filters, dropping blanks and "any"', () => {
    expect(filterQuery({ project_id: 'p1', status: 'any', trade: '', priority: undefined })).toBe(
      'project_id=p1',
    );
    expect(filterQuery({ tab: 'snags', status: 'open' })).toBe('tab=snags&status=open');
  });

  it('reads cube ages as whole days, sorted and without repeats', () => {
    expect(parseCubeAges('7, 28')).toEqual([7, 28]);
    expect(parseCubeAges('28 7 3')).toEqual([3, 7, 28]);
    expect(parseCubeAges('7,7,28')).toEqual([7, 28]);
  });

  it('refuses cube ages the API would refuse', () => {
    expect(parseCubeAges('')).toBeNull();
    expect(parseCubeAges('0, 28')).toBeNull();
    expect(parseCubeAges('7.5')).toBeNull();
    expect(parseCubeAges('1,3,7,14,28')).toBeNull();
    expect(parseCubeAges('400')).toBeNull();
  });

  it('accepts a reading with at most three decimals', () => {
    expect(isQualityDecimal('40')).toBe(true);
    expect(isQualityDecimal('-2.5')).toBe(true);
    expect(isQualityDecimal('40.125')).toBe(true);
    expect(isQualityDecimal('40.1255')).toBe(false);
    expect(isQualityDecimal('forty')).toBe(false);
    expect(isQualityDecimal('')).toBe(false);
  });
});
