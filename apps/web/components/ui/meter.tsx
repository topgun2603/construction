import { TONE_TEXT, type Tone } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Progress track. `overflowPercent` paints the part that has run past budget in
 * the blocked colour — a bar is one of the three places the design lets status
 * colour appear.
 */
export function ProgressBar({
  percent,
  overflowPercent = 0,
  tone = 'accent',
  className,
}: {
  percent: number;
  overflowPercent?: number;
  tone?: 'accent' | 'ink';
  className?: string;
}) {
  const base = clamp(percent);
  const over = clamp(overflowPercent);
  return (
    <div className={cn('flex h-[7px] overflow-hidden rounded-full bg-track', className)}>
      <div
        className={tone === 'accent' ? 'h-full bg-accent' : 'h-full bg-ink-soft'}
        style={{ width: `${base}%` }}
      />
      {over > 0 && <div className="h-full bg-blocked" style={{ width: `${over}%` }} />}
    </div>
  );
}

/** Label + mono value above a bar — the card's "Progress" and "Spend" rows. */
export function MeterRow({
  label,
  value,
  valueTone = 'neutral',
  percent,
  overflowPercent,
  tone,
}: {
  label: string;
  value: string;
  valueTone?: Tone;
  percent: number;
  overflowPercent?: number;
  tone?: 'accent' | 'ink';
}) {
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="flex justify-between text-[13px] leading-tight text-ink-muted">
        <span>{label}</span>
        <span
          className={cn(
            'font-mono font-semibold',
            valueTone === 'neutral' ? 'text-ink' : TONE_TEXT[valueTone],
          )}
        >
          {value}
        </span>
      </div>
      <ProgressBar percent={percent} overflowPercent={overflowPercent} tone={tone} />
    </div>
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
