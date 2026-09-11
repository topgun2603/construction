import { addDays, isoDateToUtcDate } from '@sitebook/shared';

/**
 * When a contractor's pay cycle closes (spec §8A, `contractors.payment_terms`).
 *
 * Pure and separate from the processor so it can be tested without a queue: this
 * decides which week a worker gets paid for, and an off-by-one here shorts real
 * people.
 */

/** Does the cycle for these terms end on `date`? */
export function isPeriodEnd(paymentTerms: string, date: string): boolean {
  const day = isoDateToUtcDate(date);
  switch (paymentTerms) {
    case 'weekly':
      // Sunday closes the week: wage periods run Monday to Sunday.
      return day.getUTCDay() === 0;
    case 'fortnightly':
      // The 15th, and the last day of the month — so February works without a
      // special case and no day is ever left outside a period.
      return day.getUTCDate() === 15 || isLastDayOfMonth(day);
    case 'monthly':
      return isLastDayOfMonth(day);
    default:
      return false;
  }
}

/** The first day of the period ending on `periodEnd`. */
export function periodStartFor(paymentTerms: string, periodEnd: string): string {
  const end = isoDateToUtcDate(periodEnd);
  const month = periodEnd.slice(0, 8);
  switch (paymentTerms) {
    case 'weekly':
      return addDays(periodEnd, -6);
    case 'fortnightly':
      return end.getUTCDate() === 15 ? month + '01' : month + '16';
    case 'monthly':
      return month + '01';
    default:
      return addDays(periodEnd, -6);
  }
}

function isLastDayOfMonth(day: Date): boolean {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getUTCDate() === 1;
}
