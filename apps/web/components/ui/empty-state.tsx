import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The design's empty state (artboard 1c): dashed border, a short line about the
 * effort involved, and the action right there. Never a bare "No data".
 *
 * The icon is a real glyph naming the thing that is missing — sites, workers, a
 * wage sheet. An abstract outlined square tells the reader nothing and reads as an
 * image that failed to load.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  /** A lucide icon, sized by this component. */
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2.5 rounded-panel border border-dashed border-line-strong bg-raised px-5 py-9 text-center',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-neutral-bg text-ink-muted [&_svg]:size-[22px]">
        {icon ?? <Inbox />}
      </span>
      <div className="text-[16px] font-semibold leading-snug">{title}</div>
      <p className="max-w-[280px] text-[13.5px] leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
