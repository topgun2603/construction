'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ReceiptText } from 'lucide-react';
import { toast } from 'sonner';
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
import { useLanguage } from '@/components/language-provider';
import { bookEquipmentHire } from '@/lib/equipment-actions';

/**
 * The vendor's invoice matches the statement: book it. Each machine and site becomes an equipment
 * hire expense, and the cost report counts those instead of the hire worked out from the logs.
 */
export function BookHireButton({ vendorId, month, total }: { vendorId: string; month: string; total: string }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await bookEquipmentHire({
        vendor_id: vendorId,
        month,
        ...(reference.trim() ? { invoice_ref: reference.trim() } : {}),
      });
      if (!result.ok) return setError(result.error ?? t('Could not book the invoice'));
      toast.success(t('Invoice booked as expenses on each site'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <ReceiptText className="size-4" />
          {t('Book the invoice')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Book the invoice')}</DialogTitle>
          <DialogDescription>
            {t('Each machine and site becomes an equipment hire expense for')} {total}.{' '}
            {t('The cost report then counts the expenses, not the hire worked out here — never both.')}
          </DialogDescription>
        </DialogHeader>
        <Field label={t('Vendor’s invoice number')} htmlFor="hire-ref" optional>
          <Input id="hire-ref" value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} dir="ltr" />
        </Field>
        {error && <p className="text-[13px] text-blocked-fg">{error}</p>}
        <DialogFooter>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {t('Book')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
