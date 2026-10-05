import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, Receipt } from 'lucide-react';
import { taxRule } from '@sitebook/shared';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { TaxReport } from '@/lib/api-types';
import { getFormat } from '@/lib/format-server';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { ReportsNav } from '../reports-nav';
import { canSeeTaxReport } from './access';
import { getT } from '@/lib/i18n-server';

export const metadata = { title: 'Tax · BUILDR' };

/**
 * VAT or GST paid and charged over a range (roadmap Phase 1, item 5).
 *
 * Input tax is what sat inside the expenses; output tax is what was charged on top of the
 * instalments raised to clients. The difference is what the return will probably say — but this is
 * a worksheet to hand an accountant, not the return, and the page says so in as many words.
 *
 * Defaults to the current month to date, on the company's clock: returns are filed by period, and
 * the period somebody is usually checking is the one still open.
 */
export default async function TaxReportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const me = await requireSelf();
  if (!canSeeTaxReport(me)) notFound();

  const t = await getT();
  const { money, shortDate, todayIso, settings } = await getFormat();
  const params = await searchParams;
  const to = params.to ?? todayIso();
  const from = params.from ?? `${todayIso().slice(0, 7)}-01`;

  const report = await serverFetch<TaxReport>(`/reports/tax?from=${from}&to=${to}`);
  const rule = taxRule(me.tenant.tax_regime);
  const taxName = report.tax_name ?? rule.taxName ?? t('Tax');

  const net = BigInt(report.net_tax);
  const netAbs = (net < 0n ? -net : net).toString();
  const monthName = new Intl.DateTimeFormat(settings.locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <FadeIn className="flex flex-col gap-5">
      <ReportsNav
        from={from}
        to={to}
        isOwnerOrAccounts={['owner', 'accounts'].includes(me.user.role)}
        showTax
      />

      <p className="rounded-btn bg-neutral-bg px-3.5 py-2.5 text-[13px] leading-snug text-ink-soft">
        <strong className="font-semibold text-ink">
          {t('A worksheet for your accountant, not a filed return.')}
        </strong>{' '}
        {taxName} {t('paid inside expenses, and charged on instalments raised to clients, from')}{' '}
        {shortDate(from)} {t('to')} {shortDate(to)}.
        {report.standard_rate_bp !== null &&
          ` ${t('Standard rate')} ${report.standard_rate_bp / 100}%.`}
      </p>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatTile
          label={`${t('Input')} ${taxName}`}
          value={money(report.input_tax)}
          note={`${t('Paid on')} ${report.expenses_with_tax} ${
            report.expenses_with_tax === 1 ? t('bill') : t('bills')
          } — ${t('reclaimable')}`}
          noteTone="done"
        />
        <StatTile
          label={`${t('Output')} ${taxName}`}
          value={money(report.output_tax)}
          note={`${t('Charged on')} ${money(report.taxable_sales)} ${t('of instalments')}`}
        />
        <StatTile
          label={
            net > 0n
              ? `${taxName} ${t('owed')}`
              : net < 0n
                ? `${taxName} ${t('to reclaim')}`
                : `${t('Net')} ${taxName}`
          }
          value={money(netAbs)}
          note={
            net > 0n
              ? t('Output is more than input: payable to the tax authority')
              : net < 0n
                ? t('Input is more than output: reclaimable from the tax authority')
                : t('Input and output cancel out')
          }
          noteTone={net > 0n ? 'pending' : net < 0n ? 'done' : 'neutral'}
        />
      </div>

      {report.missing_supplier_tax_id > 0 && (
        <p className="flex items-start gap-2 rounded-btn bg-pending-bg px-3.5 py-2.5 text-[13px] leading-snug text-pending-fg">
          <AlertTriangle className="mt-0.5 size-4 flex-none" />
          <span>
            {report.missing_supplier_tax_id}{' '}
            {report.missing_supplier_tax_id === 1 ? t('bill carries') : t('bills carry')} {taxName}{' '}
            {t('but no supplier')} {rule.idLabel ?? t('tax number')}.{' '}
            {t('That tax usually cannot be claimed until the number is on record.')}{' '}
            <Link href="/expenses" className="font-semibold underline">
              {t('Go to expenses')}
            </Link>
          </span>
        </p>
      )}

      {report.by_month.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title={`${t('No')} ${taxName} ${t('in this range')}`}
          body={t(
            'Record the tax on expenses and instalments, or pick a wider date range, to see it here.',
          )}
        />
      ) : (
        <Card className="flex flex-col gap-2 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            {t('By month')}
          </span>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Month')}</TableHead>
                <TableHead className="text-right">{t('Input')}</TableHead>
                <TableHead className="text-right">{t('Output')}</TableHead>
                <TableHead className="text-right">{t('Net')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_month.map((row) => {
                const monthNet = BigInt(row.output_tax) - BigInt(row.input_tax);
                return (
                  <TableRow key={row.month}>
                    <TableCell className="font-medium">
                      {monthName.format(new Date(`${row.month}-01T00:00:00Z`))}
                    </TableCell>
                    <TableCell className="text-right font-mono">{money(row.input_tax)}</TableCell>
                    <TableCell className="text-right font-mono">{money(row.output_tax)}</TableCell>
                    <TableCell className="text-right font-mono">
                      <NetAmount net={monthNet} money={money} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{t('Total')}</TableCell>
                <TableCell className="text-right font-mono">{money(report.input_tax)}</TableCell>
                <TableCell className="text-right font-mono">{money(report.output_tax)}</TableCell>
                <TableCell className="text-right font-mono">
                  <NetAmount net={net} money={money} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <span className="text-[12px] text-ink-muted">
            {t('Net is output less input: a plain figure is owed, one in brackets is reclaimable.')}
          </span>
        </Card>
      )}
    </FadeIn>
  );
}

/** Owed reads plain; reclaimable in brackets, the way an accountant's worksheet shows a credit. */
function NetAmount({ net, money }: { net: bigint; money: (value: string) => string }) {
  if (net < 0n) return <span className="text-done">({money((-net).toString())})</span>;
  return <span>{money(net.toString())}</span>;
}
