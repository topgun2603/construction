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
          <HandCoins /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>{HINTS[type]}</DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">
              <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="advance">Advance</SelectItem>
                  <SelectItem value="bonus">Bonus</SelectItem>
                  <SelectItem value="deduction">Deduction</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Amount (₹)" htmlFor="amount">
              <Input id="amount" name="amount" required inputMode="decimal" placeholder="300" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="For">
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
                  <SelectItem value="worker">A worker</SelectItem>
                  <SelectItem value="contractor">A contractor</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={payeeKind === 'worker' ? 'Worker' : 'Contractor'}>
              <Select value={payeeId} onValueChange={setPayeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
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
            <Field label="Paid on" htmlFor="paid_on">
              <Input id="paid_on" name="paid_on" type="date" defaultValue={todayIso()} required />
            </Field>
            <Field label="Mode">
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="bank">Bank transfer</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="Note" htmlFor="note">
            <Input id="note" name="note" placeholder="Optional" />
          </Field>

          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Recording…' : 'Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
