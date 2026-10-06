'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { mudadBankForIban, mudadIbanValid, type PayBasis } from '@sitebook/shared';
import type { Worker } from '@/lib/api-types';
import { updateWorkerPay } from '@/lib/actions';
import { amountToMinorString, minorToAmountInput } from '@/lib/money-input';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AllowanceFields, WpsFields } from '../add-worker-dialog';

/**
 * How a worker is paid (roadmap Phase 1, item 2): by the day, or a monthly salary with its
 * allowances. For a UAE company it also holds the three details a WPS salary file needs, and says
 * plainly when any is missing — a worker without them is left out of the file.
 */
export function WorkerPay({ worker, canManage }: { worker: Worker; canManage: boolean }) {
  const { t } = useLanguage();
  const { money, settings } = useFormat();
  const monthly = worker.pay_basis === 'monthly';
  const uae = settings.country === 'AE';
  const saudi = settings.country === 'SA';
  const wpsComplete = Boolean(worker.wps_person_id && worker.wps_agent_code && worker.wps_account);
  // Saudi WPS (Mudad) needs the IBAN here; the Iqama or national ID comes from the worker's papers.
  const ibanValid = Boolean(worker.wps_account && mudadIbanValid(worker.wps_account));
  const saudiBank = worker.wps_account ? mudadBankForIban(worker.wps_account) : undefined;

  const monthlyTotal =
    BigInt(worker.basic_salary ?? '0') +
    BigInt(worker.housing_allowance) +
    BigInt(worker.transport_allowance) +
    BigInt(worker.food_allowance);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <Wallet className="size-3.5" />
          {t('Pay')}
        </span>
        <div className="flex items-center gap-1.5">
          <Badge tone="neutral" dot={false}>
            {monthly ? t('Monthly salary') : t('Daily wage')}
          </Badge>
          {canManage && <EditPayDialog worker={worker} />}
        </div>
      </div>

      {monthly ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-5">
          <Amount label={t('Basic salary')} value={money(worker.basic_salary)} />
          <Amount label={t('Housing')} value={money(worker.housing_allowance)} />
          <Amount label={t('Transport')} value={money(worker.transport_allowance)} />
          <Amount label={t('Food')} value={money(worker.food_allowance)} />
          <Amount label={t('Per month')} value={money(monthlyTotal.toString())} strong />
        </dl>
      ) : (
        <p className="text-[13.5px] text-ink-muted">
          {money(worker.daily_wage)} {t('per day attended')}
        </p>
      )}

      {uae && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('WPS details')}
            </span>
            <Badge tone={wpsComplete ? 'done' : 'pending'}>
              {wpsComplete ? t('Complete') : t('Missing — left out of salary files')}
            </Badge>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-3">
            <Amount label={t('MOL personal number')} value={worker.wps_person_id} />
            <Amount label={t('Bank routing code')} value={worker.wps_agent_code} />
            <Amount
              label={t('IBAN or card number')}
              // Only the end of it: enough to tell which account, not enough to be useful to anyone
              // reading over a shoulder. The edit dialog has the whole of it.
              value={worker.wps_account ? `•••• ${worker.wps_account.slice(-4)}` : null}
            />
          </dl>
        </div>
      )}

      {saudi && (
        <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              {t('Mudad payroll')}
            </span>
            <Badge tone={ibanValid ? 'done' : 'pending'}>
              {ibanValid ? t('IBAN checked') : t('Missing — left out of payroll files')}
            </Badge>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-2">
            <Amount
              label={t('IBAN')}
              value={worker.wps_account ? `•••• ${worker.wps_account.slice(-4)}` : null}
            />
            <Amount
              label={t('Bank')}
              value={saudiBank ? `${saudiBank.name} · ${saudiBank.bic}` : null}
            />
          </dl>
          <p className="text-[12.5px] text-ink-muted">
            {t('The Iqama or Saudi national ID on the payroll file comes from this worker’s papers.')}
          </p>
        </div>
      )}
    </Card>
  );
}

