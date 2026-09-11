import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * Accent is the only colour used for action (design rule, ADR 0002).
 *
 * `approve` is the one sanctioned exception: it commits the builder's money, and
 * the design gives it the done colour so a green button never means "next".
 * `destructive` is outline-only for the same reason — status colour lives in the
 * border and text, never as a filled surface.
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-white hover:brightness-[.92]',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-raised',
        approve: 'bg-done text-white hover:brightness-[.93]',
        ghost: 'text-ink-soft hover:bg-raised',
        destructive: 'border border-blocked/40 bg-surface text-blocked-fg hover:bg-blocked-bg',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 rounded-[8px] px-3 text-[13px]',
        md: 'h-10 rounded-[10px] px-4 text-[13.5px]',
        // 56px — the design's primary button height on mobile.
        lg: 'h-14 rounded-[13px] px-5 text-[17px]',
        icon: 'h-10 w-10 rounded-[10px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
