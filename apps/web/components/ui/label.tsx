'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-[13.5px] font-semibold leading-tight', className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

/** Label + control + optional error, the shape every form row uses. */
function Field({
  label,
  hint,
  optional,
  error,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  /** Not required. Said beside the label, where it is read before the field is filled. */
  optional?: boolean;
  error?: string;
  htmlFor?: string;
  /** For laying a field out in a row — a width or a flex basis. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline gap-2">
        <Label htmlFor={htmlFor}>{label}</Label>
        {optional && <span className="text-[12px] font-normal text-ink-faint">Optional</span>}
      </div>
      {children}
      {error ? (
        <p className="text-[12.5px] leading-tight text-blocked-fg">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] leading-tight text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export { Label, Field };
