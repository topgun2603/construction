import {
  RFI_STATUS_LABELS,
  SUBMITTAL_STATUS_LABELS,
  type RfiPriority,
  type RfiStatus,
  type SubmittalStatus,
} from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';

/**
 * Status badges for RFIs and submittals (roadmap Phase 2, module 9). Overdue wins over the status
 * colour: an open question past its date is the thing on the log somebody needs to chase.
 */

const RFI_TONE: Record<RfiStatus, Tone> = {
  draft: 'neutral',
  open: 'pending',
  answered: 'accent',
  closed: 'done',
  void: 'neutral',
};

export function rfiBadge(row: { status: RfiStatus; overdue: boolean }): { label: string; tone: Tone } {
  if (row.overdue) return { label: 'Overdue', tone: 'blocked' };
  return { label: RFI_STATUS_LABELS[row.status], tone: RFI_TONE[row.status] };
}

const SUBMITTAL_TONE: Record<SubmittalStatus, Tone> = {
  draft: 'neutral',
  submitted: 'pending',
  under_review: 'pending',
  approved: 'done',
  approved_as_noted: 'done',
  revise_resubmit: 'blocked',
  rejected: 'blocked',
};

export function submittalBadge(row: { status: SubmittalStatus; overdue: boolean }): { label: string; tone: Tone } {
  if (row.overdue) return { label: 'Overdue', tone: 'blocked' };
  return { label: SUBMITTAL_STATUS_LABELS[row.status], tone: SUBMITTAL_TONE[row.status] };
}

export const PRIORITY_TONE: Record<RfiPriority, Tone> = {
  low: 'neutral',
  normal: 'neutral',
  high: 'pending',
  urgent: 'blocked',
};
