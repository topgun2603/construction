import Link from 'next/link';
import { AlertTriangle, ArrowRight, Boxes, PackageCheck, PackageMinus } from 'lucide-react';
import { serverFetch } from '@/lib/server-api';
import { requireSelf } from '@/lib/session';
import type { Material, Page, ProjectSummary, StockOnHand } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FadeIn } from '@/components/motion';
import { StatTile } from '@/components/stat-tile';
import { StockFilters } from './stock-filters';
import { RecordMovementDialog } from './record-movement-dialog';

export const metadata = { title: 'Stock · BUILDR' };

/**
 * What is on site now.
 *
 * A site filter rather than one combined figure by default: cement on the Lake View job is not
 * available to the Hill Road job, and a single total would suggest otherwise. "All sites" is
 * offered for the owner asking what the company is holding, which is a different question.
 */
export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>;
}) {
  const params = await searchParams;

  const [projects, materials, me] = await Promise.all([
    serverFetch<Page<ProjectSummary>>('/projects?limit=200'),
    // Loaded here so the dialog opens instantly instead of fetching a catalogue on click.
    serverFetch<Page<Material>>('/materials?limit=500'),
    requireSelf(),
  ]);

  const projectId = params.project_id ?? projects.items[0]?.id ?? '';
  const stock = await serverFetch<StockOnHand>(
    projectId ? `/stock?project_id=${projectId}` : '/stock',
  );

  const canRecord = me.permissions.includes('stock.record');
  const negatives = stock.items.filter((row) => row.negative);
  const emptyShelves = stock.items.filter((row) => !row.negative && Number(row.on_hand) === 0);

  return (
    <FadeIn className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <StockFilters projects={projects.items} projectId={projectId} />
        {canRecord && projectId && (
          <RecordMovementDialog
            projectId={projectId}
            projects={projects.items}
            materials={materials.items}
          />
        )}
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <StatTile
          label="Materials tracked"
          value={String(stock.totals.material_count)}
          note={emptyShelves.length > 0 ? `${emptyShelves.length} at zero` : 'All have stock'}
          noteTone={emptyShelves.length > 0 ? 'pending' : 'done'}
          icon={<Boxes className="size-4" />}
        />
        <StatTile
          label="Needs checking"
          value={String(negatives.length)}
          note={
            negatives.length === 0
              ? 'The ledger balances'
              : 'More issued than received — a challan is missing'
          }
          noteTone={negatives.length > 0 ? 'blocked' : 'done'}
          icon={<AlertTriangle className="size-4" />}
        />
        <StatTile
          label="Against estimate"
          value="Overrun report"
          note="Consumption vs what the job should take"
          icon={<ArrowRight className="size-4" />}
        />
      </div>

      {negatives.length > 0 && (
        <Card className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 size-5 flex-none text-blocked-fg" />
          <div className="flex flex-col gap-1">
            <span className="text-[14px] font-semibold">
              {negatives.length} {negatives.length === 1 ? 'material shows' : 'materials show'} less
              than nothing on site
            </span>
            <span className="text-[13px] leading-relaxed text-ink-muted">
              That means material was issued that the ledger never saw arrive — usually an inward
              challan nobody entered. Worth fixing now: the overrun report reads as nonsense until
              it is.
            </span>
          </div>
        </Card>
      )}

      {stock.items.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="Nothing on the stock ledger yet"
          body="Receiving an approved indent books material in automatically. You can also record a delivery or an issue by hand."
          action={
            canRecord && projectId ? (
              <RecordMovementDialog
            projectId={projectId}
            projects={projects.items}
            materials={materials.items}
          />
            ) : undefined
          }
        />
      ) : (
        <Card className="flex flex-col">
          <div className="flex items-center justify-between border-b border-line-soft px-4 py-3">
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
              On site
            </span>
            <Button asChild variant="ghost" size="sm">
              <Link href={`/stock/movements${projectId ? `?project_id=${projectId}` : ''}`}>
                Full ledger <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-line-soft text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                  <th className="px-4 py-2.5 text-left font-semibold">Material</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Received</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Used</th>
                  <th className="px-4 py-2.5 text-right font-semibold">On site</th>
                </tr>
              </thead>
              <tbody>
                {stock.items.map((row) => (
                  <tr
                    key={row.material_id}
                    className="border-b border-line-soft last:border-0 hover:bg-raised"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col">
                        <span className="font-medium">{row.material_name}</span>
                        {row.category && (
                          <span className="text-[12px] text-ink-muted">{row.category}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <PackageCheck className="size-3.5" />
                        {row.received}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-ink-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <PackageMinus className="size-3.5" />
                        {row.used}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {row.negative ? (
                        <Badge tone="blocked">
                          {row.on_hand} {row.unit}
                        </Badge>
                      ) : (
                        <span className="font-mono font-semibold">
                          {row.on_hand} <span className="text-[12px] text-ink-muted">{row.unit}</span>
                        </span>
                      )}
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
