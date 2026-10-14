'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type FormEvent } from 'react';
import { CheckCircle2, Loader2, Save, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AccountingSystem } from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/components/language-provider';
import { applyAccountingDefaults, saveAccountingMappings, saveAccountingSettings } from '@/lib/accounting-actions';
import { changedAccountingRows, type AccountingDraft } from '@/lib/accounting';
import type { AccountingKeyRow, AccountingOverview } from '@/lib/accounting-types';

/** What each system's files are, in a line, under the picker. */
const SYSTEM_NOTES: Record<AccountingSystem, string> = {
  tally: 'Tally XML: ledgers, cost centres and vouchers, imported through Gateway of Tally → Import.',
  quickbooks_online: 'CSV files for QuickBooks Online’s import: bills, invoices, journal entries, suppliers and customers.',
  quickbooks_desktop: 'One IIF file for QuickBooks Desktop: accounts, suppliers, customers, classes and transactions.',
  xero: 'Xero’s import templates: bills, sales invoices, manual journals and contacts. Accounts go by code.',
  sap_b1: 'Data Transfer Workbench templates: A/P and A/R invoices, journal entries and business partners. Accounts go by code.',
  netsuite: 'CSV imports for vendor bills, invoices and journal entries, with external IDs and your subsidiary.',
};

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
      {error}
    </p>
  );
}

export function AccountingSettingsForm({ overview }: { overview: AccountingOverview }) {
  return (
    <div className="flex flex-col gap-5">
      <SystemCard overview={overview} />
      <MappingCard overview={overview} />
    </div>
  );
}

// --- the system and its file details ---------------------------------------------------------------

function SystemCard({ overview }: { overview: AccountingOverview }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const saved = overview.settings;
  const [values, setValues] = useState({
    gst_home_state: saved.gst_home_state ?? '',
    tally_company: saved.tally_company ?? '',
    qbo_site_dimension: saved.qbo_site_dimension,
    xero_tracking_name: saved.xero_tracking_name ?? '',
    netsuite_subsidiary: saved.netsuite_subsidiary ?? '',
    netsuite_site_dimension: saved.netsuite_site_dimension,
  });
  const system = overview.system;
  const disabled = !overview.can_manage || pending;
  const isCompanySystem = system === saved.system;

  /** Looking at another system's mapping does not change the company's choice until saved. */
  function pick(next: string) {
    router.replace(`/settings/accounting?system=${next}`);
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await saveAccountingSettings({
        system,
        gst_home_state: values.gst_home_state.trim() || null,
        tally_company: values.tally_company,
        qbo_site_dimension: values.qbo_site_dimension,
        xero_tracking_name: values.xero_tracking_name,
        netsuite_subsidiary: values.netsuite_subsidiary,
        netsuite_site_dimension: values.netsuite_site_dimension,
      });
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Accounting settings saved'));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Accounting system')}</CardTitle>
          {isCompanySystem ? (
            <Badge tone="done">{t('Your company’s system')}</Badge>
          ) : (
            <Badge tone="pending">{t('Not saved as your system yet')}</Badge>
          )}
        </div>
        <CardDescription>{t(SYSTEM_NOTES[system])}</CardDescription>
      </CardHeader>
      <form onSubmit={onSave} className="flex flex-col gap-4 border-t border-line-soft p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-semibold">{t('System')}</span>
            <Select value={system} onValueChange={pick} disabled={pending}>
              <SelectTrigger aria-label={t('System')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {overview.systems.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {overview.tax_regime === 'gst_in' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13.5px] font-semibold">{t('Your GST state code')}</span>
              <Input
                value={values.gst_home_state}
                onChange={(event) => setValues({ ...values, gst_home_state: event.target.value })}
                inputMode="numeric"
                maxLength={2}
                placeholder="33"
                disabled={disabled}
              />
              <span className="text-[12.5px] leading-relaxed text-ink-muted">
                {t('The first two digits of your GSTIN. A bill from another state is posted to IGST, one from your own state to CGST and SGST.')}
              </span>
            </label>
          )}

          {system === 'tally' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13.5px] font-semibold">{t('Company name in Tally')}</span>
              <Input
                value={values.tally_company}
                onChange={(event) => setValues({ ...values, tally_company: event.target.value })}
                disabled={disabled}
              />
              <span className="text-[12.5px] leading-relaxed text-ink-muted">
                {t('Optional. When set, the file imports into this company even if another is open in Tally.')}
              </span>
            </label>
          )}

          {system === 'quickbooks_online' && (
            <DimensionField
              label={t('Sites go in as')}
              value={values.qbo_site_dimension}
              options={[
                ['class', t('Class')],
                ['location', t('Location')],
              ]}
              onChange={(value) => setValues({ ...values, qbo_site_dimension: value as 'class' | 'location' })}
              disabled={disabled}
            />
          )}

          {system === 'xero' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13.5px] font-semibold">{t('Tracking category for sites')}</span>
              <Input
                value={values.xero_tracking_name}
                onChange={(event) => setValues({ ...values, xero_tracking_name: event.target.value })}
                placeholder="Site"
                disabled={disabled}
              />
            </label>
          )}

          {system === 'netsuite' && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13.5px] font-semibold">{t('Subsidiary')}</span>
                <Input
                  value={values.netsuite_subsidiary}
                  onChange={(event) => setValues({ ...values, netsuite_subsidiary: event.target.value })}
                  disabled={disabled}
                />
              </label>
              <DimensionField
                label={t('Sites go in as')}
                value={values.netsuite_site_dimension}
                options={[
                  ['department', t('Department')],
                  ['class', t('Class')],
                  ['location', t('Location')],
                ]}
                onChange={(value) =>
                  setValues({ ...values, netsuite_site_dimension: value as 'department' | 'class' | 'location' })
                }
                disabled={disabled}
              />
            </>
          )}
        </div>
        <FormError error={error} />
        {overview.can_manage && (
          <Button type="submit" disabled={pending} className="gap-2 self-start">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isCompanySystem ? t('Save') : t('Use this system')}
          </Button>
        )}
      </form>
    </Card>
  );
}

