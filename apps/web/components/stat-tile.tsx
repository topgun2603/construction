import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { TONE_TEXT, type Tone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AnimatedNumber } from '@/components/motion';
import { cn } from '@/lib/utils';

/**
 * A headline number (design artboard 3a).
 *
 * The value is mono so a row of tiles lines up, and the *note* carries the tone —
 * the design never colours the metric itself, because a red number reads as an
 * error rather than as a state. The icon's tile carries it too, which is what lets
 * a row of four be read at a glance from across a desk without any of the numbers
 * shouting.
 */

/** Icon tile colours. Keyed by tone so the tile and the note can never disagree. */
const ICON_TONE: Record<Tone, string> = {
  done: 'bg-done-bg text-done-fg',
  pending: 'bg-pending-bg text-pending-fg',
  blocked: 'bg-blocked-bg text-blocked-fg',
  neutral: 'bg-accent-soft text-accent',
  accent: 'bg-accent-soft text-accent',
};

export function StatTile({
  label,
  value,
  note,
  noteTone = 'neutral',
  tone,
  icon,
  animate = false,
  href,
  hrefLabel,
}: {
  label: string;
  value: string;
  note?: string;
  noteTone?: Tone;
  /** Colour of the icon tile. Defaults to the note's tone, which is usually what is meant. */
  tone?: Tone;
  icon?: ReactNode;
  /** Count up on first view. Only for plain integers — never money. */
  animate?: boolean;
  /** Where the tile's corner arrow goes. Omitted when the number leads nowhere useful. */
  href?: string;
  hrefLabel?: string;
}) {
  const numeric = animate ? Number(value.replace(/[^\d-]/g, '')) : Number.NaN;

  return (
    <Card className="relative flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <span
              className={cn(
                'flex size-11 flex-none items-center justify-center rounded-[13px]',
                ICON_TONE[tone ?? noteTone],
              )}
            >
              {icon}
            </span>
          )}
          <span className="truncate text-[11.5px] font-semibold uppercase leading-tight tracking-[0.1em] text-ink-muted">
            {label}
          </span>
        </div>

        {href && (
          <Link
            href={href}
            aria-label={hrefLabel ?? `Open ${label}`}
            className="flex size-7 flex-none items-center justify-center rounded-full bg-neutral-bg text-ink-muted transition hover:bg-accent-soft hover:text-accent"
          >
            <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[30px] font-bold leading-[1.02]">
          {animate && Number.isFinite(numeric) ? <AnimatedNumber value={numeric} /> : value}
        </span>
        {note && (
          <span className={cn('text-[12.5px] leading-snug', TONE_TEXT[noteTone])}>{note}</span>
        )}
      </div>
    </Card>
  );
}
