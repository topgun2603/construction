import type { ReactNode } from 'react';
import Image from 'next/image';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The design's empty state (artboard 1c): dashed border, a short line about the
 * effort involved, and the action right there. Never a bare "No data".
 *
 * The icon is a real glyph naming the thing that is missing — sites, workers, a
 * wage sheet. An abstract outlined square tells the reader nothing and reads as an
 * image that failed to load.
 *
 * `illustration` replaces the glyph on the handful of screens a new account lands on with nothing
 * in them, where the empty state *is* the screen and the real question is "is this broken, or have
 * I just not done it yet". It is opt-in rather than everywhere: an empty list in the middle of a
 * working day is an answer — "nothing is waiting on you" — and dressing every one of those up
 * would make the product slower to read.
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  illustration,
  className,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  /** A lucide icon, sized by this component. */
  icon?: ReactNode;
  /** A file in `public/illustrations`, without the extension. Replaces the icon when present. */
  illustration?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2.5 rounded-panel border border-dashed border-line-strong bg-raised px-5 py-9 text-center',
        className,
      )}
    >
      {illustration ? (
        <Image
          src={`/illustrations/${illustration}.webp`}
          alt=""
          width={280}
          height={210}
          // Decorative: the title and body say everything this picture does, so a screen reader
          // announcing it would be repeating itself.
          aria-hidden
          className="h-auto w-full max-w-[280px]"
        />
      ) : (
        <span className="flex size-11 items-center justify-center rounded-full bg-neutral-bg text-ink-muted [&_svg]:size-[22px]">
          {icon ?? <Inbox />}
        </span>
      )}
      <div
        className={cn('font-semibold leading-snug', illustration ? 'text-[18px]' : 'text-[16px]')}
      >
        {title}
      </div>
      <p className="max-w-[280px] text-[13.5px] leading-relaxed text-ink-muted">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