function Amount({
  label,
  value,
  strong,
}: {
  label: string;
  value: string | null;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={`font-mono ${strong ? 'font-semibold' : ''}`}>
        {value ?? <span className="text-ink-faint">—</span>}
      </dd>
    </div>
  );
}

/**
 * Changes apply going forward, like any wage change: attendance already recorded keeps the day
 * rate frozen onto it, and a finalised wage period keeps what it worked out.
 *
 * A blank allowance is saved as zero, so one can be taken away. A blank WPS detail is left as it
 * was — the API has no way to clear one, and a blank field is more likely untouched than meant.
 */
function EditPayDialog({ worker }: { worker: Worker }) {
  const { t } = useLanguage();
  const { currencyDigits, currencySymbol, settings } = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [payBasis, setPayBasis] = useState<PayBasis>(worker.pay_basis);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const prefill = (minor: string | null) =>
    minor ? minorToAmountInput(minor, currencyDigits) : '';

  function onSubmit(formData: FormData) {
    setError(null);
    const text = (field: string) => String(formData.get(field) ?? '').trim();
    const amount = (field: string) =>
      amountToMinorString(text(field), currencyDigits, currencySymbol);
    const optionalText = (field: string) => text(field) || undefined;

    let pay;
    try {
      pay =
        payBasis === 'monthly'
          ? {
              pay_basis: payBasis,
              basic_salary: amount('basic_salary'),
              housing_allowance: amount('housing_allowance'),
              transport_allowance: amount('transport_allowance'),
              food_allowance: amount('food_allowance'),
            }
          : { pay_basis: payBasis, daily_wage: amount('daily_wage') };
    } catch {
      setError(t('One of the amounts is not a number'));
      return;
    }
    const body = {
      ...pay,
      wps_person_id: optionalText('wps_person_id'),
      wps_agent_code: optionalText('wps_agent_code'),
      wps_account: optionalText('wps_account'),
    };

    start(async () => {
      const result = await updateWorkerPay(worker.id, body);
      if (!result.ok) {
        setError(result.error ?? t('Could not save'));
        return;
      }
      toast.success(t('Pay updated'));
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setPayBasis(worker.pay_basis);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="size-3.5" /> {t('Edit')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Pay')}</DialogTitle>
          <DialogDescription>
            {t(
              'Changes apply from now on. Days already recorded keep the rate they were worked at.',
            )}
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <Field label={t('Paid by')}>
            <Select value={payBasis} onValueChange={(value) => setPayBasis(value as PayBasis)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t('Daily wage')}</SelectItem>
                <SelectItem value="monthly">{t('Monthly salary')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {payBasis === 'daily' ? (
            <Field label={t('Daily wage (₹)').replace('₹', currencySymbol)} htmlFor="daily_wage">
              <Input
                id="daily_wage"
                name="daily_wage"
                required
                inputMode="decimal"
                defaultValue={prefill(worker.daily_wage)}
              />
            </Field>
          ) : (
            <>
              <Field
                label={`${t('Basic salary')} (${currencySymbol})`}
                htmlFor="basic_salary"
                hint={t('Per month')}
              >
                <Input
                  id="basic_salary"
                  name="basic_salary"
                  required
                  inputMode="decimal"
                  defaultValue={prefill(worker.basic_salary)}
                />
              </Field>
              <AllowanceFields
                defaults={{
                  housing: prefill(worker.housing_allowance),
                  transport: prefill(worker.transport_allowance),
                  food: prefill(worker.food_allowance),
                }}
              />
            </>
          )}

          {settings.country === 'AE' && (
            <fieldset className="flex flex-col gap-3 rounded-btn border border-line-soft p-3">
              <legend className="px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {t('WPS details')}
              </legend>
              <WpsFields defaults={worker} />
            </fieldset>
          )}

          {settings.country === 'SA' && (
            <Field
              label={t('Saudi IBAN')}
              htmlFor="wps_account"
              optional
              hint={t('SA and 22 digits — the bank is read from it')}
            >
              <Input
                id="wps_account"
                name="wps_account"
                dir="ltr"
                autoComplete="off"
                maxLength={34}
                defaultValue={worker.wps_account ?? ''}
              />
            </Field>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] text-blocked-fg"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('Saving…') : t('Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
