import type {
  SafetyActionStatus,
  SafetyIncidentStatus,
  SafetyObservationStatus,
  SafetyPermitStatus,
  SafetySeverity,
} from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';

/**
 * How safety statuses read, and the colour each carries. Labels are English keys for `t()`; the
 * type and category names come from @sitebook/shared so the API's CSV and the screen agree.
 */

export const INCIDENT_STATUS: Record<SafetyIncidentStatus, { label: string; tone: Tone }> = {
  reported: { label: 'Reported', tone: 'pending' },
  investigating: { label: 'Investigating', tone: 'accent' },
  actions_open: { label: 'Actions open', tone: 'pending' },
  closed: { label: 'Closed', tone: 'done' },
};

export const PERMIT_STATUS: Record<SafetyPermitStatus, { label: string; tone: Tone }> = {
  requested: { label: 'Awaiting signatures', tone: 'pending' },
  active: { label: 'Active', tone: 'done' },
  suspended: { label: 'Suspended', tone: 'blocked' },
  closed: { label: 'Closed', tone: 'neutral' },
};

export const OBSERVATION_STATUS: Record<SafetyObservationStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'pending' },
  closed: { label: 'Closed', tone: 'done' },
};

export const ACTION_STATUS: Record<SafetyActionStatus, { label: string; tone: Tone }> = {
  open: { label: 'Open', tone: 'pending' },
  done: { label: 'Done', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const SEVERITY: Record<SafetySeverity, { label: string; tone: Tone }> = {
  low: { label: 'Low', tone: 'neutral' },
  medium: { label: 'Medium', tone: 'pending' },
  high: { label: 'High', tone: 'blocked' },
  critical: { label: 'Critical', tone: 'blocked' },
};

export const PERSON_ROLE: Record<'injured' | 'involved' | 'witness', string> = {
  injured: 'Injured',
  involved: 'Involved',
  witness: 'Witness',
};

/** An expired permit reads as expired whatever its stored status, because the work must stop. */
export function permitBadge(permit: { status: SafetyPermitStatus; expired: boolean }): { label: string; tone: Tone } {
  return permit.expired ? { label: 'Expired — still open', tone: 'blocked' } : PERMIT_STATUS[permit.status];
}

/**
 * The tone for a days-since-LTI figure: a week or less since an injury is a red flag, a month is
 * still recent, beyond that it is good news.
 */
export function daysSinceTone(days: number | null, hasLti: boolean): Tone {
  if (!hasLti) return 'done';
  if (days === null || days <= 7) return 'blocked';
  if (days <= 30) return 'pending';
  return 'done';
}

/** A local wall-clock time on the company's clock, rounded to the minute, for a datetime input. */
export function localNow(timeZone: string, offsetMinutes = 0): string {
  const at = new Date(Date.now() + offsetMinutes * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      calendar: 'gregory',
      numberingSystem: 'latn',
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
