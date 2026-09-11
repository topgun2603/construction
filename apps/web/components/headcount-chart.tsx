'use client';

import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Headcount over the last week (design artboard 3a).
 *
 * Deliberately not a charting library: seven bars with a shared max needs no axis,
 * no tooltip layer and no 40 KB dependency. The bar heights are a percentage of the
 * busiest day, so the shape reads even when the numbers are small.
 */
export function HeadcountChart({
  series,
  className,
}: {
  series: Array<{ date: string; count: number }>;
  className?: string;
}) {
  const max = Math.max(...series.map((point) => point.count), 1);
  const total = series.reduce((sum, point) => sum + point.count, 0);
  const worked = series.filter((point) => point.count > 0);
  const average = worked.length > 0 ? Math.round(total / worked.length) : 0;
  const busiest = series.reduce((best, point) => (point.count > best.count ? point : best), series[0]!);

  return (
    <Card className={cn('flex flex-col gap-3 p-4', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          Headcount · last 7 days
        </span>
        <span className="font-mono text-[13px] text-ink-muted">avg {average}</span>
      </div>

      <div className="flex flex-1 items-end gap-2 pt-2">
        {series.map((point, index) => {
          const isToday = index === series.length - 1;
          const height = point.count === 0 ? 4 : Math.max(8, (point.count / max) * 100);
          return (
            <div key={point.date} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className={cn(
                  'font-mono text-[11px] leading-none',
                  point.count === 0 ? 'text-ink-faint' : isToday ? 'text-ink' : 'text-ink-muted',
                )}
              >
                {point.count > 0 ? point.count : ''}
              </span>
              <div className="flex h-20 w-full items-end">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${height}%` }}
                  transition={{ duration: 0.4, delay: index * 0.04, ease: [0.22, 0.61, 0.36, 1] }}
                  className={cn(
                    'w-full rounded-t-[5px]',
                    point.count === 0
                      ? 'bg-neutral-bg'
                      : isToday
                        ? 'bg-accent'
                        : 'bg-accent-soft',
                  )}
                />
              </div>
              <span
                className={cn(
                  'font-mono text-[11px] leading-none',
                  isToday ? 'font-semibold text-ink' : 'text-ink-faint',
                )}
              >
                {weekday(point.date)}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[12.5px] leading-snug text-ink-muted">
        {total === 0
          ? 'No attendance recorded this week.'
          : `Busiest was ${weekday(busiest.date)} with ${busiest.count} on site.`}
      </p>
    </Card>
  );
}

/** `2026-09-09` → `We`. */
function weekday(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' })
    .format(date)
    .slice(0, 2);
}