function DimensionField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13.5px] font-semibold">{label}</span>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([id, text]) => (
            <SelectItem key={id} value={id}>
              {text}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

// --- the mapping grid ------------------------------------------------------------------------------

function MappingCard({ overview }: { overview: AccountingOverview }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => [...overview.keys, ...overview.optional], [overview]);
  const saved = useMemo(() => Object.fromEntries(rows.map((row) => [row.key, row.account])), [rows]);
  const [draft, setDraft] = useState<AccountingDraft>(() =>
    Object.fromEntries(rows.map((row) => [row.key, { code: row.account?.code ?? '', name: row.account?.name ?? '' }])),
  );
  const changes = changedAccountingRows(saved, draft);
  const { completeness } = overview;
  const complete = completeness.missing.length === 0;
  const readOnly = !overview.can_manage;
  // Tally goes by ledger name alone; every other system can carry a number.
  const showCode = overview.system !== 'tally';

  const groups = useMemo(() => {
    const out = new Map<string, AccountingKeyRow[]>();
    for (const row of overview.keys) out.set(row.group_label, [...(out.get(row.group_label) ?? []), row]);
    return [...out.entries()];
  }, [overview.keys]);

  function set(key: string, field: 'code' | 'name', value: string) {
    setDraft((current) => ({ ...current, [key]: { ...current[key]!, [field]: value } }));
  }

  function onSave() {
    setError(null);
    start(async () => {
      const result = await saveAccountingMappings({ system: overview.system, rows: changes });
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Account mapping saved'));
      router.refresh();
    });
  }

  function onDefaults() {
    setError(null);
    start(async () => {
      const result = await applyAccountingDefaults({ system: overview.system });
      if (!result.ok) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      toast.success(t('Suggested accounts filled in'));
      router.refresh();
    });
  }

  const renderRow = (row: AccountingKeyRow) => {
    const value = draft[row.key] ?? { code: '', name: '' };
    const mapped = Boolean(row.account?.name);
    const isTaxCode = row.key.startsWith('tax_code:');
    return (
      <TableRow key={row.key}>
        <TableCell className="min-w-[200px]">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium">{t(row.label)}</span>
            {row.required && !mapped && <span className="text-[12px] font-semibold text-pending-fg">{t('Not mapped')}</span>}
          </span>
        </TableCell>
        {showCode && (
          <TableCell className="w-[150px]">
            <Input
              value={value.code}
              onChange={(event) => set(row.key, 'code', event.target.value)}
              placeholder={row.suggested?.code ?? ''}
              aria-label={`${t(row.label)}: ${isTaxCode ? t('Tax code') : t('Account code')}`}
              disabled={readOnly || pending}
              className="h-9 text-[14px]"
            />
          </TableCell>
        )}
        <TableCell className="min-w-[220px]">
          <Input
            value={value.name}
            onChange={(event) => set(row.key, 'name', event.target.value)}
            placeholder={row.suggested?.name ?? ''}
            aria-label={`${t(row.label)}: ${isTaxCode ? t('Tax code name') : t('Account name')}`}
            disabled={readOnly || pending}
            className="h-9 text-[14px]"
          />
        </TableCell>
      </TableRow>
    );
  };

  const header = (
    <TableHeader>
      <TableRow>
        <TableHead>{t('Used for')}</TableHead>
        {showCode && <TableHead>{overview.needs_account_code ? t('Code (required)') : t('Code')}</TableHead>}
        <TableHead>{overview.posts_to_party_ledger ? t('Ledger name') : t('Account name')}</TableHead>
      </TableRow>
    </TableHeader>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('Account mapping')}</CardTitle>
          {complete ? (
            <Badge tone="done">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {t('Complete')}
            </Badge>
          ) : (
            <Badge tone="pending">
              {completeness.mapped} {t('of')} {completeness.total} {t('mapped')}
            </Badge>
          )}
        </div>
        <CardDescription>
          {overview.posts_to_party_ledger
            ? t('Type each ledger exactly as it is named in Tally. Suppliers and clients get their own ledgers under the groups named for payables and receivables.')
            : overview.needs_account_code
              ? t('Give each account its code exactly as it is in your chart of accounts — the import matches on the code.')
              : t('Type each account exactly as it is named in your chart of accounts — the import matches on the name.')}{' '}
          {overview.uses_tax_codes &&
            t('Tax codes go on bill and invoice lines; your accounting system works the tax out from them.')}
        </CardDescription>
      </CardHeader>
      <div className="flex flex-col gap-4 border-t border-line-soft p-4">
        {!complete && overview.can_manage && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-btn bg-neutral-bg px-3.5 py-2.5">
            <span className="text-[13px] leading-relaxed text-ink-soft">
              {t('The grey text in each box is a suggestion. Use the suggestions for everything still empty, then change any that differ from your books.')}
            </span>
            <Button type="button" variant="secondary" onClick={onDefaults} disabled={pending} className="gap-2">
              <Wand2 className="size-4" />
              {t('Use suggested accounts')}
            </Button>
          </div>
        )}

        {groups.map(([group, groupRows]) => (
          <section key={group} className="flex flex-col gap-1.5">
            <h3 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t(group)}</h3>
            <div className="overflow-x-auto">
              <Table>
                {header}
                <TableBody>{groupRows.map(renderRow)}</TableBody>
              </Table>
            </div>
          </section>
        ))}

        {overview.optional.length > 0 && (
          <details className="rounded-btn border border-line-soft">
            <summary className="cursor-pointer px-3.5 py-2.5 text-[13.5px] font-semibold">
              {t('Optional: accounts by tax rate, cost code and site')}
            </summary>
            <div className="flex flex-col gap-2 border-t border-line-soft p-3.5">
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                {t('Leave these empty to use the account above. A cost code’s account wins over its category’s; a rate’s over the plain one. A site’s name here is its cost centre, class or tracking option (its code is SAP’s project code).')}
              </p>
              <div className="overflow-x-auto">
                <Table>
                  {header}
                  <TableBody>{overview.optional.map(renderRow)}</TableBody>
                </Table>
              </div>
            </div>
          </details>
        )}

        <FormError error={error} />
        {overview.can_manage ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={onSave} disabled={pending || changes.length === 0} className="gap-2">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t('Save mapping')}
            </Button>
            {changes.length > 0 && (
              <span className="text-[12.5px] text-ink-muted">
                {changes.length} {changes.length === 1 ? t('change not saved') : t('changes not saved')}
              </span>
            )}
          </div>
        ) : (
          <p className="text-[12.5px] text-ink-muted">{t('Only someone who manages accounting can change the mapping.')}</p>
        )}
      </div>
    </Card>
  );
}
