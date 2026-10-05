'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PAYMENT_MODE_LABELS, paymentModesFor, type PaymentMode } from '@sitebook/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { ActionResult } from '@/lib/server-api';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import type { PaymentInput } from '@/lib/subcontract-actions';

/**
 * An amount, a date, and — for money handed over — how it was paid. One dialog for paying a bill,
 * the advance or released retention, and (with `withMode` off) for releasing retention, so they all
 * read and check the same way.
 */
export function AmountDialog({
  trigger,
  title,
  description,
  suggested,
  max,
  withMode = true,
  confirmLabel,
  onSubmit,
}: {
  trigger: ReactNode;
  title: string;
  description: string;
  /** Minor units, pre-filled. */
  suggested?: string;
  /** Minor units; more is refused here before the API refuses it. */
  max?: string;
  withMode?: boolean;
  confirmLabel: string;
  onSubmit: (input: PaymentInput) => Promise<ActionResult>;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PaymentMode>('bank');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    let amount: string;
    try {
      amount = amountToMinorString(String(formData.get('amount') ?? ''), format.currencyDigits, format.currencySymbol);
    } catch {
      setError(t('Enter the amount as a number, like 25000'));
      return;
    }
    if (BigInt(amount) <= 0n) {
      setError(t('Enter an amount more than zero'));
      return;
    }
    if (max !== undefined && BigInt(amount) > BigInt(max)) {
      setError(`${t('At most')} ${format.money(max)}`);
      return;
    }
    const reference = String(formData.get('reference') ?? '').trim();
    start(async () => {
      const result = await onSubmit({
        amount,
        paid_on: String(formData.get('date')),
        mode,
        ...(reference ? { reference } : {}),
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not save that'));
        return;
      }
      toast.success(t('Saved'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={`${t('Amount')} (${format.currencySymbol})`} htmlFor="pay-amount">
              <Input
                id="pay-amount"
                name="amount"
                inputMode="decimal"
                dir="ltr"
                className="font-mono"
                defaultValue={suggested ? minorToAmountInput(suggested, format.currencyDigits) : ''}
                required
              />
            </Field>
            <Field label={t('Date')} htmlFor="pay-date">
              <Input id="pay-date" name="date" type="date" defaultValue={format.todayIso()} required />
            </Field>
          </div>
          {withMode && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Paid by')}>
                <Select value={mode} onValueChange={(value) => setMode(value as PaymentMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentModesFor(format.settings.country).map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(PAYMENT_MODE_LABELS[option])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t('Reference')} htmlFor="pay-ref" optional>
                <Input id="pay-ref" name="reference" maxLength={120} placeholder="UTR / cheque no." />
              </Field>
            </div>
          )}
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
