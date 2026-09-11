'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Chart primitives for the platform console.
 *
 * Hand-rolled SVG rather than a charting library, matching `components/headcount-chart`.
 * These are five fixed shapes with no zoom, no legend engine and no axis generation; a
 * library would add 40–90 KB to a page three people open, and its default styling would
 * have to be fought back to the design tokens anyway.
 *
 * Every value carries a `title`, so the exact figure is one hover away. That is what lets
 * the charts stay unlabelled and still be trustworthy — the shape is for scanning, the
 * tooltip is for reading.
 */

/** A week or day label like "7 Sep". */
function shortLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`);
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function ChartEmpty({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-[150px] items-center justify-center rounded-panel border border-dashed border-line-strong text-[13px] text-ink-muted',
        className,
      )}
    >
      {label}
    </div>
  );
}

/**
 * Bars with a line riding on top — new signups per week against the running total.
 *
 * Two scales on one frame, which is usually a mistake. It works here because nobody reads
 * the line's value: its job is to show whether growth is accelerating, and the bars carry
 * the numbers. The line is accent and the bars are ink, so they are not mistaken for one
 * series.
 */
export function GrowthChart({
  data,
  className,
}: {
  data: Array<{ week: string; count: number; cumulative: number }>;
  className?: string;
}) {
  const gradientId = useId();
  if (data.length === 0) return <ChartEmpty className={className} label="No signups yet" />;

  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const maxCumulative = Math.max(...data.map((d) => d.cumulative), 1);

  // A single-point series has no line to draw, so it is centred rather than collapsing
  // into a degenerate path.
  const points = data.map((d, index) => ({
    x: data.length === 1 ? 50 : (index / (data.length - 1)) * 100,
    y: 100 - (d.cumulative / maxCumulative) * 100,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L100,100 L0,100 Z`;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="relative h-[150px]">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(108 76 224)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="rgb(108 76 224)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke="rgb(108 76 224)"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        </svg>

        <div className="absolute inset-0 flex items-end gap-1">
          {data.map((d) => (
            <div key={d.week} className="group flex h-full flex-1 items-end justify-center">
              <div
                className="w-full max-w-[26px] rounded-t-[3px] bg-ink/70 transition group-hover:bg-ink"
                style={{
                  height: `${d.count === 0 ? 1.5 : Math.max(5, (d.count / maxCount) * 88)}%`,
                }}
                title={`Week of ${shortLabel(d.week)} — ${d.count} new, ${d.cumulative} total`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11.5px] text-ink-muted">
        <span className="font-mono">{shortLabel(data[0]!.week)}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[2px] bg-ink/70" /> new
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-3 bg-accent" /> total
          </span>
        </span>
        <span className="font-mono">{shortLabel(data[data.length - 1]!.week)}</span>
      </div>
    </div>
  );
}

/**
 * The activation funnel.
 *
 * Each bar is a share of total signups, so the bars are comparable top to bottom, and the
 * number that matters — how many tenants were lost at this particular step — sits on the
 * right in the blocked colour.
 *
 * The biggest drop is marked. On a funnel of six steps the eye goes to the longest bar,
 * which is the step that is going *well*; the one worth looking at is the largest fall
 * between two bars, and that takes pointing at.
 */
export function FunnelChart({
  steps,
  className,
}: {
  steps: Array<{ key: string; label: string; count: number; percent: number; dropped: number }>;
  className?: string;
}) {
  const worst = steps.reduce(
    (best, step) => (step.dropped > best.dropped ? step : best),
    { dropped: 0, key: '' } as { dropped: number; key: string },
  );

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {steps.map((step) => {
        const biggestDrop = step.dropped > 0 && step.key === worst.key;
        return (
          <div key={step.key} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="flex items-center gap-2">
                <span className="font-medium">{step.label}</span>
                {biggestDrop && (
                  <span className="rounded-full bg-blocked-bg px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-blocked-fg">
                    biggest drop
                  </span>
                )}
              </span>
              <span className="flex flex-none items-baseline gap-2.5 font-mono">
                {step.dropped > 0 && (
                  <span className="text-[12px] text-blocked-fg">−{step.dropped}</span>
                )}
                <span className="font-semibold">{step.count}</span>
                <span className="w-9 text-right text-[12px] text-ink-muted">{step.percent}%</span>
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-track">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  biggestDrop ? 'bg-blocked' : 'bg-accent',
                )}
                style={{ width: `${Math.max(step.percent, 1)}%` }}
                title={`${step.count} tenants — ${step.percent}% of all signups`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Weekly active tenants as a share of those that existed.
 *
 * Bars are tinted by the percentage rather than all one colour: a week where a fifth of
 * the platform did any work is a different fact from one where most of it did, and that
 * difference should be visible without reading the numbers.
 */
export function EngagementChart({
  data,
  className,
}: {
  data: Array<{ week: string; active: number; existing: number; percent: number }>;
  className?: string;
}) {
  if (data.length === 0) return <ChartEmpty className={className} label="No activity yet" />;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex h-[130px] items-end gap-1">
        {data.map((d) => {
          const tone =
            d.percent >= 60
              ? 'bg-done'
              : d.percent >= 30
                ? 'bg-pending'
                : d.percent > 0
                  ? 'bg-blocked'
                  : 'bg-line-strong';
          return (
            <div key={d.week} className="group flex h-full flex-1 flex-col justify-end gap-1">
              <div
                className={cn('rounded-t-[3px] transition', tone)}
                style={{ height: `${d.percent === 0 ? 2 : Math.max(6, d.percent)}%` }}
                title={`Week of ${shortLabel(d.week)} — ${d.active} of ${d.existing} tenants worked (${d.percent}%)`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11.5px] text-ink-muted">
        <span className="font-mono">{shortLabel(data[0]!.week)}</span>
        <span>share of tenants that did work</span>
        <span className="font-mono">{shortLabel(data[data.length - 1]!.week)}</span>
      </div>
    </div>
  );
}

/**
 * Daily volume across the platform, stacked by what was recorded.
 *
 * Stacked rather than three separate lines: the question is "is the platform busier than
 * last week", and one column per day answers it at a glance. The split within each column
 * is secondary, which is exactly what stacking says.
 *
 * Sundays are tinted, because a construction week runs six days and a drop every seventh
 * column is the calendar, not a problem.
 */
export function VolumeChart({
  data,
  className,
}: {
  data: Array<{ day: string; attendance: number; reports: number; expenses: number }>;
  className?: string;
}) {
  if (data.length === 0) return <ChartEmpty className={className} label="Nothing recorded yet" />;

  const totals = data.map((d) => d.attendance + d.reports + d.expenses);
  const max = Math.max(...totals, 1);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex h-[130px] items-end gap-[3px]">
        {data.map((d, index) => {
          const total = totals[index] ?? 0;
          const height = total === 0 ? 2 : Math.max(6, (total / max) * 100);
          const sunday = new Date(`${d.day}T00:00:00.000Z`).getUTCDay() === 0;
          return (
            <div
              key={d.day}
              className="group flex h-full flex-1 flex-col justify-end"
              title={`${shortLabel(d.day)} — ${d.attendance} attendance, ${d.reports} reports, ${d.expenses} expenses`}
            >
              <div
                className={cn(
                  'flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]',
                  total === 0 && (sunday ? 'bg-line-soft' : 'bg-line-strong'),
                )}
                style={{ height: `${height}%` }}
              >
                {total > 0 && (
                  <>
                    <Segment value={d.expenses} total={total} className="bg-pending" />
                    <Segment value={d.reports} total={total} className="bg-accent" />
                    <Segment value={d.attendance} total={total} className="bg-ink/70" />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-ink-muted">
        <span className="font-mono">{shortLabel(data[0]!.day)}</span>
        <span className="flex items-center gap-3">
          <Key className="bg-ink/70" label="attendance" />
          <Key className="bg-accent" label="reports" />
          <Key className="bg-pending" label="expenses" />
        </span>
        <span className="font-mono">{shortLabel(data[data.length - 1]!.day)}</span>
      </div>
    </div>
  );
}

function Segment({
  value,
  total,
  className,
}: {
  value: number;
  total: number;
  className: string;
}) {
  if (value === 0) return null;
  return (
    <div
      className={className}
      // A floor of 6% so a single row in a busy day is still a visible sliver rather
      // than a sub-pixel line that rounds away to nothing.
      style={{ height: `${Math.max((value / total) * 100, 6)}%` }}
    />
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('h-2 w-3 rounded-[2px]', className)} />
      {label}
    </span>
  );
}

/**
 * Plan mix as a single proportional bar.
 *
 * A donut was the obvious choice and the wrong one: with two segments a ring is harder to
 * read than a bar, and it wastes a square of space that a wide card does not have to
 * spare.
 */
export function PlanMixBar({
  starter,
  pro,
  className,
}: {
  starter: number;
  pro: number;
  className?: string;
}) {
  const total = starter + pro;
  const proShare = total === 0 ? 0 : Math.round((pro / total) * 100);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex h-3 overflow-hidden rounded-full bg-track">
        <div
          className="bg-accent transition-all"
          style={{ width: `${total === 0 ? 0 : (pro / total) * 100}%` }}
          title={`${pro} on Pro`}
        />
        <div
          className="bg-ink/25 transition-all"
          style={{ width: `${total === 0 ? 100 : (starter / total) * 100}%` }}
          title={`${starter} on Starter`}
        />
      </div>
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[2px] bg-accent" />
          <span className="font-semibold">{pro}</span>
          <span className="text-ink-muted">Pro · {proShare}%</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[2px] bg-ink/25" />
          <span className="font-semibold">{starter}</span>
          <span className="text-ink-muted">Starter</span>
        </span>
      </div>
    </div>
  );
}
