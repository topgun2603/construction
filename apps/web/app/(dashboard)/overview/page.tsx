import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, Users, Wallet } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { moneyShort } from '@/lib/format';
import type { DashboardOverview, DashboardToday } from '@/lib/api-types';
import { Button } from '@/components/ui/button';
import { FadeIn, Stagger, StaggerItem } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { SiteCard } from '@/components/site-card';
import { DecisionPanel } from '@/components/decision-panel';
import { HeadcountChart } from '@/components/headcount-chart';
import { cn } from '@/lib/utils';
import { StartBanner } from './start-banner';
import { AttentionStrip } from './attention-strip';
import { OverrunAlert } from './overrun-alert';
import { SpendBar } from './spend-bar';
import { TodayFeed } from './today-feed';

export const metadata = { title: 'Overview · BUILDR' };

/**
 * All sites, today (design artboard 3a).
 *
 * The grid holds site cards *plus* the decision panel and the headcount trend, so
 * the screen answers "what happened today and what is it costing me" without a
 * second click. Cards are sorted by trouble rather than alphabet — a stopped site
 * or a missing report floats to the top.
 */
export default async function OverviewPage() {
  const [data, today, me] = await Promise.all([
    serverFetch<DashboardOverview>('/dashboard/overview'),
    serverFetch<DashboardToday>('/dashboard/today'),
    // Shares the layout's `/me` rather than issuing a second one.
    requireSelf(),
  ]);

  const { totals, sites } = data;
  const canApprove = ['owner', 'project_manager'].includes(me.user.role);
  const missingDpr = sites.filter((site) => site.dpr_status !== 'submitted');
  const withIssues = sites.filter((site) => site.dpr_has_issues);
  const sorted = [...sites].sort(troubleFirst);

  return (
    <div className="flex flex-col gap-5">
      <FadeIn>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="DPRs in"
            value={`${totals.dprs_in} / ${totals.site_count}`}
            note={
              missingDpr.length === 0
                ? 'Every site has reported'
                : `${missingDpr.map((s) => s.name).slice(0, 2).join(', ')} pending`
            }
            noteTone={missingDpr.length === 0 ? 'done' : 'pending'}
            tone="neutral"
            icon={<Building2 className="size-5" />}
            href="/projects"
            hrefLabel="Open sites"
          />
          <StatTile
            label="Headcount today"
            value={String(totals.headcount_today)}
            animate
            note={totals.headcount_today === 0 ? 'No attendance recorded yet' : 'On site now'}
            noteTone={totals.headcount_today === 0 ? 'neutral' : 'done'}
            tone="done"
            icon={<Users className="size-5" />}
            href="/labour/attendance"
            hrefLabel="Open attendance"
          />
          <StatTile
            label="Spend this month"
            value={moneyShort(totals.spend_month)}
            note={
              BigInt(totals.budget_committed) > 0n
                ? `of ${moneyShort(totals.budget_committed)} budgeted`
                : `${moneyShort(totals.labour_cost_month)} labour, ${moneyShort(totals.expenses_month)} expenses`
            }
            tone="pending"
            icon={<Wallet className="size-5" />}
            href="/expenses"
            hrefLabel="Open expenses"
          />
          <StatTile
            label="Needs you"
            value={String(totals.pending_indents)}
            animate
            note={
              totals.pending_indents === 0
                ? 'Nothing waiting'
                : `${totals.urgent_indents} urgent · ${withIssues.length} sites reporting issues`
            }
            noteTone={totals.urgent_indents > 0 ? 'blocked' : 'neutral'}
            tone="blocked"
            icon={<AlertTriangle className="size-5" />}
            href="/indents"
            hrefLabel="Open approvals"
          />
        </div>
      </FadeIn>

      {sorted.length > 0 && (
        <FadeIn delay={0.03}>
          <AttentionStrip sites={sites} totals={totals} wagePeriods={data.wage_periods} />
        </FadeIn>
      )}

      {sorted.length > 0 && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            Sites
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/indents">
              All approvals <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <StartBanner />
      ) : (
        /*
          The column count follows the number of sites.
          
          A fixed three-column grid gave a builder with one site a card in the first third and two
          empty tracks beside it — the page read as broken rather than as empty. Counting first
          costs nothing and means one site fills the row, two split it, and three or more go
          three-up as before.
        */
        <Stagger
          className={cn(
            'grid gap-4',
            sorted.length === 1
              ? ''
              : sorted.length === 2
                ? 'md:grid-cols-2'
                : 'md:grid-cols-2 xl:grid-cols-3',
          )}
        >
          {sorted.map((site) => (
            <StaggerItem key={site.id} className="h-full">
              <SiteCard site={site} />
            </StaggerItem>
          ))}
        </Stagger>
      )}

      {/*
        The decision panel and the trend get their own fixed row rather than
        trailing the site grid: with an arbitrary number of sites they would land
        in whatever cells were left over, and any site count that is not a multiple
        of three leaves a hole. A 1 + 2 split is the same every time.
      */}
      {/*
        Decisions beside the feed, trend beside the money.
        
        Each row answers one question: "what is waiting on me and what happened today", then "how
        many people and how much money". Pairing them that way is what makes this readable top to
        bottom rather than a wall of equally weighted cards.
      */}
      <FadeIn delay={0.05}>
        <div className="grid gap-4 xl:grid-cols-3">
          <DecisionPanel approvals={today.approvals} canApprove={canApprove} className="h-full" />
          <TodayFeed reports={today.reports} className="h-full max-h-[460px] xl:col-span-2" />
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div className="grid gap-4 xl:grid-cols-3">
          <HeadcountChart
            series={data.headcount_series}
            trend={data.headcount_trend}
            className="h-full xl:col-span-2"
          />
          <SpendBar
            spendMonth={totals.spend_month}
            labourMonth={totals.labour_cost_month}
            expensesMonth={totals.expenses_month}
            budgetCommitted={totals.budget_committed}
          />
        </div>
      </FadeIn>

      {/* An alert, not a fixture: it renders only when something is actually past its estimate. */}
      {data.overruns.length > 0 && (
        <FadeIn delay={0.15}>
          <OverrunAlert overruns={data.overruns} />
        </FadeIn>
      )}
    </div>
  );
}

/** Stopped work first, then a missing report, then urgent indents. */
function troubleFirst(a: DashboardOverview['sites'][number], b: DashboardOverview['sites'][number]) {
  const score = (site: DashboardOverview['sites'][number]) =>
    (site.status === 'on_hold' ? 0 : 100) +
    (site.dpr_status === 'submitted' ? 20 : 0) +
    (site.urgent_indents > 0 ? 0 : 10) +
    (site.dpr_has_issues ? 0 : 5);
  return score(a) - score(b);
}
