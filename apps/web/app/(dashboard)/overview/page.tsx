import Link from 'next/link';
import { AlertTriangle, ArrowRight, Building2, FileText, IndianRupee, Users } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import { moneyShort, timeOfDay } from '@/lib/format';
import type { DashboardOverview, DashboardToday } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn, Stagger, StaggerItem } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { SiteCard } from '@/components/site-card';
import { DecisionPanel } from '@/components/decision-panel';
import { HeadcountChart } from '@/components/headcount-chart';

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
            icon={<FileText className="size-4" />}
          />
          <StatTile
            label="Headcount today"
            value={String(totals.headcount_today)}
            animate
            note={totals.headcount_today === 0 ? 'No attendance recorded yet' : 'On site now'}
            icon={<Users className="size-4" />}
          />
          <StatTile
            label="Spend this month"
            value={moneyShort(totals.spend_month)}
            note={
              BigInt(totals.budget_committed) > 0n
                ? `of ${moneyShort(totals.budget_committed)} budgeted`
                : `${moneyShort(totals.labour_cost_month)} labour, ${moneyShort(totals.expenses_month)} expenses`
            }
            icon={<IndianRupee className="size-4" />}
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
            icon={<AlertTriangle className="size-4" />}
          />
        </div>
      </FadeIn>

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

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No sites yet"
          body="Create your first project to start filing daily reports and attendance."
          action={
            <Button asChild size="sm">
              <Link href="/projects">Go to sites</Link>
            </Button>
          }
        />
      ) : (
        <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      <FadeIn delay={0.05}>
        <div className="grid gap-4 xl:grid-cols-3">
          <DecisionPanel
            approvals={today.approvals}
            canApprove={canApprove}
            className="h-full"
          />
          <HeadcountChart series={data.headcount_series} className="h-full xl:col-span-2" />
        </div>
      </FadeIn>

      {today.reports.length > 0 && (
        <FadeIn delay={0.1}>
          <Card className="flex flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
              <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
                Today’s reports
              </span>
              <span className="font-mono text-[13px] text-ink-muted">{today.reports.length}</span>
            </div>
            <ul className="divide-y divide-line-soft">
              {today.reports.map((report) => (
                <li key={report.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/projects/${report.project_id}?tab=reports`}
                        className="text-[14px] font-semibold hover:underline"
                      >
                        {report.project_name}
                      </Link>
                      <span className="text-[12.5px] text-ink-muted">
                        {report.submitted_by} · {timeOfDay(report.submitted_at)}
                      </span>
                    </div>
                    {report.work_done && (
                      <p className="line-clamp-2 text-[13.5px] leading-relaxed text-ink-soft">
                        {report.work_done}
                      </p>
                    )}
                    {report.issues && (
                      <p className="rounded-btn bg-blocked-bg px-2.5 py-1.5 text-[12.5px] leading-snug text-blocked-fg">
                        {report.issues}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    <span className="font-mono text-[13px] text-ink-muted">
                      {report.headcount} on site
                    </span>
                    {report.photo_count > 0 && (
                      <span className="font-mono text-[13px] text-ink-faint">
                        {report.photo_count} photos
                      </span>
                    )}
                    <Badge tone={report.status === 'submitted' ? 'done' : 'pending'}>
                      {report.status === 'submitted' ? 'Submitted' : 'Draft'}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
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
