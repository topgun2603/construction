'use client';

import { useState, useTransition } from 'react';
import { Loader2, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import { amendIndentReceipt, receiveIndent } from '@/lib/actions';
import type { Indent } from '@/lib/api-types';
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

/**
 * Receiving a delivery, counted line by line.
 *
 * Not a single "mark received" button, which is what this used to be. 40 bags ordered and 37
 * delivered is the commonest thing that happens to a site order and the easiest money to lose,
 * and one button assumes it away — it books the ordered quantity into stock whether or not that
 * is what arrived.
 *
 * Each line starts at the quantity ordered, because most of the time that is what turned up; the
 * person checking only has to change the ones that differ.
 */
export function ReceiveDialog({ indent, amend = false }: { indent: Indent; amend?: boolean }) {
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      indent.items.map((item) => [
        item.material_id,
        amend ? item.received_quantity : item.quantity,
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const short = indent.items.filter(
    (item) => Number(quantities[item.material_id] ?? '0') < Number(item.quantity),
  );

  function submit(formData: FormData) {
    setError(null);
    const items = indent.items.map((item) => ({
      material_id: item.material_id,
      received_quantity: (quantities[item.material_id] ?? '0').trim() || '0',
    }));

    start(async () => {
      const note = String(formData.get('note') ?? '').trim();
      const result = amend
        ? await amendIndentReceipt({ id: indent.id, items, ...(note ? { ref: note } : {}) })
        : await receiveIndent({ id: indent.id, items, ...(note ? { note } : {}) });

      if (!result.ok) {
        setError(result.error ?? 'Could not record that');
        return;
      }
      toast.success(amend ? 'Delivery corrected' : 'Delivery recorded and stock booked in');
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {amend ? (
          <Button variant="ghost" size="sm">
            Correct the count
          </Button>
        ) : (
          <Button variant="approve" size="sm">
            <PackageCheck className="size-4" />
            Received
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{amend ? 'Correct what arrived' : 'What actually arrived?'}</DialogTitle>
          <DialogDescription>
            {amend
              ? 'The delivery stays received; only the counts change. Stock is adjusted to match.'
              : 'Each line starts at the quantity ordered. Change the ones that differ — what you enter here is what goes onto the site stock.'}
          </DialogDescription>
        </DialogHeader>

        <form action={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {indent.items.map((item) => {
              const entered = quantities[item.material_id] ?? '';
              const isShort = Number(entered || '0') < Number(item.quantity);
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-btn bg-raised px-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[14px] font-medium">{item.material_name}</span>
                    <span className="font-mono text-[12px] text-ink-muted">
                      {item.quantity} {item.unit} ordered
                    </span>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <Input
                      value={entered}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.material_id]: event.target.value,
                        }))
                      }
                      inputMode="decimal"
                      className="h-9 w-[100px] text-right font-mono"
                      aria-label={`Received ${item.material_name}`}
                    />
                    <span className="w-10 text-[12.5px] text-ink-muted">{item.unit}</span>
                  </div>
                  {isShort && (
                    <span className="w-full text-[12px] text-pending-fg">
                      Short by {Number(item.quantity) - Number(entered || '0')} {item.unit}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {short.length > 0 && (
            <p className="rounded-btn bg-pending-bg px-3 py-2 text-[12.5px] leading-snug text-pending-fg">
              {short.length} {short.length === 1 ? 'line is' : 'lines are'} short of what was
              ordered. Only what you enter is booked into stock, so the shortfall stays visible
              against the order rather than disappearing into it.
            </p>
          )}

          <Field
            label={amend ? 'Corrected challan number' : 'Challan or bill number'}
            hint="Optional"
          >
            <Input name="note" maxLength={80} placeholder="CH-10482" />
          </Field>

          {error && (
            <p
              role="alert"
              className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" variant={amend ? 'primary' : 'approve'} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {amend ? 'Save counts' : 'Book in'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
