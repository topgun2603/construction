import { addDays, isoDateToUtcDate, type AskPeriod } from '@sitebook/shared';

/**
 * A period keyword to a pair of dates.
 *
 * In code rather than in the model's answer, for the same reason the bill date is: "last month" on
 * the 2nd of October means the whole of September, and a model asked for dates gets month
 * boundaries wrong in exactly the cases a spend question is about.
 *
 * `today` is the app's today — Asia/Kolkata — not the server's, so a question asked at 1am in
 * India does not quietly answer for yesterday.
 */
export function resolvePeriod(period: AskPeriod, today: string): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number) as [number, number, number];

  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'previous_7_days':
      return { from: addDays(today, -13), to: addDays(today, -7) };
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last_month': {
      const first = new Date(Date.UTC(year, month - 2, 1));
      const last = new Date(Date.UTC(year, month - 1, 0));
      return { from: iso(first), to: iso(last) };
    }
    case 'last_30_days':
      return { from: addDays(today, -29), to: today };
    case 'last_90_days':
      return { from: addDays(today, -89), to: today };
    case 'this_year':
      return { from: `${year}-01-01`, to: today };
    case 'all_time':
      // Far enough back to predate any site in the product, and no further: an open lower bound
      // turns every index scan into a table scan.
      return { from: '2015-01-01', to: today };
  }
}

/** How a period reads in the answer: "in September", "over the last 30 days". */
export function describePeriod(period: AskPeriod, range: { from: string; to: string }): string {
  switch (period) {
    case 'today':
      return 'today';
    case 'last_7_days':
      return 'in the last 7 days';
    case 'previous_7_days':
      return 'in the 7 days before that';
    case 'this_month':
      return 'this month';
    case 'last_month':
      return `in ${monthName(range.from)}`;
    case 'last_30_days':
      return 'over the last 30 days';
    case 'last_90_days':
      return 'over the last 90 days';
    case 'this_year':
      return 'this year';
    case 'all_time':
      return 'in total';
  }
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthName(date: string): string {
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    isoDateToUtcDate(date),
  );
}
