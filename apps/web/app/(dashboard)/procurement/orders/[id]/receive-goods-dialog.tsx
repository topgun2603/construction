'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { quantityToThousandths, thousandthsToQuantity } from '@sitebook/shared';
import { receiveGoods } from '@/lib/procurement-actions';
import type { PurchaseOrder } from '@/lib/procurement-types';
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

/**
 * Sign for a delivery against the order (a goods receipt). Pre-filled with what is still to come
 * on every line, because the common case is "it all came"; a short delivery is corrected down.
 * Catalogue materials are booked into the site's stock as they are received.
 */
export function ReceiveGoodsDialog({ order }: { order: PurchaseOrder }) {
  const { t } = useLanguage();
  const { todayIso } = useFormat();
  const router = useRouter();
  const outstanding = (line: PurchaseOrder['lines'][number]) =>
    thousandthsToQuantity(
      quantityToThousandths(line.quantity) - quantityToThousandths(line.received_quantity),
    );
  const open_lines = order.lines.filter((line) => quantityToThousandths(outstanding(line)) > 0n);

  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(open_lines.map((line) => [line.id, outstanding(line)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const lines = open_lines
      .map((line) => ({ po_line_id: line.id, quantity: (quantities[line.id] ?? '').trim() }))
      .filter((line) => line.quantity !== '' && Number(line.quantity) > 0);
    if (lines.length === 0) return setError(t('Enter what arrived on at least one line'));
    const ref = String(formData.get('ref') ?? '').trim();
    const note = String(formData.get('note') ?? '').trim();
    start(async () => {
      const result = await receiveGoods(order.id, {
        received_on: String(formData.get('received_on') ?? todayIso()),
        ...(ref ? { ref } : {}),
        ...(note ? { note } : {}),
        lines,
      });
      if (!result.ok) {
        setError(result.error ?? t('Could not record the delivery'));
        return;
      }
      toast.success(t('Delivery recorded and booked into stock'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="approve">
          <PackageCheck className="size-4" />
          {t('Receive goods')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle>
            {t('Receive goods')} · {order.number}
          </DialogTitle>
          <DialogDescription>
            {t('Count what actually came. Catalogue materials go into the site’s stock as you save.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {open_lines.map((line) => (
              <div
                key={line.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-btn border border-line-soft bg-raised px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{line.description}</span>
                  <span className="text-[12px] text-ink-muted">
                    {t('Ordered')} {line.quantity} · {t('received')} {line.received_quantity} · {t('to come')}{' '}
                    {outstanding(line)} {line.unit}
                    {!line.material_id && ` · ${t('not in the catalogue, so not booked into stock')}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    aria-label={`${t('Received')} ${line.description}`}
                    inputMode="decimal"
                    className="w-[110px] text-end font-mono"
                    value={quantities[line.id] ?? ''}
                    onChange={(event) =>
                      setQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                    }
                  />
                  <span className="w-[40px] text-[12px] text-ink-muted">{line.unit}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
            <Field label={t('Challan or delivery note number')} optional>
              <Input name="ref" maxLength={80} placeholder="CH-10482" />
            </Field>
            <Field label={t('Received on')}>
              <Input name="received_on" type="date" defaultValue={todayIso()} />
            </Field>
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
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Record delivery')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
