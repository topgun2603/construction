import type { Tone } from '@/components/ui/badge';
import type { ChangeOrderStatus } from '@/lib/change-order-types';

/** How a change order's status reads, and the colour it carries. Wrapped in `t()` where shown. */
export const CHANGE_ORDER_STATUS: Record<ChangeOrderStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Awaiting approval', tone: 'pending' },
  sent: { label: 'With the client', tone: 'accent' },
  approved: { label: 'Approved by client', tone: 'done' },
  rejected: { label: 'Rejected by client', tone: 'blocked' },
  implemented: { label: 'Implemented', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** `7` → `+7 days`, `-2` → `−2 days`, `0` → `No change`. */
export function changeOrderDaysText(days: number, t: (text: string) => string): string {
  if (days === 0) return t('No change');
  const unit = Math.abs(days) === 1 ? t('day') : t('days');
  return `${days > 0 ? '+' : '−'}${Math.abs(days)} ${unit}`;
}
