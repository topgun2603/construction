import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * A status is dot + word + colour — three signals, so it still reads for
 * colour-blind users and on a phone in direct sun (design artboard 1c).
 * The dot is on by default; turn it off only for a plain label pill.
 */
const badgeVariants = cva(
  'inline-flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold leading-tight',
  {
    variants: {
      tone: {
        done: 'bg-done-bg text-done-fg',
        pending: 'bg-pending-bg text-pending-fg',
        blocked: 'bg-blocked-bg text-blocked-fg',
        neutral: 'bg-neutral-bg text-neutral-fg',
        accent: 'bg-accent-soft text-accent',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

const DOT: Record<string, string> = {
  done: 'bg-done',
  pending: 'bg-pending',
  blocked: 'bg-blocked',
  neutral: 'bg-ink-faint',
  accent: 'bg-accent',
};

export type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/** Text colour for a tone, for the places a full pill would be too heavy. */
export const TONE_TEXT: Record<Tone, string> = {
  done: 'text-done-fg',
  pending: 'text-pending-fg',
  blocked: 'text-blocked-fg',
  neutral: 'text-ink-muted',
  accent: 'text-accent',
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, tone = 'neutral', dot = true, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className={cn('h-1.5 w-1.5 flex-none rounded-full', DOT[tone ?? 'neutral'])} />}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
