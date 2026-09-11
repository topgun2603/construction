import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Flame,
  IndianRupee,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  platformFetch,
  type PlatformAnalytics,
  type PlatformMetrics,
} from '@/lib/platform-session';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { moneyShort, titleCase } from '@/lib/format';
import { EngagementChart, FunnelChart, GrowthChart, PlanMixBar, VolumeChart } from './charts';
import { RangePicker } from './range-picker';

export const metadata = { title: 'Overview · BUILDR platform' };

/**
 * The console's analytics page.
 *
 * Ordered by what an operator can act on, not by what is easiest to plot. Growth and the
 * activation funnel come first because they say whether the product is working; the
 * dormancy list comes last because it is the one thing on the page with names to ring.
 *
 * There is no revenue figure. Billing is not built yet (spec §16 step 12), so plan prices
 * exist nowhere in this system — and an invented MRR is the one number on a console like
 * this that somebody would actually make a decision on.
 */
export default async function PlatformOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  const params = await searchParams;
  const weeks = params.weeks ?? '12';

  const [metrics, analytics] = await Promise.all([
    platformFetch<PlatformMetrics>('/metrics'),
    platformFetch<PlatformAnalytics>(`/analytics?weeks=${weeks}`),
  ]);

  const latestWeek = analytics.activity[analytics.activity.length - 1];
  const previousWeek = analytics.activity[analytics.activity.length - 2];
  const latestMix = analytics.plan_mix[analytics.plan_mix.length - 1];
  const neverWorked = analytics.dormant.filter((row) => row.quiet_days === null).length;

  // Week-on-week movement in the share of tenants doing work. The direction matters more
  // than the figure, which is why it is shown as a signed delta rather than a ratio.
  const engagementDelta =
    latestWeek && previousWeek ? latestWeek.percent - previousWeek.percent : null;

  return (
    <FadeIn className="mx-auto flex max-w-[1400px] flex-col gap-5 px-6 pb-12 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold leading-tight">Platform overview</h1>
          <p className="text-[13.5px] text-ink-muted">
            Growth, activation and engagement across every tenant.
          </p>
        </div>
        <RangePicker weeks={analytics.weeks} />
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        {/*
          First tile now that billing exists. Counts only what is actually being charged — a trial or
          a past-due account is not revenue, and the past-due count beside it is the number worth
          chasing this week.
        */}
        <StatTile
          label="MRR"
          value={moneyShort(metrics.revenue.mrr)}
          animate
          note={
            metrics.revenue.past_due > 0
              ? `${metrics.revenue.past_due} payment${metrics.revenue.past_due === 1 ? '' : 's'} failed`
              : `${metrics.revenue.paying} paying · ${metrics.revenue.trialing} in trial`
          }
          noteTone={metrics.revenue.past_due > 0 ? 'blocked' : 'done'}
          icon={<IndianRupee className="size-4" />}
        />
        <StatTile
          label="Tenants"
          value={String(metrics.tenants.total)}
          animate
          note={`${metrics.tenants.new_this_month} joined this month`}
          noteTone={metrics.tenants.new_this_month > 0 ? 'done' : 'neutral'}
          icon={<Building2 className="size-4" />}
        />
        <StatTile
          label="Working this week"
          value={latestWeek ? `${latestWeek.active} / ${latestWeek.existing}` : '—'}
          animate
          note={
            engagementDelta === null
              ? 'Attendance or a report filed'
              : `${engagementDelta >= 0 ? '+' : ''}${engagementDelta} pts on last week`
          }
          noteTone={
            engagementDelta === null ? 'neutral' : engagementDelta >= 0 ? 'done' : 'blocked'
          }
          icon={<TrendingUp className="size-4" />}
        />
        <StatTile
          label="Gone quiet"
          value={String(analytics.dormant.length)}
          animate
          note={
            analytics.dormant.length === 0
              ? 'Every account is working'
              : `${neverWorked} never started at all`
          }
          noteTone={analytics.dormant.length > 0 ? 'pending' : 'done'}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="People"
          value={String(metrics.usage.users)}
          animate
          note={`${metrics.usage.workers} workers · ${metrics.usage.active_projects} live sites`}
          icon={<Users className="size-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Signups per week
            </span>
            <span className="font-mono text-[13px] text-ink-muted">
              {metrics.tenants.total} total
            </span>
          </div>
          <GrowthChart data={analytics.signups} />
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Activation funnel
            </span>
            <span className="font-mono text-[13px] text-ink-muted">all time</span>
          </div>
          <FunnelChart steps={analytics.funnel} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Tenants doing work
            </span>
            {latestWeek && (
              <span className="font-mono text-[13px] text-ink-muted">{latestWeek.percent}% now</span>
            )}
          </div>
          <EngagementChart data={analytics.activity} />
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              What the platform processed · 30 days
            </span>
            <span className="font-mono text-[13px] text-ink-muted">
              {analytics.volume.reduce((sum, d) => sum + d.attendance, 0).toLocaleString('en-IN')}{' '}
              attendance rows
            </span>
          </div>
          <VolumeChart data={analytics.volume} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="flex flex-col gap-3 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Plan mix
          </span>
          <PlanMixBar starter={latestMix?.starter ?? 0} pro={latestMix?.pro ?? 0} />
          <div className="mt-auto flex flex-col gap-1.5 border-t border-line-soft pt-3 text-[12.5px]">
            <Row label="Active" value={metrics.tenants.active} />
            <Row label="Suspended" value={metrics.tenants.suspended} tone="blocked" />
            <Row label="Cancelled" value={metrics.tenants.cancelled} />
          </div>
        </Card>

        <Card className="flex flex-col xl:col-span-2">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              <Flame className="size-3.5" />
              Busiest accounts · 30 days
            </span>
          </div>
          {analytics.leaders.length === 0 ? (
            <p className="px-4 py-5 text-[13.5px] text-ink-muted">
              Nobody has recorded work in the last month.
            </p>
          ) : (
            <ul className="divide-y divide-line-soft">
              {analytics.leaders.map((leader, index) => (
                <li
                  key={leader.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-4 flex-none font-mono text-[12px] text-ink-faint">
                      {index + 1}
                    </span>
                    <Link
                      href={`/admin/tenants/${leader.id}`}
                      className="truncate text-[14px] font-medium hover:underline"
                    >
                      {leader.name}
                    </Link>
                    <Badge tone={leader.plan === 'pro' ? 'accent' : 'neutral'} dot={false}>
                      {titleCase(leader.plan)}
                    </Badge>
                  </div>
                  <span className="flex flex-none items-baseline gap-3 font-mono text-[12.5px]">
                    <span className="font-semibold">
                      {leader.attendance.toLocaleString('en-IN')}
                    </span>
                    <span className="text-ink-muted">{leader.reports} reports</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/*
        Last on the page and the only part with something to do about it. Ordered by how
        long each account has been silent, with the ones that never started first — that is
        an onboarding conversation, which is a different and easier call than win-back.
      */}
      <Card className="flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Needs a call · quiet for two weeks or more
          </span>
          <Link
            href="/admin/tenants?status=active"
            className="flex items-center gap-1.5 text-[13px] text-accent hover:underline"
          >
            All tenants <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {analytics.dormant.length === 0 ? (
          <p className="px-4 py-5 text-[13.5px] text-ink-muted">
            Nothing to chase — every active tenant has recorded work in the last fortnight.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {analytics.dormant.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Link
                    href={`/admin/tenants/${row.id}`}
                    className="truncate text-[14px] font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <Badge tone={row.plan === 'pro' ? 'accent' : 'neutral'} dot={false}>
                    {titleCase(row.plan)}
                  </Badge>
                </div>
                {row.quiet_days === null ? (
                  <Badge tone="blocked">Never recorded anything</Badge>
                ) : (
                  <span className="font-mono text-[12.5px] text-pending-fg">
                    quiet {row.quiet_days} days
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </FadeIn>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'blocked';
}) {
  return (
    <span className="flex items-center justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <span
        className={
          tone === 'blocked' && value > 0 ? 'font-mono font-semibold text-blocked-fg' : 'font-mono font-semibold'
        }
      >
        {value}
      </span>
    </span>
  );
}
