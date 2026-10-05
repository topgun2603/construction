'use client';

import {
  PAYMENT_MODE_LABELS,
  paymentModesFor,
  taxOnTop,
  taxRule,
  type PaymentMode,
} from '@sitebook/shared';
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
import { cn } from '@/lib/utils';
import { minorToAmountInput } from '@/lib/money-input';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';

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
  const { t } = useLanguage();
  const { money } = useFormat();
  const scheduled = BigInt(schedule.totals.scheduled);
  const budget = schedule.totals.budget ? BigInt(schedule.totals.budget) : null;
  // A schedule that does not add up to the contract is one with an instalment missing from it.
  const unscheduled = budget !== null && budget > scheduled ? budget - scheduled : 0n;

  return (
    <div className="flex flex-col gap-4">
      <Card className="grid gap-5 p-4 sm:grid-cols-3">
        <Total label={t('Scheduled')} value={schedule.totals.scheduled} />
        <Total label={t('Received')} value={schedule.totals.received} tone="done" />
        <Total label={t('Outstanding')} value={schedule.totals.outstanding} tone="pending" />
      </Card>

      {canManage && unscheduled > 0n && (
        <p className="rounded-btn bg-pending-bg px-3.5 py-2.5 text-[13px] text-pending-fg">
          {t('The schedule adds up to')} {money(schedule.totals.scheduled)} against a contract of{' '}
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
          title={t('No payment schedule yet')}
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
            {t('Received')}
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
  const { money } = useFormat();
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
  const { t } = useLanguage();
  const { money, shortDate, settings } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const status = STATUS[stage.status];
  const partPaid = BigInt(stage.paid) > 0n && BigInt(stage.outstanding) > 0n;
  // VAT is charged on top, so the client is asked for the total; the breakdown sits under it.
  const taxed = BigInt(stage.tax_amount) > 0n;
  const taxName = taxRule(settings.taxRegime ?? 'none').taxName ?? t('Tax');

  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-medium">{t(stage.label)}</span>
          <Badge tone={status.tone}>{t(status.label)}</Badge>
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
        <span className="font-mono text-[15px] font-semibold">
          {money(taxed ? stage.total : stage.amount)}
        </span>
        {taxed && (
          <span className="font-mono text-[12px] text-ink-muted">
            {money(stage.amount)} + {taxName} {money(stage.tax_amount)}
          </span>
        )}
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
              title={t('Mark this as asked for')}
              onClick={() =>
                start(async () => {
                  const result = await updatePaymentStage({
                    id: stage.id,
                    projectId: stage.project_id,
                    raised: true,
                  });
                  if (!result.ok) toast.error(result.error ?? 'Could not do that');
                  else {
                    toast.success(`${t(stage.label)} marked as asked for`);
                    router.refresh();
                  }
                })
              }
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t('Raise')}
            </Button>
          )}
          <ConfirmDialog
            title={t('Remove this instalment?')}
            body={
              <>
                <strong className="font-semibold text-ink">{t(stage.label)}</strong> comes off the
                schedule, and the total the client owes drops by {money(stage.total)}.
              </>
            }
            confirmLabel={t('Remove')}
            successMessage="Removed"
            onConfirm={() => deletePaymentStage(stage.id, stage.project_id)}
            trigger={
              <Button size="icon" variant="ghost" aria-label={`Remove ${t(stage.label)}`}>
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
  const { t } = useLanguage();
  const { money, shortDate } = useFormat();
  return (
    <div className="flex flex-wrap items-center gap-4 p-4">
      <Check className="size-4 flex-none text-done" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-medium">
          {receipt.stage_label ?? 'Against no particular instalment'}
        </span>
        <span className="text-[12.5px] text-ink-muted">
          {shortDate(receipt.received_on)} · {t(PAYMENT_MODE_LABELS[receipt.mode as PaymentMode] ?? receipt.mode)}
          {receipt.reference && ` · ${receipt.reference}`} · {receipt.recorded_by.name}
        </span>
      </div>
      <span className="flex-none font-mono text-[15px] font-semibold text-done">
        {money(receipt.amount)}
      </span>
      {canManage && (
        <ConfirmDialog
          title={t('Remove this receipt?')}
          body={
            <>
              {money(receipt.amount)} comes off what the client is recorded as having paid. Do this
              only if it was entered by mistake.
            </>
          }
          confirmLabel={t('Remove receipt')}
          successMessage="Removed"
          onConfirm={() => deleteClientPayment(receipt.id, receipt.project_id)}
          trigger={
            <Button size="icon" variant="ghost" aria-label={t('Remove receipt')}>
              <Trash2 className="size-4" />
            </Button>
          }
        />
      )}
    </div>
  );
}

/** Major units in the box, minor units on the wire — `digits` is the currency's, 2 for rupees. */
function toPaise(rupees: string, digits = 2): string | null {
  const trimmed = rupees.trim().replace(/,/g, '');
  const fraction = digits > 0 ? `(\\.\\d{1,${digits}})?` : '';
  if (!new RegExp(`^\\d+${fraction}$`).test(trimmed)) return null;
  const [whole, part = ''] = trimmed.split('.');
  const minor = BigInt(part.padEnd(digits, '0') || '0');
  return (BigInt(whole!) * 10n ** BigInt(digits) + minor).toString();
}

