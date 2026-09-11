'use client';

import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

/**
 * How far back the growth and engagement charts look.
 *
 * In the URL so a window can be shared, and limited to four presets rather than a date
 * picker: the question this page answers is "is the trend up or down", and a free date
 * range invites fiddling with boundaries instead of reading the shape.
 */
const RANGES = [
  { weeks: 4, label: '1M' },
  { weeks: 12, label: '3M' },
  { weeks: 26, label: '6M' },
  { weeks: 52, label: '1Y' },
];

export function RangePicker({ weeks }: { weeks: number }) {
  const router = useRouter();

  return (
    <div className="flex gap-1 rounded-btn bg-neutral-bg p-1" role="group" aria-label="Date range">
      {RANGES.map((range) => (
        <button
          key={range.weeks}
          type="button"
          aria-pressed={weeks === range.weeks}
          onClick={() => router.push(`/admin?weeks=${range.weeks}`)}
          className={cn(
            'min-h-0 rounded-[7px] px-3 py-1.5 text-[12.5px] font-medium transition',
            weeks === range.weeks
              ? 'bg-surface font-semibold text-ink shadow-seg'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}
