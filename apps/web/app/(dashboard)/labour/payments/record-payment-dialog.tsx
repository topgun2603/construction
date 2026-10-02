'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import { recordPayment } from '@/lib/actions';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { rupeesToPaiseString } from '@/lib/money-input';
import { todayIso } from '@/lib/format';
import type { Contractor, Worker } from '@/lib/api-types';
import { useLanguage } from '@/components/language-provider';

const HINTS: Record<string, string> = {
  advance: 'Deducted from this worker’s next wage period.',
  bonus: 'Added to what is owed on the next period.',
  deduction: 'Reduces what is owed on the next period.',
};

/**
 * Wage payments are deliberately absent from this form: they are recorded by the
 * wage period so the line totals stay in step, and the API rejects them here.
 */
export function RecordPaymentDialog({
  workers,
  contractors,
}: {
  workers: Worker[];
  contractors: Contractor[];
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'advance' | 'bonus' | 'deduction'>('advance');
  const [payeeKind, setPayeeKind] = useState<'worker' | 'contractor'>('worker');
  const [payeeId, setPayeeId] = useState('');
  const [mode, setMode] = useState('cash');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    if (!payeeId) {
      setError('Choose who this is for');
      return;
    }
    start(async () => {
      const result = await recordPayment({
        type,
        amount: rupeesToPaiseString(String(formData.get('amount') ?? '0')),
        paid_on: String(formData.get('paid_on') ?? todayIso()),
        mode,
        ...(payeeKind === 'worker' ? { worker_id: payeeId } : { contractor_id: payeeId }),
        note: String(formData.get('note') ?? '').trim() || undefined,
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not record the payment');
        return;
      }
      toast.success('Recorded');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <HandCoins /> {t('Record payment')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Record a payment')}</DialogTitle>
          <DialogDescription>{HINTS[type]}</DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Type')}>
              <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="advance">{t('Advance')}</SelectItem>
                  <SelectItem value="bonus">{t('Bonus')}</SelectItem>
                  <SelectItem value="deduction">{t('Deduction')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t('Amount (₹)')} htmlFor="amount">
              <Input id="amount" name="amount" required inputMode="decimal" placeholder="300" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('For')}>
              <Select
                value={payeeKind}
                onValueChange={(value) => {
                  setPayeeKind(value as typeof payeeKind);
                  setPayeeId('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">{t('A worker')}</SelectItem>
                  <SelectItem value="contractor">{t('A contractor')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={payeeKind === 'worker' ? t('Worker') : t('Contractor')}>
              <Select value={payeeId} onValueChange={setPayeeId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Choose')} />
                </SelectTrigger>
                <SelectContent>
                  {(payeeKind === 'worker' ? workers : contractors).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Paid on')} htmlFor="paid_on">
              <Input id="paid_on" name="paid_on" type="date" defaultValue={todayIso()} required />
            </Field>
            <Field label={t('Mode')}>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">{t('Cash')}</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank">{t('Bank transfer')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label={t('Note')} htmlFor="note">
            <Input id="note" name="note" placeholder={t('Optional')} />
          </Field>

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
              {pending ? 'Recording…' : t('Record')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
