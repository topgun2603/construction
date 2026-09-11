/**
 * Report and attendance dates are plain calendar dates in `Asia/Kolkata`
 * (spec §17) — they never carry a timezone. Represent them as `YYYY-MM-DD`
 * strings everywhere outside the database.
 */

export const APP_TIMEZONE = 'Asia/Kolkata';

/** Minutes IST is ahead of UTC. India has no DST, so this is a constant. */
const IST_OFFSET_MINUTES = 330;

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The current calendar date in IST, regardless of server timezone. */
export function todayInIst(now: Date = new Date()): IsoDate {
  const shifted = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
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
