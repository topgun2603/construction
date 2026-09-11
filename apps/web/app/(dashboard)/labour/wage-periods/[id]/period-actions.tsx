'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BadgeCheck, Banknote, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  discardWagePeriod,
  finaliseWagePeriod,
  payWagePeriod,
  reopenWagePeriod,
} from '@/lib/actions';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { money, shortDate, todayIso } from '@/lib/format';
import type { WagePeriodDetail } from '@/lib/api-types';

/**
 * Finalising and paying both move something that is hard to move back, so each confirms first
 * and says plainly what it does — finalise locks a week of attendance, and paying moves cash.
 *
 * Discard and reopen are the ways out. They exist because the nightly job drafts periods
 * unattended: a sheet nobody asked for has to be removable, and one finalised by mistake has to
 * be recoverable. Both are offered only in the state where they are safe — discard while open,
 * reopen while finalised and unpaid — so the dangerous version is never on screen to click.
 */
export function PeriodActions({
  period,
  outstanding,
}: {
  period: WagePeriodDetail;
  outstanding: string;
}) {
  const router = useRouter();
  const [confirmFinalise, setConfirmFinalise] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [mode, setMode] = useState('cash');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const nothingToPay = BigInt(outstanding) <= 0n;

  function finalise() {
    setError(null);
    start(async () => {
      const result = await finaliseWagePeriod(period.id);
      if (!result.ok) {
        setError(result.error ?? 'Could not finalise');
        return;
      }
      toast.success('Period finalised — attendance for this range is now locked');
      setConfirmFinalise(false);
      router.refresh();
    });
  }

  function pay(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await payWagePeriod(period.id, {
        paid_on: String(formData.get('paid_on') ?? todayIso()),
        mode,
        reference: String(formData.get('reference') ?? '').trim() || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? 'Could not record the payment');
        return;
      }
      toast.success(`Paid ${money(outstanding)} to ${period.contractor_name}`);
      setPayOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {period.status === 'open' && (
        <Button onClick={() => setConfirmFinalise(true)} disabled={period.lines.length === 0}>
          <BadgeCheck /> Finalise
        </Button>
      )}
      {period.status === 'finalised' && (
        <Button variant="approve" onClick={() => setPayOpen(true)} disabled={nothingToPay}>
          <Banknote /> Pay {money(outstanding)}
        </Button>
      )}

      {/* The way out of a draft nobody wanted. Open only — once finalised, reopen first. */}
      {period.status === 'open' && (
        <ConfirmDialog
          title="Discard this draft?"
          body={
            <>
              The sheet for {shortDate(period.period_start)} – {shortDate(period.period_end)} is
              removed. Attendance and advances are untouched, and you can generate it again for
              the same dates whenever you like.
            </>
          }
          confirmLabel="Discard draft"
          successMessage="Draft discarded"
          onConfirm={() => discardWagePeriod(period.id)}
          trigger={<Button variant="destructive">Discard</Button>}
        />
      )}

      {/*
        Reopening is offered only while nothing has been paid, which is the only state it is safe
        in — the API refuses otherwise, and a button that exists to produce an error is worse than
        no button.
      */}
      {period.status === 'finalised' && BigInt(period.total_paid) === 0n && (
        <ConfirmDialog
          title="Reopen this period?"
          body={
            <>
              Attendance between {shortDate(period.period_start)} and{' '}
              {shortDate(period.period_end)} unlocks so you can correct it, and any advances this
              sheet deducted go back to being outstanding. Nothing has been paid yet, so no cash
              is affected.
            </>
          }
          confirmLabel="Reopen period"
          successMessage="Period reopened — attendance is editable again"
          onConfirm={() => reopenWagePeriod(period.id).then((r) => ({ ok: r.ok, error: r.error }))}
          trigger={
            <Button variant="secondary">
              <RotateCcw className="size-4" /> Reopen
            </Button>
          }
        />
      )}

      <Dialog open={confirmFinalise} onOpenChange={setConfirmFinalise}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Finalise this period?</DialogTitle>
            <DialogDescription>
              This freezes {period.lines.length} wage lines and locks attendance between{' '}
              {shortDate(period.period_start)} and {shortDate(period.period_end)}. Corrections
              after this have to go in the next period as a bonus or deduction.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmFinalise(false)}>
              Cancel
            </Button>
            <Button onClick={finalise} disabled={pending}>
              {pending ? 'Finalising…' : 'Finalise'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              Settles everything outstanding on this period — {money(outstanding)} across{' '}
              {period.lines.filter((line) => BigInt(line.outstanding) > 0n).length} workers.
            </DialogDescription>
          </DialogHeader>

          <form action={pay} className="flex flex-col gap-4">
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
            <Field label="Reference" htmlFor="reference" hint="UTR or voucher number, optional">
              <Input id="reference" name="reference" />
            </Field>

            {error && (
              <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setPayOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="approve" disabled={pending}>
                {pending ? 'Recording…' : `Pay ${money(outstanding)}`}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
