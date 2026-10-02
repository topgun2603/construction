import { describe, expect, it } from 'vitest';
import { parseBillDate, parseIndianDate } from './indian-date';

/**
 * The case this was written for: an invoice printed 25/09/2026 came back from a vision model as
 * 2026-08-25. A month out is an expense in the wrong month's spend, and nothing downstream can see
 * that it is wrong. So the model transcribes and this parses.
 */
describe('reading a date off an Indian bill', () => {
  it('reads the common printed forms, day first', () => {
    expect(parseIndianDate('25/09/2026')).toBe('2026-09-25');
    expect(parseIndianDate('25-09-2026')).toBe('2026-09-25');
    expect(parseIndianDate('25.09.2026')).toBe('2026-09-25');
    expect(parseIndianDate('5/9/26')).toBe('2026-09-05');
    expect(parseIndianDate('  25 / 09 / 2026 ')).toBe('2026-09-25');
  });

  it('reads the ambiguous one as day first, because every Indian bill is', () => {
    // The fifth of June. A parser that guesses American here is wrong eleven days a year and
    // plausible on all of them.
    expect(parseIndianDate('05/06/2026')).toBe('2026-06-05');
  });

  it('reads month names in either order', () => {
    expect(parseIndianDate('25 Sep 2026')).toBe('2026-09-25');
    expect(parseIndianDate('25 September 2026')).toBe('2026-09-25');
    expect(parseIndianDate('25-Sep-2026')).toBe('2026-09-25');
    expect(parseIndianDate('Sep 25, 2026')).toBe('2026-09-25');
    expect(parseIndianDate('September 25 2026')).toBe('2026-09-25');
  });

  it('passes an ISO date straight through', () => {
    expect(parseIndianDate('2026-09-25')).toBe('2026-09-25');
  });

  it('refuses a date that does not exist', () => {
    expect(parseIndianDate('31/04/2026')).toBeNull(); // April has thirty days
    expect(parseIndianDate('29/02/2026')).toBeNull(); // 2026 is not a leap year
    expect(parseIndianDate('32/01/2026')).toBeNull();
    expect(parseIndianDate('25/13/2026')).toBeNull();
  });

  it('keeps 29 February in a leap year', () => {
    expect(parseIndianDate('29/02/2028')).toBe('2028-02-29');
  });

  it('refuses what it cannot read rather than guessing', () => {
    expect(parseIndianDate('')).toBeNull();
    expect(parseIndianDate('not a date')).toBeNull();
    expect(parseIndianDate('25/Sept')).toBeNull();
  });

  describe('as a bill date', () => {
    const today = new Date('2026-10-02T00:00:00Z');

    it('accepts a bill from last month', () => {
      expect(parseBillDate('25/09/2026', today)).toBe('2026-09-25');
    });

    it('accepts today', () => {
      expect(parseBillDate('02/10/2026', today)).toBe('2026-10-02');
    });

    it('refuses a date in the future, which is a misread rather than a prediction', () => {
      expect(parseBillDate('25/12/2026', today)).toBeNull();
    });

    it('allows one day ahead, for a bill raised where it is already tomorrow', () => {
      expect(parseBillDate('03/10/2026', today)).toBe('2026-10-03');
    });

    it('refuses something far too old to be this month’s expense', () => {
      expect(parseBillDate('25/09/2019', today)).toBeNull();
    });
  });
});
