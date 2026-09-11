'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const GROUPS = [
  { value: 'project', label: 'By site' },
  { value: 'contractor', label: 'By contractor' },
  { value: 'worker', label: 'By worker' },
] as const;

/**
 * How the labour cost report is grouped.
 *
 * Dates are NOT here. `ReportsNav` owns the range for every report, and having a second
 * pair of date inputs on this page meant two controls for one piece of state — change one
 * and the other was stale, which is worse than having no control at all.
 *
 * The grouping still travels in the URL alongside the range, so the whole view is one
 * shareable link.
 */
export function ReportFilters({
  groupBy,
  from,
  to,
}: {
  groupBy: string;
  from: string;
  to: string;
}) {
  const router = useRouter();

  return (
    <div className="flex gap-1 rounded-btn bg-neutral-bg p-1" role="group" aria-label="Group by">
      {GROUPS.map((group) => (
        <button
          key={group.value}
          type="button"
          aria-pressed={groupBy === group.value}
          onClick={() =>
            router.push(`/reports?group_by=${group.value}&from=${from}&to=${to}`)
          }
          className={cn(
            'min-h-0 rounded-[7px] px-3 py-2 text-[13px] font-medium transition',
            groupBy === group.value
              ? 'bg-surface font-semibold text-ink shadow-seg'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {group.label}
        </button>
      ))}
    </div>
  );
}
