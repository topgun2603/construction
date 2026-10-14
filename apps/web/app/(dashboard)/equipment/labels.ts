import type { Tone } from '@/components/ui/badge';
import type { EquipmentDocumentStandingName, EquipmentServiceStateName } from '@/lib/equipment-types';

/**
 * Badge tones and labels for equipment. Labels are English keys, translated with `t()` where shown.
 */

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: 'Available', tone: 'neutral' },
  on_site: { label: 'On site', tone: 'done' },
  under_maintenance: { label: 'Under maintenance', tone: 'pending' },
  off_hire: { label: 'Off hire', tone: 'neutral' },
};

export const SERVICE: Record<EquipmentServiceStateName, { label: string; tone: Tone }> = {
  ok: { label: 'Service OK', tone: 'done' },
  due_soon: { label: 'Service due soon', tone: 'pending' },
  due: { label: 'Service due', tone: 'blocked' },
  overdue: { label: 'Service overdue', tone: 'blocked' },
};

export const PAPERS: Record<EquipmentDocumentStandingName, { label: string; tone: Tone }> = {
  valid: { label: 'Papers valid', tone: 'done' },
  no_expiry: { label: 'No expiry', tone: 'neutral' },
  expiring: { label: 'Papers expiring', tone: 'pending' },
  expired: { label: 'Papers expired', tone: 'blocked' },
};

export const HIRE_BASIS_LABEL: Record<string, string> = {
  hour: 'per hour',
  day: 'per day',
  month: 'per month',
};

export const METER_UNIT: Record<string, string> = {
  hours: 'h',
  km: 'km',
  none: '',
};

/** A utilisation figure's tone: busy is good, idle hired kit is money going out. */
export function utilisationTone(percent: number | null): Tone {
  if (percent === null) return 'neutral';
  if (percent >= 70) return 'done';
  if (percent >= 40) return 'pending';
  return 'blocked';
}
