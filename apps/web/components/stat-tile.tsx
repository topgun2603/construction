import type { ReactNode } from 'react';
import { TONE_TEXT, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * A headline number (design artboard 3a).
 *
 * The value is mono so a row of tiles lines up, and the *note* carries the tone —
 * the design never colours the metric itself, because a red number reads as an
 * error rather than as a state.
 */
export function StatTile({
  label,
  value,
  note,
  noteTone = 'neutral',
  icon,
  animate = false,
}: {
  label: string;
  value: string;
  note?: string;
  noteTone?: Tone;
  icon?: ReactNode;
  /** Count up on first view. Only for plain integers — never money. */
  animate?: boolean;
}) {
  const numeric = animate ? Number(value.replace(/[^\d-]/g, '')) : Number.NaN;

  return (
    <Card className="flex flex-col gap-1.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase leading-tight tracking-[0.08em] text-ink-muted">
          {label}
        </span>
        {icon && <span className="text-ink-faint">{icon}</span>}
      </div>
      <span className="font-mono text-[26px] font-bold leading-[1.05]">
        {animate && Number.isFinite(numeric) ? <AnimatedNumber value={numeric} /> : value}
      </span>
      {note && (
        <span className={cn('text-[13px] leading-tight', TONE_TEXT[noteTone])}>{note}</span>
      )}
    </Card>
  );
}
