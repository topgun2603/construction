/**
 * Report and attendance dates are plain calendar dates in the company's time zone —
 * `Asia/Kolkata` for an Indian one (spec §17) — and never carry a timezone themselves.
 * Represent them as `YYYY-MM-DD` strings everywhere outside the database.
 */

export const APP_TIMEZONE = 'Asia/Kolkata';

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The current calendar date in IST, regardless of server timezone. `todayIn` for an Indian
 * company; new code should pass the tenant's (or the site's) zone to `todayIn` instead.
 */
export function todayInIst(now: Date = new Date()): IsoDate {
  return todayIn(APP_TIMEZONE, now);
}

/**
 * The calendar date it is right now in `timeZone` — what "today" means for a site's attendance
 * and report. Goes through the tz database rather than a fixed offset, so +5:45 (Kathmandu) and
 * zones with daylight saving are right too.
 */
export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  const parts = dayFormatter(timeZone).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      calendar: 'gregory',
      numberingSystem: 'latn',
    });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * A `YYYY-MM-DD` string as the UTC-midnight `Date` that Prisma stores in a
 * `date` column. Going through UTC keeps the stored day independent of the
 * server's own timezone.
 */
export function isoDateToUtcDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function utcDateToIsoDate(value: Date): IsoDate {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const date = isoDateToUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateToIsoDate(date);
}

/** Inclusive day count: `2026-01-01`..`2026-01-07` is 7. */
export function daysBetweenInclusive(from: IsoDate, to: IsoDate): number {
  const ms = isoDateToUtcDate(to).getTime() - isoDateToUtcDate(from).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

/** Every date in an inclusive range, ascending. */
export function eachDate(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) out.push(cursor);
  return out;
}
