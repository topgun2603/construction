'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertTriangle, Download, Eye, FileOutput, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  ACCOUNTING_CATEGORIES,
  ACCOUNTING_CATEGORY_LABELS,
  type AccountingCategory,
  type AccountingSystem,
} from '@sitebook/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLanguage } from '@/components/language-provider';
import { useFormat } from '@/components/format-provider';
import { createAccountingExport, previewAccountingExport } from '@/lib/accounting-actions';
import { fileSize } from '@/lib/accounting';
import type { AccountingBatch, AccountingPreview } from '@/lib/accounting-types';

const DOCUMENT_LABELS: Record<string, string> = { bill: 'Bill', invoice: 'Invoice', journal: 'Journal' };

/** How many voucher rows the preview table shows before "show all". */
const FIRST_ROWS = 50;

/**
 * The export form: system, sites, what to include, then Preview and Export.
 *
 * Export stays disabled until a preview of exactly these choices came back complete — the API
 * refuses an incomplete mapping anyway, but the person should see the list of what is missing and
 * the totals by account before anything is recorded as exported.
 */
export function ExportForm({
  from,
  to,
  systems,
  defaultSystem,
  sites,
  seesAllSites,
  canManage,
}: {
  from: string;
  to: string;
  systems: { id: AccountingSystem; label: string }[];
  defaultSystem: AccountingSystem;
  sites: { id: string; name: string }[];
  seesAllSites: boolean;
  canManage: boolean;
}) {
  const { t } = useLanguage();
  const { money, shortDate } = useFormat();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [system, setSystem] = useState<AccountingSystem>(defaultSystem);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [include, setInclude] = useState<AccountingCategory[]>([...ACCOUNTING_CATEGORIES]);
  const [includeExported, setIncludeExported] = useState(false);
  const [preview, setPreview] = useState<AccountingPreview | null>(null);
  const [batch, setBatch] = useState<AccountingBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const input = { system, from, to, project_ids: siteIds, include, include_exported: includeExported };

  /** Any change of choice makes the preview stale: clear it, so Export cannot use old figures. */
  function changed<T>(apply: (value: T) => void) {
    return (value: T) => {
      apply(value);
      setPreview(null);
      setBatch(null);
      setError(null);
    };
  }

  function toggle<T>(list: T[], value: T, on: boolean): T[] {
    return on ? [...list, value] : list.filter((item) => item !== value);
  }

  function runPreview() {
    setError(null);
    setBatch(null);
    start(async () => {
      const result = await previewAccountingExport(input);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('That did not work. Try again.'));
        return;
      }
      setPreview(result.data);
      setShowAll(false);
    });
  }

  function runExport() {
    setError(null);
    start(async () => {
      const result = await createAccountingExport(input);
      if (!result.ok || !result.data) {
        setError(result.error ?? t('That did not work. Try again.'));
        // The refusal's reason — a mapping changed elsewhere, someone else exported first — shows in
        // a fresh preview.
        const again = await previewAccountingExport(input);
        if (again.ok && again.data) setPreview(again.data);
        return;
      }
      setBatch(result.data);
      setPreview(null);
      toast.success(`${t('Exported batch')} #${result.data.number}`);
      router.refresh();
    });
  }

  const canExport = Boolean(preview?.complete && (preview.voucher_count > 0 || preview.masters));
  const vouchers = preview ? (showAll ? preview.vouchers : preview.vouchers.slice(0, FIRST_ROWS)) : [];

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4 p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13.5px] font-semibold">{t('Accounting system')}</span>
            <Select value={system} onValueChange={changed((value: string) => setSystem(value as AccountingSystem))}>
              <SelectTrigger aria-label={t('Accounting system')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {systems.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13.5px] font-semibold">{t('Include')}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {ACCOUNTING_CATEGORIES.map((category) => (
                <label key={category} className="flex items-center gap-2 text-[13.5px]">
                  <input
                    type="checkbox"
                    checked={include.includes(category)}
                    onChange={(event) => changed(setInclude)(toggle(include, category, event.target.checked))}
                    className="size-4 accent-accent"
                  />
                  {t(ACCOUNTING_CATEGORY_LABELS[category])}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13.5px] font-semibold">{t('Sites')}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                checked={siteIds.length === 0}
                onChange={(event) => event.target.checked && changed(setSiteIds)([])}
                className="size-4 accent-accent"
              />
              {seesAllSites ? t('Every site') : t('All my sites')}
            </label>
            {sites.map((site) => (
              <label key={site.id} className="flex items-center gap-2 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={siteIds.includes(site.id)}
                  onChange={(event) => changed(setSiteIds)(toggle(siteIds, site.id, event.target.checked))}
                  className="size-4 accent-accent"
                />
                {site.name}
              </label>
            ))}
          </div>
          <span className="text-[12.5px] leading-relaxed text-ink-muted">
            {t('Wage periods belong to the whole company, not a site, so they are exported only with every site.')}
          </span>
        </fieldset>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={includeExported}
            onChange={(event) => changed(setIncludeExported)(event.target.checked)}
            className="mt-0.5 size-4 flex-none accent-accent"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium">{t('Include transactions already exported')}</span>
            <span className="text-[12.5px] leading-relaxed text-ink-muted">
              {t('Off, each transaction goes to your accounts once. Tick it only to re-import a period — the same reference numbers let your accounting system spot the repeat.')}
            </span>
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-btn bg-blocked-bg px-3 py-2 text-[13px] leading-snug text-blocked-fg">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={runPreview} disabled={pending || include.length === 0} className="gap-2">
            {pending && !preview ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
            {t('Preview')}
          </Button>
          <Button type="button" onClick={runExport} disabled={pending || !canExport} className="gap-2">
            {pending && preview ? <Loader2 className="size-4 animate-spin" /> : <FileOutput className="size-4" />}
            {t('Export')}
          </Button>
        </div>
      </Card>

      {batch && (
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-[14px] font-semibold">
            {t('Batch')} #{batch.number} · {batch.voucher_count}{' '}
            {batch.voucher_count === 1 ? t('transaction') : t('transactions')}
          </span>
          <span className="text-[13px] text-ink-soft">
            {t('Import the files in this order: masters and contacts first, then bills and invoices, then journals.')}
          </span>
          <div className="flex flex-wrap gap-2">
            {batch.files.map((file) => (
              <Link
                key={file.id}
                href={`/reports/accounts-export/file?batch=${batch.id}&file=${file.id}`}
                prefetch={false}
                className="inline-flex items-center gap-1.5 rounded-btn border border-line px-2.5 py-1.5 text-[12.5px] font-medium hover:bg-raised"
              >
                <Download className="size-3.5" aria-hidden />
                <span className="font-mono">{file.name}</span>
                <span className="text-ink-muted">{fileSize(file.size_bytes)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {preview && (
        <div className="flex flex-col gap-4">
          {!preview.complete && (
            <div className="flex flex-col gap-2 rounded-btn border border-pending-line bg-pending-bg px-3.5 py-3 text-[13px] leading-relaxed text-pending-fg">
              <span className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4 flex-none" aria-hidden />
                {t('Map these accounts before exporting to')} {preview.system_label}:
              </span>
              <ul className="flex flex-col gap-1 ps-6">
                {preview.missing.map((item) => (
                  <li key={item.key} className="list-disc">
                    <span className="font-semibold">{t(item.label)}</span> — {t('needed for')} {item.example}
                  </li>
                ))}
              </ul>
              <Link href={`/settings/accounting?system=${preview.system}`} className="self-start font-semibold underline underline-offset-4">
                {canManage ? t('Open Settings → Accounting') : t('Ask whoever manages accounting to map them')}
              </Link>
            </div>
          )}

          {preview.payroll_left_out && (
            <p className="rounded-btn bg-neutral-bg px-3.5 py-2.5 text-[13px] leading-snug text-ink-soft">
              {t('Wage periods are left out: they belong to the whole company. Choose every site to export them.')}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Badge tone={preview.complete ? 'done' : 'pending'}>
              {preview.voucher_count} {preview.voucher_count === 1 ? t('transaction') : t('transactions')}
            </Badge>
            {(Object.keys(preview.counts) as (keyof AccountingPreview['counts'])[])
              .filter((category) => preview.counts[category] > 0)
              .map((category) => (
                <Badge key={category} tone="neutral">
                  {t(ACCOUNTING_CATEGORY_LABELS[category])}: {preview.counts[category]}
                </Badge>
              ))}
            {preview.skipped_count > 0 && (
              <Badge tone="accent">
                {preview.skipped_count} {t('already exported, left out')}
              </Badge>
            )}
            {preview.masters && (
              <Badge tone="neutral">
                {preview.masters.parties} {t('suppliers and clients')}, {preview.masters.accounts} {t('accounts')}
              </Badge>
            )}
          </div>

          {preview.accounts.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Totals by account')}</span>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Account')}</TableHead>
                      <TableHead className="text-end">{t('Debit')}</TableHead>
                      <TableHead className="text-end">{t('Credit')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.accounts.map((row) => (
                      <TableRow key={`${row.code}|${row.name}`}>
                        <TableCell className="font-medium">
                          {row.code && <span className="me-2 font-mono text-ink-muted">{row.code}</span>}
                          {row.name || <span className="text-pending-fg">{t('Not mapped')}</span>}
                        </TableCell>
                        <TableCell className="text-end font-mono">{row.debit !== '0' ? money(row.debit) : ''}</TableCell>
                        <TableCell className="text-end font-mono">{row.credit !== '0' ? money(row.credit) : ''}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell>{t('Total')}</TableCell>
                      <TableCell className="text-end font-mono">{money(preview.debit_total)}</TableCell>
                      <TableCell className="text-end font-mono">{money(preview.credit_total)}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </Card>
          )}

          {preview.vouchers.length > 0 && (
            <Card className="flex flex-col gap-2 p-4">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t('Transactions')}</span>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('Date')}</TableHead>
                      <TableHead>{t('Reference')}</TableHead>
                      <TableHead>{t('Party')}</TableHead>
                      <TableHead>{t('Site')}</TableHead>
                      <TableHead>{t('Goes in as')}</TableHead>
                      <TableHead className="text-end">{t('Amount')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vouchers.map((voucher) => (
                      <TableRow key={voucher.external_id}>
                        <TableCell className="whitespace-nowrap">{shortDate(voucher.date)}</TableCell>
                        <TableCell>
                          <span className="flex flex-col gap-0.5">
                            <span className="font-mono text-[12.5px]">{voucher.reference}</span>
                            {voucher.exported_in && (
                              <span className="text-[12px] font-semibold text-accent">
                                {t('Exported in batch')} #{voucher.exported_in.number}
                              </span>
                            )}
                          </span>
                        </TableCell>
                        <TableCell>{voucher.party ?? '—'}</TableCell>
                        <TableCell>{voucher.site ?? t('Company')}</TableCell>
                        <TableCell>{t(DOCUMENT_LABELS[voucher.document] ?? voucher.document)}</TableCell>
                        <TableCell className="text-end font-mono">{money(voucher.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {!showAll && preview.vouchers.length > FIRST_ROWS && (
                <Button type="button" variant="ghost" onClick={() => setShowAll(true)} className="self-start">
                  {t('Show all')} {preview.vouchers.length}
                </Button>
              )}
              {preview.voucher_count > preview.vouchers.length && (
                <span className="text-[12.5px] text-ink-muted">
                  {t('Showing the first')} {preview.vouchers.length} {t('of')} {preview.voucher_count}. {t('The totals cover all of them.')}
                </span>
              )}
            </Card>
          )}

          {preview.skipped.length > 0 && (
            <details className="rounded-btn border border-line-soft">
              <summary className="cursor-pointer px-3.5 py-2.5 text-[13.5px] font-semibold">
                {preview.skipped_count} {t('already exported, left out')}
              </summary>
              <ul className="flex flex-col gap-1 border-t border-line-soft p-3.5 text-[13px]">
                {preview.skipped.map((item) => (
                  <li key={item.external_id} className="flex flex-wrap gap-2">
                    <span className="font-mono">{item.external_id}</span>
                    <span className="text-ink-muted">{shortDate(item.date)}</span>
                    <span className="text-accent">
                      {t('Exported in batch')} #{item.exported_in.number}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
