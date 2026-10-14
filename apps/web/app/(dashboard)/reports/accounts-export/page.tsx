import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Download, History } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { getFormat } from '@/lib/format-server';
import { getT } from '@/lib/i18n-server';
import { fileSize } from '@/lib/accounting';
import type { AccountingBatch, AccountingOverview } from '@/lib/accounting-types';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { ReportsNav } from '../reports-nav';
import { canSeeTaxReport } from '../tax/access';
import { ExportForm } from './export-form';

export const metadata = { title: 'Export to accounts · BUILDR' };

/** The month before the one `today` is in, as `[first, last]` — what an accountant usually closes. */
function lastMonth(today: string): [string, string] {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(year, month - 2, 1));
  const last = new Date(Date.UTC(year, month - 1, 0));
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

/**
 * Reports → Export to accounts (roadmap Phase 3): a period's purchases, wages, subcontractor bills,
 * client bills and payments as files for Tally, QuickBooks, Xero, SAP Business One or NetSuite.
 *
 * Preview first — totals by account, what is unmapped, what went out before — then export, which
 * records a batch. The history below re-downloads any batch's files exactly as they were written.
 * Defaults to last month on the company's calendar: the period being closed is the one just ended.
 */
export default async function AccountsExportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await requireSelf();
  if (!me.permissions.includes('accounting.export')) notFound();
  const t = await getT();
  const { todayIso, shortDate, instantDate, timeOfDay } = await getFormat();
  const params = await searchParams;
  const [defaultFrom, defaultTo] = lastMonth(todayIso());
  const from = params.from ?? defaultFrom;
  const to = params.to ?? defaultTo;

  const [overview, batches, projects] = await Promise.all([
    serverFetch<AccountingOverview>('/accounting/settings'),
    serverFetch<{ items: AccountingBatch[] }>('/accounting/exports'),
    serverFetch<{ items: { id: string; name: string }[] }>('/projects?limit=200'),
  ]);

  return (
    <FadeIn className="flex flex-col gap-5">
      <ReportsNav
        from={from}
        to={to}
        isOwnerOrAccounts={['owner', 'accounts'].includes(me.user.role)}
        showTax={canSeeTaxReport(me)}
        showAccounting
      />

      <ExportForm
        // A new range is a new preview: start the form again rather than show last range's figures.
        key={`${from}:${to}`}
        from={from}
        to={to}
        systems={overview.systems}
        defaultSystem={overview.settings.system}
        sites={projects.items.map((project) => ({ id: project.id, name: project.name }))}
        seesAllSites={me.sees_all_projects}
        canManage={overview.can_manage}
      />

      <Card className="flex flex-col gap-3 p-4">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <History className="size-4" aria-hidden />
          {t('Earlier exports')}
        </span>
        {batches.items.length === 0 ? (
          <EmptyState
            icon={<History />}
            title={t('Nothing exported yet')}
            body={t('Each export is kept here with its files, so you can download the same file again.')}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {batches.items.map((batch) => (
              <li key={batch.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[14px] font-semibold">
                    {t('Batch')} #{batch.number} · {batch.system_label}
                  </span>
                  <span className="text-[12.5px] text-ink-muted">
                    {instantDate(batch.created_at)} {timeOfDay(batch.created_at)}
                  </span>
                </div>
                <span className="text-[13px] text-ink-soft">
                  {shortDate(batch.from)} {t('to')} {shortDate(batch.to)} · {batch.voucher_count}{' '}
                  {batch.voucher_count === 1 ? t('transaction') : t('transactions')}
                  {batch.include_exported ? ` · ${t('included earlier exports')}` : ''}
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
              </li>
            ))}
          </ul>
        )}
      </Card>
    </FadeIn>
  );
}
