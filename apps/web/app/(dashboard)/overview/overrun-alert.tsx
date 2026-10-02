import Link from 'next/link';
import { ArrowRight, TriangleAlert } from 'lucide-react';
import type { DashboardOverview } from '@/lib/api-types';
import { Card } from '@/components/ui/card';
import { getT } from '@/lib/i18n-server';

/**
 * Materials consumed past what anybody estimated.
 *
 * This is an alert, not a panel: it renders only when something is over, and it shows four at
 * most. The full report is a screen of its own and lists everything — what belongs on the
 * overview is the fact that cement is 18% past estimate at all, with a way through to the detail.
 *
 * Consumption, not delivery. Material in the store has been paid for and not yet used, and
 * counting it here would flag a site that simply took delivery early.
 */
export async function OverrunAlert({ overruns }: { overruns: DashboardOverview['overruns'] }) {
  const t = await getT();
  if (overruns.length === 0) return null;

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          <TriangleAlert className="size-3.5 text-pending-fg" />
          {t('Past estimate')}
        </span>
        <Link
          href="/reports/overrun"
          className="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
        >
          {t('Full report')} <ArrowRight className="size-3.5" />
        </Link>
      </div>

      <ul className="flex flex-col gap-2.5">
        {overruns.map((row) => (
          <li key={row.material_name} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13.5px] font-medium">{row.material_name}</span>
              <span className="font-mono text-[12.5px] text-pending-fg">
                {row.percent_used}% of estimate
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-track">
              {/* The bar is capped at the track but the number is not: 400% over is a real state
                  and a bar that keeps growing would just break the layout. */}
              <span
                aria-hidden
                className="block h-full bg-pending"
                style={{ width: `${Math.min(row.percent_used, 100)}%` }}
              />
            </div>
            <span className="font-mono text-[12px] text-ink-muted">
              {row.consumed} used of {row.estimated} {row.unit} planned
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
