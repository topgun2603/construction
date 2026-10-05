import {
  QUALITY_INSPECTION_RESULT_LABELS,
  SNAG_PRIORITY_LABELS,
  SNAG_STATUS_LABELS,
  type QualityInspectionResult,
  type QualityTestState,
  type SnagPriority,
  type SnagStatus,
} from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';

/**
 * How QA/QC states read, and the colour each carries. English here and translated where they are
 * drawn — a module-level constant is evaluated before there is any language to translate into.
 */

export const SNAG_STATUS: Record<SnagStatus, { label: string; tone: Tone }> = {
  draft: { label: SNAG_STATUS_LABELS.draft, tone: 'neutral' },
  open: { label: SNAG_STATUS_LABELS.open, tone: 'blocked' },
  fixed: { label: SNAG_STATUS_LABELS.fixed, tone: 'pending' },
  closed: { label: SNAG_STATUS_LABELS.closed, tone: 'done' },
};

export const SNAG_PRIORITY: Record<SnagPriority, { label: string; tone: Tone }> = {
  low: { label: SNAG_PRIORITY_LABELS.low, tone: 'neutral' },
  medium: { label: SNAG_PRIORITY_LABELS.medium, tone: 'accent' },
  high: { label: SNAG_PRIORITY_LABELS.high, tone: 'pending' },
  critical: { label: SNAG_PRIORITY_LABELS.critical, tone: 'blocked' },
};

export const INSPECTION_RESULT: Record<QualityInspectionResult, { label: string; tone: Tone }> = {
  pass: { label: QUALITY_INSPECTION_RESULT_LABELS.pass, tone: 'done' },
  pass_with_comments: { label: QUALITY_INSPECTION_RESULT_LABELS.pass_with_comments, tone: 'pending' },
  fail: { label: QUALITY_INSPECTION_RESULT_LABELS.fail, tone: 'blocked' },
};

export const TEST_STATE: Record<QualityTestState, { label: string; tone: Tone }> = {
  scheduled: { label: 'Scheduled', tone: 'neutral' },
  due: { label: 'Due today', tone: 'pending' },
  overdue: { label: 'Overdue', tone: 'blocked' },
  pass: { label: 'Pass', tone: 'done' },
  fail: { label: 'Fail', tone: 'blocked' },
  recorded: { label: 'Recorded', tone: 'accent' },
};

/** Basis points → "87.5%"; nothing completed reads as a dash, never as 0%. */
export function passRate(bp: number | null): string {
  if (bp === null) return '—';
  const tenths = Math.round(bp / 10);
  return `${tenths % 10 === 0 ? tenths / 10 : (tenths / 10).toFixed(1)}%`;
}

/**
 * A query string from filter values, dropping the empty ones and the "any" placeholder. The
 * filters live in the URL so a filtered list is a link somebody can send, and the CSV export
 * downloads exactly what is on screen.
 */
export function filterQuery(values: Record<string, string | undefined | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value && value !== ANY) query.set(key, value);
  }
  return query.toString();
}

/** Radix Select cannot hold an empty value, so "any" has a name of its own. */
export const ANY = 'any';

/**
 * Comma-separated cube ages → whole days, oldest last. `null` when anything in it is not a day
 * count the API would accept (1–365, at most four).
 */
export function parseCubeAges(text: string): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 4) return null;
  const ages = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (ages.some((age) => !Number.isInteger(age) || age < 1 || age > 365)) return null;
  return [...new Set(ages)].sort((a, b) => a - b);
}

/** A reading the API will take: up to three decimals, negative allowed. */
export function isQualityDecimal(value: string): boolean {
  return /^-?\d{1,9}(?:\.\d{1,3})?$/.test(value.trim());
}
