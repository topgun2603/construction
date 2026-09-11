import { AlertTriangle, PackageSearch } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { MaterialOverrun, Page, ProjectSummary } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { OverrunFilters } from './overrun-filters';

export const metadata = { title: 'Material overrun · BUILDR' };

/**
 * Consumption against estimate (spec §3 item 11).
 *
 * Measures what was *used*, not what was delivered. Material in the store has been paid for but
 * not consumed, and counting it would flag an overrun on a site that simply took delivery early —
 * the report would cry wolf on exactly the well-run job.
 *
 * No date range, unlike the other reports. An overrun is cumulative: a slab that took 20 bags too
 * many is over by 20 bags whether you look this week or next, and slicing it by month would hide
 * the figure that matters behind an arbitrary boundary.
 */
export default async function OverrunPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string; all?: string }>;
}) {
  const params = await searchParams;
  const showAll = params.all === 'true';

  const [projects, me] = await Promise.all([
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    requireSelf(),
  ]);

  const projectId = params.project_id ?? '';
  const query = new URLSearchParams();
  if (projectId) query.set('project_id', projectId);
  if (showAll) query.set('estimated_only', 'false');
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const report = await serverFetch<MaterialOverrun>(`/stock/overrun${suffix}`);
  const over = report.items.filter((row) => row.over);

  return (
    <FadeIn className="flex flex-col gap-5">
      <OverrunFilters
        projects={projects.items}
        projectId={projectId}
        showAll={showAll}
        isOwnerOrAccounts={['owner', 'accounts'].includes(me.user.role)}
      />

      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatTile
          label="Over estimate"
          value={String(report.totals.over_estimate)}
          note={
            report.totals.over_estimate === 0
              ? 'Nothing has gone over'
              : `of ${report.totals.material_count} materials measured`
          }
          noteTone={report.totals.over_estimate > 0 ? 'blocked' : 'done'}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Materials measured"
          value={String(report.totals.material_count)}
          note={showAll ? 'Including those with no estimate' : 'With an estimate set'}
          icon={<PackageSearch className="size-4" />}
        />
        <StatTile
          label="Worst overrun"
          value={over[0] ? `${over[0].variance} ${over[0].unit}` : '—'}
          note={over[0]?.material_name ?? 'Nothing over'}
          noteTone={over[0] ? 'blocked' : 'done'}
        />
      </div>

      {report.items.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title="Nothing to measure yet"
          body="Set what a site should consume on its Materials tab, then record what it actually uses. This report is the difference."
        />
      ) : (
        <Card className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              Worst first
            </span>
            <span className="font-mono text-[13px] text-ink-muted">
              {report.items.length} materials
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-4 py-2.5 text-left font-semibold">Material</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Should take</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Used</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Delivered</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Variance</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((row) => (
                  <tr
                    key={row.material_id}
                    className="border-b border-line-soft last:border-0 hover:bg-raised"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-medium">{row.material_name}</span>
                        <span className="text-[12px] text-ink-muted">{row.unit}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-muted">
                      {Number(row.estimated) > 0 ? (
                        row.estimated
                      ) : (
                        <span className="text-ink-faint">not set</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold">
                      {row.consumed}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-muted">
                      {row.received}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {row.over ? (
                          <Badge tone="blocked">+{row.variance}</Badge>
                        ) : Number(row.estimated) > 0 ? (
                          <Badge tone="done" dot={false}>
                            {row.variance} left
                          </Badge>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                        {/*
                          Null percent means nothing was estimated. A literal "0%" would read as
                          on budget, which is a different statement from nobody having said what
                          this material should take.
                        */}
                        {row.percent_used !== null && (
                          <span
                            className={
                              row.over
                                ? 'font-mono text-[12px] text-blocked-fg'
                                : 'font-mono text-[12px] text-ink-muted'
                            }
                          >
                            {row.percent_used}% used
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </FadeIn>
  );
}
