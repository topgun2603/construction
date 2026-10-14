import type {
  MatchFlagType,
  PurchaseInvoiceStatus,
  PurchaseOrderStatus,
  RfqStatus,
} from '@sitebook/shared';
import type { Tone } from '@/components/ui/badge';

/**
 * Labels and tones for procurement statuses, in one place so a list, a detail page and the site
 * tab never disagree about what colour "waiting for approval" is.
 */
export const ORDER_STATUS: Record<PurchaseOrderStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_approval: { label: 'Waiting for approval', tone: 'pending' },
  approved: { label: 'Approved', tone: 'accent' },
  sent: { label: 'Sent to supplier', tone: 'accent' },
  partially_received: { label: 'Partly received', tone: 'pending' },
  received: { label: 'Received', tone: 'done' },
  closed: { label: 'Closed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'blocked' },
};

export const RFQ_STATUS: Record<RfqStatus, { label: string; tone: Tone }> = {
  open: { label: 'Collecting quotes', tone: 'pending' },
  awarded: { label: 'Awarded', tone: 'done' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const INVOICE_STATUS: Record<PurchaseInvoiceStatus, { label: string; tone: Tone }> = {
  matched: { label: 'Matched', tone: 'accent' },
  mismatch: { label: 'Does not match', tone: 'blocked' },
  approved: { label: 'Approved', tone: 'done' },
  rejected: { label: 'Rejected', tone: 'neutral' },
};

/** What each three-way match flag means, in the words a buyer would use. */
export const FLAG_LABEL: Record<MatchFlagType, string> = {
  over_billed_qty: 'Billed more than was ordered',
  billed_not_received: 'Billed but not received',
  price_variance: 'Rate differs from the order',
  tax_variance: 'Tax differs from the order',
};

/** 1800 → "18%", 550 → "5.5%". */
export function percent(bp: number): string {
  return `${Number((bp / 100).toFixed(2))}%`;
}

/** "18" or "5.5" typed by a person → basis points. NaN when it is not a percentage. */
export function percentToBp(value: string): number {
  const trimmed = value.replace('%', '').trim();
  if (trimmed === '') return 0;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
