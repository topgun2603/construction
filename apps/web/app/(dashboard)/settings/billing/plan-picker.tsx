'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { formatMoney } from '@sitebook/shared';
import type { BankTransferInvoice, BillingCatalogue } from '@/lib/billing-types';
import { requestBankTransfer, startPlanCheckout } from '@/lib/billing-actions';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';

const STATUS_TONE: Record<BankTransferInvoice['status'], Tone> = {
  pending: 'pending',
  paid: 'done',
  cancelled: 'neutral',
};

/**
 * The plans, each priced for this company, with the ways to pay for one.
 *
 * A quote is in the company's currency, or in US dollars with a note saying so, or "contact us" —
 * the screen never converts. Card checkout goes to Razorpay (rupees) or Stripe (everything else);
 * where a bank-transfer invoice is offered, each plan can be asked for that way instead.
 */
export function PlanPicker({
  catalogue,
  transfers,
}: {
  catalogue: BillingCatalogue;
  transfers: BankTransferInvoice[];
}) {
  const { t } = useLanguage();
  const { settings, shortDate } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');

  const price = (currency: string, amount: string) =>
    formatMoney(BigInt(amount), { currency, locale: settings.locale });
  const waiting = new Set(
    transfers.filter((invoice) => invoice.status === 'pending').map((invoice) => invoice.plan),
  );
  const planName = (code: string) =>
    catalogue.items.find((plan) => plan.code === code)?.name ?? code;

  function checkout(plan: string) {
    start(async () => {
      const result = await startPlanCheckout(plan);
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not start the checkout'));
        return;
      }
      if (result.data.checkout_url) {
        window.location.assign(result.data.checkout_url);
        return;
      }
      // No payment account on this deployment: nothing was charged, and nothing is pretended.
      toast.info(t('Card payments are not set up here yet — nothing was charged.'));
      router.refresh();
    });
  }

  function askForInvoice(plan: string) {
    start(async () => {
      const result = await requestBankTransfer({ plan, ...(note.trim() ? { note: note.trim() } : {}) });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? t('Could not request the invoice'));
        return;
      }
      toast.success(
        `${t('Invoice requested')}: ${result.data.number}. ${t('We will send the bank details shortly.')}`,
      );
      setNote('');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {catalogue.items.map((plan) => (
          <Card key={plan.code} className="flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold">{plan.name}</span>
                {plan.description && (
                  <span className="text-[13px] text-ink-muted">{plan.description}</span>
                )}
              </div>
              {plan.badge && <Badge tone="accent">{plan.badge}</Badge>}
            </div>

            {plan.quote ? (
              <div className="flex flex-col gap-0.5">
                <span className="font-mono text-[20px] font-semibold" dir="ltr">
                  {price(plan.quote.currency, plan.quote.amount)}
                </span>
                <span className="text-[12.5px] text-ink-muted">
                  {plan.months === null
                    ? t('One payment, never expires')
                    : plan.months === 1
                      ? t('For 1 month')
                      : `${t('For')} ${plan.months} ${t('months')}`}
                  {plan.quote.basis === 'fallback' &&
                    ` · ${t('Priced in US dollars — there is no price in your currency yet')}`}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[13.5px] text-ink-muted">
                <Mail className="size-4" />
                {t('Contact us for a price in your currency.')}
              </div>
            )}

            {plan.highlights.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 ps-5 text-[13px] text-ink-muted">
                {plan.highlights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}

            {plan.quote && (
              <div className="mt-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={() => checkout(plan.code)} disabled={pending}>
                  {t('Pay by card')}
                </Button>
                {catalogue.bank_transfer && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => askForInvoice(plan.code)}
                    disabled={pending || waiting.has(plan.code)}
                  >
                    <Landmark className="size-3.5" />
                    {waiting.has(plan.code)
                      ? t('Invoice requested')
                      : t('Request a bank-transfer invoice')}
                  </Button>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>

      {catalogue.bank_transfer && (
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              <Landmark className="size-3.5" />
              {t('Bank transfer')}
            </span>
            <span className="text-[13px] text-ink-muted">
              {t(
                'Ask for an invoice and pay it from your bank. Your plan starts as soon as we see the money arrive — usually within a working day.',
              )}
            </span>
          </div>
          <Field
            label={t('Anything for the invoice')}
            htmlFor="bank-transfer-note"
            optional
            hint={t('The name it should be made out to, or your purchase order number')}
          >
            <Input
              id="bank-transfer-note"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {transfers.length > 0 && (
            <ul className="flex flex-col divide-y divide-line-soft text-[13px]">
              {transfers.map((invoice) => (
                <li
                  key={invoice.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono font-medium" dir="ltr">
                      {invoice.number}
                    </span>
                    <span className="text-ink-muted">
                      {planName(invoice.plan)} · {shortDate(invoice.created_at.slice(0, 10))}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono" dir="ltr">
                      {price(invoice.currency, invoice.amount)}
                    </span>
                    <Badge tone={STATUS_TONE[invoice.status]}>{t(statusLabel(invoice.status))}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!catalogue.billing_configured && (
        <p className="text-[12.5px] text-ink-muted">
          {t('Card payments are not set up on this deployment yet; a checkout will not charge anything.')}
        </p>
      )}
    </div>
  );
}

function statusLabel(status: BankTransferInvoice['status']): string {
  switch (status) {
    case 'pending':
      return 'Waiting for payment';
    case 'paid':
      return 'Paid';
    default:
      return 'Cancelled';
  }
}
