'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Award, Ban, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { awardRfq, cancelRfq, removeQuote } from '@/lib/procurement-actions';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/components/language-provider';

/** Award a quote: makes a draft order to that supplier, then opens it. */
export function AwardButton({ rfqId, quoteId, lowest }: { rfqId: string; quoteId: string; lowest: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={lowest ? 'approve' : 'secondary'}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await awardRfq(rfqId, quoteId);
          if (!result.ok || !result.data) {
            toast.error(result.error ?? t('Could not award it'));
            return;
          }
          toast.success(t('Draft order made from this quote'));
          router.push(`/procurement/orders/${result.data.purchase_order_id}`);
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Award className="size-4" />}
      {t('Award')}
    </Button>
  );
}

export function RemoveQuoteButton({ rfqId, quoteId }: { rfqId: string; quoteId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={t('Remove quote')}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await removeQuote(rfqId, quoteId);
          if (!result.ok) toast.error(result.error ?? t('Could not remove it'));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </Button>
  );
}

export function CancelRfqButton({ rfqId }: { rfqId: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="destructive"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await cancelRfq(rfqId);
          if (!result.ok) toast.error(result.error ?? t('Could not cancel it'));
          router.refresh();
        })
      }
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
      {t('Cancel request')}
    </Button>
  );
}
