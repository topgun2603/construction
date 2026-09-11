import Link from 'next/link';
import { PieChart } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { LabourCostReport } from '@/lib/api-types';
import { addDaysIso, money, moneyShort, shortDate, todayIso } from '@/lib/format';
import { Card } from '@/components/ui/card';
import { ProgressBar } from '@/components/ui/meter';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn, Stagger, StaggerItem } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { ReportFilters } from './report-filters';
import { ReportsNav } from './reports-nav';

export const metadata = { title: 'Reports · BUILDR' };

const GROUPS = ['project', 'contractor', 'worker'] as const;

/**
 * Labour cost for a date range (spec §8A "Reports").
 *
 * Every figure comes from the wage snapshot frozen on each attendance row, so
 * re-running last month tomorrow returns exactly what it returns today.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ group_by?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const to = params.to ?? todayIso();
  const from = params.from ?? addDaysIso(to, -29);
  const groupBy = (GROUPS as readonly string[]).includes(params.group_by ?? '')
    ? (params.group_by as (typeof GROUPS)[number])
    : 'project';

  const [report, me] = await Promise.all([
    serverFetch<LabourCostReport>(
      `/reports/labour-cost?group_by=${groupBy}&from=${from}&to=${to}`,
    ),
    requireSelf(),
  ]);

  const total = BigInt(report.total);
  const days = report.groups.reduce((sum, group) => sum + Number(group.days), 0);
  const overtime = report.groups.reduce((sum, group) => sum + Number(group.overtime_hours), 0);

  return (
    <FadeIn className="flex flex-col gap-5">
      <ReportsNav
        from={from}
        to={to}
        isOwnerOrAccounts={['owner', 'accounts'].includes(me.user.role)}
        extraParams={{ group_by: groupBy }}
      />
      <ReportFilters groupBy={groupBy} from={from} to={to} />

      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatTile
          label="Labour cost"
          value={moneyShort(report.total)}
          note={`${shortDate(from)} – ${shortDate(to)}`}
        />
        <StatTile label="Worker-days" value={days.toFixed(1)} note="Half days counted as 0.5" />
        <StatTile label="Overtime hours" value={overtime.toFixed(1)} note="Paid on top of the day rate" />
      </div>

      {report.groups.length === 0 ? (
        <EmptyState
          icon={<PieChart />}
          title="No attendance in this range"
          body="Pick a wider date range, or record a roll call to see labour cost here."
        />
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            By {groupBy}
          </span>
          <Stagger className="flex flex-col gap-3.5">
            {report.groups.map((group) => {
              const amount = BigInt(group.amount);
              const share = total > 0n ? Number((amount * 100n) / total) : 0;
              return (
                <StaggerItem key={group.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="truncate text-[14px] font-medium">{group.label}</span>
                    <div className="flex flex-none items-baseline gap-3">
                      <span className="font-mono text-[12.5px] text-ink-muted">
                        {group.days} d · {group.overtime_hours} h
                      </span>
                      <span className="font-mono text-[14px] font-semibold">
                        {money(group.amount)}
                      </span>
                    </div>
                  </div>
                  <ProgressBar percent={share} />
                </StaggerItem>
              );
            })}
          </Stagger>
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold">Wage sheets</span>
          <span className="text-[13px] text-ink-muted">
            Printable sheet with a signature column, for cash disbursement at site.
          </span>
        </div>
        <Link
          href="/labour/wage-periods"
          className="text-[13.5px] font-semibold text-accent hover:underline"
        >
          Go to wage periods →
        </Link>
      </Card>
    </FadeIn>
  );
}
