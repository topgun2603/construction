'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { taxRule } from '@sitebook/shared';
import { saveQuote } from '@/lib/procurement-actions';
import type { Rfq, Vendor } from '@/lib/procurement-types';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
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
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import { percentToBp } from '../../status';

/**
 * Type in one supplier's prices for the RFQ. An item left blank is one they did not quote for —
 * the comparison shows the gap rather than treating it as free. Entering the same supplier again
 * replaces their quote.
 */
export function QuoteDialog({ rfq, vendors }: { rfq: Rfq; vendors: Vendor[] }) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const standard = taxRule(format.settings.taxRegime ?? 'none').standardRateBp;
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [rows, setRows] = useState<Record<string, { rate: string; tax: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function pickVendor(id: string) {
    setVendorId(id);
    // A supplier already quoted opens with their prices, so a correction is an edit, not a retype.
    const existing = rfq.quotes.find((quote) => quote.vendor.id === id);
    setRows(
      Object.fromEntries(
        rfq.items.map((item) => {
          const line = existing?.lines.find((row) => row.rfq_item_id === item.id);
          return [
            item.id,
            {
              rate: line ? minorToAmountInput(line.unit_rate, format.currencyDigits) : '',
              tax: line ? String(line.tax_rate_bp / 100) : standard === null ? '' : String(standard / 100),
            },
          ];
        }),
      ),
    );
  }

  function submit(formData: FormData) {
    setError(null);
    if (!vendorId) return setError(t('Pick a supplier'));
    const lines: Array<{ rfq_item_id: string; unit_rate: string; tax_rate_bp: number }> = [];
    for (const item of rfq.items) {
      const row = rows[item.id];
      if (!row || !row.rate.trim()) continue;
      const bp = percentToBp(row.tax);
      if (Number.isNaN(bp)) return setError(`${item.description}: ${t('the tax is not a percentage')}`);
      try {
        lines.push({
          rfq_item_id: item.id,
          unit_rate: amountToMinorString(row.rate, format.currencyDigits, format.currencySymbol),
          tax_rate_bp: bp,
        });
      } catch {
        return setError(`${item.description}: ${t('the rate is not an amount')}`);
      }
    }
    if (lines.length === 0) return setError(t('Enter a price for at least one item'));
    const days = String(formData.get('delivery_days') ?? '').trim();
    const validUntil = String(formData.get('valid_until') ?? '').trim();
    const notes = String(formData.get('notes') ?? '').trim();
    start(async () => {
      const result = await saveQuote(rfq.id, {
        vendor_id: vendorId,
        delivery_days: days ? Number(days) : null,
        valid_until: validUntil || null,
        notes: notes || null,
        lines,
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not save the quote'));
        return;
      }
      toast.success(t('Quote saved'));
      setOpen(false);
      setVendorId('');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {t('Enter a quote')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{t('Enter a supplier’s quote')}</DialogTitle>
          <DialogDescription>
            {t('Rates before tax, per unit. Leave an item blank if they did not quote for it.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <Field label={t('Supplier')}>
            <Select value={vendorId} onValueChange={pickVendor}>
              <SelectTrigger aria-label={t('Supplier')}>
                <SelectValue placeholder={t('Pick a supplier')} />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {vendorId && (
            <div className="flex flex-col gap-2">
              {rfq.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-btn border border-line-soft bg-raised px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{item.description}</span>
                    <span className="text-[12px] text-ink-muted">
                      {item.quantity} {item.unit}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Input
                      aria-label={`${t('Rate')} ${item.description}`}
                      inputMode="decimal"
                      placeholder={`${t('Rate')} (${format.currencySymbol})`}
                      className="w-[130px] text-end font-mono"
                      value={rows[item.id]?.rate ?? ''}
                      onChange={(event) =>
                        setRows((current) => ({
                          ...current,
                          [item.id]: { tax: current[item.id]?.tax ?? '', rate: event.target.value },
                        }))
                      }
                    />
                    <Input
                      aria-label={`${t('Tax %')} ${item.description}`}
                      inputMode="decimal"
                      placeholder={t('Tax %')}
                      className="w-[80px] text-end font-mono"
                      value={rows[item.id]?.tax ?? ''}
                      onChange={(event) =>
                        setRows((current) => ({
                          ...current,
                          [item.id]: { rate: current[item.id]?.rate ?? '', tax: event.target.value },
                        }))
                      }
                    />
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('Delivery in (days)')} optional>
              <Input name="delivery_days" inputMode="numeric" />
            </Field>
            <Field label={t('Valid until')} optional>
              <Input name="valid_until" type="date" />
            </Field>
          </div>
          <Field label={t('Note')} optional>
            <Textarea name="notes" rows={2} maxLength={2000} />
          </Field>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save quote')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
