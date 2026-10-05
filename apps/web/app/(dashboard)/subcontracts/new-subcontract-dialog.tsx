'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { percentToBasisPoints, taxRule } from '@sitebook/shared';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFormat } from '@/components/format-provider';
import { useLanguage } from '@/components/language-provider';
import type { Contractor } from '@/lib/api-types';
import { costCodeOptions } from '@/lib/cost-code-actions';
import type { CostCode } from '@/lib/cost-code-types';
import { amountToMinorString } from '@/lib/money-input';
import { createSubcontract } from '@/lib/subcontract-actions';
import { LinesEditor, blankLine, linesForApi, type DraftLine } from './lines-editor';

/**
 * Write a subcontract: who, where, the commercial terms, and the schedule of rates. It is saved as
 * a draft — lines can still change — and let from its own page.
 */
export function NewSubcontractDialog({
  sites,
  contractors,
  fixedSiteId,
}: {
  sites: Array<{ id: string; name: string }>;
  contractors: Contractor[];
  /** On a site's own tab the site is already chosen. */
  fixedSiteId?: string;
}) {
  const { t } = useLanguage();
  const format = useFormat();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(fixedSiteId ?? '');
  const [contractorId, setContractorId] = useState('');
  const [codes, setCodes] = useState<CostCode[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rule = taxRule(format.settings.taxRegime ?? 'none');

  // The cost codes belong to the site, so they follow it.
  useEffect(() => {
    if (!open || !siteId) {
      setCodes([]);
      return;
    }
    let live = true;
    void costCodeOptions(siteId).then((result) => {
      if (live) setCodes(result.ok ? (result.data ?? []) : []);
    });
    return () => {
      live = false;
    };
  }, [open, siteId]);

  function submit(formData: FormData) {
    setError(null);
    const read = (name: string) => String(formData.get(name) ?? '').trim();
    if (!siteId || !contractorId) {
      setError(t('Choose the site and the subcontractor'));
      return;
    }
    const pct = (name: string, fallback: number | null) => {
      const value = read(name);
      return value ? percentToBasisPoints(value) : fallback;
    };
    const retention = pct('retention', 0);
    const release = pct('release', 5000);
    const recovery = pct('recovery', 0);
    const tax = pct('tax', rule.standardRateBp ?? (rule.taxName ? null : 0));
    if (retention === null || release === null || recovery === null) {
      setError(t('Enter percentages as numbers between 0 and 100'));
      return;
    }
    if (tax === null) {
      setError(`${t('Enter the rate of')} ${rule.taxName ?? t('tax')} ${t('the subcontractor charges')}`);
      return;
    }
    let advance: string;
    try {
      advance = amountToMinorString(read('advance'), format.currencyDigits, format.currencySymbol);
    } catch {
      setError(t('Enter the advance as a number, like 50000'));
      return;
    }
    const parsed = linesForApi(lines, format.currencyDigits, format.currencySymbol);
    if ('error' in parsed) {
      setError(t(parsed.error));
      return;
    }
    const months = Number(read('dlp') || '12');
    start(async () => {
      const result = await createSubcontract({
        project_id: siteId,
        contractor_id: contractorId,
        title: read('title'),
        ...(read('number') ? { number: read('number') } : {}),
        ...(read('scope') ? { scope: read('scope') } : {}),
        ...(read('start') ? { start_date: read('start') } : {}),
        ...(read('end') ? { end_date: read('end') } : {}),
        retention_bp: retention,
        retention_release_at_completion_bp: release,
        defects_liability_months: Number.isInteger(months) ? months : 12,
        advance_amount: advance,
        advance_recovery_bp: recovery,
        tax_rate_bp: tax,
        ...(read('terms') ? { payment_terms: read('terms') } : {}),
        lines: parsed.lines,
      });
      if (!result.ok || !result.data) {
        setError(result.error ?? t('Could not save the subcontract'));
        return;
      }
      toast.success(`${result.data.number} ${t('saved as a draft')}`);
      setOpen(false);
      setLines([blankLine()]);
      router.push(`/subcontracts/${result.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          {t('New subcontract')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('New subcontract')}</DialogTitle>
          <DialogDescription>
            {t('A scope of work let to one subcontractor on one site, priced line by line. It stays a draft until you let it.')}
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!fixedSiteId && (
              <Field label={t('Site')}>
                <Select value={siteId} onValueChange={setSiteId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('Choose a site')} />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field
              label={t('Subcontractor')}
              hint={contractors.length === 0 ? t('Add them under Labour → Contractors first') : undefined}
            >
              <Select value={contractorId} onValueChange={setContractorId}>
                <SelectTrigger>
                  <SelectValue placeholder={t('Choose a contractor')} />
                </SelectTrigger>
                <SelectContent>
                  {contractors.map((contractor) => (
                    <SelectItem key={contractor.id} value={contractor.id}>
                      {contractor.name}
                      {contractor.trade ? ` · ${contractor.trade}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field label={t('Title')} htmlFor="sc-title">
              <Input id="sc-title" name="title" required maxLength={160} placeholder={t('Internal plaster, block A')} />
            </Field>
            <Field label={t('Number')} htmlFor="sc-number" optional>
              <Input id="sc-number" name="number" maxLength={40} placeholder="SC-001" dir="ltr" className="font-mono" />
            </Field>
          </div>
          <Field label={t('Scope of work')} htmlFor="sc-scope" optional>
            <Textarea id="sc-scope" name="scope" maxLength={4000} className="min-h-[64px]" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('Start')} htmlFor="sc-start" optional>
              <Input id="sc-start" name="start" type="date" />
            </Field>
            <Field label={t('Finish')} htmlFor="sc-end" optional>
              <Input id="sc-end" name="end" type="date" />
            </Field>
            <Field label={t('Payment terms')} htmlFor="sc-terms" optional>
              <Input id="sc-terms" name="terms" maxLength={200} placeholder={t('14 days from certification')} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('Retention %')} htmlFor="sc-retention" hint={t('Held back from every bill')}>
              <Input id="sc-retention" name="retention" inputMode="decimal" defaultValue="5" dir="ltr" />
            </Field>
            <Field label={t('Released at completion %')} htmlFor="sc-release" hint={t('The rest after the defects period')}>
              <Input id="sc-release" name="release" inputMode="decimal" defaultValue="50" dir="ltr" />
            </Field>
            <Field label={t('Defects period (months)')} htmlFor="sc-dlp">
              <Input id="sc-dlp" name="dlp" inputMode="numeric" defaultValue="12" dir="ltr" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={`${t('Advance')} (${format.currencySymbol})`} htmlFor="sc-advance" optional>
              <Input id="sc-advance" name="advance" inputMode="decimal" placeholder="0" dir="ltr" />
            </Field>
            <Field label={t('Advance recovered per bill %')} htmlFor="sc-recovery" optional>
              <Input id="sc-recovery" name="recovery" inputMode="decimal" placeholder="10" dir="ltr" />
            </Field>
            <Field
              label={`${rule.taxName ?? t('Tax')} %`}
              htmlFor="sc-tax"
              hint={rule.standardRateBp === null && rule.taxName ? t('Depends on the work; ask your accountant') : undefined}
            >
              <Input
                id="sc-tax"
                name="tax"
                inputMode="decimal"
                defaultValue={rule.standardRateBp !== null ? String(rule.standardRateBp / 100) : rule.taxName ? '' : '0'}
                placeholder={rule.taxName ? '18' : '0'}
                dir="ltr"
              />
            </Field>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13.5px] font-semibold">{t('Schedule of rates')}</span>
            <LinesEditor lines={lines} onChange={setLines} costCodes={codes} />
          </div>

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
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t('Save draft')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
