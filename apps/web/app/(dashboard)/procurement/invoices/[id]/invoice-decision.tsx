'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Paperclip, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { viewUrl } from '@/lib/actions';
import {
  approvePurchaseInvoice,
  deletePurchaseInvoice,
  rejectPurchaseInvoice,
} from '@/lib/procurement-actions';
import type { PurchaseInvoice } from '@/lib/procurement-types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { useLanguage } from '@/components/language-provider';

/**
 * Approve, reject or delete an invoice. A matched invoice is approved with one click; a flagged
 * one needs the difference accepted with a reason, by somebody who approves orders.
 */
export function InvoiceDecision({
  invoice,
  canRecord,
  canApproveOrders,
}: {
  invoice: PurchaseInvoice;
  canRecord: boolean;
  canApproveOrders: boolean;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decided = invoice.status === 'approved' || invoice.status === 'rejected';
  const mismatch = invoice.status === 'mismatch';

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.error ?? t('That did not work'));
        return;
      }
      toast.success(success);
      if (after) after();
      else router.refresh();
    });
  }

  async function openAttachment() {
    if (!invoice.attachment_s3_key) return;
    const result = await viewUrl(invoice.attachment_s3_key);
    if (result.ok && result.data) window.open(result.data.url, '_blank', 'noopener');
    else toast.error(result.error ?? t('Could not open the file'));
  }

  return (
    <div className="flex flex-col gap-3">
      {invoice.attachment_s3_key && (
        <Button size="sm" variant="secondary" className="self-start" onClick={() => void openAttachment()}>
          <Paperclip className="size-4" /> {t('Open the invoice')}
        </Button>
      )}
      {!decided && (canRecord || canApproveOrders) && (
        <>
          <Field
            label={mismatch ? t('Why the difference is accepted, or why it is rejected') : t('Note')}
            optional={!mismatch}
          >
            <Textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {mismatch && !canApproveOrders && (
            <p className="text-[12.5px] text-ink-muted">
              {t('Accepting a difference needs somebody who approves purchase orders. You can reject it and ask the supplier for a corrected invoice.')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {(!mismatch || canApproveOrders) && (
              <Button
                size="sm"
                variant="approve"
                disabled={pending || (mismatch && note.trim() === '')}
                onClick={() =>
                  run(
                    () =>
                      approvePurchaseInvoice(invoice.id, {
                        ...(mismatch ? { accept_variance: true } : {}),
                        ...(note.trim() ? { note: note.trim() } : {}),
                      }),
                    t('Approved and booked as an expense'),
                  )
                }
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {mismatch ? t('Accept the difference and approve') : t('Approve')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || note.trim() === ''}
              onClick={() => run(() => rejectPurchaseInvoice(invoice.id, note.trim()), t('Invoice rejected'))}
            >
              <X className="size-4" /> {t('Reject')}
            </Button>
          </div>
        </>
      )}
      {invoice.status !== 'approved' && canRecord && (
        <Button
          size="sm"
          variant="destructive"
          className="self-start"
          disabled={pending}
          onClick={() =>
            run(() => deletePurchaseInvoice(invoice.id), t('Invoice deleted'), () =>
              router.push(`/procurement/orders/${invoice.purchase_order_id}`),
            )
          }
        >
          <Trash2 className="size-4" /> {t('Delete invoice')}
        </Button>
      )}
      {error && (
        <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
          {error}
        </p>
      )}
    </div>
  );
}
