import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileWarning,
  PauseCircle,
  Siren,
} from 'lucide-react';
import type { DashboardOverview } from '@/lib/api-types';
import { getT } from '@/lib/i18n-server';

/**
 * What is wrong today, in one line, with somewhere to go about each of it.
 *
 * The site cards below carry all of this already — but spread across one card per job, which means
 * reading twelve cards to find the two that need something. A command centre's first duty is to
 * say "these are the ones", and its second is to make each one a link rather than a fact.
 *
 * Nothing appears when nothing is wrong except the line saying so. A strip that always has four
 * chips in it teaches people to stop looking at the strip.
 */
export async function AttentionStrip({
  sites,
  totals,
  wagePeriods,
}: {
  sites: DashboardOverview['sites'];
  totals: DashboardOverview['totals'];
  wagePeriods: DashboardOverview['wage_periods'];
}) {
  const t = await getT();
  const missingDpr = sites.filter((site) => site.dpr_status !== 'submitted');
  const onHold = sites.filter((site) => site.status === 'on_hold');
  const reportingIssues = sites.filter((site) => site.dpr_has_issues);

  const items = [
    {
      key: 'urgent',
      show: totals.urgent_indents > 0,
      icon: Siren,
      tone: 'bg-blocked-bg text-blocked-fg',
      label: `${totals.urgent_indents} urgent ${totals.urgent_indents === 1 ? 'indent' : 'indents'}`,
      href: '/indents',
    },
    {
      key: 'hold',
      show: onHold.length > 0,
      icon: PauseCircle,
      tone: 'bg-blocked-bg text-blocked-fg',
      label: `${onHold.length} ${onHold.length === 1 ? 'site' : 'sites'} on hold`,
      href: '/projects',
      detail: onHold.map((site) => site.name).join(', '),
    },
    {
      key: 'dpr',
      show: missingDpr.length > 0,
      icon: FileWarning,
      tone: 'bg-pending-bg text-pending-fg',
      label: `${missingDpr.length} without today's report`,
      href: '/projects',
      detail: missingDpr.map((site) => site.name).join(', '),
    },
    {
      key: 'issues',
      show: reportingIssues.length > 0,
      icon: AlertTriangle,
      tone: 'bg-pending-bg text-pending-fg',
      label: `${reportingIssues.length} reporting issues`,
      href: '/projects',
      detail: reportingIssues.map((site) => site.name).join(', '),
    },
    {
      // The one on this list that costs somebody money today: wages are not paid until the period
      // is finalised, and a period whose end date has passed is a week of work nobody can be paid
      // for.
      key: 'wages_overdue',
      show: wagePeriods.overdue_count > 0,
      icon: CalendarClock,
      tone: 'bg-blocked-bg text-blocked-fg',
      label: `${wagePeriods.overdue_count} wage ${wagePeriods.overdue_count === 1 ? 'period' : 'periods'} to finalise`,
      href: '/labour/wage-periods',
    },
    {
      // Only inside a week. A period closing in three weeks is not news.
      key: 'wages_soon',
      show:
        wagePeriods.overdue_count === 0 &&
        wagePeriods.days_to_close !== null &&
        wagePeriods.days_to_close <= 7,
      icon: CalendarClock,
      tone: 'bg-accent-soft text-accent',
      label:
        wagePeriods.days_to_close === 0
          ? 'Wage period closes today'
          : `Wage period closes in ${wagePeriods.days_to_close} ${wagePeriods.days_to_close === 1 ? 'day' : 'days'}`,
      href: '/labour/wage-periods',
    },
    {
      key: 'expenses',
      show: totals.pending_expenses > 0,
      icon: AlertTriangle,
      tone: 'bg-accent-soft text-accent',
      label: `${totals.pending_expenses} ${totals.pending_expenses === 1 ? 'expense' : 'expenses'} to approve`,
      href: '/expenses',
    },
  ].filter((item) => item.show);

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-card border border-done/25 bg-done-bg/50 px-4 py-2.5">
        <CheckCircle2 className="size-4 flex-none text-done-fg" />
        <span className="text-[13.5px] font-medium text-done-fg">
          {t('Nothing needs you right now — every site has reported and nothing is waiting.')}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {t('Needs attention')}
      </span>
      {items.map(({ key, icon: Icon, tone, label, href, detail }) => (
        <Link
          key={key}
          href={href}
          title={detail}
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-semibold transition hover:brightness-95 ${tone}`}
        >
          <Icon className="size-3.5" />
          {label}
        </Link>
      ))}
    </div>
  );
}
