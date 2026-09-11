import { isPeriodEnd, periodStartFor } from './pay-cycle';

/**
 * These two functions decide which days a worker gets paid for. An off-by-one
 * leaves a day outside every period, and nobody notices until someone is short.
 */
describe('pay cycle', () => {
  describe('weekly', () => {
    it('closes on Sunday only', () => {
      expect(isPeriodEnd('weekly', '2026-03-08')).toBe(true); // Sunday
      expect(isPeriodEnd('weekly', '2026-03-07')).toBe(false); // Saturday
      expect(isPeriodEnd('weekly', '2026-03-02')).toBe(false); // Monday
    });

    it('starts the Monday six days before', () => {
      expect(periodStartFor('weekly', '2026-03-08')).toBe('2026-03-02');
    });
  });

  describe('fortnightly', () => {
    it('closes on the 15th and the last day of the month', () => {
      expect(isPeriodEnd('fortnightly', '2026-03-15')).toBe(true);
      expect(isPeriodEnd('fortnightly', '2026-03-31')).toBe(true);
      expect(isPeriodEnd('fortnightly', '2026-03-16')).toBe(false);
      expect(isPeriodEnd('fortnightly', '2026-03-30')).toBe(false);
    });

    it('handles February without a special case', () => {
      expect(isPeriodEnd('fortnightly', '2026-02-28')).toBe(true);
      expect(isPeriodEnd('fortnightly', '2026-02-27')).toBe(false);
      // 2028 is a leap year: the 28th is no longer the end.
      expect(isPeriodEnd('fortnightly', '2028-02-29')).toBe(true);
      expect(isPeriodEnd('fortnightly', '2028-02-28')).toBe(false);
    });

    it('splits the month into 1-15 and 16-end', () => {
      expect(periodStartFor('fortnightly', '2026-03-15')).toBe('2026-03-01');
      expect(periodStartFor('fortnightly', '2026-03-31')).toBe('2026-03-16');
      expect(periodStartFor('fortnightly', '2026-02-28')).toBe('2026-02-16');
    });

    it('leaves no day outside a period', () => {
      // Every day of March falls in exactly one of the two halves.
      const first = { start: periodStartFor('fortnightly', '2026-03-15'), end: '2026-03-15' };
      const second = { start: periodStartFor('fortnightly', '2026-03-31'), end: '2026-03-31' };
      expect(first.start).toBe('2026-03-01');
      expect(second.start).toBe('2026-03-16');
      // The halves are contiguous: the second starts the day after the first ends.
      expect(Number(second.start.slice(-2))).toBe(Number(first.end.slice(-2)) + 1);
    });
  });

  describe('monthly', () => {
    it('closes on the last day and starts on the first', () => {
      expect(isPeriodEnd('monthly', '2026-04-30')).toBe(true);
      expect(isPeriodEnd('monthly', '2026-04-29')).toBe(false);
      expect(periodStartFor('monthly', '2026-04-30')).toBe('2026-04-01');
    });
  });

  it('never closes for unknown terms rather than guessing', () => {
    expect(isPeriodEnd('quarterly', '2026-03-31')).toBe(false);
  });
});