function StageDialog({ projectId, milestones }: { projectId: string; milestones: Milestone[] }) {
  const { t } = useLanguage();
  const { currencyDigits, settings } = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('');
  // VAT goes on top of an instalment; a regime without one (or GST, with no single rate) gets the
  // field without the shortcut, and no tax at all gets neither.
  const rule = taxRule(settings.taxRegime ?? 'none');
  const rate = rule.standardRateBp;
  const [milestoneId, setMilestoneId] = useState('none');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const paise = toPaise(amount, currencyDigits);
    if (!label.trim()) return setError('Give it a name the client will recognise');
    if (!paise || paise === '0') return setError('Enter the amount in rupees, like 250000');
    const taxPaise = rule.taxName && tax.trim() ? toPaise(tax, currencyDigits) : null;
    if (rule.taxName && tax.trim() && taxPaise === null) {
      return setError(`${t('Enter the')} ${rule.taxName} ${t('as an amount, like 50')}`);
    }
    setError(null);

    start(async () => {
      const result = await createPaymentStage({
        projectId,
        label: label.trim(),
        amount: paise,
        ...(taxPaise && taxPaise !== '0' ? { tax_amount: taxPaise } : {}),
        milestone_id: milestoneId === 'none' ? null : milestoneId,
        due_date: dueDate || null,
      });
      if (!result.ok) return setError(result.error ?? 'Could not add that');
      setOpen(false);
      setLabel('');
      setAmount('');
      setTax('');
      setDueDate('');
      setMilestoneId('none');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus className="size-4" /> {t('Add instalment')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Add an instalment')}</DialogTitle>
          <DialogDescription>
            {t('The client sees this, so name it the way you would say it to them.')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t('What it is for')} htmlFor="stage-label">
            <Input
              id="stage-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={160}
              placeholder={t('On completion of the slab')}
            />
          </Field>
          <Field label={t('Amount')} htmlFor="stage-amount">
            <Input
              id="stage-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="2500000"
            />
          </Field>
          {rule.taxName && (
            <Field
              label={`${rule.taxName} ${t('on top')}`}
              htmlFor="stage-tax"
              optional
              hint={t('Charged in addition to the amount; the client is asked for both.')}
            >
              <div className="flex gap-2">
                <Input
                  id="stage-tax"
                  value={tax}
                  onChange={(event) => setTax(event.target.value)}
                  inputMode="decimal"
                  placeholder="125000"
                />
                {rate !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const net = toPaise(amount, currencyDigits);
                      if (!net || net === '0') return setError(t('Enter the amount first'));
                      setError(null);
                      setTax(
                        minorToAmountInput(
                          taxOnTop(BigInt(net), rate).toString(),
                          currencyDigits,
                        ),
                      );
                    }}
                  >
                    {t('Add')} {rate / 100}%
                  </Button>
                )}
              </div>
            </Field>
          )}
          <Field label={t('Triggered by')} hint={t('Optional. Links it to a stage on the timeline.')}>
            <Select value={milestoneId} onValueChange={setMilestoneId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('Nothing in particular')}</SelectItem>
                {milestones.map((milestone) => (
                  <SelectItem key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Due')} optional htmlFor="stage-due">
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
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} {t('Add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReceiptDialog({ projectId, stages }: { projectId: string; stages: PaymentStage[] }) {
  const { t } = useLanguage();
  const { money, currencyDigits, todayIso, settings } = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [receivedOn, setReceivedOn] = useState(() => todayIso());
  const [mode, setMode] = useState<PaymentMode>('bank');
  const [stageId, setStageId] = useState('none');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const owing = stages.filter((stage) => BigInt(stage.outstanding) > 0n);

  function submit() {
    const paise = toPaise(amount, currencyDigits);
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
          <BadgeIndianRupee className="size-4" /> {t('Record payment')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Record money received')}</DialogTitle>
          <DialogDescription>
            {t('Money from the client. Nothing to do with what the job costs to build.')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t('Amount')} htmlFor="receipt-amount">
            <Input
              id="receipt-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="2500000"
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Received on')} htmlFor="receipt-date">
              <Input
                id="receipt-date"
                type="date"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
              />
            </Field>
            <Field label={t('How')}>
              <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {paymentModesFor(settings.country).map((option) => (
                    <SelectItem key={option} value={option}>
                      {t(PAYMENT_MODE_LABELS[option])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field
            label={t('Against')}
            hint={t('Leave it unassigned if nobody has decided which instalment it was for.')}
          >
            <Select value={stageId} onValueChange={setStageId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('No particular instalment')}</SelectItem>
                {owing.map((stage) => (
                  <SelectItem key={stage.id} value={stage.id}>
                    {t(stage.label)} — {money(stage.outstanding)} left
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Reference')} optional htmlFor="receipt-ref">
            <Input
              id="receipt-ref"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              maxLength={120}
              placeholder={t('UTR or cheque number')}
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
            {t('Cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} {t('Record')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
