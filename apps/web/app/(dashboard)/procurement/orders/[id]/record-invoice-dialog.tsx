'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Loader2, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { orderLineAmount, quantityToThousandths, taxOnTop, thousandthsToQuantity } from '@sitebook/shared';
import { presignUpload } from '@/lib/actions';
import { recordPurchaseInvoice } from '@/lib/procurement-actions';
import type { PurchaseOrder } from '@/lib/procurement-types';
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
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';

interface Row {
  include: boolean;
  quantity: string;
  rate: string;
  tax: string;
}

/**
 * Enter a supplier's invoice against the order. Pre-filled with what has been received and not yet
 * billed, at the order's rates and tax — so the common case, an invoice that matches, is a number
 * and a date. Whatever is typed is matched three ways when it is saved.
 */
export function RecordInvoiceDialog({ order }: { order: PurchaseOrder }) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const digits = format.currencyDigits;

  const unbilled = (line: PurchaseOrder['lines'][number]) => {
    const left = quantityToThousandths(line.received_quantity) - quantityToThousandths(line.billed_quantity);
    return left > 0n ? thousandthsToQuantity(left) : '0';
  };

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>(() =>
    Object.fromEntries(
      order.lines.map((line) => {
        const quantity = unbilled(line);
        const rate = line.unit_rate ?? '0';
        const tax = taxOnTop(orderLineAmount(quantity, BigInt(rate)), line.tax_rate_bp);
        return [
          line.id,
          {
            include: quantity !== '0',
            quantity,
            rate: minorToAmountInput(rate, digits),
            tax: minorToAmountInput(tax.toString(), digits),
          },
        ];
      }),
    ),
  );
  const [attachment, setAttachment] = useState<{ key: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function patch(id: string, change: Partial<Row>) {
    setRows((current) => ({ ...current, [id]: { ...current[id]!, ...change } }));
  }

  async function attach(file: File) {
    setError(null);
    setUploading(true);
    try {
      const presigned = await presignUpload({
        kind: 'bill',
        content_type: file.type || 'application/pdf',
        content_length: file.size,
        project_id: order.project_id,
      });
      if (!presigned.ok || !presigned.data) {
        setError(presigned.error ?? t('Could not prepare the upload'));
        return;
      }
      const put = await fetch(presigned.data.url, {
        method: 'PUT',
        headers: presigned.data.headers,
        body: file,
      });
      if (!put.ok) {
        setError(t('The upload failed'));
        return;
      }
      setAttachment({ key: presigned.data.s3_key, name: file.name });
    } finally {
      setUploading(false);
    }
  }

  function submit(formData: FormData) {
    setError(null);
    const number = String(formData.get('invoice_number') ?? '').trim();
    if (!number) return setError(t('Enter the invoice number'));
    const lines: Array<{ po_line_id: string; quantity: string; unit_rate: string; tax_amount: string }> = [];
    for (const line of order.lines) {
      const row = rows[line.id];
      if (!row?.include) continue;
      try {
        lines.push({
          po_line_id: line.id,
          quantity: row.quantity.trim(),
          unit_rate: amountToMinorString(row.rate, digits, format.currencySymbol),
          tax_amount: amountToMinorString(row.tax, digits, format.currencySymbol),
        });
      } catch {
        return setError(`${line.description}: ${t('an amount is not a number')}`);
      }
    }
    if (lines.length === 0) return setError(t('Include at least one line'));
    const due = String(formData.get('due_date') ?? '').trim();
    const note = String(formData.get('note') ?? '').trim();
    start(async () => {
      const result = await recordPurchaseInvoice(order.id, {
        invoice_number: number,
        invoice_date: String(formData.get('invoice_date') ?? format.todayIso()),
        ...(due ? { due_date: due } : {}),
        ...(attachment ? { attachment_s3_key: attachment.key } : {}),
        ...(note ? { note } : {}),
        lines,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not record the invoice'));
        return;
      }
      toast.success(result.data.status === 'matched' ? t('Invoice matches the order') : t('Invoice recorded — it does not match'));
      setOpen(false);
      router.push(`/procurement/invoices/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <FileText className="size-4" />
          {t('Record invoice')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <DialogTitle>
            {t('Supplier invoice')} · {order.number}
          </DialogTitle>
          <DialogDescription>
            {t('Filled in with what was received and not yet billed. Change it to what the invoice says; it is checked against the order and the deliveries when you save.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('Invoice number')}>
              <Input name="invoice_number" maxLength={60} />
            </Field>
            <Field label={t('Invoice date')}>
              <Input name="invoice_date" type="date" defaultValue={format.todayIso()} />
            </Field>
            <Field label={t('Due date')} optional>
              <Input name="due_date" type="date" />
            </Field>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-[11.5px] uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-2 py-1.5 text-start font-semibold">{t('Line')}</th>
                  <th className="px-2 py-1.5 text-end font-semibold">{t('Qty')}</th>
                  <th className="px-2 py-1.5 text-end font-semibold">
                    {t('Rate')} ({format.currencySymbol})
                  </th>
                  <th className="px-2 py-1.5 text-end font-semibold">
                    {t('Tax')} ({format.currencySymbol})
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((line) => {
                  const row = rows[line.id]!;
                  return (
                    <tr key={line.id} className="border-t border-line-soft">
                      <td className="px-2 py-1.5">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(event) => patch(line.id, { include: event.target.checked })}
                          />
                          <span className="flex flex-col">
                            <span className="font-medium">{line.description}</span>
                            <span className="text-[11.5px] text-ink-muted">
                              {t('received')} {line.received_quantity} · {t('billed')} {line.billed_quantity} {line.unit}
                            </span>
                          </span>
                        </label>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          aria-label={t('Quantity')}
                          inputMode="decimal"
                          className="ms-auto w-[90px] text-end font-mono"
                          value={row.quantity}
                          disabled={!row.include}
                          onChange={(event) => patch(line.id, { quantity: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          aria-label={t('Rate')}
                          inputMode="decimal"
                          className="ms-auto w-[110px] text-end font-mono"
                          value={row.rate}
                          disabled={!row.include}
                          onChange={(event) => patch(line.id, { rate: event.target.value })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          aria-label={t('Tax')}
                          inputMode="decimal"
                          className="ms-auto w-[110px] text-end font-mono"
                          value={row.tax}
                          disabled={!row.include}
                          onChange={(event) => patch(line.id, { tax: event.target.value })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 py-2 text-[13px] font-medium hover:bg-raised">
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
              {attachment ? attachment.name : t('Attach the invoice')}
              <input
                type="file"
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void attach(file);
                }}
              />
            </label>
            <span className="text-[12px] text-ink-muted">{t('A photo or a PDF. Optional.')}</span>
          </div>

          <Field label={t('Note')} optional>
            <Textarea name="note" rows={2} maxLength={1000} />
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
            <Button type="submit" disabled={pending || uploading}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Record and match')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
