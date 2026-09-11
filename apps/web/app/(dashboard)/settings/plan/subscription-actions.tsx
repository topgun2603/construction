'use client';

import { useState, useTransition } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cancelSubscription, startSubscription } from '@/lib/actions';
import type { Billing } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { longDate } from '@/lib/format';

/**
 * Cancelling, and retrying a failed payment.
 *
 * Cancelling always keeps access to the end of the paid period. There is no "cancel immediately"
 * button: the API supports it, but offering it on a settings page means somebody eventually clicks it
 * expecting to stop the next charge and instead switches off their own site staff mid-shift. Anyone
 * who genuinely wants that can be helped by support, having said so out loud.
 */
export function SubscriptionActions({
  billing,
  retry = false,
}: {
  billing: Billing;
  /** Renders the fix-your-card action rather than the cancel action. */
  retry?: boolean;
}) {
  const [pending, start] = useTransition();
  const [, setBusy] = useState(false);

  function resubscribe() {
    setBusy(true);
    start(async () => {
      const result = await startSubscription(billing.plan);
      setBusy(false);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? 'Could not start checkout');
        return;
      }
      if (result.data.checkout_url) {
        window.open(result.data.checkout_url, '_blank', 'noopener,noreferrer');
        toast.success('Checkout opened');
      } else {
        toast.success(
          result.data.dry_run
            ? 'Test mode: no checkout to open.'
            : 'Subscription restarted',
        );
      }
    });
  }

  if (retry) {
    return (
      <Button onClick={resubscribe} disabled={pending} size="sm">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
        Update payment
      </Button>
    );
  }

  // Nothing to cancel, so offer the way in rather than a dead button.
  if (billing.status === 'none' || billing.status === 'cancelled') {
    return (
      <Button onClick={resubscribe} disabled={pending} size="sm" variant="secondary">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
        {billing.status === 'cancelled' ? 'Subscribe again' : 'Set up payment'}
      </Button>
    );
  }

  if (billing.cancel_at) return null;

  return (
    <ConfirmDialog
      title="Cancel your subscription?"
      body={
        <>
          You keep everything until{' '}
          <strong className="font-semibold text-ink">
            {billing.current_period_end
              ? longDate(billing.current_period_end.slice(0, 10))
              : 'the end of the paid period'}
          </strong>
          , which is already paid for. After that the account moves to Starter and the Pro modules
          switch off — your data stays, including everything those modules recorded.
        </>
      }
      confirmLabel="Cancel subscription"
      successMessage="Cancelled — you keep access until the period ends"
      onConfirm={() => cancelSubscription(true)}
      trigger={
        <Button variant="ghost" size="sm">
          Cancel subscription
        </Button>
      }
    />
  );
}
