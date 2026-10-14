'use client';

import { useState, useTransition } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { createWorker } from '@/lib/actions';
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
import { PhoneInput } from '@/components/phone-input';
import { Field } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { PayBasis } from '@sitebook/shared';
import { amountToMinorString } from '@/lib/money-input';
import type { Contractor, ProjectSummary } from '@/lib/api-types';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';

const DIRECT = 'direct';

export function AddWorkerDialog({
  contractors,
  projects,
}: {
  contractors: Contractor[];
  projects: ProjectSummary[];
}) {
  const { t } = useLanguage();
  const { currencyDigits, currencySymbol, todayIso, settings } = useFormat();
  const [open, setOpen] = useState(false);
  const [payBasis, setPayBasis] = useState<PayBasis>('daily');
  const [contractorId, setContractorId] = useState<string>(DIRECT);
  const [projectId, setProjectId] = useState<string>('');
  const [skill, setSkill] = useState('unskilled');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    const amount = (field: string) =>
      amountToMinorString(String(formData.get(field) ?? '0'), currencyDigits, currencySymbol);
    // An allowance left blank is not sent, rather than sent as zero.
    const optionalAmount = (field: string) =>
      optional(formData.get(field)) === undefined ? undefined : amount(field);

    // A monthly worker's day rate is the API's to work out (fixed pay / 30), so it is not sent.
    const readPay = () => {
      const overtime = { overtime_rate_per_hour: amount('ot_rate') };
      return payBasis === 'monthly'
        ? {
            ...overtime,
            pay_basis: payBasis,
            basic_salary: amount('basic_salary'),
            housing_allowance: optionalAmount('housing_allowance'),
            transport_allowance: optionalAmount('transport_allowance'),
            food_allowance: optionalAmount('food_allowance'),
          }
        : { ...overtime, daily_wage: amount('daily_wage') };
    };

    let pay: ReturnType<typeof readPay>;
    try {
      pay = readPay();
    } catch {
      setError(t('One of the amounts is not a number'));
      return;
    }

    start(async () => {
      const result = await createWorker({
        name: String(formData.get('name') ?? ''),
        trade: optional(formData.get('trade')),
        phone: optional(formData.get('phone')),
        // "Direct labour" is an explicit choice in the UI and a null in the API.
        contractor_id: contractorId === DIRECT ? null : contractorId,
        skill_level: skill,
        ...pay,
        wps_person_id: optional(formData.get('wps_person_id')),
        wps_agent_code: optional(formData.get('wps_agent_code')),
        wps_account: optional(formData.get('wps_account')),
        ...(projectId ? { project_id: projectId, from_date: todayIso() } : {}),
      });

      if (!result.ok) {
        setError(result.error ?? 'Could not add the worker');
        return;
      }
      toast.success(`${result.data?.name ?? 'Worker'} added to the roster`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus /> {t('Add worker')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Add a worker')}</DialogTitle>
          <DialogDescription>
            {t('The wage set here is frozen onto each day’s attendance, so changing it later never alters what has already been earned.')}
          </DialogDescription>
        </DialogHeader>

        <form action={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Name')} htmlFor="name">
              <Input id="name" name="name" required placeholder="Raju M" />
            </Field>
            <Field label={t('Phone')} htmlFor="phone">
              <PhoneInput id="phone" name="phone" />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Trade')} htmlFor="trade">
              <Input id="trade" name="trade" placeholder={t('Mason')} />
            </Field>
            <Field label={t('Skill level')}>
              <Select value={skill} onValueChange={setSkill}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unskilled">{t('Unskilled')}</SelectItem>
                  <SelectItem value="semi">{t('Semi-skilled')}</SelectItem>
                  <SelectItem value="skilled">{t('Skilled')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('Daily wage (₹)').replace('₹', currencySymbol)} htmlFor="daily_wage">
                <Input id="daily_wage" name="daily_wage" required inputMode="decimal" placeholder="850" />
              </Field>
              <Field label={t('Overtime per hour (₹)').replace('₹', currencySymbol)} htmlFor="ot_rate">
                <Input id="ot_rate" name="ot_rate" inputMode="decimal" defaultValue="0" />
              </Field>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={`${t('Basic salary')} (${currencySymbol})`}
                  htmlFor="basic_salary"
                  hint={t('Per month')}
                >
                  <Input id="basic_salary" name="basic_salary" required inputMode="decimal" placeholder="1500" />
                </Field>
                <Field label={t('Overtime per hour (₹)').replace('₹', currencySymbol)} htmlFor="ot_rate">
                  <Input id="ot_rate" name="ot_rate" inputMode="decimal" defaultValue="0" />
                </Field>
              </div>
              <AllowanceFields />
            </>
          )}

          {/* Only a UAE company pays through WPS; anywhere else these would be noise. */}
          {settings.country === 'AE' && (
            <fieldset className="flex flex-col gap-3 rounded-btn border border-line-soft p-3">
              <legend className="px-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                {t('WPS details')}
              </legend>
              <p className="text-[12.5px] text-ink-muted">
                {t('Optional now — needed before this worker can go on a WPS salary file.')}
              </p>
              <WpsFields />
            </fieldset>
          )}

          <Field label={t('Contractor')}>
            <Select value={contractorId} onValueChange={setContractorId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DIRECT}>{t('Direct labour')}</SelectItem>
                {contractors.map((contractor) => (
                  <SelectItem key={contractor.id} value={contractor.id}>
                    {contractor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t('Assign to site')} hint={t('Optional — they appear in that site’s roll call from today')}>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder={t('No site yet')} />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              {pending ? 'Adding…' : t('Add worker')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? '').trim();
  return text.length > 0 ? text : undefined;
}

/** Housing, transport and food allowances, per month. Shared with the worker page's pay editor. */
export function AllowanceFields({
  defaults,
}: {
  defaults?: { housing: string; transport: string; food: string };
}) {
  const { t } = useLanguage();
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Field label={t('Housing')} htmlFor="housing_allowance" optional>
        <Input
          id="housing_allowance"
          name="housing_allowance"
          inputMode="decimal"
          placeholder="0"
          defaultValue={defaults?.housing}
        />
      </Field>
      <Field label={t('Transport')} htmlFor="transport_allowance" optional>
        <Input
          id="transport_allowance"
          name="transport_allowance"
          inputMode="decimal"
          placeholder="0"
          defaultValue={defaults?.transport}
        />
      </Field>
      <Field label={t('Food')} htmlFor="food_allowance" optional>
        <Input
          id="food_allowance"
          name="food_allowance"
          inputMode="decimal"
          placeholder="0"
          defaultValue={defaults?.food}
        />
      </Field>
    </div>
  );
}

/** The three UAE WPS inputs. Shared with the worker page's pay editor. */
export function WpsFields({
  defaults,
}: {
  defaults?: {
    wps_person_id: string | null;
    wps_agent_code: string | null;
    wps_account: string | null;
  };
}) {
  const { t } = useLanguage();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('MOL personal number')} htmlFor="wps_person_id" optional hint={t('14 digits')}>
        <Input
          id="wps_person_id"
          name="wps_person_id"
          inputMode="numeric"
          pattern="[0-9]{14}"
          maxLength={14}
          defaultValue={defaults?.wps_person_id ?? ''}
        />
      </Field>
      <Field label={t('Bank routing code')} htmlFor="wps_agent_code" optional hint={t('9 digits')}>
        <Input
          id="wps_agent_code"
          name="wps_agent_code"
          inputMode="numeric"
          pattern="[0-9]{9}"
          maxLength={9}
          defaultValue={defaults?.wps_agent_code ?? ''}
        />
      </Field>
      <Field
        label={t('IBAN or card number')}
        htmlFor="wps_account"
        optional
        className="sm:col-span-2"
      >
        <Input
          id="wps_account"
          name="wps_account"
          autoCapitalize="characters"
          pattern="[0-9A-Za-z]{8,34}"
          maxLength={34}
          defaultValue={defaults?.wps_account ?? ''}
        />
      </Field>
    </div>
  );
}
