import Link from 'next/link';
import { AlertTriangle, Building2, Download, HardHat, Landmark, Users } from 'lucide-react';
import {
  COMPANY_GROUP_COUNT_KEYS,
  COMPANY_GROUP_MONEY_KEYS,
  type CompanyGroupCountKey,
  type CompanyGroupMoneyKey,
} from '@sitebook/shared';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server-api';
import { getT } from '@/lib/i18n-server';
import { createFormat } from '@/lib/format';
import { getFormat } from '@/lib/format-server';
import { requireSelf } from '@/lib/session';
import type { CompanyGroupReport } from '@/lib/company-group-types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { StatTile } from '@/components/stat-tile';
import { FadeIn } from '@/components/motion';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export const metadata = { title: 'Group overview · BUILDR' };

const MONEY_LABELS: Record<CompanyGroupMoneyKey, string> = {
  labour_cost: 'Labour cost',
  expenses: 'Expenses',
  committed: 'Committed',
  budget: 'Budget',
  actual: 'Actual to date',
  receivables: 'Receivables',
};

const COUNT_LABELS: Record<CompanyGroupCountKey, string> = {
  sites_active: 'Active sites',
  headcount_today: 'On today’s roll',
  open_incidents: 'Open incidents',
  open_snags: 'Open snags',
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The consolidated report (roadmap Phase 2, module 11) — for group admins only; the API refuses
 * everybody else and this page says so rather than showing an error.
 *
 * Each company is printed in its own currency with its own conventions — dirhams as a Dubai
 * company writes them, rupees in lakh and crore — and only the total row is converted, at the
 * group's own rates, which are shown beside it.
 */
export default async function GroupOverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await getT();
  const params = await searchParams;
  const { shortDate } = await getFormat();
  await requireSelf();

  const query = new URLSearchParams();
  if (params['from'] && ISO_DATE.test(params['from'])) query.set('from', params['from']);
  if (params['to'] && ISO_DATE.test(params['to'])) query.set('to', params['to']);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  let report: CompanyGroupReport;
  try {
    report = await serverFetch<CompanyGroupReport>(`/company-groups/current/report${suffix}`);
  } catch (error) {
    if (error instanceof ApiRequestError && (error.status === 403 || error.status === 404)) {
      return (
        <EmptyState
          icon={<Landmark className="size-6" />}
          title={error.status === 404 ? t('This company is not in a group') : t('For group admins')}
          body={
            error.status === 404
              ? t('Start a group or accept an invitation under Settings → Company group.')
              : t('The consolidated report is for people the group has made group admins.')
          }
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/settings/group">{t('Company group settings')}</Link>
            </Button>
          }
        />
      );
    }
    throw error;
  }

  const base = createFormat({ currency: report.total.currency, locale: localeFor(report), timezone: 'UTC' });
  const formatOf = (currency: string, locale: string) =>
    createFormat({ currency, locale, timezone: 'UTC' });

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[19px] font-semibold leading-tight">{report.group.name}</h2>
          <p className="text-[13.5px] text-ink-muted">
            {t('Labour cost and expenses for')} {shortDate(report.period.from)} – {shortDate(report.period.to)}.{' '}
            {t('Everything else is to date.')}
          </p>
        </div>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-muted">
            {t('From')}
            <Input type="date" name="from" defaultValue={report.period.from} className="h-9 w-40" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-muted">
            {t('To')}
            <Input type="date" name="to" defaultValue={report.period.to} className="h-9 w-40" />
          </label>
          <Button type="submit" size="sm" variant="secondary">
            {t('Apply')}
          </Button>
          <Button asChild size="sm" variant="secondary">
            <a href={`/group/export?from=${report.period.from}&to=${report.period.to}`}>
              <Download /> {t('Export CSV')}
            </a>
          </Button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label={t('Companies')}
          value={String(report.companies.length)}
          icon={<Building2 className="size-4" />}
        />
        <StatTile
          label={t('Active sites')}
          value={String(report.total.counts.sites_active)}
          icon={<HardHat className="size-4" />}
        />
        <StatTile
          label={t('On today’s roll')}
          value={String(report.total.counts.headcount_today)}
          icon={<Users className="size-4" />}
        />
        <StatTile
          label={`${t('Actual to date')} (${report.total.currency})`}
          value={base.moneyShort(report.total.money.actual)}
          note={
            report.total.complete
              ? `${t('Budget')} ${base.moneyShort(report.total.money.budget)}`
              : t('Some companies are not in this total')
          }
          noteTone={report.total.complete ? 'neutral' : 'pending'}
          icon={<Landmark className="size-4" />}
        />
      </div>

      {!report.total.complete && (
        <p className="flex items-start gap-2 rounded-btn border border-pending-line bg-pending-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-pending-fg">
          <AlertTriangle className="mt-0.5 size-4 flex-none" />
          <span>
            {t('No exchange rate for')} <span className="font-mono">{report.total.missing_currencies.join(', ')}</span>{' '}
            {t('on')} {shortDate(report.rates_as_of)}. {t('Those companies are shown in their own currency but left out of the group total.')}{' '}
            <Link href="/settings/group" className="font-semibold underline underline-offset-2">
              {t('Set a rate')}
            </Link>
          </span>
        </p>
      )}

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Company')}</TableHead>
              {COMPANY_GROUP_MONEY_KEYS.map((key) => (
                <TableHead key={key} className="text-end">
                  {t(MONEY_LABELS[key])}
                </TableHead>
              ))}
              <TableHead className="text-end">{t('Budget used')}</TableHead>
              {COMPANY_GROUP_COUNT_KEYS.map((key) => (
                <TableHead key={key} className="text-end">
                  {t(COUNT_LABELS[key])}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.companies.map((company) => {
              const format = formatOf(company.currency, company.locale);
              return (
                <TableRow key={company.tenant_id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{company.name}</span>
                      <span className="font-mono text-[12px] text-ink-muted">{company.currency}</span>
                    </div>
                  </TableCell>
                  {COMPANY_GROUP_MONEY_KEYS.map((key) => (
                    <TableCell key={key} className="whitespace-nowrap text-end font-mono">
                      {format.money(company.money[key])}
                    </TableCell>
                  ))}
                  <TableCell className="text-end font-mono">
                    {percentUsed(company.money.actual, company.money.budget)}
                  </TableCell>
                  {COMPANY_GROUP_COUNT_KEYS.map((key) => (
                    <TableCell key={key} className="text-end font-mono">
                      {format.count(company.counts[key])}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>
                <div className="flex flex-col">
                  <span>{t('Group total')}</span>
                  <span className="font-mono text-[12px] font-normal text-ink-muted">
                    {report.total.currency}
                  </span>
                </div>
              </TableCell>
              {COMPANY_GROUP_MONEY_KEYS.map((key) => (
                <TableCell key={key} className="whitespace-nowrap text-end font-mono">
                  {base.money(report.total.money[key])}
                </TableCell>
              ))}
              <TableCell className="text-end font-mono">
                {percentUsed(report.total.money.actual, report.total.money.budget)}
              </TableCell>
              {COMPANY_GROUP_COUNT_KEYS.map((key) => (
                <TableCell key={key} className="text-end font-mono">
                  {base.count(report.total.counts[key])}
                </TableCell>
              ))}
            </TableRow>
          </TableFooter>
        </Table>
      </Card>

      <Card className="p-4">
        <h3 className="text-[14px] font-semibold">{t('Rates used for the group total')}</h3>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          {t('The group’s own rates on')} {shortDate(report.rates_as_of)}.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {report.total.rates_used.map((rate) => (
            <li
              key={rate.currency}
              dir="ltr"
              className="rounded-full bg-neutral-bg px-3 py-1 font-mono text-[12.5px] text-ink-soft"
            >
              1 {rate.currency} = {rate.rate} {report.total.currency}
              {rate.effective_from ? ` · ${shortDate(rate.effective_from)}` : ''}
            </li>
          ))}
        </ul>
      </Card>
    </FadeIn>
  );
}

/** Actual as a share of budget, or a dash where there is no budget to compare against. */
function percentUsed(actual: string, budget: string): string {
  const b = BigInt(budget || '0');
  if (b <= 0n) return '—';
  // Whole percent, computed on integers so a large budget never goes through a float.
  return `${((BigInt(actual || '0') * 100n) / b).toString()}%`;
}

/** The total reads in the locale of a company that uses the group currency, if there is one. */
function localeFor(report: CompanyGroupReport): string {
  return (
    report.companies.find((company) => company.currency === report.total.currency)?.locale ?? 'en'
  );
}
