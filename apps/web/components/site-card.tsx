import Link from 'next/link';
import { moneyShort, timeOfDay } from '@/lib/format';
import type { DashboardSite } from '@/lib/api-types';
import { Badge } from '@/components/ui/badge';
import { MeterRow } from '@/components/ui/meter';
import { schedule } from '@/lib/projects';

/**
 * The site card (design artboards 1c and 3a).
 *
 * The second meter is spend vs budget: labour plus expenses for the month against
 * the project budget. Past 100% the overflow paints in the blocked colour - the one
 * place the design lets a bar carry status, because a site over budget is the thing
 * the owner opened this screen to find.
 */
export function SiteCard({ site }: { site: DashboardSite }) {
  const timeline = schedule(site);
  const budget = site.budget_amount ? BigInt(site.budget_amount) : null;
  const spend = BigInt(site.spend_month || '0');
  const budgetUsed = budget && budget > 0n ? Number((spend * 100n) / budget) : 0;
  const overBudget = budgetUsed > 100;

  return (
    <Link
      href={`/projects/${site.id}`}
      className="flex h-full flex-col gap-3.5 rounded-panel border border-line bg-surface p-4 transition hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-[17px] font-semibold leading-snug">{site.name}</span>
          <span className="truncate text-[13.5px] leading-tight text-ink-muted">
            {[site.address, site.client_name].filter(Boolean).join(' · ') || 'No site details'}
          </span>
        </div>
        {site.status === 'on_hold' ? (
          <Badge tone="blocked">Work stopped</Badge>
        ) : timeline && timeline.tone !== 'done' ? (
          <Badge tone={timeline.tone}>{timeline.label}</Badge>
        ) : (
          <Badge tone="done">On track</Badge>
        )}
      </div>

      {timeline && (
        <MeterRow
          label="Schedule elapsed"
          value={`${timeline.elapsedPercent}%`}
          percent={timeline.elapsedPercent}
        />
      )}

      <MeterRow
        label="Spend vs budget"
        value={
          budget === null
            ? moneyShort(site.spend_month)
            : `${moneyShort(site.spend_month)} / ${moneyShort(site.budget_amount)}`
        }
        percent={Math.min(budgetUsed, 100)}
        overflowPercent={overBudget ? Math.min(budgetUsed - 100, 30) : 0}
        tone="ink"
        valueTone={overBudget ? 'blocked' : 'neutral'}
      />

      <div className="mt-auto flex items-center justify-between border-t border-line-soft pt-3">
        {site.dpr_status === 'submitted' ? (
          <Badge tone="done" dot={false}>
            DPR {timeOfDay(site.dpr_submitted_at)}
          </Badge>
        ) : site.dpr_status === 'draft' ? (
          <Badge tone="pending" dot={false}>
            DPR draft
          </Badge>
        ) : (
          <Badge tone="pending" dot={false}>
            DPR pending
          </Badge>
        )}
        <div className="flex items-center gap-3 text-[13px] text-ink-muted">
          {site.urgent_indents > 0 && (
            <span className="font-semibold text-blocked-fg">{site.urgent_indents} urgent</span>
          )}
          <span>{site.headcount_today} on site</span>
        </div>
      </div>
    </Link>
  );
}
