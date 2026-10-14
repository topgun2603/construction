import { describe, expect, it } from 'vitest';
import { rfiBadge, submittalBadge } from './labels';

describe('RFI and submittal badges', () => {
  it('shows overdue over the status, because that is what needs chasing', () => {
    expect(rfiBadge({ status: 'open', overdue: true })).toEqual({ label: 'Overdue', tone: 'blocked' });
    expect(submittalBadge({ status: 'under_review', overdue: true })).toEqual({ label: 'Overdue', tone: 'blocked' });
  });

  it('colours the outcome', () => {
    expect(rfiBadge({ status: 'closed', overdue: false })).toEqual({ label: 'Closed', tone: 'done' });
    expect(submittalBadge({ status: 'approved_as_noted', overdue: false })).toEqual({
      label: 'Approved as noted',
      tone: 'done',
    });
    expect(submittalBadge({ status: 'revise_resubmit', overdue: false }).tone).toBe('blocked');
  });
});
