import { formatInr, formatInrCompact } from '@sitebook/shared';

/**
 * Display helpers.
 *
 * Money crosses the wire as a decimal string of paise, so it is parsed straight to
 * `bigint` and never through `Number` — that is the whole point of the string form
 * (ADR 0003).
 */

export function paise(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Full precision: `₹1,250.50`. Use in ledgers and wage sheets. */
export function money(value: string | null | undefined): string {
  return formatInr(paise(value));
}

/** Short form: `₹4.2 Cr`. Use in headline tiles. */
export function moneyShort(value: string | null | undefined): string {
  return formatInrCompact(paise(value));
}

/** `2026-03-02` → `2 Mar`. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}

/** `2026-03-02` → `Mon 2 Mar 2026`. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/** An instant → `9:52 am`, in the app's timezone. */
export function timeOfDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(parsed);
}

/** An instant → `2 Mar`, on the day it happened in Asia/Kolkata rather than in UTC. */
export function instantDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(parsed);
}

/**
 * An instant → `just now`, `20m ago`, `3h ago`, then a date.
 *
 * Deliberately coarse. This renders on the server and again in the browser, and a unit finer than a
 * minute would disagree between the two often enough to matter; past a day it stops being relative
 * at all, because "6d ago" is not how anybody thinks about when a drawing was sent.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '—';

  const minutes = Math.floor((Date.now() - parsed.getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${instantDate(iso)}, ${timeOfDay(iso)}`;
}

export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Today in `Asia/Kolkata` as `YYYY-MM-DD` — the default for any date input. */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

/** The Monday on or before `iso`, for defaulting a weekly wage period. */
export function weekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
