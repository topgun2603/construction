'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { BadgeIndianRupee, Check, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  createPaymentStage,
  deleteClientPayment,
  deletePaymentStage,
  recordClientPayment,
  updatePaymentStage,
} from '@/lib/actions';
import type {
  ClientPayment,
  Milestone,
  PaymentSchedule,
  PaymentStage,
} from '@/lib/api-types';
import { Badge, type Tone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { money, shortDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS: Record<PaymentStage['status'], { label: string; tone: Tone }> = {
  paid: { label: 'Paid', tone: 'done' },
  part_paid: { label: 'Part paid', tone: 'pending' },
  overdue: { label: 'Overdue', tone: 'blocked' },
  due: { label: 'Due', tone: 'pending' },
  upcoming: { label: 'Upcoming', tone: 'neutral' },
};

/**
 * What the client owes, and what has arrived.
 *
 * Every figure here comes from the server, worked out from the instalments and the receipts. There
 * is no stored balance anywhere, which is why the schedule and the money can never disagree.
 *
 * A client sees this read-only. It is the one money screen they get: the cost of *building* the
 * thing — labour, materials, petty cash — is a different part of the product they have no
 * permission to reach at all, and the difference between the two is the builder's margin.
 */
export function PaymentScheduleTab({
  projectId,
  schedule,
  receipts,
  milestones,
  canManage,
}: {
  projectId: string;
  schedule: PaymentSchedule;
  receipts: ClientPayment[];
  milestones: Milestone[];
  canManage: boolean;
}) {
  const scheduled = BigInt(schedule.totals.scheduled);
  const budget = schedule.totals.budget ? BigInt(schedule.totals.budget) : null;
  // A schedule that does not add up to the contract is one with an instalment missing from it.
  const unscheduled = budget !== null && budget > scheduled ? budget - scheduled : 0n;

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-5 p-4 sm:grid-cols-3">
        <Total label="Scheduled" value={schedule.totals.scheduled} />
        <Total label="Received" value={schedule.totals.received} tone="done" />
        <Total label="Outstanding" value={schedule.totals.outstanding} tone="pending" />
      </Card>

      {canManage && unscheduled > 0n && (
        <p className="rounded-btn bg-pending-bg px-3.5 py-2.5 text-[13px] text-pending-fg">
          The schedule adds up to {money(schedule.totals.scheduled)} against a contract of{' '}
          {money(schedule.totals.budget)} — {money(unscheduled.toString())} is not on it yet.
        </p>
      )}

      {BigInt(schedule.totals.unallocated) > 0n && (
        <p className="rounded-btn bg-neutral-bg px-3.5 py-2.5 text-[13px] text-ink-soft">
          {money(schedule.totals.unallocated)} has been received against no particular instalment.
          It counts towards the total either way.
        </p>
      )}

      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
          <StageDialog projectId={projectId} milestones={milestones} />
          <ReceiptDialog projectId={projectId} stages={schedule.items} />
        </div>
      )}

      {schedule.items.length === 0 ? (
        <EmptyState
          icon={<BadgeIndianRupee />}
          title="No payment schedule yet"
          body={
            canManage
              ? 'Break the contract into the instalments you will actually ask for — on signing, on the slab, on handover.'
              : 'Your builder has not published a payment schedule for this site yet.'
          }
        />
      ) : (
        <Card className="divide-y divide-line-soft">
          {schedule.items.map((stage) => (
            <StageRow key={stage.id} stage={stage} canManage={canManage} />
          ))}
        </Card>
      )}

      {receipts.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Received
          </h3>
          <Card className="divide-y divide-line-soft">
            {receipts.map((receipt) => (
              <ReceiptRow key={receipt.id} receipt={receipt} canManage={canManage} />
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone?: 'done' | 'pending' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12.5px] leading-tight text-ink-muted">{label}</span>
      <span
        className={cn(
          'font-mono text-[20px] font-bold leading-[1.1]',
          tone === 'done' && 'text-done',
          tone === 'pending' && BigInt(value) > 0n && 'text-pending-fg',
        )}
      >
        {money(value)}
      </span>
    </div>
  );
}

function StageRow({ stage, canManage }: { stage: PaymentStage; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = STATUS[stage.status];
  const partPaid = BigInt(stage.paid) > 0n && BigInt(stage.outstanding) > 0n;

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium">{stage.label}</span>
          <Badge tone={status.tone}>{status.label}</Badge>
          {stage.milestone && (
            <span
              className="text-[12px] text-ink-faint"
              title={stage.milestone.reached ? 'This stage has been reached' : 'Not reached yet'}
            >
              {stage.milestone.reached ? '✓ ' : ''}
              {stage.milestone.name}
            </span>
          )}
        </div>
        <span className="text-[12.5px] text-ink-muted">
          {stage.due_date ? `Due ${shortDate(stage.due_date)}` : 'No due date'}
          {partPaid && ` · ${money(stage.paid)} received`}
        </span>
      </div>

      <div className="flex flex-none flex-col items-end">
        <span className="font-mono text-[15px] font-semibold">{money(stage.amount)}</span>
        {BigInt(stage.outstanding) > 0n && BigInt(stage.paid) > 0n && (
          <span className="font-mono text-[12px] text-pending-fg">
            {money(stage.outstanding)} left
          </span>
        )}
      </div>

      {canManage && (
        <div className="flex flex-none items-center gap-1">
          {/* Asking for it is a deliberate act, and the server records when it happened. */}
          {!stage.raised_at && stage.status !== 'paid' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              title="Mark this as asked for"
              onClick={() =>
                start(async () => {
                  const result = await updatePaymentStage({
                    id: stage.id,
                    projectId: stage.project_id,
                    raised: true,
                  });
                  if (!result.ok) toast.error(result.error ?? 'Could not do that');
                  else {
                    toast.success(`${stage.label} marked as asked for`);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Raise
            </Button>
          )}
          <ConfirmDialog
            title="Remove this instalment?"
            body={
              <>
                <strong className="font-semibold text-ink">{stage.label}</strong> comes off the
                schedule, and the total the client owes drops by {money(stage.amount)}.
              </>
            }
            confirmLabel="Remove"
            successMessage="Removed"
            onConfirm={() => deletePaymentStage(stage.id, stage.project_id)}
            trigger={
              <Button size="icon" variant="ghost" aria-label={`Remove ${stage.label}`}>
                <Trash2 className="size-4" />
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

function ReceiptRow({ receipt, canManage }: { receipt: ClientPayment; canManage: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <Check className="size-4 flex-none text-done" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-medium">
          {receipt.stage_label ?? 'Against no particular instalment'}
        </span>
        <span className="text-[12.5px] text-ink-muted">
          {shortDate(receipt.received_on)} · {receipt.mode.toUpperCase()}
          {receipt.reference && ` · ${receipt.reference}`} · {receipt.recorded_by.name}
        </span>
      </div>
      <span className="flex-none font-mono text-[15px] font-semibold text-done">
        {money(receipt.amount)}
      </span>
      {canManage && (
        <ConfirmDialog
          title="Remove this receipt?"
          body={
            <>
              {money(receipt.amount)} comes off what the client is recorded as having paid. Do this
              only if it was entered by mistake.
            </>
          }
          confirmLabel="Remove receipt"
          successMessage="Removed"
          onConfirm={() => deleteClientPayment(receipt.id, receipt.project_id)}
          trigger={
            <Button size="icon" variant="ghost" aria-label="Remove receipt">
              <Trash2 className="size-4" />
            </Button>
          }
        />
      )}
    </div>
  );
}

/** Rupees in the box, paise on the wire. */
function toPaise(rupees: string): string | null {
  const trimmed = rupees.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

function StageDialog({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [milestoneId, setMilestoneId] = useState('none');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const paise = toPaise(amount);
    if (!label.trim()) return setError('Give it a name the client will recognise');
    if (!paise || paise === '0') return setError('Enter the amount in rupees, like 250000');
    setError(null);

    start(async () => {
      const result = await createPaymentStage({
        projectId,
        label: label.trim(),
        amount: paise,
        milestone_id: milestoneId === 'none' ? null : milestoneId,
        due_date: dueDate || null,
      });
      if (!result.ok) return setError(result.error ?? 'Could not add that');
      setOpen(false);
      setLabel('');
      setAmount('');
      setDueDate('');
      setMilestoneId('none');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus className="size-4" /> Add instalment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an instalment</DialogTitle>
          <DialogDescription>
            The client sees this, so name it the way you would say it to them.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="What it is for" htmlFor="stage-label">
            <Input
              id="stage-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={160}
              placeholder="On completion of the slab"
            />
          </Field>
          <Field label="Amount" htmlFor="stage-amount">
            <Input
              id="stage-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="2500000"
            />
          </Field>
          <Field label="Triggered by" hint="Optional. Links it to a stage on the timeline.">
            <Select value={milestoneId} onValueChange={setMilestoneId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nothing in particular</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Due" optional htmlFor="stage-due">
            <Input
              id="stage-due"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ projectId, stages }: { projectId: string; stages: PaymentStage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState<'cash' | 'upi' | 'bank'>('bank');
  const [stageId, setStageId] = useState('none');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const owing = stages.filter((stage) => BigInt(stage.outstanding) > 0n);

  function submit() {
    const paise = toPaise(amount);
    if (!paise || paise === '0') return setError('Enter the amount in rupees, like 250000');
    setError(null);

    start(async () => {
      const result = await recordClientPayment({
        projectId,
        amount: paise,
        received_on: receivedOn,
        mode,
        stage_id: stageId === 'none' ? null : stageId,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      if (!result.ok) return setError(result.error ?? 'Could not record that');
      setOpen(false);
      setAmount('');
      setReference('');
      setStageId('none');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <BadgeIndianRupee className="size-4" /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record money received</DialogTitle>
          <DialogDescription>
            Money from the client. Nothing to do with what the job costs to build.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="Amount" htmlFor="receipt-amount">
            <Input
              id="receipt-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="2500000"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Received on" htmlFor="receipt-date">
              <Input
                id="receipt-date"
                type="date"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
            </Field>
            <Field label="How">
              <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank transfer</SelectItem>
                  <SelectItem value="upi">UPI</SelectItem>
                  <SelectItem value="cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            label="Against"
            hint="Leave it unassigned if nobody has decided which instalment it was for."
          >
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No particular instalment</SelectItem>
                {owing.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {stage.label} — {money(stage.outstanding)} left
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Reference" optional htmlFor="receipt-ref">
            <Input
              id="receipt-ref"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={120}
              placeholder="UTR or cheque number"
            />
          </Field>
          {error && (
            <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
