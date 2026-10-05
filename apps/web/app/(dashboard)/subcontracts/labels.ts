import { basisPointsToPercent } from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';
import type { RaBillStatus, SubcontractStatus } from '@/lib/subcontract-types';

/** How a subcontract's and an RA bill's status read, and the colour each carries. */

export const SUBCONTRACT_STATUS: Record<SubcontractStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  active: { label: 'Active', tone: 'accent' },
  completed: { label: 'Completed', tone: 'done' },
  closed: { label: 'Closed', tone: 'neutral' },
  terminated: { label: 'Terminated', tone: 'blocked' },
};

export const BILL_STATUS: Record<RaBillStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Awaiting certification', tone: 'pending' },
  certified: { label: 'Certified, unpaid', tone: 'accent' },
  paid: { label: 'Paid', tone: 'done' },
};

/** 1250 basis points → "12.5%". */
export function percent(bp: number): string {
  return `${basisPointsToPercent(bp)}%`;
}
